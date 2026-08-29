import { describe, expect, it } from "vitest";

import {
  JSON_SAFE_MAX_DEPTH,
  JSON_SAFE_MAX_NODES,
  JSON_SAFE_MAX_STRING_BYTES,
  escapeJsonPointerToken,
  isJsonArray,
  isJsonObject,
  jsonPointer,
  parseJsonSafe,
} from "../../src/parsers/json-safe.js";
import type { JsonSafeResult } from "../../src/parsers/json-safe.js";

/**
 * `docs/TEST_STRATEGY.md` section 3's lowest tier: a pure parser unit with no
 * transport, no server and no fixture entry.
 *
 * Every limit in `docs/THREAT_MODEL.md` section 19.2 is tested from both
 * sides. A one-sided test passes for a parser that refuses everything, which
 * is the failure mode a defensive parser actually has.
 */

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function parse(text: string): JsonSafeResult {
  return parseJsonSafe(bytes(text));
}

/** The failure half of the result, with a message when it was a success. */
function failureOf(result: JsonSafeResult): { code: string; pointer: string } {
  if (result.ok) {
    throw new Error(
      `expected a failure, got ${JSON.stringify(result.value).slice(0, 120)}`,
    );
  }
  return { code: result.code, pointer: result.pointer };
}

function valueOf(result: JsonSafeResult): unknown {
  if (!result.ok) {
    throw new Error(
      `expected a value, got ${result.code} at "${result.pointer}"`,
    );
  }
  return result.value;
}

describe("well-formed documents", () => {
  it("reads the shape of an RFC 9264 link set", () => {
    const result = parse(
      '{"linkset":[{"anchor":"https://a.example/api","service-desc":[{"href":"https://a.example/openapi.json","type":"application/openapi+json"}]}]}',
    );
    expect(valueOf(result)).toEqual({
      linkset: [
        {
          anchor: "https://a.example/api",
          "service-desc": [
            {
              href: "https://a.example/openapi.json",
              type: "application/openapi+json",
            },
          ],
        },
      ],
    });
  });

  it("reads every scalar form RFC 8259 defines", () => {
    expect(valueOf(parse('{"a":true,"b":false,"c":null}'))).toEqual({
      a: true,
      b: false,
      c: null,
    });
    expect(valueOf(parse("[0,-0,1,-1.5,2e3,2E+3,1e-3,0.5]"))).toEqual([
      0, -0, 1, -1.5, 2000, 2000, 0.001, 0.5,
    ]);
    expect(valueOf(parse('"\\"\\\\\\/\\b\\f\\n\\r\\t"'))).toBe(
      '"\\/\b\f\n\r\t',
    );
    expect(valueOf(parse("[]"))).toEqual([]);
    expect(valueOf(parse("{}"))).toEqual({});
    expect(valueOf(parse("  \t\r\n 42 \n"))).toBe(42);
  });

  it("decodes multi-byte UTF-8 and surrogate-pair escapes", () => {
    expect(valueOf(parse('"naïve 中文 \u{1f600}"'))).toBe(
      "naïve 中文 \u{1f600}",
    );
    expect(valueOf(parse('"\\ud83d\\ude00"'))).toBe("\u{1f600}");
  });

  it("ignores a leading UTF-8 byte order mark (RFC 8259 section 8.1)", () => {
    const body = Uint8Array.from([0xef, 0xbb, 0xbf, ...bytes("{}")]);
    expect(valueOf(parseJsonSafe(body))).toEqual({});
  });

  it("reports the node count and the depth it reached", () => {
    const result = parse('{"linkset":[{"a":[{}]}]}');
    if (!result.ok) throw new Error(result.code);
    // The root object, the array, the entry, its array, and the empty object.
    expect(result.nodes).toBe(5);
    expect(result.depth).toBe(5);
    expect(result.neutralizedKeys).toEqual([]);
  });
});

describe("malformed documents", () => {
  it.each([
    ["", ""],
    ["{", ""],
    ['{"a"}', "/a"],
    ['{"a":}', "/a"],
    ["[1,]", "/1"],
    ["[1 2]", "/0"],
    ['{"a":1}{"b":2}', ""],
    ["nul", ""],
    ["01", ""],
    ["+1", ""],
    [".5", ""],
    ["1.", ""],
    ["1e", ""],
    ["{a:1}", ""],
    ["'a'", ""],
    ['["unterminated]', "/0"],
  ])("refuses %j as syntax", (text, pointer) => {
    const failure = failureOf(parse(text));
    expect(failure.code).toBe("syntax");
    expect(failure.pointer).toBe(pointer);
  });

  it("refuses an unescaped control character inside a string", () => {
    expect(failureOf(parse('["ab"]')).code).toBe("syntax");
  });

  it("refuses a number that is not finite", () => {
    expect(failureOf(parse("[1e999]")).code).toBe("syntax");
  });

  it("locates the defect precisely inside a nested document", () => {
    const failure = failureOf(
      parse('{"linkset":[{"anchor":"x","item":[{"href":@}]}]}'),
    );
    expect(failure.code).toBe("syntax");
    expect(failure.pointer).toBe("/linkset/0/item/0/href");
  });
});

