/**
 * Body re-segmentation, for ADR-0005 section 7 test 3.
 *
 * "Each body is delivered in several segmentations, including one where the
 * byte that crosses a whole-scan threshold arrives alone as the final chunk
 * and one where it arrives inside the first chunk, and the canonical JSON is
 * byte-identical across all of them. This is the test the first revision did
 * not have, and it is the one that would have caught the byte-budget race."
 *
 * The two named segmentations are therefore built here rather than left to
 * each test to reconstruct, because a test that quietly builds neither of them
 * still passes.
 */

export interface BodySegmentation {
  readonly name: string;
  readonly chunks: readonly Uint8Array[];
}

export function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Splits at the given ascending byte offsets. Empty chunks are dropped. */
export function resegment(
  bytes: Uint8Array,
  boundaries: readonly number[],
): readonly Uint8Array[] {
  const cuts = [...new Set(boundaries)]
    .filter((at) => at > 0 && at < bytes.length)
    .sort((left, right) => left - right);
  const chunks: Uint8Array[] = [];
  let start = 0;
  for (const cut of [...cuts, bytes.length]) {
    if (cut > start) chunks.push(bytes.slice(start, cut));
    start = cut;
  }
  return chunks.length === 0 ? [new Uint8Array(0)] : chunks;
}

export function segmentEvenly(
  bytes: Uint8Array,
  count: number,
): readonly Uint8Array[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`segment count ${String(count)} is not a count`);
  }
  const size = Math.max(1, Math.ceil(bytes.length / count));
  const boundaries: number[] = [];
  for (let at = size; at < bytes.length; at += size) boundaries.push(at);
  return resegment(bytes, boundaries);
}

/**
 * The segmentations a whole-scan byte threshold has to survive.
 *
 * `crossingIndex` is the index of the first byte the transport must refuse,
 * which is the remaining allowance rather than a property of the body.
 */
export function arrivalSegmentations(
  bytes: Uint8Array,
  crossingIndex: number,
): readonly BodySegmentation[] {
  return [
    { name: "whole-body", chunks: resegment(bytes, []) },
    { name: "even-quarters", chunks: segmentEvenly(bytes, 4) },
    {
      // The crossing byte arrives alone, immediately after a chunk boundary.
      name: "crossing-byte-alone",
      chunks: resegment(bytes, [crossingIndex, crossingIndex + 1]),
    },
    {
      // The crossing byte arrives inside the first chunk, which is the case a
      // per-chunk accounting bug passes and a per-byte one does not.
      name: "crossing-byte-in-first-chunk",
      chunks: resegment(bytes, [crossingIndex + 1]),
    },
    { name: "byte-at-a-time", chunks: segmentEvenly(bytes, bytes.length) },
  ];
}
