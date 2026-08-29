import { describe, expect, it } from "vitest";

import { Deadline, readBoundedBody, resolveByteCaps } from "../src/index.js";
import type { ByteCaps, ByteStream, Clock } from "../src/index.js";

/**
 * `docs/THREAT_MODEL.md` sections 16 and 17, and `docs/FIXTURE_CATALOG.md`
 * `sec-007`: "Response exceeds rule body cap by one decoded byte / Stream
 * aborted; result `unable-to-check`, no oversized evidence."
 *
 * The one-byte cases below are the point of the file. A cap tested only with a
 * body twice its size passes for an implementation that is off by one in
 * either direction, and off-by-one in the permissive direction is a byte of a
 * hostile response that the caps said would never be held.
 */

interface FakeStream extends ByteStream {
  readonly destroyed: () => boolean;
  readonly consumed: () => number;
}

function streamOf(
  chunks: readonly Uint8Array[],
  options: { readonly error?: Error; readonly onChunk?: () => void } = {},
): FakeStream {
  let destroyed = false;
  let consumed = 0;
  return {
    destroy: () => {
      destroyed = true;
    },
    destroyed: () => destroyed,
    consumed: () => consumed,
    async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      for (const chunk of chunks) {
        if (destroyed) return;
        consumed += 1;
        options.onChunk?.();
        yield await Promise.resolve(chunk);
      }
      if (options.error !== undefined) throw options.error;
    },
  };
}

function bytes(count: number, fill = 0x61): Uint8Array {
  return new Uint8Array(count).fill(fill);
}

function caps(overrides: Partial<ByteCaps> = {}): ByteCaps {
  return {
    encoded: 100,
    decoded: 100,
    encodedBoundByScan: false,
    decodedBoundByScan: false,
    ...overrides,
  };
}

const generousDeadline = (): Deadline => new Deadline(60_000);

describe("cap arithmetic", () => {
  it("takes the minimum across the response cap and the scan remainder", () => {
    expect(
      resolveByteCaps({
        maxEncodedBytes: 1000,
        maxDecodedBytes: 2000,
        scanRemainingEncodedBytes: 400,
        scanRemainingDecodedBytes: 5000,
      }),
    ).toStrictEqual({
      encoded: 400,
      decoded: 2000,
      encodedBoundByScan: true,
      decodedBoundByScan: false,
    });
  });

  it("gives a tie to the per-response cap", () => {
    // ADR-0003 section 4 makes the two report different public codes, so a tie
    // has to resolve somewhere. Reporting a spent whole-scan budget when the
    // scan still has room would mislead a user about what to change.
    const resolved = resolveByteCaps({
      maxEncodedBytes: 500,
      maxDecodedBytes: 500,
      scanRemainingEncodedBytes: 500,
      scanRemainingDecodedBytes: 500,
    });
    expect(resolved.encodedBoundByScan).toBe(false);
    expect(resolved.decodedBoundByScan).toBe(false);
  });
});

