import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  FrozenClock,
  TESTKIT_PACKAGE_VERSION,
  applyPermutation,
  arrivalSegmentations,
  encodeText,
  latencyProfiles,
  resegment,
  seededPermutation,
  segmentEvenly,
  ticks,
} from "../src/index.js";

it("keeps the exported version in step with package.json", () => {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );

  expect(manifest).toMatchObject({
    name: "@agentready-lab/testkit",
    version: TESTKIT_PACKAGE_VERSION,
  });
});

describe("seeded permutation", () => {
  it("is a permutation of 0..n-1", () => {
    const order = seededPermutation(16, 99);

    expect([...order].sort((left, right) => left - right)).toStrictEqual(
      Array.from({ length: 16 }, (_unused, index) => index),
    );
  });

  it("is the same for the same seed and different for another", () => {
    expect(seededPermutation(24, 7)).toStrictEqual(seededPermutation(24, 7));
    expect(seededPermutation(24, 7)).not.toStrictEqual(
      seededPermutation(24, 8),
    );
  });

  it("reorders the items it is applied to", () => {
    const items = ["a", "b", "c", "d"];

    expect(applyPermutation(items, [3, 2, 1, 0])).toStrictEqual([
      "d",
      "c",
      "b",
      "a",
    ]);
    expect(() => applyPermutation(items, [4])).toThrow(RangeError);
  });

  it("produces the identity and its reverse among the latency profiles", () => {
    const profiles = latencyProfiles(4, [11]);

    expect(profiles.map((profile) => profile.name)).toStrictEqual([
      "identity",
      "reverse",
      "seed-11",
    ]);
    expect(profiles[0]?.ticks).toStrictEqual([0, 1, 2, 3]);
    expect(profiles[1]?.ticks).toStrictEqual([3, 2, 1, 0]);
  });
});

describe("body segmentation", () => {
  const body = encodeText("0123456789");

  function joined(chunks: readonly Uint8Array[]): string {
    return new TextDecoder().decode(
      Uint8Array.from(chunks.flatMap((chunk) => [...chunk])),
    );
  }

  it("preserves the bytes under every segmentation", () => {
    for (const segmentation of arrivalSegmentations(body, 4)) {
      expect(joined(segmentation.chunks)).toBe("0123456789");
    }
  });

  it("delivers the crossing byte alone when asked to", () => {
    const segmentation = arrivalSegmentations(body, 4).find(
      (candidate) => candidate.name === "crossing-byte-alone",
    );

    expect(segmentation?.chunks.map((chunk) => joined([chunk]))).toStrictEqual([
      "0123",
      "4",
      "56789",
    ]);
  });

  it("delivers the crossing byte inside the first chunk when asked to", () => {
    const segmentation = arrivalSegmentations(body, 4).find(
      (candidate) => candidate.name === "crossing-byte-in-first-chunk",
    );

    expect(segmentation?.chunks.map((chunk) => joined([chunk]))).toStrictEqual([
      "01234",
      "56789",
    ]);
  });

  it("drops empty segments and never returns an empty chunk list", () => {
    expect(resegment(body, [0, 0, 10, 999]).length).toBe(1);
    expect(resegment(new Uint8Array(0), [1, 2])).toHaveLength(1);
    expect(segmentEvenly(body, 10)).toHaveLength(10);
    expect(() => segmentEvenly(body, 0)).toThrow(RangeError);
  });
});

describe("frozen clock", () => {
  it("does not move on its own", async () => {
    const clock = new FrozenClock(1_700_000_000_000);
    const before = clock.now();
    await ticks(5);

    expect(clock.now()).toBe(before);
    expect(clock.nowIso()).toBe("2023-11-14T22:13:20.000Z");
  });

  it("moves only forward, and only when told to", () => {
    const clock = new FrozenClock(0);
    clock.advance(1500);

    expect(clock.now()).toBe(1500);
    expect(() => {
      clock.advance(-1);
    }).toThrow(RangeError);
  });
});
