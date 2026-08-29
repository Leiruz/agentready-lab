import { describe, expect, it } from "vitest";

import {
  MAX_MEDIA_TYPE_LENGTH,
  MAX_MEDIA_TYPE_PARAMETERS,
  isMediaType,
  mediaTypeParameter,
  parseMediaType,
} from "../../src/parsers/media-type.js";

/**
 * `src/parsers/media-type.ts`, the bottom of the three tiers in
 * `docs/TEST_STRATEGY.md` section 3: a pure parser unit with no transport, no
 * rule and no engine.
 *
 * The cases below are the ones the parser exists to get right rather than a
 * sample of them: `docs/FIXTURE_CATALOG.md` case `md-005` turns on
 * `text/plain` never answering to `text/markdown`, and RFC 9110 section 8.3.1
 * turns on `TEXT/MARKDOWN` always doing so.
 */

describe("parseMediaType", () => {
  it("lowercases type and subtype and keeps the essence separate", () => {
    expect(parseMediaType("TEXT/MarkDown")).toEqual({
      type: "text",
      subtype: "markdown",
      essence: "text/markdown",
      parameters: [],
    });
  });

  it("parses parameters, lowercasing only the name", () => {
    const parsed = parseMediaType("text/markdown; charset=UTF-8; Variant=GFM");

    expect(parsed?.essence).toBe("text/markdown");
    expect(parsed?.parameters).toEqual([
      { name: "charset", value: "UTF-8" },
      { name: "variant", value: "GFM" },
    ]);
  });

  it("unescapes a quoted-string value and its quoted-pairs", () => {
    const parsed = parseMediaType(String.raw`text/markdown; variant="a\"b;c"`);

    expect(parsed?.parameters).toEqual([{ name: "variant", value: 'a"b;c' }]);
  });

  it("accepts obs-text in a quoted-string and in a quoted-pair", () => {
    // RFC 9110 section 5.6.4 keeps `obs-text` (%x80-FF) in both productions.
    const high = String.fromCharCode(0xe9);
    const parsed = parseMediaType(
      `text/markdown; variant="caf${high}"; note="\\${high}"`,
    );

    expect(parsed?.parameters).toEqual([
      { name: "variant", value: `caf${high}` },
      { name: "note", value: high },
    ]);
  });

  it("tolerates OWS around the separators and a trailing semicolon", () => {
    expect(parseMediaType("  text/markdown ;  charset=utf-8 ;")?.essence).toBe(
      "text/markdown",
    );
  });

  it("refuses whitespace around the parameter equals sign", () => {
    // RFC 9110 section 5.6.6 permits none, so this is not a media type.
    expect(parseMediaType("text/markdown; charset = utf-8")).toBeNull();
  });

  it("refuses trailing content rather than taking the first media type", () => {
    // Two combined field lines do not say which representation was sent.
    expect(parseMediaType("text/markdown, text/html")).toBeNull();
  });

  it.each([
    ["an empty value", ""],
    ["a bare type", "text"],
    ["a missing subtype", "text/"],
    ["a missing type", "/markdown"],
    ["a parameter with no value", "text/markdown; charset="],
    ["a parameter with no name", "text/markdown; =utf-8"],
    ["an unterminated quoted-string", 'text/markdown; variant="gfm'],
    [
      "a control character in a quoted-string",
      `text/markdown; variant="a${String.fromCharCode(1)}b"`,
    ],
    ["a dangling quoted-pair escape", 'text/markdown; variant="a\\'],
    ["a non-token character in the subtype", "text/mark down"],
  ])("refuses %s", (_label, field) => {
    expect(parseMediaType(field)).toBeNull();
  });

  it("refuses a field value longer than the cap rather than truncating it", () => {
    const padded = `text/markdown; charset=${"u".repeat(MAX_MEDIA_TYPE_LENGTH)}`;

    expect(padded.length).toBeGreaterThan(MAX_MEDIA_TYPE_LENGTH);
    expect(parseMediaType(padded)).toBeNull();
  });

  it("refuses more parameters than the cap", () => {
    const within = Array.from(
      { length: MAX_MEDIA_TYPE_PARAMETERS },
      (_value, index) => `p${String(index)}=v`,
    ).join("; ");

    expect(parseMediaType(`text/markdown; ${within}`)?.parameters).toHaveLength(
      MAX_MEDIA_TYPE_PARAMETERS,
    );
    expect(parseMediaType(`text/markdown; ${within}; last=v`)).toBeNull();
  });

  it("terminates on a long run of separators", () => {
    // A bounded forward scan, not a backtracking pattern.
    expect(parseMediaType(`text/markdown${";".repeat(500)}`)).not.toBeNull();
  });
});

describe("isMediaType", () => {
  it.each([
    "text/markdown",
    "text/markdown; charset=utf-8",
    "TEXT/MARKDOWN",
    "text/markdown;charset=utf-8;variant=GFM",
  ])("accepts %s as text/markdown", (field) => {
    expect(isMediaType(field, "text/markdown")).toBe(true);
  });

  it.each([
    "text/html",
    "text/html; charset=utf-8",
    // `md-005`: Markdown bytes labelled `text/plain`. The label decides.
    "text/plain",
    "text/plain; charset=utf-8",
    "text/x-markdown",
    "text/markdownish",
    "application/markdown",
  ])("rejects %s as text/markdown", (field) => {
    expect(isMediaType(field, "text/markdown")).toBe(false);
  });

  it("rejects an absent field", () => {
    expect(isMediaType(undefined, "text/markdown")).toBe(false);
  });

  it("rejects an unparseable field rather than substring-matching it", () => {
    expect(isMediaType("text/markdown, text/html", "text/markdown")).toBe(
      false,
    );
  });
});

describe("mediaTypeParameter", () => {
  it("matches the parameter name case-insensitively", () => {
    const parsed = parseMediaType("text/markdown; CharSet=utf-8");

    expect(parsed).not.toBeNull();
    if (parsed === null) return;
    expect(mediaTypeParameter(parsed, "charset")).toBe("utf-8");
    expect(mediaTypeParameter(parsed, "CHARSET")).toBe("utf-8");
    expect(mediaTypeParameter(parsed, "variant")).toBeUndefined();
  });
});