describe("the byte cap", () => {
  it("accepts a body exactly at the cap", async () => {
    const stream = streamOf([bytes(100)]);
    const result = await readBoundedBody(
      stream,
      caps(),
      null,
      generousDeadline(),
    );

    expect(result.kind).toBe("body");
    if (result.kind !== "body") return;
    expect(result.bytes.byteLength).toBe(100);
    expect(result.encodedBytes).toBe(100);
    expect(result.decodedBytes).toBe(100);
  });

  it("aborts on the chunk that carries the first byte over the cap", async () => {
    const stream = streamOf([bytes(100), bytes(1)]);
    const result = await readBoundedBody(
      stream,
      caps(),
      null,
      generousDeadline(),
    );

    expect(result).toStrictEqual({
      kind: "failure",
      reason: { code: "response-too-large", phase: "body" },
    });
    expect(stream.destroyed()).toBe(true);
  });

  it("aborts when the one byte over arrives inside the first chunk", async () => {
    // ADR-0005 section 7 test 3: the same plan must not depend on how the
    // bytes were segmented.
    const stream = streamOf([bytes(101)]);
    const result = await readBoundedBody(
      stream,
      caps(),
      null,
      generousDeadline(),
    );

    expect(result).toStrictEqual({
      kind: "failure",
      reason: { code: "response-too-large", phase: "body" },
    });
  });

  it("returns no bytes at all when it aborts", async () => {
    // `sec-007`'s "no oversized evidence". A failure carries no body field, so
    // there is nothing for a caller to read the first N bytes out of.
    const result = await readBoundedBody(
      streamOf([bytes(500)]),
      caps(),
      null,
      generousDeadline(),
    );
    expect(result.kind).toBe("failure");
    expect(Object.keys(result)).toStrictEqual(["kind", "reason"]);
  });

  it("counts the decoded bound separately from the encoded one", async () => {
    const stream = streamOf([bytes(60)]);
    const result = await readBoundedBody(
      stream,
      caps({ encoded: 100, decoded: 50 }),
      null,
      generousDeadline(),
    );
    expect(result).toStrictEqual({
      kind: "failure",
      reason: { code: "response-too-large", phase: "body" },
    });
  });

  it("names the whole-scan budget when that is what bound", async () => {
    const stream = streamOf([bytes(101)]);
    const result = await readBoundedBody(
      stream,
      caps({ encodedBoundByScan: true }),
      null,
      generousDeadline(),
    );
    expect(result).toStrictEqual({
      kind: "failure",
      reason: { code: "scan-byte-budget-exceeded", phase: "body" },
    });
  });

  it("stops before any byte is read when Content-Length declares too many", async () => {
    const stream = streamOf([bytes(10)]);
    const result = await readBoundedBody(
      stream,
      caps(),
      101,
      generousDeadline(),
    );

    expect(result).toStrictEqual({
      kind: "failure",
      reason: { code: "response-too-large", phase: "body" },
    });
    expect(stream.consumed()).toBe(0);
    expect(stream.destroyed()).toBe(true);
  });

  it("does not trust Content-Length as the only control", async () => {
    // Section 16: "Check `Content-Length` early but do not trust it as the
    // only byte control." A truthful-looking declaration with a lying body is
    // still stopped by the streaming counter.
    const stream = streamOf([bytes(10), bytes(200)]);
    const result = await readBoundedBody(
      stream,
      caps(),
      10,
      generousDeadline(),
    );
    expect(result).toStrictEqual({
      kind: "failure",
      reason: { code: "response-too-large", phase: "body" },
    });
  });
});

describe("the elapsed deadline", () => {
  it("refuses to start once the deadline has passed", async () => {
    const result = await readBoundedBody(
      streamOf([bytes(1)]),
      caps(),
      null,
      new Deadline(0),
    );
    expect(result).toStrictEqual({
      kind: "failure",
      reason: { code: "timeout", phase: "body" },
    });
  });

  it("stops a slow body at an absolute deadline, not at an idle timer", async () => {
    // A server that sends one byte per interval never trips an inactivity
    // timeout. The clock is injected so the test measures the rule and not the
    // machine it runs on.
    let now = 0;
    const clock: Clock = { now: () => now };
    const deadline = new Deadline(50, clock);
    const stream = streamOf([bytes(1), bytes(1), bytes(1)], {
      onChunk: () => {
        now += 30;
      },
    });

    const result = await readBoundedBody(stream, caps(), null, deadline);
    expect(result).toStrictEqual({
      kind: "failure",
      reason: { code: "timeout", phase: "body" },
    });
    expect(stream.destroyed()).toBe(true);
  });
});

describe("a stream that breaks", () => {
  it("reports an llhttp framing rejection as malformed HTTP", async () => {
    const result = await readBoundedBody(
      streamOf([bytes(4)], {
        error: Object.assign(new Error("x"), {
          code: "HPE_INVALID_CHUNK_SIZE",
        }),
      }),
      caps(),
      null,
      generousDeadline(),
    );
    expect(result).toStrictEqual({
      kind: "failure",
      reason: { code: "malformed-http", phase: "body" },
    });
  });

  it("reports anything else as a connection failure and never rethrows", async () => {
    const result = await readBoundedBody(
      streamOf([bytes(4)], { error: new Error("socket hang up") }),
      caps(),
      null,
      generousDeadline(),
    );
    expect(result).toStrictEqual({
      kind: "failure",
      reason: { code: "connection-failed", phase: "connect" },
    });
  });

  it("carries no exception text into the result", async () => {
    const result = await readBoundedBody(
      streamOf([], {
        error: new Error("connect ECONNREFUSED http://secret.example/"),
      }),
      caps(),
      null,
      generousDeadline(),
    );
    expect(JSON.stringify(result)).not.toContain("secret.example");
  });
});
