import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

import type { HttpTransportRequest } from "@agentready-lab/core";

import { createNetworkPolicy } from "../../src/index.js";
import type { LocalLoopbackPolicy } from "../../src/index.js";
// By module path, because the entry point does not export the connector or
// the types that describe it. A test may reach inside the package; a consumer
// of the published surface may not.
import type {
  ConnectionAttempt,
  ExchangeResult,
  OpenExchange,
} from "../../src/safe-fetcher.js";

/**
 * Loopback servers and a connector spy.
 *
 * `docs/TEST_STRATEGY.md` and `.claude/rules/testing.md` both forbid public
 * network access in the default suite, and `docs/THREAT_MODEL.md` section 27
 * requires "injected resolvers, connectors, clocks, byte streams, and local
 * canaries". Everything here binds to a loopback address on an ephemeral port
 * and is closed by the test that started it.
 */

export interface Loopback {
  readonly origin: string;
  readonly port: number;
  /** Connections accepted, for a canary that must observe none. */
  readonly connections: () => number;
  close(): Promise<void>;
}

function originFor(host: string, port: number, scheme = "http"): string {
  return host.includes(":")
    ? `${scheme}://[${host}]:${String(port)}`
    : `${scheme}://${host}:${String(port)}`;
}

export async function startHttpServer(
  handler: (
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) => void,
  host = "127.0.0.1",
): Promise<Loopback> {
  const sockets = new Set<net.Socket>();
  let accepted = 0;
  const server = http.createServer(handler);
  server.on("connection", (socket) => {
    accepted += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });

  const address = server.address() as AddressInfo;
  return {
    origin: originFor(host, address.port),
    port: address.port,
    connections: () => accepted,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

/**
 * A self-signed certificate, made in the test process and trusted by nobody.
 *
 * A behavioural TLS case needs a certificate the client will refuse, and this
 * is how to get one without adding a dependency, shelling out to `openssl`, or
 * committing key material. `node:crypto` generates the key pair and signs;
 * everything between is the DER of the smallest X.509 the verifier accepts.
 * There are no extensions and no subjectAltName, because nothing here is meant
 * to be trusted: the fixture exists so that verification fails.
 */
function derLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest >>>= 8) bytes.unshift(rest & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}

/** `YYMMDDHHMMSSZ`, the only form an X.509 `UTCTime` takes. */
function utcTime(at: Date): Buffer {
  const text = at
    .toISOString()
    .replace(/[-:T]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return der(0x17, Buffer.from(text.slice(2), "ascii"));
}

/** `SEQUENCE { SET { SEQUENCE { OID commonName, UTF8String cn } } }`. */
function distinguishedName(commonName: string): Buffer {
  const commonNameOid = Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03]);
  return der(
    0x30,
    der(
      0x31,
      der(
        0x30,
        Buffer.concat([
          commonNameOid,
          der(0x0c, Buffer.from(commonName, "utf8")),
        ]),
      ),
    ),
  );
}

export function selfSignedCertificate(commonName = "localhost"): {
  readonly cert: string;
  readonly key: string;
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  // OID 1.3.101.112. Ed25519 takes no algorithm parameters, and an absent
  // parameter field is what the encoding below spells.
  const algorithm = der(0x30, Buffer.from([0x06, 0x03, 0x2b, 0x65, 0x70]));
  const now = Date.now();
  const tbs = der(
    0x30,
    Buffer.concat([
      der(0xa0, Buffer.from([0x02, 0x01, 0x02])), // version, v3
      Buffer.from([0x02, 0x01, 0x01]), // serial number, 1
      algorithm,
      distinguishedName(commonName),
      der(
        0x30,
        Buffer.concat([
          utcTime(new Date(now - 3_600_000)),
          utcTime(new Date(now + 3_600_000)),
        ]),
      ),
      distinguishedName(commonName),
      publicKey.export({ type: "spki", format: "der" }),
    ]),
  );
  const signature = crypto.sign(null, tbs, privateKey);
  const certificate = der(
    0x30,
    Buffer.concat([
      tbs,
      algorithm,
      // A BIT STRING carries a leading count of unused trailing bits.
      der(0x03, Buffer.concat([Buffer.from([0x00]), signature])),
    ]),
  );

  const key = privateKey.export({ type: "pkcs8", format: "pem" });
  if (typeof key !== "string") throw new Error("expected a PEM private key");
  const base64 = certificate.toString("base64").replace(/(.{64})/g, "$1\n");
  return {
    cert: `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----\n`,
    key,
  };
}

