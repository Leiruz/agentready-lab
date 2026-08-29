import net from "node:net";

/**
 * A loopback listener whose only job is to count the connections nobody was
 * supposed to open.
 *
 * The sentinel proves that a *known* network API was not called. This proves
 * the complement: that nothing reached a socket by any route at all, including
 * one nobody thought to stub. A pure-unit test asserts `connections === 0`; a
 * transport test asserts the number it expects.
 *
 * Every accepted socket is destroyed immediately. The canary is a tripwire and
 * never a server, so it must not be usable as one.
 *
 * It belongs to the `loopback-only` sentinel tier. Binding to a host goes
 * through `dns.lookup`, which the `deny-all` tier refuses, and under that tier
 * the sentinel already guarantees what the canary would be measuring.
 */
export class ConnectionCanary {
  readonly #server: net.Server;
  readonly #host: string;
  readonly #port: number;
  readonly #peers: string[] = [];

  constructor(server: net.Server, host: string, port: number) {
    this.#server = server;
    this.#host = host;
    this.#port = port;
    server.on("connection", (socket) => {
      const peer = `${socket.remoteAddress ?? "?"}:${String(socket.remotePort ?? 0)}`;
      this.#peers.push(peer);
      socket.destroy();
    });
  }

  get host(): string {
    return this.#host;
  }

  get port(): number {
    return this.#port;
  }

  /** `http://host:port`, ready to hand to a transport under test. */
  get origin(): string {
    const authority = this.#host.includes(":") ? `[${this.#host}]` : this.#host;
    return `http://${authority}:${String(this.#port)}`;
  }

  get connections(): number {
    return this.#peers.length;
  }

  /** One entry per accepted connection, in accept order. */
  get peers(): readonly string[] {
    return [...this.#peers];
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#server.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      });
    });
  }
}

/**
 * Binds a canary to an ephemeral loopback port.
 *
 * Port 0 rather than a fixed port: `docs/TEST_STRATEGY.md` section 2.1 forbids
 * "random ports chosen without injection", and asking the kernel for a free
 * one and reading it back is the injected form of that.
 */
export async function openConnectionCanary(
  host = "127.0.0.1",
): Promise<ConnectionCanary> {
  const server = net.createServer();
  return await new Promise<ConnectionCanary>((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error);
    };
    server.once("error", onError);
    server.listen(0, host, () => {
      server.removeListener("error", onError);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(
          new Error(
            "the connection canary bound to a pipe rather than a TCP port",
          ),
        );
        return;
      }
      resolve(new ConnectionCanary(server, address.address, address.port));
    });
  });
}
