import type { LookupFunction } from "node:net";

/**
 * Injectable resolution and connection pinning,
 * `docs/THREAT_MODEL.md` sections 12.2 and 12.3.
 *
 * ## Why this exists in a milestone that resolves nothing
 *
 * M1's `local-loopback` profile accepts only an IP literal, so there is no
 * name to resolve and pinning is semantically a no-op. The module is built
 * anyway, for two reasons that are not the same reason.
 *
 * The first is evidential. "No lookup happened" is a claim, and the way to
 * turn it into a fact is to hand the connector a `lookup` that records every
 * call and refuses every host it was not built for. A test then reads
 * `callCount` and asserts zero, which is a measurement; reading the source and
 * concluding that `net.connect` skips DNS for literals is a belief about
 * someone else's library.
 *
 * The second is that M3 has to defend against DNS rebinding under a deadline.
 * `docs/THREAT_MODEL.md` section 12.3 requires the validated address set to be
 * "supplied directly to the connector", and this is that mechanism, with its
 * tests already written, rather than something to invent later.
 */

export interface PinnedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

/**
 * A `lookup` that can only ever answer with addresses the policy already
 * authorized, for the one hostname it was built for.
 *
 * There is no code path through it that performs a name service query, so a
 * second resolution between validation and connection, the time-of-check /
 * time-of-use hole section 8 describes, cannot happen: the answer was decided
 * before the socket existed.
 */
export class PinnedResolver {
  readonly #hostname: string;
  readonly #addresses: readonly PinnedAddress[];
  #calls: string[] = [];

  constructor(hostname: string, addresses: readonly PinnedAddress[]) {
    this.#hostname = hostname;
    this.#addresses = addresses;
  }

  /** Every hostname this resolver was asked about, in call order. */
  get calls(): readonly string[] {
    return this.#calls;
  }

  get callCount(): number {
    return this.#calls.length;
  }

  /**
   * The `node:net` lookup shape.
   *
   * An unexpected hostname produces an error through the callback rather than
   * a throw: this runs inside Node's connection machinery, where a synchronous
   * throw would escape as an unhandled exception instead of becoming a typed
   * connection failure.
   */
  get lookup(): LookupFunction {
    return (hostname, options, callback) => {
      this.#calls = [...this.#calls, hostname];

      if (hostname !== this.#hostname) {
        callback(
          new Error("transport-node: unauthorized lookup"),
          [],
          undefined,
        );
        return;
      }

      const wanted =
        options.family === 4 || options.family === 6
          ? this.#addresses.filter((entry) => entry.family === options.family)
          : this.#addresses;

      if (wanted.length === 0) {
        callback(new Error("transport-node: no pinned address"), [], undefined);
        return;
      }

      if (options.all === true) {
        callback(
          null,
          wanted.map((entry) => ({
            address: entry.address,
            family: entry.family,
          })),
        );
        return;
      }

      const first = wanted[0];
      if (first === undefined) {
        callback(new Error("transport-node: no pinned address"), [], undefined);
        return;
      }
      callback(null, first.address, first.family);
    };
  }
}
