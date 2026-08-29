import { describe, expect, it } from "vitest";

import {
  MEMO_KEYS,
  MemoStore,
  RuleContractViolation,
  acceptMemoValue,
  isMemoKey,
} from "../src/index.js";

/**
 * ADR-0002 section 11. Memo values are validated as plain data, then deeply
 * frozen, in that order.
 *
 * The order is the point: the freezing walk reads every own property, so a
 * getter returning a fresh object on each call would be invoked by the freeze
 * pass and would defeat it silently. The accessor case below is the one that
 * fails if the two passes are swapped.
 */

const KEY = MEMO_KEYS[0];

/**
 * Asserts both the violation and the reason it names.
 *
 * The message matters: several of these values are rejected by more than one
 * check, so a test that asserted only "it threw" would keep passing after the
 * check it claims to cover was deleted. Mutation-testing the accessor case
 * found exactly that, because an accessor descriptor has no `value` and the
 * `undefined` guard caught it instead.
 */
function rejects(value: unknown, because: RegExp): void {
  let thrown: unknown;
  try {
    acceptMemoValue(value);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(RuleContractViolation);
  expect((thrown as RuleContractViolation).code).toBe("memo-value-rejected");
  expect((thrown as RuleContractViolation).message).toMatch(because);
}

const NON_PLAIN = /non-plain prototype/;
const ACCESSOR = /accessor property/;
const CYCLIC = /cyclic or shares a node/;

describe("forbidden memo values", () => {
  it("rejects a Map", () => {
    rejects(new Map([["a", 1]]), NON_PLAIN);
  });

  it("rejects a Set", () => {
    rejects(new Set([1]), NON_PLAIN);
  });

  it("rejects a typed array", () => {
    rejects(new Uint8Array([1, 2, 3]), NON_PLAIN);
  });

  it("rejects a Date", () => {
    rejects(new Date(0), NON_PLAIN);
  });

  it("rejects a RegExp", () => {
    rejects(/x/, NON_PLAIN);
  });

  it("rejects a class instance", () => {
    class Parsed {
      value = 1;
    }
    rejects(new Parsed(), NON_PLAIN);
  });

  it("rejects an accessor property", () => {
    const value = {};
    Object.defineProperty(value, "groups", {
      enumerable: true,
      get: () => ({ fresh: true }),
    });
    rejects(value, ACCESSOR);
  });

  it("rejects a non-enumerable accessor property", () => {
    const value = {};
    Object.defineProperty(value, "hidden", {
      enumerable: false,
      get: () => 1,
    });
    rejects(value, ACCESSOR);
  });

  it("rejects a symbol-keyed property", () => {
    rejects({ [Symbol("k")]: 1 }, /symbol-keyed property/);
  });

  it("rejects a cycle", () => {
    const value: Record<string, unknown> = {};
    value["self"] = value;
    rejects(value, CYCLIC);
  });

  it("rejects a shared subtree", () => {
    // Rejected together with cycles: the walk cannot tell them apart without
    // a second pass and neither is worth one.
    const shared = { token: "x" };
    rejects({ left: shared, right: shared }, CYCLIC);
  });

  it("rejects undefined anywhere", () => {
    rejects({ absent: undefined }, /type undefined/);
    rejects(undefined, /type undefined/);
  });

  it("rejects a function", () => {
    rejects({ load: () => 1 }, /type function/);
  });

  it("rejects a frozen Map, because validation is a property of the value", () => {
    rejects(Object.freeze(new Map()), NON_PLAIN);
  });
});

describe("accepted memo values", () => {
  it("accepts plain objects, arrays and primitives", () => {
    const value = acceptMemoValue({
      groups: [{ agent: "a", allow: ["/"], disallow: [] }],
      sitemapCount: 1,
      valid: true,
      note: null,
    });
    expect(value.groups[0]?.agent).toBe("a");
  });

  it("accepts a null-prototype object", () => {
    const value: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    value["token"] = "x";
    expect(() => acceptMemoValue(value)).not.toThrow();
  });

  it("accepts the same primitive twice without calling it a shared node", () => {
    expect(() => acceptMemoValue({ a: "x", b: "x", c: 1, d: 1 })).not.toThrow();
  });

  it("freezes the whole graph", () => {
    const value = acceptMemoValue({ groups: [{ agent: "a" }] });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.groups)).toBe(true);
    expect(Object.isFrozen(value.groups[0])).toBe(true);
  });

  it("cannot be mutated afterwards", () => {
    const value = acceptMemoValue({ groups: [{ agent: "a" }] });
    // ESM modules are strict mode, so a write to a frozen object throws.
    expect(() => {
      (value.groups[0] as { agent: string }).agent = "b";
    }).toThrow(TypeError);
    expect(value.groups[0]?.agent).toBe("a");
  });
});

describe("memo keys", () => {
  it("accepts only the compile-time list", () => {
    expect(isMemoKey(KEY)).toBe(true);
    expect(isMemoKey("agentready-lab/parsed-robots/v2")).toBe(false);
  });

  it("rejects an unlisted key at the store", () => {
    const store = new MemoStore();
    expect(() => store.get("whatever", () => 1)).toThrow(
      /not in the compile-time list/,
    );
  });
});

describe("MemoStore", () => {
  it("loads once and shares the same frozen object with every rule", () => {
    const store = new MemoStore();
    let loads = 0;
    const load = (): { groups: string[] } => {
      loads += 1;
      return { groups: ["a"] };
    };

    const first = store.get(KEY, load);
    const second = store.get(KEY, load);
    const third = store.get(KEY, load);

    expect(loads).toBe(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("caches nothing when the loader returns a forbidden value", () => {
    const store = new MemoStore();
    expect(() => store.get(KEY, () => new Map())).toThrow(
      RuleContractViolation,
    );
    // Validation runs before the cache is written, so a later good load wins.
    expect(store.get(KEY, () => ({ ok: true }))).toStrictEqual({ ok: true });
  });
});
