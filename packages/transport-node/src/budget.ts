import type { TransportReason } from "@agentready-lab/core";

/**
 * The transport half of `docs/THREAT_MODEL.md` section 16.
 *
 * Core owns `NetworkBudget`, which is the scan-wide policy. This file owns the
 * per-exchange arithmetic the transport has to do with it: which of the two
 * byte bounds actually binds, which typed reason that produces, and how much
 * of the elapsed deadline is left. The numbers that only the wire cares about
 * (the header block, the header count) live here too, because nothing outside
 * the transport can observe them.
 */

/**
 * Response header block, 32 KiB (`docs/THREAT_MODEL.md` section 16).
 *
 * Passed to `node:http` as `maxHeaderSize`, so the parser itself refuses an
 * oversized block instead of this code discovering it afterwards.
 */
export const MAX_RESPONSE_HEADER_BYTES = 32768;

/**
 * Response header count, 100 (`docs/THREAT_MODEL.md` section 16). Node has no
 * setting for this, so it is checked after the head arrives and before the
 * body is read.
 */
export const MAX_RESPONSE_HEADER_COUNT = 100;

/** `docs/THREAT_MODEL.md` section 13: at most five hops per observation. */
export const MAX_REDIRECT_HOPS = 5;

/**
 * The two byte bounds for one exchange, already reduced to the minimum across
 * this response's cap and what is left of the whole-scan budget.
 *
 * `boundByScan` is not cosmetic. ADR-0003 section 4 requires the transport to
 * report `response-too-large` or `scan-byte-budget-exceeded` "according to
 * which of the two bound", and those project to different public codes, so the
 * distinction has to survive as far as the failure value.
 */
export interface ByteCaps {
  readonly encoded: number;
  readonly decoded: number;
  readonly encodedBoundByScan: boolean;
  readonly decodedBoundByScan: boolean;
}

export interface ByteCapInput {
  readonly maxEncodedBytes: number;
  readonly maxDecodedBytes: number;
  readonly scanRemainingEncodedBytes: number;
  readonly scanRemainingDecodedBytes: number;
}

/**
 * A tie goes to the per-response cap.
 *
 * When the two bounds are equal the observation is stopped by a limit the
 * caller chose for this response, and `response-too-large` is the reason that
 * says so. Reporting `scan-byte-budget-exceeded` there would tell a user their
 * whole-scan budget is spent when it is not.
 */
export function resolveByteCaps(input: ByteCapInput): ByteCaps {
  const encoded = Math.min(
    input.maxEncodedBytes,
    input.scanRemainingEncodedBytes,
  );
  const decoded = Math.min(
    input.maxDecodedBytes,
    input.scanRemainingDecodedBytes,
  );
  return {
    encoded,
    decoded,
    encodedBoundByScan: input.scanRemainingEncodedBytes < input.maxEncodedBytes,
    decodedBoundByScan: input.scanRemainingDecodedBytes < input.maxDecodedBytes,
  };
}

/**
 * ADR-0003 section 4. `phase` is `body` for both codes in M1 because M1
 * decodes nothing: `docs/THREAT_MODEL.md` section 17 permits compression only
 * "if compression is implemented", and this transport implements none, so no
 * byte is ever counted at phase `decode`.
 */
export function byteCapReason(boundByScan: boolean): TransportReason {
  return boundByScan
    ? { code: "scan-byte-budget-exceeded", phase: "body" }
    : { code: "response-too-large", phase: "body" };
}

/** Injected so a test never depends on how fast the machine running it is. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

/**
 * An absolute elapsed deadline, not a socket-inactivity timeout.
 *
 * `docs/THREAT_MODEL.md` section 16: "Enforce absolute elapsed deadlines, not
 * only socket inactivity." A server that sends one byte every 500 ms never
 * trips an inactivity timer and would otherwise stream for as long as it
 * likes.
 */
export class Deadline {
  readonly #clock: Clock;
  readonly #expiresAt: number;

  constructor(budgetMs: number, clock: Clock = systemClock) {
    this.#clock = clock;
    this.#expiresAt = clock.now() + Math.max(0, budgetMs);
  }

  get remainingMs(): number {
    return Math.max(0, this.#expiresAt - this.#clock.now());
  }

  get expired(): boolean {
    return this.remainingMs === 0;
  }
}
