import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

/**
 * A tripwire for the `ci-public` acceptance criterion.
 *
 * `docs/ROADMAP.md` M1: "The `ci-public` profile exits as an
 * unsupported/configuration condition and makes no public connection." The
 * exit code is easy to assert and is the weaker half. This module asserts the
 * other half two ways, because they fail differently:
 *
 * - a **listener** on an ephemeral loopback port, whose URL is handed to the
 *   command as the target. If the refusal ever leaked into a connection, that
 *   connection would arrive here and be counted. It catches a socket opened by
 *   any route, including one nobody thought to stub;
 * - a **recording deny** over `dns`, `net.Socket#connect`, `http`, `https` and
 *   `tls`. It catches an attempt that never reaches a socket, which is the
 *   only thing the listener cannot see - a DNS lookup for a public name is a
 *   disclosure whether or not a connection follows.
 *
 * `packages/testkit` already ships both ideas, and neither is reused here.
 * `openConnectionCanary` binds with a host argument, which routes through
 * `dns.lookup`, and the deny-all sentinel this suite runs under has replaced
 * that with a thrower; binding to the ephemeral port with no host avoids the
 * lookup entirely. The recording deny is separate from the sentinel because
 * the sentinel's handle is installed by a setup file and is not reachable from
 * a test, so there is no `blocked` array here to read.
 */

export interface Canary {
  /** `http://127.0.0.1:<port>`, ready to hand to the command under test. */
  readonly origin: string;
  readonly connections: number;
  close(): Promise<void>;
}

export async function openCanary(): Promise<Canary> {
  const server = net.createServer();
  let connections = 0;
  server.on("connection", (socket) => {
    connections += 1;
    socket.destroy();
  });

  const port = await new Promise<number>((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error);
    };
    server.once("error", onError);
    // No host argument. `listen(0, host)` resolves the host through
    // `dns.lookup`, which the deny-all sentinel refuses.
    server.listen(0, () => {
      server.removeListener("error", onError);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("the canary bound to a pipe rather than a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });

  return {
    origin: `http://127.0.0.1:${String(port)}`,
    get connections() {
      return connections;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      }),
  };
}

export interface NetworkDeny {
  /** Every refused attempt, as `api target`, in order. */
  readonly attempts: readonly string[];
  restore(): void;
}

interface Target {
  readonly owner: object;
  readonly name: string;
  readonly label: string;
}

const TARGETS: readonly Target[] = [
  { owner: dns, name: "lookup", label: "dns.lookup" },
  { owner: dns.promises, name: "lookup", label: "dns.promises.lookup" },
  { owner: dns, name: "resolve", label: "dns.resolve" },
  { owner: dns.promises, name: "resolve", label: "dns.promises.resolve" },
  { owner: net.Socket.prototype, name: "connect", label: "net.Socket#connect" },
  { owner: http, name: "request", label: "http.request" },
  { owner: https, name: "request", label: "https.request" },
  { owner: tls, name: "connect", label: "tls.connect" },
];

/**
 * Replaces each API with a recorder that throws.
 *
 * It never calls through, which is what keeps it free of a cast: a wrapper
 * that had to forward to an overloaded Node signature would need one, and the
 * only assertion made against this is that nothing was called at all.
 */
export function denyNetwork(): NetworkDeny {
  const attempts: string[] = [];
  const restores: (() => void)[] = [];

  for (const target of TARGETS) {
    const previous = Object.getOwnPropertyDescriptor(target.owner, target.name);
    if (previous === undefined) continue;
    const recorder = (...args: readonly unknown[]): never => {
      const first = args[0];
      attempts.push(
        `${target.label} ${typeof first === "string" ? first : "(non-string argument)"}`,
      );
      throw new Error(`${target.label} was called and must not have been`);
    };
    Object.defineProperty(target.owner, target.name, {
      value: recorder,
      writable: true,
      configurable: true,
      enumerable: previous.enumerable ?? false,
    });
    restores.push(() => {
      Object.defineProperty(target.owner, target.name, previous);
    });
  }

  return {
    attempts,
    restore: () => {
      for (const restore of restores.reverse()) restore();
    },
  };
}
