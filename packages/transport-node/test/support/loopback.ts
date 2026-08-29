import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";

import type { HttpTransportRequest } from "@agentready-lab/core";

import { createNetworkPolicy } from "../../src/index.js";
import type {
  ConnectionAttempt,
  ExchangeResult,
  LocalLoopbackPolicy,
  OpenExchange,
} from "../../src/index.js";

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

function originFor(host: string, port: number): string {
  return host.includes(":")
    ? `http://[${host}]:${String(port)}`
    : `http://${host}:${String(port)}`;
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
