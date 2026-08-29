import { describe, expect, it } from "vitest";

import {
  CanonicalJsonError,
  canonicalizeJson,
  encodeCanonicalJson,
} from "../src/schema/canonical-json.js";
import { sha256Hex } from "../src/schema/sha256.js";

// ---------------------------------------------------------------------------
// PROVENANCE OF THE TEST VECTORS
//
// The five named cases below are the official JCS test vectors from the
// reference implementation that RFC 8785 Appendix G points to:
//
//   https://github.com/cyberphone/json-canonicalization
//   testdata/input/<name>.json and testdata/output/<name>.json
//   (Apache-2.0, retrieved 2026-08-29)
//
// They are embedded as string literals rather than committed as .json files
// so that Prettier cannot reformat them: input/arrays.json is deliberately
// badly formatted and input/structures.json deliberately has no trailing
// newline, and a formatting pass would silently destroy both. The literals
// were generated mechanically from the retrieved files, and each carries the
// SHA-256 of the file it came from. The "retains the published bytes" case
// re-derives those digests from the literals, so a transcription error is a
// test failure and not a comment that has quietly drifted.
//
// Two further cases come from the body of RFC 8785 itself: the sample in
// section 3.2.2 with its canonical form in section 3.2.3, and the property
// sorting test data in section 3.2.3. Appendix B's number table is
// transcribed in full further down.
// ---------------------------------------------------------------------------

interface Vector {
  readonly name: string;
  readonly input: string;
  readonly inputSha256: string;
  readonly output: string;
  readonly outputSha256: string;
}

const VECTORS: readonly Vector[] = [
  {
    name: "arrays",
    input:
      '[\n  56,\n  {\n    "d": true,\n    "10": null,\n    "1": [ ]\n  }\n]\n',
    inputSha256:
      "e503b6d71d1afa595b1c74b1016445c944cd89f90418066b23de1aeda7d17563",
    output: '[56,{"1":[],"10":null,"d":true}]',
    outputSha256:
      "099601b171cafed97c333f8878d68e7f8c8f795412adb34b2fdcf0e7c7beac42",
  },
  {
    name: "french",
    input:
      '{\n  "peach": "This sorting order",\n  "péché": "is wrong according to French",\n  "pêche": "but canonicalization MUST",\n  "sin":   "ignore locale"\n}\n',
    inputSha256:
      "03676a951cd8753ac62589f72eb2105cc782c33425418cfe1d517c111f6e5d5a",
    output:
      '{"peach":"This sorting order","péché":"is wrong according to French","pêche":"but canonicalization MUST","sin":"ignore locale"}',
    outputSha256:
      "d99d0ebdcb0033cb858cfa830ae46bc0fb3309413b271f1da828c89901a27ed5",
  },
  {
    name: "structures",
    input:
      '{\n  "1": {"f": {"f": "hi","F": 5} ,"\\n": 56.0},\n  "10": { },\n  "": "empty",\n  "a": { },\n  "111": [ {"e": "yes","E": "no" } ],\n  "A": { }\n}',
    inputSha256:
      "d66893805be1784116af50af3110d08766c70a6b4aad93374723f72346e7aaa6",
    output:
      '{"":"empty","1":{"\\n":56,"f":{"F":5,"f":"hi"}},"10":{},"111":[{"E":"no","e":"yes"}],"A":{},"a":{}}',
    outputSha256:
      "605f65004ec2db7692522a0852c22f1c989e036d547e88963d1a3143cf3195d5",
  },
  {
    name: "unicode",
    input: '{\n  "Unnormalized Unicode":"A\\u030a"\n}\n',
    inputSha256:
      "4621864e014d4a805a563f55b9ea20aba4a2d2dc09c7394f625496998c00702c",
    output: '{"Unnormalized Unicode":"Å"}',
    outputSha256:
      "0d99aad92a125196ff887876643fd3206786a84ddce2cee52ba4ad256d2381d3",
  },
  {
    name: "weird",
    input:
      '{\n  "\\u20ac": "Euro Sign",\n  "\\r": "Carriage Return",\n  "\\u000a": "Newline",\n  "1": "One",\n  "\\u0080": "Control\\u007f",\n  "\\ud83d\\ude02": "Smiley",\n  "\\u00f6": "Latin Small Letter O With Diaeresis",\n  "\\ufb33": "Hebrew Letter Dalet With Dagesh",\n  "</script>": "Browser Challenge"\n}\n',
    inputSha256:
      "a3a905266bd4a49a969274ea69baa14ee0c4af0ead926d6fa2b7612b4af75387",
    // U+0080 and U+007F are emitted raw: RFC 8785 section 3.2.2.2 escapes only
    // U+0000 through U+001F, the quote, and the backslash.
    output:
      '{"\\n":"Newline","\\r":"Carriage Return","1":"One","</script>":"Browser Challenge","\u0080":"Control\u007f","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😂":"Smiley","דּ":"Hebrew Letter Dalet With Dagesh"}',
    outputSha256:
      "6af595a9aa80110b964b4de3f82a05fa6ae7423005019bacfa2620dddc4e94d1",
  },
];

