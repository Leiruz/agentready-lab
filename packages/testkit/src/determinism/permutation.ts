/**
 * Seeded permutations, for the latency profiles of ADR-0005 section 7 test 2.
 *
 * The decision requires the same plan replayed under "several per-response
 * latency profiles, including one that is the reverse of another", with
 * byte-identical canonical JSON across all of them. A profile is one tick
 * count per planned observation, so a permutation of `0..n-1` is a profile in
 * which every observation has a distinct latency.
 *
 * The generator is mulberry32 rather than `Math.random`: a test that only
 * fails for some seeds is not a test, and a seed printed in a failure message
 * is what makes the failure reproducible.
 */

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** A permutation of `0..length-1`, decided entirely by `seed`. */
export function seededPermutation(
  length: number,
  seed: number,
): readonly number[] {
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError(`permutation length ${String(length)} is not a count`);
  }
  const order = Array.from({ length }, (_unused, index) => index);
  const random = mulberry32(seed);
  // Fisher-Yates, downward, which is the form whose uniformity is provable.
  for (let index = length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const left = order[index];
    const right = order[swap];
    if (left === undefined || right === undefined) continue;
    order[index] = right;
    order[swap] = left;
  }
  return order;
}

export function applyPermutation<T>(
  items: readonly T[],
  permutation: readonly number[],
): readonly T[] {
  return permutation.map((index) => {
    const item = items[index];
    if (item === undefined) {
      throw new RangeError(
        `permutation index ${String(index)} is outside 0..${String(items.length - 1)}`,
      );
    }
    return item;
  });
}

/** One tick count per planned observation, plus the name of the profile. */
export interface LatencyProfile {
  readonly name: string;
  readonly ticks: readonly number[];
}

/**
 * The profile set ADR-0005 section 7 test 2 asks for: the identity, its
 * reverse, and one per supplied seed.
 */
export function latencyProfiles(
  count: number,
  seeds: readonly number[] = [1, 7, 4242],
): readonly LatencyProfile[] {
  const identity = Array.from({ length: count }, (_unused, index) => index);
  return [
    { name: "identity", ticks: identity },
    { name: "reverse", ticks: [...identity].reverse() },
    ...seeds.map((seed) => ({
      name: `seed-${String(seed)}`,
      ticks: seededPermutation(count, seed),
    })),
  ];
}