/** An HTTPS server whose certificate no client has any reason to trust. */
export async function startTlsServer(
  handler: (
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) => void,
  host = "127.0.0.1",
): Promise<Loopback> {
  // `tls.Server` reports its connections as `Duplex`, not as `net.Socket`.
  const sockets = new Set<Duplex>();
  let accepted = 0;
  const server = https.createServer(selfSignedCertificate(), handler);
  server.on("connection", (socket) => {
    accepted += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  // A client that refuses the certificate aborts the handshake, and the
  // rejection arrives here. Unlistened it is only noise in the test output.
  server.on("tlsClientError", () => undefined);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });

  const address = server.address() as AddressInfo;
  return {
    origin: originFor(host, address.port, "https"),
    port: address.port,
    connections: () => accepted,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

/**
 * A server that speaks raw bytes, for responses `http.ServerResponse` refuses
 * to produce: `Transfer-Encoding` beside `Content-Length`, conflicting
 * `Content-Length` values, oversized header blocks, `101`.
 */
export async function startRawServer(
  respond: (requestHead: string) => string | Uint8Array,
  host = "127.0.0.1",
): Promise<Loopback> {
  const sockets = new Set<net.Socket>();
  let accepted = 0;

  const server = net.createServer((socket) => {
    accepted += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);

    let head = "";
    socket.on("data", (chunk: Buffer) => {
      head += chunk.toString("latin1");
      if (!head.includes("\r\n\r\n")) return;
      const payload = respond(head);
      socket.end(
        typeof payload === "string" ? Buffer.from(payload, "latin1") : payload,
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });

  const address = server.address() as AddressInfo;
  return {
    origin: originFor(host, address.port),
    port: address.port,
    connections: () => accepted,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

/** A port nothing is listening on, for "this must never be reached" cases. */
export async function reservedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  return port;
}

export interface ConnectorSpy {
  readonly attempts: readonly ConnectionAttempt[];
  readonly open: OpenExchange;
}

/**
 * A connector that records every attempt and completes none.
 *
 * The assertion a test makes on it is `attempts.length === 0`: a refusal that
 * happens after a socket exists is not a refusal "before a socket exists",
 * and only the recorded attempt list can tell the two apart.
 */
export function createConnectorSpy(): ConnectorSpy {
  const attempts: ConnectionAttempt[] = [];
  return {
    attempts,
    open: (attempt) => {
      attempts.push(attempt);
      return Promise.resolve<ExchangeResult>({
        kind: "failure",
        reason: { code: "connection-failed", phase: "connect" },
      });
    },
  };
}

/** `docs/THREAT_MODEL.md` section 16 defaults, as one transport request. */
export function makeRequest(
  url: string,
  overrides: Partial<HttpTransportRequest> = {},
): HttpTransportRequest {
  return {
    method: "GET",
    url,
    headers: new Map([["accept", ["text/html"]]]),
    redirects: "follow-same-origin",
    maxRedirects: 5,
    maxEncodedBytes: 1048576,
    maxDecodedBytes: 2097152,
    scanRemainingEncodedBytes: 4194304,
    scanRemainingDecodedBytes: 8388608,
    connectTimeoutMs: 3000,
    requestTimeoutMs: 10000,
    ...overrides,
  };
}

/** Unwraps a policy result, failing the test loudly rather than silently. */
export function loopbackPolicy(origin: string): LocalLoopbackPolicy {
  const result = createNetworkPolicy("local-loopback", origin);
  if (result.kind !== "policy") {
    throw new Error(`expected a loopback policy for ${origin}`);
  }
  return result.policy;
}