describe("RFC 8785 published test vectors", () => {
  it.each(VECTORS)("canonicalizes $name", (vector) => {
    expect(canonicalizeJson(JSON.parse(vector.input))).toBe(vector.output);
  });

  it.each(VECTORS)(
    "$name still carries the published bytes of both vector files",
    async (vector) => {
      const encoder = new TextEncoder();
      await expect(sha256Hex(encoder.encode(vector.input))).resolves.toBe(
        vector.inputSha256,
      );
      await expect(sha256Hex(encoder.encode(vector.output))).resolves.toBe(
        vector.outputSha256,
      );
    },
  );

  it.each(VECTORS)(
    "emits $name as the published UTF-8 output bytes",
    async (vector) => {
      const bytes = encodeCanonicalJson(JSON.parse(vector.input));
      await expect(sha256Hex(bytes)).resolves.toBe(vector.outputSha256);
    },
  );

  it("is idempotent, so canonical output is valid canonical input", () => {
    for (const vector of VECTORS) {
      expect(canonicalizeJson(JSON.parse(vector.output))).toBe(vector.output);
    }
  });
});

describe("RFC 8785 section 3.2.2 sample", () => {
  // The object from section 3.2.2, kept as JSON text so that the number
  // literals are the RFC's own (333333333.33333329, 1E30, 4.50) rather than
  // something a TypeScript author chose.
  const SAMPLE =
    "{\n" +
    '  "numbers": [333333333.33333329, 1E30, 4.50,\n' +
    "              2e-3, 0.000000000000000000000000001],\n" +
    '  "string": "\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/",\n' +
    '  "literals": [null, true, false]\n' +
    "}";

  // The canonical form printed in section 3.2.3 (the RFC shows it with a line
  // wrap "added for display purposes only").
  const CANONICAL =
    '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
    '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}';

  it("matches the canonical form printed in section 3.2.3", () => {
    expect(canonicalizeJson(JSON.parse(SAMPLE))).toBe(CANONICAL);
  });
});

describe("RFC 8785 section 3.2.3 property sorting", () => {
  // The sorting test data printed in section 3.2.3. Unlike the `weird` vector
  // this one uses U+1F600 GRINNING FACE, and the RFC states the expected
  // result as the order of the property *values*.
  const SORTING_SAMPLE =
    "{\n" +
    '  "\\u20ac": "Euro Sign",\n' +
    '  "\\r": "Carriage Return",\n' +
    '  "\\ufb33": "Hebrew Letter Dalet With Dagesh",\n' +
    '  "1": "One",\n' +
    '  "\\ud83d\\ude00": "Emoji: Grinning Face",\n' +
    '  "\\u0080": "Control",\n' +
    '  "\\u00f6": "Latin Small Letter O With Diaeresis"\n' +
    "}";

  it("orders properties by UTF-16 code unit", () => {
    const canonical = canonicalizeJson(JSON.parse(SORTING_SAMPLE));

    // The order is read out of the canonical *string*, not out of a reparsed
    // object. ECMAScript object property order puts integer-like keys first,
    // so JSON.parse would move the "1" property ahead of the "\r" one and
    // this assertion would test property ordering rules rather than JCS.
    const order = [
      "Carriage Return",
      "One",
      "Control",
      "Latin Small Letter O With Diaeresis",
      "Euro Sign",
      "Emoji: Grinning Face",
      "Hebrew Letter Dalet With Dagesh",
    ];
    const positions = order.map((value) => canonical.indexOf(value));
    expect(positions).not.toContain(-1);
    expect(positions).toStrictEqual([...positions].sort((a, b) => a - b));
  });

  it("puts a non-BMP key before U+FB33, which a code point sort would not", () => {
    // U+1F600 is code point 128512 and U+FB33 is code point 64307, so sorting
    // by code point reverses these two. Sorting by UTF-16 code units compares
    // the leading surrogate 0xD83D against 0xFB33 instead. This is the single
    // assertion that a [...key]-based comparator fails.
    expect(canonicalizeJson({ דּ: 1, "😀": 2 })).toBe('{"😀":2,"דּ":1}');
  });

  it("ignores locale, as the french vector requires", () => {
    // Under a French collation "pêche" precedes "péché"; under
    // code unit ordering U+00E9 precedes U+00EA, so "péché" is first.
    expect(canonicalizeJson({ pêche: 1, péché: 2 })).toBe(
      '{"péché":2,"pêche":1}',
    );
  });

  it("sorts a shorter key before a longer key sharing its prefix", () => {
    // The "plain English" example in section 3.2.3.
    expect(canonicalizeJson({ ab: 4, aa: 3, a: 2, "": 1 })).toBe(
      '{"":1,"a":2,"aa":3,"ab":4}',
    );
  });

  it("sorts nested objects and objects inside arrays, without reordering arrays", () => {
    expect(canonicalizeJson([{ b: 1, a: { d: 1, c: 2 } }, "z", "y"])).toBe(
      '[{"a":{"c":2,"d":1},"b":1},"z","y"]',
    );
  });
});

