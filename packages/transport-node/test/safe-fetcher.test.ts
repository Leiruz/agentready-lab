import { Readable } from "node:stream";

import { transportCapabilities } from "@agentready-lab/core";
import { afterEach, describe, expect, it } from "vitest";

import { createNodeTransport, tlsOptionsFor } from "../src/index.js";
import type { ByteStream } from "../src/index.js";
// By module path: the entry point exports neither the connector nor the wire
// types, so that no consumer can reach `http.request` without a policy.
import { createInjectedTransport, nodeExchange } from "../src/safe-fetcher.js";
import type {
  ConnectionAttempt,
  ExchangeResult,
  OpenExchange,
  WireExchange,
} from "../src/safe-fetcher.js";
import {
  createConnectorSpy,
  loopbackPolicy,
  makeRequest,
  reservedPort,
  startHttpServer,
  startRawServer,
  startTlsServer,
} from "./support/loopback.js";
import type { Loopback } from "./support/loopback.js";

/**
 * The `SafeFetcher` against real loopback servers.
 *
 * `docs/THREAT_MODEL.md` section 27 requires "injected resolvers, connectors,
 * clocks, byte streams, and local canaries", and both halves are here: the
 * refusals are proved with a spy that records zero attempts, and the wire
 * behaviour is proved against servers that actually speak HTTP, including a
 * raw one for responses `http.ServerResponse` will not produce.
 */

const closables: Loopback[] = [];

afterEach(async () => {
  await Promise.all(closables.splice(0).map((server) => server.close()));
  for (const key of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "NODE_TLS_REJECT_UNAUTHORIZED",
  ]) {
    Reflect.deleteProperty(process.env, key);
  }
});

function track(server: Loopback): Loopback {
  closables.push(server);
  return server;
}

interface Recorder {
  readonly attempts: readonly ConnectionAttempt[];
  readonly lookups: readonly string[];
  readonly open: OpenExchange;
}

/**
 * The real connector, with the attempts and the `lookup` calls recorded.
 *
 * Wrapping `attempt.lookup` is what turns "an IP literal needs no resolution"
 * from a claim about `net.connect` into an observation: if Node ever asked,
 * the hostname it asked about is in `lookups`.
 */
function recordingExchange(): Recorder {
  const attempts: ConnectionAttempt[] = [];
  const lookups: string[] = [];
  return {
    attempts,
    lookups,
    open: (attempt) => {
      attempts.push(attempt);
      return nodeExchange({
        ...attempt,
        lookup: (hostname, options, callback) => {
          lookups.push(hostname);
          attempt.lookup(hostname, options, callback);
        },
      });
    },
  };
}

function fakeWire(overrides: Partial<WireExchange>): OpenExchange {
  return () =>
    Promise.resolve<ExchangeResult>({
      kind: "wire",
      wire: {
        status: 200,
        rawHeaders: [["content-length", "2"]],
        peerAddress: "127.0.0.1",
        body: Readable.from([new Uint8Array([0x6f, 0x6b])]),
        destroy: () => undefined,
        ...overrides,
      },
    });
}