describe("UTF-8 validation (RFC 9264 section 4.2 requires UTF-8)", () => {
  it.each([
    ["a bare continuation byte", [0x22, 0x80, 0x22]],
    ["a truncated two-byte sequence", [0x22, 0xc3, 0x22]],
    ["an overlong encoding of NUL", [0x22, 0xc0, 0x80, 0x22]],
    ["an overlong three-byte form", [0x22, 0xe0, 0x80, 0xaf, 0x22]],
    ["a UTF-8-encoded surrogate", [0x22, 0xed, 0xa0, 0x80, 0x22]],
    ["a code point above U+10FFFF", [0x22, 0xf5, 0x80, 0x80, 0x80, 0x22]],
  ])("refuses %s", (_label, octets) => {
    expect(failureOf(parseJsonSafe(Uint8Array.from(octets))).code).toBe(
      "invalid-utf8",
    );
  });

  it.each([
    ['a high surrogate with no pair, "\\ud800"', '"\\ud800"'],
    ["a low surrogate first", '"\\udc00\\ud800"'],
    ["a high surrogate followed by a normal escape", '"\\ud800\\n"'],
    ["a high surrogate followed by a non-surrogate", '"\\ud800\\u0041"'],
  ])("refuses %s", (_label, text) => {
    expect(failureOf(parse(text)).code).toBe("invalid-utf8");
  });
});

describe("depth limit", () => {
  it(`accepts ${String(JSON_SAFE_MAX_DEPTH)} nested containers`, () => {
    const text =
      "[".repeat(JSON_SAFE_MAX_DEPTH) + "]".repeat(JSON_SAFE_MAX_DEPTH);
    const result = parse(text);
    if (!result.ok) throw new Error(`${result.code} at "${result.pointer}"`);
    expect(result.depth).toBe(JSON_SAFE_MAX_DEPTH);
  });

  it("refuses one container beyond the limit", () => {
    const depth = JSON_SAFE_MAX_DEPTH + 1;
    const failure = failureOf(parse("[".repeat(depth) + "]".repeat(depth)));
    expect(failure.code).toBe("depth-exceeded");
    // The pointer names the deepest position that was legal to enter.
    expect(failure.pointer).toBe("/0".repeat(JSON_SAFE_MAX_DEPTH));
  });

  it("refuses a document nested far past any call-stack limit", () => {
    // 200,000 is well beyond the V8 default stack. A recursive-descent parser
    // dies here with a RangeError; this one answers in constant depth. If this
    // test ever throws instead of returning, the parser started recursing.
    const failure = failureOf(parse("[".repeat(200_000)));
    expect(failure.code).toBe("depth-exceeded");
  });

  it("refuses deep nesting built from objects rather than arrays", () => {
    const depth = JSON_SAFE_MAX_DEPTH + 1;
    const text = '{"a":'.repeat(depth) + "1" + "}".repeat(depth);
    expect(failureOf(parse(text)).code).toBe("depth-exceeded");
  });
});

describe("node limit", () => {
  it(`accepts ${String(JSON_SAFE_MAX_NODES)} object and array nodes`, () => {
    const text = `[${"{},".repeat(JSON_SAFE_MAX_NODES - 2)}{}]`;
    const result = parse(text);
    if (!result.ok) throw new Error(`${result.code} at "${result.pointer}"`);
    expect(result.nodes).toBe(JSON_SAFE_MAX_NODES);
  });

  it("refuses one node beyond the limit", () => {
    const text = `[${"{},".repeat(JSON_SAFE_MAX_NODES - 1)}{}]`;
    expect(failureOf(parse(text)).code).toBe("node-limit-exceeded");
  });

  it("counts containers and not scalars", () => {
    const text = `[${"1,".repeat(JSON_SAFE_MAX_NODES * 2)}1]`;
    const result = parse(text);
    if (!result.ok) throw new Error(result.code);
    expect(result.nodes).toBe(1);
  });
});

describe("string length limit", () => {
  it(`accepts a ${String(JSON_SAFE_MAX_STRING_BYTES)}-byte string`, () => {
    const text = `"${"a".repeat(JSON_SAFE_MAX_STRING_BYTES)}"`;
    expect(valueOf(parse(text))).toHaveLength(JSON_SAFE_MAX_STRING_BYTES);
  });

  it("refuses one byte beyond the limit", () => {
    const text = `"${"a".repeat(JSON_SAFE_MAX_STRING_BYTES + 1)}"`;
    expect(failureOf(parse(text)).code).toBe("string-too-long");
  });

  it("measures UTF-8 bytes, not UTF-16 code units", () => {
    // Each astral character is 4 UTF-8 bytes and 2 UTF-16 code units, so a
    // parser counting code units would accept twice the budget.
    const count = JSON_SAFE_MAX_STRING_BYTES / 4 + 1;
    const text = `"${"\u{1f600}".repeat(count)}"`;
    expect(failureOf(parse(text)).code).toBe("string-too-long");
  });

  it("applies the same limit to a member name", () => {
    const key = "k".repeat(JSON_SAFE_MAX_STRING_BYTES + 1);
    const failure = failureOf(parse(`{"${key}":1}`));
    expect(failure.code).toBe("string-too-long");
  });

  it("counts each string separately rather than in total", () => {
    const half = "a".repeat(JSON_SAFE_MAX_STRING_BYTES);
    const result = parse(`["${half}","${half}"]`);
    expect(result.ok).toBe(true);
  });
});

