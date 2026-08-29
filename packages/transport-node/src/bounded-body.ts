import type { TransportReason } from "@agentready-lab/core";

import { byteCapReason } from "./budget.js";
import type { ByteCaps, Deadline } from "./budget.js";

/**
 * Streaming size enforcement, `docs/THREAT_MODEL.md` sections 16 and 17.
 *
 * Section 16: "Never call an unlimited `arrayBuffer()`, `text()`, or parser
 * first" and "Count compressed and decompressed bytes while streaming". Both
 * are structural here: the only way bytes enter this module is one chunk at a
 * time, and the two counters are separate values with separate caps even in
 * M1, where they always hold the same number.
 *
 * ## M1 decodes nothing
 *
 * `Accept-Encoding: identity` is sent, and a response that carries a
 * content coding anyway is refused rather than decoded. Section 17 permits
 * `gzip`, `deflate` and `br` "if compression is implemented", and implementing
 * none of them is the strictly stronger reading: there is no decompressor to
 * bomb, no layer count to bound, and no truncated-inflate state to
 * misinterpret as partial valid content. The decoded counter is still kept
 * separate so that adding a decoder later changes one loop and not the shape
 * of the result.
 *
 * ## Over the cap is a failure, never a truncation
 *
 * A body one byte over its decoded cap aborts the stream and produces a typed
 * failure. It does not return the first N bytes with `truncated: true`.
 * Section 16 requires that "a truncated observation must never be interpreted
 * as a pass or fail", and the cheapest way to guarantee that is to make sure
 * a rule never receives one.
 */

/** The subset of a Node response stream this module needs. */
export interface ByteStream extends AsyncIterable<Uint8Array> {
  destroy(): void;
}

export type BoundedBodyResult =
  | {
      readonly kind: "body";
      readonly bytes: Uint8Array;
      readonly encodedBytes: number;
      readonly decodedBytes: number;
    }
  | { readonly kind: "failure"; readonly reason: TransportReason };

const TIMED_OUT = Symbol("transport-node.body-deadline");

function timer(ms: number): {
  readonly promise: Promise<typeof TIMED_OUT>;
  cancel(): void;
} {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<typeof TIMED_OUT>((resolve) => {
    handle = setTimeout(() => {
      resolve(TIMED_OUT);
    }, ms);
  });
  return {
    promise,
    cancel: () => {
      if (handle !== undefined) clearTimeout(handle);
    },
  };
}

/**
 * `HPE_*` is llhttp's own prefix for a framing rejection: invalid chunk
 * framing, an unexpected `Content-Length`, an oversized header block. Those
 * are wire-level and map to `malformed-http`. Anything else that breaks a body
 * mid-flight is a socket that went away.
 */
function classifyStreamError(error: unknown): TransportReason {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { readonly code: unknown }).code)
      : "";
  if (code.startsWith("HPE_")) return { code: "malformed-http", phase: "body" };
  return { code: "connection-failed", phase: "connect" };
}

/**
 * Reads a response body under both byte caps and an absolute elapsed deadline.
 *
 * `declaredLength` is the parsed `Content-Length`, or `null` when the response
 * did not carry one. Section 16 says to "check `Content-Length` early but do
 * not trust it as the only byte control", which is exactly the shape below: an
 * oversized declaration aborts before a body byte is read, and a truthful or
 * absent declaration changes nothing about the streaming checks.
 */
export async function readBoundedBody(
  stream: ByteStream,
  caps: ByteCaps,
  declaredLength: number | null,
  deadline: Deadline,
): Promise<BoundedBodyResult> {
  const fail = (reason: TransportReason): BoundedBodyResult => {
    stream.destroy();
    return { kind: "failure", reason };
  };

  /**
   * Which cap was crossed first, rather than which one is checked first.
   *
   * ADR-0003 section 4 projects `encodedBoundByScan` and `decodedBoundByScan`
   * to different public codes, so a read that carries the totals past both
   * caps at once has to name the one that actually bound. A fixed
   * encoded-then-decoded order gets that right only while the encoded cap is
   * the lower one, and tells a user their whole-scan budget is spent when it
   * is their per-response cap that stopped the read, or the reverse.
   *
   * M1 counts the same number into both totals, so the lower cap is the one
   * the stream reached first. A tie goes to the encoded cap, matching
   * `resolveByteCaps`: it is the wire number, and the per-response reason is
   * the one a caller can act on. Implementing a decoder would make the two
   * totals differ and make this the place to revisit.
   */
  const capExceeded = (
    encodedTotal: number,
    decodedTotal: number,
  ): TransportReason | null => {
    const overEncoded = encodedTotal > caps.encoded;
    const overDecoded = decodedTotal > caps.decoded;
    if (!overEncoded && !overDecoded) return null;
    const encodedFirst =
      overEncoded && (!overDecoded || caps.encoded <= caps.decoded);
    return byteCapReason(
      encodedFirst ? caps.encodedBoundByScan : caps.decodedBoundByScan,
    );
  };

  if (declaredLength !== null) {
    const declared = capExceeded(declaredLength, declaredLength);
    if (declared !== null) return fail(declared);
  }

  const chunks: Uint8Array[] = [];
  let encodedBytes = 0;
  let decodedBytes = 0;

  const iterator = stream[Symbol.asyncIterator]();
  try {
    for (;;) {
      const remaining = deadline.remainingMs;
      if (remaining === 0) return fail({ code: "timeout", phase: "body" });

      const clock = timer(remaining);
      let step: IteratorResult<Uint8Array> | typeof TIMED_OUT;
      try {
        step = await Promise.race([iterator.next(), clock.promise]);
      } finally {
        clock.cancel();
      }
      if (step === TIMED_OUT) return fail({ code: "timeout", phase: "body" });
      if (step.done === true) break;

      const chunk = step.value;
      encodedBytes += chunk.byteLength;
      // Identity only in M1, so the decoded count tracks the wire count. The
      // two are still incremented and checked independently.
      decodedBytes += chunk.byteLength;

      const overCap = capExceeded(encodedBytes, decodedBytes);
      if (overCap !== null) return fail(overCap);
      chunks.push(chunk);
    }
  } catch (error) {
    return fail(
      deadline.expired
        ? { code: "timeout", phase: "body" }
        : classifyStreamError(error),
    );
  }

  const bytes = new Uint8Array(decodedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: "body", bytes, encodedBytes, decodedBytes };
}

/**
 * Drops a body without reading it, for a redirect hop.
 *
 * Section 13: "discard rather than fully read an unneeded redirect body". A
 * `resume()` here would read a hostile server's arbitrarily large hop body to
 * completion just to reach the next hop, which is a byte budget spent on
 * nothing.
 */
export function discardBody(stream: ByteStream): void {
  stream.destroy();
}