describe("RFC 8785 section 3.2.2.2 string escaping", () => {
  const unit = (code: number): string => String.fromCharCode(code);

  it.each([
    [0x00, '"\\u0000"'],
    [0x01, '"\\u0001"'],
    [0x07, '"\\u0007"'],
    [0x08, '"\\b"'],
    [0x09, '"\\t"'],
    [0x0a, '"\\n"'],
    [0x0b, '"\\u000b"'],
    [0x0c, '"\\f"'],
    [0x0d, '"\\r"'],
    [0x0e, '"\\u000e"'],
    [0x1f, '"\\u001f"'],
    [0x20, '" "'],
    [0x22, '"\\""'],
    [0x2f, '"/"'],
    [0x5c, '"\\\\"'],
    [0x7f, '"\u007f"'],
    [0x80, '"\u0080"'],
  ])("serializes U+%s per the section 3.2.2.2 rules", (code, expected) => {
    expect(canonicalizeJson(unit(code))).toBe(expected);
  });

  it("uses lowercase hexadecimal in \\uhhhh escapes", () => {
    const control = [0x1a, 0x1b, 0x1c, 0x1d, 0x1e].map(unit).join("");
    expect(canonicalizeJson(control)).toBe(
      '"\\u001a\\u001b\\u001c\\u001d\\u001e"',
    );
  });

  it("escapes control characters in property names too", () => {
    expect(canonicalizeJson({ [`${unit(0x00)}${unit(0x1f)}`]: 1 })).toBe(
      '{"\\u0000\\u001f":1}',
    );
  });

  it("does not apply Unicode normalization", () => {
    // U+00C5 and U+0041 U+030A are canonically equivalent under NFC. JCS must
    // keep both, or two parties who typed the same word differently would get
    // the same digest for different bytes.
    const canonical = canonicalizeJson(["Å", "Å"]);
    expect(canonical).toBe('["Å","Å"]');
    expect(canonical.normalize("NFC")).not.toBe(canonical);
  });
});

describe("RFC 8785 Appendix B number serialization", () => {
  /** Reads an IEEE 754 binary64 value from the RFC's big-endian hex notation. */
  const doubleFromHex = (hex: string): number => {
    const view = new DataView(new ArrayBuffer(8));
    for (let index = 0; index < 8; index += 1) {
      const byte = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
      view.setUint8(index, byte);
    }
    return view.getFloat64(0, false);
  };

  // Table 1 of RFC 8785, transcribed in full. The two rows with an empty JSON
  // representation (NaN and Infinity) are asserted separately below.
  it.each([
    ["0000000000000000", "0"],
    ["8000000000000000", "0"],
    ["0000000000000001", "5e-324"],
    ["8000000000000001", "-5e-324"],
    ["7fefffffffffffff", "1.7976931348623157e+308"],
    ["ffefffffffffffff", "-1.7976931348623157e+308"],
    ["4340000000000000", "9007199254740992"],
    ["c340000000000000", "-9007199254740992"],
    ["4430000000000000", "295147905179352830000"],
    ["44b52d02c7e14af5", "9.999999999999997e+22"],
    ["44b52d02c7e14af6", "1e+23"],
    ["44b52d02c7e14af7", "1.0000000000000001e+23"],
    ["444b1ae4d6e2ef4e", "999999999999999700000"],
    ["444b1ae4d6e2ef4f", "999999999999999900000"],
    ["444b1ae4d6e2ef50", "1e+21"],
    ["3eb0c6f7a0b5ed8c", "9.999999999999997e-7"],
    ["3eb0c6f7a0b5ed8d", "0.000001"],
    ["41b3de4355555553", "333333333.3333332"],
    ["41b3de4355555554", "333333333.33333325"],
    ["41b3de4355555555", "333333333.3333333"],
    ["41b3de4355555556", "333333333.3333334"],
    ["41b3de4355555557", "333333333.33333343"],
    ["becbf647612f3696", "-0.0000033333333333333333"],
    ["43143ff3c1cb0959", "1424953923781206.2"],
  ])("serializes IEEE 754 %s as %s", (hex, expected) => {
    expect(canonicalizeJson(doubleFromHex(hex))).toBe(expected);
  });

  it("rejects the two Appendix B rows with no JSON representation", () => {
    // 7fffffffffffffff is NaN and 7ff0000000000000 is Infinity.
    expect(() => canonicalizeJson(doubleFromHex("7fffffffffffffff"))).toThrow(
      CanonicalJsonError,
    );
    expect(() => canonicalizeJson(doubleFromHex("7ff0000000000000"))).toThrow(
      CanonicalJsonError,
    );
  });

  it("writes negative zero as 0 wherever it appears", () => {
    expect(canonicalizeJson({ a: -0, b: [-0] })).toBe('{"a":0,"b":[0]}');
  });
});