describe("prototype-polluting keys", () => {
  it("drops __proto__ and leaves Object.prototype alone", () => {
    const result = parse('{"__proto__":{"polluted":true},"keep":1}');
    if (!result.ok) throw new Error(result.code);
    const value = result.value;
    if (!isJsonObject(value)) throw new Error("expected an object");
    expect(value["__proto__"]).toBeUndefined();
    expect(value["keep"]).toBe(1);
    expect(result.neutralizedKeys).toEqual(["/__proto__"]);
    expect(Object.getPrototypeOf(value)).toBeNull();
    expect(
      (Object.prototype as unknown as Record<string, unknown>)["polluted"],
    ).toBeUndefined();
  });

  it.each(["__proto__", "constructor", "prototype"])(
    "drops a nested %s key and records its pointer",
    (key) => {
      const result = parse(`{"linkset":[{"${key}":{"x":1},"anchor":"a"}]}`);
      if (!result.ok) throw new Error(result.code);
      expect(result.neutralizedKeys).toEqual([`/linkset/0/${key}`]);
      const linkset = isJsonObject(result.value)
        ? result.value["linkset"]
        : undefined;
      if (!isJsonArray(linkset)) throw new Error("expected an array");
      const entry = linkset[0];
      if (!isJsonObject(entry)) throw new Error("expected an object");
      expect(Object.keys(entry)).toEqual(["anchor"]);
    },
  );

  it("still reads a document whose only member is dropped", () => {
    const result = parse('{"__proto__":1}');
    if (!result.ok) throw new Error(result.code);
    expect(Object.keys(result.value as object)).toEqual([]);
  });
});

describe("duplicate keys", () => {
  it("refuses rather than letting the last one win", () => {
    const failure = failureOf(parse('{"a":1,"a":2}'));
    expect(failure.code).toBe("duplicate-key");
    expect(failure.pointer).toBe("/a");
  });

  it("locates a duplicate inside a link context object", () => {
    const failure = failureOf(
      parse('{"linkset":[{"anchor":"a","anchor":"b"}]}'),
    );
    expect(failure.code).toBe("duplicate-key");
    expect(failure.pointer).toBe("/linkset/0/anchor");
  });

  it("treats two dropped keys as a duplicate, not as two silent removals", () => {
    expect(failureOf(parse('{"__proto__":1,"__proto__":2}')).code).toBe(
      "duplicate-key",
    );
  });

  it("permits the same name in two different objects", () => {
    expect(parse('[{"a":1},{"a":2}]').ok).toBe(true);
  });
});

describe("RFC 6901 pointers", () => {
  it("escapes ~ before / , as section 3 requires", () => {
    expect(escapeJsonPointerToken("m~n")).toBe("m~0n");
    expect(escapeJsonPointerToken("a/b")).toBe("a~1b");
    // The order matters: escaping "/" first would turn "~/" into "~~1", and
    // unescaping that yields "~1" rather than "~/".
    expect(escapeJsonPointerToken("~/")).toBe("~0~1");
    expect(escapeJsonPointerToken("~1")).toBe("~01");
  });

  it("builds the pointers of RFC 6901 section 5", () => {
    expect(jsonPointer([])).toBe("");
    expect(jsonPointer(["foo"])).toBe("/foo");
    expect(jsonPointer(["foo", 0])).toBe("/foo/0");
    expect(jsonPointer([""])).toBe("/");
    expect(jsonPointer(["a/b"])).toBe("/a~1b");
    expect(jsonPointer(["c%d"])).toBe("/c%d");
    expect(jsonPointer(["m~n"])).toBe("/m~0n");
    expect(jsonPointer([" "])).toBe("/ ");
  });

  it("escapes a member name that contains a pointer separator", () => {
    const failure = failureOf(parse('{"a/b~c":@}'));
    expect(failure.pointer).toBe("/a~1b~0c");
  });
});

describe("type guards", () => {
  it("separates objects, arrays and everything else", () => {
    expect(isJsonObject({})).toBe(true);
    expect(isJsonObject([])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject(undefined)).toBe(false);
    expect(isJsonObject("a")).toBe(false);
    expect(isJsonArray([])).toBe(true);
    expect(isJsonArray({})).toBe(false);
    expect(isJsonArray(undefined)).toBe(false);
  });
});