function text(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

describe("sec-001 and sec-002: the exact loopback origin is observable", () => {
  it("fetches over IPv4 loopback and reports what it read", async () => {
    const seen: Record<string, string | string[] | undefined>[] = [];
    const server = track(
      await startHttpServer((request, response) => {
        seen.push(request.headers);
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("hello");
      }),
    );

    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    const result = await transport.http(makeRequest(`${server.origin}/page`));

    expect(result.kind).toBe("response");
    if (result.kind !== "response") return;
    expect(result.status).toBe(200);
    expect(text(result.body)).toBe("hello");
    expect(result.encodedBytes).toBe(5);
    expect(result.decodedBytes).toBe(5);
    expect(result.truncated).toBe(false);
    expect(result.effectiveUrl).toBe(`${server.origin}/page`);
    expect(result.redirects).toStrictEqual([]);
    // SHA-256 of "hello".
    expect(result.bodySha256).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("fetches over IPv6 loopback", async () => {
    const server = track(
      await startHttpServer((_request, response) => {
        response.end("v6");
      }, "::1"),
    );

    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    const result = await transport.http(makeRequest(`${server.origin}/`));

    expect(result.kind).toBe("response");
    if (result.kind !== "response") return;
    expect(text(result.body)).toBe("v6");
  });
});

describe("request construction", () => {
  it("sends exactly the fixed header set and nothing ambient", async () => {
    let received: Record<string, string | string[] | undefined> = {};
    const server = track(
      await startHttpServer((request, response) => {
        received = request.headers;
        response.end("x");
      }),
    );

    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    await transport.http(
      makeRequest(`${server.origin}/`, {
        headers: new Map([
          ["accept", ["text/markdown"]],
          // Section 18: no caller-supplied arbitrary header is accepted, and
          // these three in particular must never leave the process.
          ["authorization", ["Bearer secret"]],
          ["cookie", ["session=secret"]],
          ["proxy-authorization", ["Basic secret"]],
          ["x-custom", ["anything"]],
        ]),
      }),
    );

    expect(received["accept"]).toBe("text/markdown");
    expect(received["accept-encoding"]).toBe("identity");
    expect(received["host"]).toBe(server.origin.replace("http://", ""));
    expect(received["user-agent"]).toBe("AgentReady-Lab/0.0.0");
    expect(received["authorization"]).toBeUndefined();
    expect(received["cookie"]).toBeUndefined();
    expect(received["proxy-authorization"]).toBeUndefined();
    expect(received["x-custom"]).toBeUndefined();
  });

  it("puts the canonical hostname in Host and the IP only in the socket", async () => {
    const recorder = recordingExchange();
    const server = track(
      await startHttpServer((_request, response) => {
        response.end("x");
      }),
    );

    const transport = createInjectedTransport({
      policy: loopbackPolicy(server.origin),
      openExchange: recorder.open,
    });
    await transport.http(makeRequest(`${server.origin}/`));

    expect(recorder.attempts).toHaveLength(1);
    const attempt = recorder.attempts[0];
    expect(attempt?.address).toBe("127.0.0.1");
    expect(attempt?.hostHeader).toBe(`127.0.0.1:${String(server.port)}`);
    expect(attempt?.headers.find(([name]) => name === "host")?.[1]).toBe(
      `127.0.0.1:${String(server.port)}`,
    );
  });

  it("performs no name lookup for an IP literal", async () => {
    const recorder = recordingExchange();
    const server = track(
      await startHttpServer((_request, response) => {
        response.end("x");
      }),
    );

    const transport = createInjectedTransport({
      policy: loopbackPolicy(server.origin),
      openExchange: recorder.open,
    });
    await transport.http(makeRequest(`${server.origin}/`));

    expect(recorder.lookups).toStrictEqual([]);
  });

  it("supports HEAD without tripping the declared Content-Length check", async () => {
    const server = track(
      await startHttpServer((_request, response) => {
        response.writeHead(200, { "content-length": "5000" });
        response.end();
      }),
    );

    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    const result = await transport.http(
      makeRequest(`${server.origin}/`, {
        method: "HEAD",
        maxEncodedBytes: 100,
        maxDecodedBytes: 100,
      }),
    );

    expect(result.kind).toBe("response");
    if (result.kind !== "response") return;
    expect(result.body.byteLength).toBe(0);
  });
});

describe("sec-003, sec-004 and sec-005: redirects cannot leave the origin", () => {
  async function redirectingTo(location: string): Promise<Loopback> {
    return track(
      await startHttpServer((request, response) => {
        if (request.url === "/start") {
          response.writeHead(302, { location });
          response.end("x".repeat(64));
          return;
        }
        response.end("arrived");
      }),
    );
  }

  it("sec-003: blocks a hop to another loopback port and never connects there", async () => {
    const canary = track(
      await startHttpServer((_request, response) => {
        response.end("should never be read");
      }),
    );
    const server = await redirectingTo(`${canary.origin}/`);

    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    const result = await transport.http(makeRequest(`${server.origin}/start`));

    expect(result).toStrictEqual({
      kind: "failure",
      reason: { code: "redirect-blocked", phase: "redirect" },
    });
    expect(canary.connections()).toBe(0);
  });

  it("sec-004: blocks 127.0.0.1 redirecting to localhost on the same port", async () => {
    // The two names resolve to the same machine and are different origins.
    // The policy is an origin policy, so this is blocked even though nothing
    // about the destination address has changed.
    const server = track(
      await startHttpServer((request, response) => {
        if (request.url === "/start") {
          response.writeHead(302, {
            location: `http://localhost:${String(server.port)}/next`,
          });
          response.end();
          return;
        }
        response.end("arrived");
      }),
    );

    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    const result = await transport.http(makeRequest(`${server.origin}/start`));

    expect(result).toStrictEqual({
      kind: "failure",
      reason: { code: "redirect-blocked", phase: "redirect" },
    });
    expect(server.connections()).toBe(1);
  });

  it("sec-005: blocks a hop to a private LAN address before connecting", async () => {
    const recorder = recordingExchange();
    const server = await redirectingTo("http://10.0.0.1/internal");

    const transport = createInjectedTransport({
      policy: loopbackPolicy(server.origin),
      openExchange: recorder.open,
    });
    const result = await transport.http(makeRequest(`${server.origin}/start`));

    expect(result).toStrictEqual({
      kind: "failure",
      reason: { code: "redirect-blocked", phase: "redirect" },
    });
    expect(recorder.attempts).toHaveLength(1);
    expect(recorder.attempts[0]?.address).toBe("127.0.0.1");
  });

  it("follows a relative same-origin hop and records it", async () => {
    const server = await redirectingTo("/next");

    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    const result = await transport.http(makeRequest(`${server.origin}/start`));

    expect(result.kind).toBe("response");
    if (result.kind !== "response") return;
    expect(text(result.body)).toBe("arrived");
    expect(result.effectiveUrl).toBe(`${server.origin}/next`);
    expect(result.redirects).toStrictEqual([
      {
        status: 302,
        location: `${server.origin}/next`,
        decision: "followed",
      },
    ]);
    // Section 13: the hop body is discarded, so only the final body is
    // charged to the byte budget.
    expect(result.encodedBytes).toBe("arrived".length);
  });

  it("never replays a Set-Cookie across a hop", async () => {
    const seen: (string | undefined)[] = [];
    const server = track(
      await startHttpServer((request, response) => {
        seen.push(request.headers.cookie);
        if (request.url === "/start") {
          response.writeHead(302, {
            location: "/next",
            "set-cookie": "session=secret; Path=/",
          });
          response.end();
          return;
        }
        response.end("arrived");
      }),
    );

    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    await transport.http(makeRequest(`${server.origin}/start`));

    expect(seen).toStrictEqual([undefined, undefined]);
  });

  it("stops at five hops with redirect-limit", async () => {
    const server = track(
      await startHttpServer((request, response) => {
        const step = Number(/\d+/.exec(request.url ?? "")?.[0] ?? "0");
        response.writeHead(302, { location: `/hop${String(step + 1)}` });
        response.end();
      }),
    );

    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    const result = await transport.http(makeRequest(`${server.origin}/hop0`));

    expect(result).toStrictEqual({
      kind: "failure",
      reason: { code: "redirect-limit", phase: "redirect" },
    });
    // Six requests: the first plus five permitted hops. There is no seventh.
    expect(server.connections()).toBe(6);
  });

  it("terminates a canonical loop", async () => {
    const server = track(
      await startHttpServer((request, response) => {
        response.writeHead(302, {
          location: request.url === "/a" ? "/b" : "/a",
        });
        response.end();
      }),
    );

    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    const result = await transport.http(makeRequest(`${server.origin}/a`));

    expect(result).toStrictEqual({
      kind: "failure",
      reason: { code: "redirect-blocked", phase: "redirect" },
    });
  });

  it("returns the 3xx itself when the caller asked not to follow", async () => {
    const server = await redirectingTo("/next");

    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    const result = await transport.http(
      makeRequest(`${server.origin}/start`, { redirects: "reject" }),
    );

    expect(result.kind).toBe("response");
    if (result.kind !== "response") return;
    expect(result.status).toBe(302);
    expect(result.redirects).toStrictEqual([
      { status: 302, location: "/next", decision: "blocked" },
    ]);
    expect(server.connections()).toBe(1);
  });

  it("ignores a Refresh header", async () => {
    const server = track(
      await startHttpServer((_request, response) => {
        response.writeHead(200, { refresh: "0; url=/elsewhere" });
        response.end("body");
      }),
    );

    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    const result = await transport.http(makeRequest(`${server.origin}/`));

    expect(result.kind).toBe("response");
    expect(server.connections()).toBe(1);
  });

  it("ignores links in 103 Early Hints", async () => {
    const server = track(
      await startHttpServer((_request, response) => {
        response.writeEarlyHints({ link: "</style.css>; rel=preload" });
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<p>ok</p>");
      }),
    );

    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    const result = await transport.http(makeRequest(`${server.origin}/`));

    expect(result.kind).toBe("response");
    if (result.kind !== "response") return;
    expect(result.status).toBe(200);
    expect(result.headers.has("link")).toBe(false);
    expect(server.connections()).toBe(1);
  });
});

describe("sec-007: the byte caps", () => {
  it("aborts a body that is one decoded byte over the cap", async () => {
    const server = track(
      await startHttpServer((_request, response) => {
        // No Content-Length, so the streaming counter is what has to catch it.
        response.writeHead(200, { "transfer-encoding": "chunked" });
        response.end("a".repeat(101));
      }),
    );

    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    const result = await transport.http(
      makeRequest(`${server.origin}/`, {
        maxEncodedBytes: 1000,
        maxDecodedBytes: 100,
      }),
    );

    expect(result).toStrictEqual({
      kind: "failure",
      reason: { code: "response-too-large", phase: "body" },
    });
  });

  it("accepts a body exactly at the cap", async () => {
    const server = track(
      await startHttpServer((_request, response) => {
        response.writeHead(200, { "transfer-encoding": "chunked" });
        response.end("a".repeat(100));
      }),
    );

    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    const result = await transport.http(
      makeRequest(`${server.origin}/`, {
        maxEncodedBytes: 1000,
        maxDecodedBytes: 100,
      }),
    );

    expect(result.kind).toBe("response");
    if (result.kind !== "response") return;
    expect(result.decodedBytes).toBe(100);
  });

  it("reports the whole-scan budget when that is the smaller bound", async () => {
    const server = track(
      await startHttpServer((_request, response) => {
        response.writeHead(200, { "transfer-encoding": "chunked" });
        response.end("a".repeat(200));
      }),
    );

    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    const result = await transport.http(
      makeRequest(`${server.origin}/`, {
        scanRemainingEncodedBytes: 50,
        scanRemainingDecodedBytes: 50,
      }),
    );

    expect(result).toStrictEqual({
      kind: "failure",
      reason: { code: "scan-byte-budget-exceeded", phase: "body" },
    });
  });

  it("refuses an oversized Content-Length", async () => {
    const server = track(
      await startHttpServer((_request, response) => {
        response.writeHead(200, { "content-length": "5000" });
        response.end("a".repeat(5000));
      }),
    );

    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    const result = await transport.http(
      makeRequest(`${server.origin}/`, {
        maxEncodedBytes: 100,
        maxDecodedBytes: 100,
      }),
    );

    expect(result).toStrictEqual({
      kind: "failure",
      reason: { code: "response-too-large", phase: "body" },
    });
  });

  it("reads no body byte when Content-Length already exceeds the cap", async () => {
    // Section 16's "check `Content-Length` early", as an observation rather
    // than a claim. The case above cannot make it: a server write callback
    // reports what the server flushed, not what the client consumed, so it
    // stays true for a transport that reads the whole body and rejects it
    // afterwards. Only a stream this test owns can count the reads.
    let reads = 0;
    const body: ByteStream = {
      destroy: () => undefined,
      async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
        reads += 1;
        yield await Promise.resolve(new Uint8Array(5000));
      },
    };

    const transport = createInjectedTransport({
      policy: loopbackPolicy("http://127.0.0.1:8080/"),
      openExchange: fakeWire({
        rawHeaders: [["content-length", "5000"]],
        body,
      }),
    });
    const result = await transport.http(
      makeRequest("http://127.0.0.1:8080/", {
        maxEncodedBytes: 100,
        maxDecodedBytes: 100,
      }),
    );

    expect(result).toStrictEqual({
      kind: "failure",
      reason: { code: "response-too-large", phase: "body" },
    });
    expect(reads).toBe(0);
  });
});

describe("HTTP framing, section 17", () => {
  async function rawResponse(payload: string): Promise<Loopback> {
    return track(await startRawServer(() => payload));
  }

  it("refuses Transfer-Encoding beside Content-Length", async () => {
    const server = await rawResponse(
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Length: 5\r\n\r\n5\r\nhello\r\n0\r\n\r\n",
    );
    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    const result = await transport.http(makeRequest(`${server.origin}/`));

    expect(result.kind).toBe("failure");
    if (result.kind !== "failure") return;
    expect(result.reason.code).toBe("malformed-http");
  });

  it("refuses conflicting Content-Length values", async () => {
    const server = await rawResponse(
      "HTTP/1.1 200 OK\r\nContent-Length: 5\r\nContent-Length: 6\r\n\r\nhello",
    );
    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    const result = await transport.http(makeRequest(`${server.origin}/`));

    expect(result.kind).toBe("failure");
    if (result.kind !== "failure") return;
    expect(result.reason.code).toBe("malformed-http");
  });

  it("refuses an unsupported transfer coding", async () => {
    const server = await rawResponse(
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: gzip\r\n\r\nhello",
    );
    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    const result = await transport.http(makeRequest(`${server.origin}/`));

    expect(result.kind).toBe("failure");
    if (result.kind !== "failure") return;
    expect(result.reason.code).toBe("malformed-http");
  });

  it("refuses a 101 upgrade", async () => {
    const server = await rawResponse(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
    );
    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    const result = await transport.http(makeRequest(`${server.origin}/`));

    expect(result.kind).toBe("failure");
    if (result.kind !== "failure") return;
    expect(result.reason.code).toBe("malformed-http");
  });

  it("refuses more than a hundred response header fields", async () => {
    const filler = Array.from(
      { length: 120 },
      (_value, index) => `X-Pad-${String(index)}: 1\r\n`,
    ).join("");
    const server = await rawResponse(
      `HTTP/1.1 200 OK\r\n${filler}Content-Length: 2\r\n\r\nok`,
    );
    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    const result = await transport.http(makeRequest(`${server.origin}/`));

    expect(result.kind).toBe("failure");
    if (result.kind !== "failure") return;
    expect(result.reason.code).toBe("malformed-http");
  });

  it("refuses a header block over 32 KiB", async () => {
    const server = await rawResponse(
      `HTTP/1.1 200 OK\r\nX-Pad: ${"a".repeat(40000)}\r\nContent-Length: 2\r\n\r\nok`,
    );
    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    const result = await transport.http(makeRequest(`${server.origin}/`));

    expect(result.kind).toBe("failure");
    if (result.kind !== "failure") return;
    expect(result.reason.code).toBe("malformed-http");
  });

  it("refuses a content coding rather than decoding it", async () => {
    // M1 implements no decompressor, so there is no bomb to defuse: a body
    // that claims to be compressed is simply not accepted.
    const server = await rawResponse(
      "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: 2\r\n\r\nok",
    );
    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    const result = await transport.http(makeRequest(`${server.origin}/`));

    expect(result).toStrictEqual({
      kind: "failure",
      reason: { code: "decompression-failure", phase: "decode" },
    });
  });
});

describe("connection pinning and the peer check", () => {
  it("fails closed when the peer is not the selected address", async () => {
    const transport = createInjectedTransport({
      policy: loopbackPolicy("http://127.0.0.1:8080/"),
      openExchange: fakeWire({ peerAddress: "127.0.0.2" }),
    });
    const result = await transport.http(makeRequest("http://127.0.0.1:8080/"));

    expect(result).toStrictEqual({
      kind: "failure",
      reason: { code: "peer-address-mismatch", phase: "connect" },
    });
  });

  it("fails closed when the peer cannot be determined at all", async () => {
    const transport = createInjectedTransport({
      policy: loopbackPolicy("http://127.0.0.1:8080/"),
      openExchange: fakeWire({ peerAddress: null }),
    });
    const result = await transport.http(makeRequest("http://127.0.0.1:8080/"));

    expect(result).toStrictEqual({
      kind: "failure",
      reason: { code: "peer-address-mismatch", phase: "connect" },
    });
  });

  it("accepts an IPv4-mapped spelling of the selected address", async () => {
    const transport = createInjectedTransport({
      policy: loopbackPolicy("http://127.0.0.1:8080/"),
      openExchange: fakeWire({ peerAddress: "::ffff:127.0.0.1" }),
    });
    const result = await transport.http(makeRequest("http://127.0.0.1:8080/"));

    expect(result.kind).toBe("response");
  });
});

describe("ambient environment", () => {
  it("ignores HTTP_PROXY and friends", async () => {
    const proxy = track(
      await startRawServer(
        () => "HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nproxy",
      ),
    );
    const server = track(
      await startHttpServer((_request, response) => {
        response.end("direct");
      }),
    );

    process.env["HTTP_PROXY"] = proxy.origin;
    process.env["HTTPS_PROXY"] = proxy.origin;
    process.env["ALL_PROXY"] = proxy.origin;
    process.env["NO_PROXY"] = "";

    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    const result = await transport.http(makeRequest(`${server.origin}/`));

    expect(result.kind).toBe("response");
    if (result.kind !== "response") return;
    expect(text(result.body)).toBe("direct");
    expect(proxy.connections()).toBe(0);
    expect(server.connections()).toBe(1);
  });

  it("refuses an untrusted certificate with NODE_TLS_REJECT_UNAUTHORIZED=0 set", async () => {
    // The behavioural half, and the one that survives a mutation. Asserting
    // what `tlsOptionsFor` returns says nothing about whether the connector
    // passes it to the socket: deleting the `...tlsOptionsFor(...)` spread
    // from the `https.request` call leaves that assertion true. Here the
    // environment variable would make the default permissive, so a request
    // that reaches this server without the explicit `rejectUnauthorized`
    // succeeds and reads the body.
    const server = track(
      await startTlsServer((_request, response) => {
        response.end("verification was skipped");
      }),
    );
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    const result = await transport.http(makeRequest(`${server.origin}/`));

    expect(result).toStrictEqual({
      kind: "failure",
      reason: { code: "tls-failure", phase: "tls" },
    });
  });

  it("does not honour NODE_TLS_REJECT_UNAUTHORIZED=0", () => {
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
    expect(tlsOptionsFor("preview.test")).toStrictEqual({
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      servername: "preview.test",
    });
    // RFC 6066 forbids an IP literal in SNI, so `servername` is omitted and
    // Node verifies against `host`, which is that same pinned address.
    expect(tlsOptionsFor("127.0.0.1")).toStrictEqual({
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    });
    expect(tlsOptionsFor("::1")).toStrictEqual({
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    });
  });
});

describe("failure semantics", () => {
  it("reports a refused connection without throwing", async () => {
    const port = await reservedPort();
    const origin = `http://127.0.0.1:${String(port)}`;
    const transport = createNodeTransport({
      policy: loopbackPolicy(origin),
    });
    const result = await transport.http(makeRequest(`${origin}/`));

    expect(result.kind).toBe("failure");
    if (result.kind !== "failure") return;
    expect(result.reason.code).toBe("connection-failed");
  });

  it("reports a TLS handshake failure as tls-failure", async () => {
    const server = track(
      await startHttpServer((_request, response) => {
        response.end("plaintext");
      }),
    );
    const origin = `https://127.0.0.1:${String(server.port)}`;
    const transport = createNodeTransport({ policy: loopbackPolicy(origin) });
    const result = await transport.http(makeRequest(`${origin}/`));

    expect(result.kind).toBe("failure");
    if (result.kind !== "failure") return;
    expect(result.reason.code).toBe("tls-failure");
  });

  it("times out a stalled body against an absolute deadline", async () => {
    const server = track(
      await startHttpServer((_request, response) => {
        response.writeHead(200, { "transfer-encoding": "chunked" });
        response.write("start");
        // Never ends: the deadline is the only thing that can stop it.
      }),
    );

    const transport = createNodeTransport({
      policy: loopbackPolicy(server.origin),
    });
    const result = await transport.http(
      makeRequest(`${server.origin}/`, { requestTimeoutMs: 150 }),
    );

    expect(result).toStrictEqual({
      kind: "failure",
      reason: { code: "timeout", phase: "body" },
    });
  });

  it("never lets an exception cross the boundary", async () => {
    const transport = createInjectedTransport({
      policy: loopbackPolicy("http://127.0.0.1:8080/"),
      openExchange: () => {
        throw new Error("connector exploded at http://127.0.0.1:8080/secret");
      },
    });
    const result = await transport.http(makeRequest("http://127.0.0.1:8080/"));

    expect(result).toStrictEqual({
      kind: "failure",
      reason: { code: "connection-failed", phase: "connect" },
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("declares only the http runtime", () => {
    // ADR-0002 section 4: a `dns` rule must resolve to `unsupported-runtime`
    // before `plan()` runs, and core derives that from the methods present.
    const transport = createNodeTransport({
      policy: loopbackPolicy("http://127.0.0.1:8080/"),
    });
    expect(transportCapabilities(transport)).toStrictEqual(["http"]);
  });
});

describe("the connector spy is a real seam", () => {
  it("is what the refusal tests observe", async () => {
    const spy = createConnectorSpy();
    const transport = createInjectedTransport({
      policy: loopbackPolicy("http://127.0.0.1:8080/"),
      openExchange: spy.open,
    });
    await transport.http(makeRequest("http://127.0.0.1:8080/"));
    expect(spy.attempts).toHaveLength(1);
  });
});