describe("values RFC 8785 cannot represent", () => {
  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["undefined", undefined],
    ["a function", (): undefined => undefined],
    ["a symbol", Symbol("s")],
    ["a bigint", 1n],
    ["a Date", new Date(0)],
    ["a Map", new Map()],
    ["a Set", new Set()],
    ["a RegExp", /x/],
  ])("rejects %s", (_label, value) => {
    expect(() => canonicalizeJson(value)).toThrow(CanonicalJsonError);
  });

  it("names the location of a nested unusable value", () => {
    expect(() =>
      canonicalizeJson({ checks: [{ ordinal: Number.NaN }] }),
    ).toThrow(/\/checks\/0\/ordinal/);
  });

  it("rejects a lone high surrogate", () => {
    expect(() => canonicalizeJson("a\ud83d")).toThrow(/lone surrogate U\+D83D/);
  });

  it("rejects a lone low surrogate", () => {
    expect(() => canonicalizeJson("\udeadb")).toThrow(/lone surrogate U\+DEAD/);
  });

  it("rejects a lone surrogate in a property name", () => {
    expect(() => canonicalizeJson({ "\ud800": 1 })).toThrow(CanonicalJsonError);
  });

  it("accepts a correctly paired surrogate", () => {
    expect(canonicalizeJson("😂")).toBe('"😂"');
  });

  it("rejects a cycle instead of recursing forever", () => {
    const cyclic: Record<string, unknown> = { name: "root" };
    cyclic["self"] = cyclic;
    expect(() => canonicalizeJson(cyclic)).toThrow(/circular reference/);
  });

  it("rejects a cycle through an array", () => {
    const items: unknown[] = [];
    items.push(items);
    expect(() => canonicalizeJson(items)).toThrow(/circular reference/);
  });

  it("allows one object to appear twice without calling it a cycle", () => {
    const shared = { a: 1 };
    expect(canonicalizeJson([shared, shared])).toBe('[{"a":1},{"a":1}]');
  });

  it("reports the document root when the top-level value is unusable", () => {
    expect(() => canonicalizeJson(undefined)).toThrow(/the document root/);
  });

  it("escapes JSON Pointer reserved characters in the reported path", () => {
    expect(() => canonicalizeJson({ "a/b~c": undefined })).toThrow(/\/a~1b~0c/);
  });

  it("exposes the offending path on the error", () => {
    try {
      canonicalizeJson({ a: [1, Number.POSITIVE_INFINITY] });
      expect.unreachable("expected a CanonicalJsonError");
    } catch (error) {
      expect(error).toBeInstanceOf(CanonicalJsonError);
      expect((error as CanonicalJsonError).path).toBe("/a/1");
    }
  });
});

describe("structural rules", () => {
  it("emits no whitespace between tokens", () => {
    expect(canonicalizeJson({ a: [1, 2], b: { c: true } })).toBe(
      '{"a":[1,2],"b":{"c":true}}',
    );
  });

  it("serializes the three literals", () => {
    expect(canonicalizeJson([null, true, false])).toBe("[null,true,false]");
  });

  it("serializes empty containers", () => {
    expect(canonicalizeJson({ a: {}, b: [] })).toBe('{"a":{},"b":[]}');
  });

  it("accepts a null-prototype object", () => {
    // Object.create(null) is what a hardened JSON parser hands back, so
    // rejecting it would make the canonicalizer unusable with one.
    const bare = Object.create(null) as Record<string, unknown>;
    bare["b"] = 1;
    bare["a"] = 2;
    expect(canonicalizeJson(bare)).toBe('{"a":2,"b":1}');
  });

  it("ignores symbol-keyed properties, as JSON has no name for them", () => {
    expect(canonicalizeJson({ a: 1, [Symbol("hidden")]: 2 })).toBe('{"a":1}');
  });

  it("encodes the result as UTF-8", () => {
    // The Euro sign is one UTF-16 code unit and three UTF-8 bytes, so the byte
    // length is the assertion that step 3.2.4 actually happened.
    expect(Array.from(encodeCanonicalJson("€"))).toStrictEqual([
      0x22, 0xe2, 0x82, 0xac, 0x22,
    ]);
  });
});
