import { acceptMemoValue } from "@agentready-lab/core";
import { describe, expect, it } from "vitest";

import type { ParsedRobots } from "../../src/parsers/robots.js";
import {
  MAX_DESCRIBED_MALFORMED_LINES,
  ROBOTS_PARSE_LIMITS,
  extensionFieldNames,
  parseRobots,
} from "../../src/parsers/robots.js";

/**
 * The pure half of the robots work: no harness, no transport, no engine.
 *
 * `docs/TEST_STRATEGY.md` section 3 puts parser units below the contract tier
 * for a reason. Everything here is a property of a byte string, and asserting
 * it through a scan would only add ways for the assertion to be satisfied by
 * something other than the parser.
 */

const encoder = new TextEncoder();

function parse(text: string): ParsedRobots {
  return parseRobots(encoder.encode(text));
}

describe("RFC 9309 section 2.2 records", () => {
  it("assembles consecutive user-agent lines into one group", () => {
    const parsed = parse(
      ["User-agent: A", "User-agent: B", "Disallow: /x"].join("\n"),
    );

    expect(parsed.groups).toEqual([
      {
        agents: ["a", "b"],
        agentLines: [1, 2],
        rules: [{ line: 3, type: "disallow", path: "/x" }],
      },
    ]);
  });

  it("starts a new group at a user-agent line that follows a rule", () => {
    const parsed = parse(
      ["User-agent: A", "Disallow: /x", "User-agent: B", "Allow: /y"].join(
        "\n",
      ),
    );

    expect(parsed.groups.map((group) => group.agents)).toEqual([["a"], ["b"]]);
    expect(parsed.groups[1]?.rules).toEqual([
      { line: 4, type: "allow", path: "/y" },
    ]);
  });

  it("keeps the empty-pattern distinct from a path", () => {
    const parsed = parse(["User-agent: *", "Disallow:", "Allow: /"].join("\n"));

    expect(parsed.groups[0]?.rules).toEqual([
      { line: 2, type: "disallow", path: "" },
      { line: 3, type: "allow", path: "/" },
    ]);
    expect(parsed.malformedCount).toBe(0);
  });

  it("lowercases the product token but not the path", () => {
    const parsed = parse(
      ["User-Agent: ExampleBot", "Disallow: /Case"].join("\n"),
    );

    expect(parsed.groups[0]?.agents).toEqual(["examplebot"]);
    expect(parsed.groups[0]?.rules[0]?.path).toBe("/Case");
  });
});

describe("tolerant parsing, per rob-006", () => {
  const document = [
    "# a comment",
    "",
    "   \t  ",
    "User-agent: *   # trailing comment",
    "Disallow: /admin/",
    "Crawl-delay: 10",
    "Allow: /admin/help",
    "# no final newline follows",
  ];

  it.each([
    ["LF", document.join("\n")],
    ["CRLF", document.join("\r\n")],
    ["CR", document.join("\r")],
    ["LF with a final newline", `${document.join("\n")}\n`],
  ])("parses the same groups with %s line endings", (_label, text) => {
    const parsed = parse(text);

    expect(parsed.malformedCount).toBe(0);
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0]?.rules.map((rule) => rule.path)).toEqual([
      "/admin/",
      "/admin/help",
    ]);
  });

  it("strips a UTF-8 byte-order mark", () => {
    const bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...encoder.encode("User-agent: *\nDisallow: /"),
    ]);
    const parsed = parseRobots(bytes);

    expect(parsed.invalidUtf8).toBe(false);
    expect(parsed.groups[0]?.agents).toEqual(["*"]);
  });

  it("reports the ignored field names, bounded and sorted", () => {
    const parsed = parse(
      [
        "Sitemap: http://a.invalid/s.xml",
        "User-agent: *",
        "Content-Signal: search=yes",
        "Crawl-delay: 10",
        "Sitemap: http://a.invalid/s2.xml",
      ].join("\n"),
    );

    expect(extensionFieldNames(parsed)).toEqual([
      "content-signal",
      "crawl-delay",
      "sitemap",
    ]);
    expect(extensionFieldNames(parsed, 2)).toHaveLength(2);
  });
});

describe("section 2.2.4: other records are handed out, never interpreted", () => {
  // Every extension record sits where interference would show: one before any
  // group, and three *between* the two rules of the only group. A fixture with
  // them only at the edges cannot tell a tokenizer from an interpreter, which
  // is what mutating the parser to close a group on `Sitemap:` demonstrated.
  const withExtensions = [
    "Sitemap: http://127.0.0.1:8787/sitemap.xml",
    "User-agent: *",
    "Content-Signal: search=yes, ai-train=no",
    "Disallow: /admin/",
    "Sitemap: http://127.0.0.1:8787/other.xml",
    "Crawl-delay: 10",
    "Allow: /admin/help",
  ].join("\n");

  const withoutExtensions = [
    "User-agent: *",
    "Disallow: /admin/",
    "Allow: /admin/help",
  ].join("\n");

  it("emits Sitemap as an extension record with its line number", () => {
    const parsed = parse(withExtensions);

    // If this ever starts reporting a `sitemaps` array, the parser has taken a
    // decision that belongs to `web.discovery.sitemap`.
    expect(parsed.extensions).toEqual([
      {
        line: 1,
        field: "sitemap",
        value: "http://127.0.0.1:8787/sitemap.xml",
      },
      { line: 3, field: "content-signal", value: "search=yes, ai-train=no" },
      { line: 5, field: "sitemap", value: "http://127.0.0.1:8787/other.xml" },
      { line: 6, field: "crawl-delay", value: "10" },
    ]);
    expect(Object.keys(parsed)).not.toContain("sitemaps");
  });

  it("does not let an extension record change group parsing", () => {
    // ADR-0009 section 3 discharges RFC 9309 section 2.2.4's non-interference
    // MUST here: identical group selection and allow/disallow results with the
    // extension records present and with them stripped.
    const present = parse(withExtensions);
    const stripped = parse(withoutExtensions);

    expect(present.groups.map((group) => group.agents)).toEqual(
      stripped.groups.map((group) => group.agents),
    );
    expect(
      present.groups.map((group) =>
        group.rules.map((rule) => `${rule.type} ${rule.path}`),
      ),
    ).toEqual(
      stripped.groups.map((group) =>
        group.rules.map((rule) => `${rule.type} ${rule.path}`),
      ),
    );
    expect(present.malformedCount).toBe(0);
    // The positive half: the group really does span the extension records, so
    // "unchanged" above is not two empty lists agreeing with each other.
    expect(present.groups).toHaveLength(1);
    expect(present.groups[0]?.rules).toHaveLength(2);
  });
});

describe("malformed lines", () => {
  it.each([
    ["<html>", "no-separator"],
    ['<a href="http://x">y</a>', "unparseable-field"],
    ["User-agent: bad token!", "bad-product-token"],
    ["User-agent: ", "bad-product-token"],
  ])("%s is %s", (line, reason) => {
    const parsed = parse(line);

    expect(parsed.malformed).toEqual([{ line: 1, reason }]);
    expect(parsed.groups).toEqual([]);
  });

  it("rejects a path that does not start with a slash", () => {
    const parsed = parse(["User-agent: *", "Disallow: admin"].join("\n"));

    expect(parsed.malformed).toEqual([{ line: 2, reason: "bad-path-pattern" }]);
    expect(parsed.groups[0]?.rules).toEqual([]);
  });

  it("rejects an unescaped space inside a path pattern", () => {
    // `path-pattern = "/" *UTF8-char-noctl` and `UTF8-1-noctl` starts at
    // %x21, so SP and HTAB are not path characters.
    const parsed = parse(["User-agent: *", "Disallow: /my path"].join("\n"));

    expect(parsed.malformed).toEqual([{ line: 2, reason: "bad-path-pattern" }]);
  });

  it("records a rule that precedes every group rather than dropping it", () => {
    const parsed = parse(["Disallow: /x", "User-agent: *"].join("\n"));

    expect(parsed.malformed).toEqual([
      { line: 1, reason: "rule-outside-group" },
    ]);
    expect(parsed.groups).toEqual([
      { agents: ["*"], agentLines: [2], rules: [] },
    ]);
  });

  it("counts every malformed line but describes a bounded number", () => {
    const lines = MAX_DESCRIBED_MALFORMED_LINES + 10;
    const parsed = parse(
      Array.from({ length: lines }, () => "junk").join("\n"),
    );

    expect(parsed.malformedCount).toBe(lines);
    expect(parsed.malformed).toHaveLength(MAX_DESCRIBED_MALFORMED_LINES);
  });

  it("flags a body that is not well-formed UTF-8", () => {
    // RFC 9309 section 2.3's "MUST be UTF-8 encoded", on the actual bytes. The
    // lone 0xFF cannot begin any sequence.
    const parsed = parseRobots(
      new Uint8Array([...encoder.encode("User-agent: *\nDisallow: /"), 0xff]),
    );

    expect(parsed.invalidUtf8).toBe(true);
    expect(parsed.groups).toHaveLength(1);
  });

  it.each([
    ["overlong two-byte form", [0xc0, 0xaf]],
    ["surrogate half", [0xed, 0xa0, 0x80]],
    ["past U+10FFFF", [0xf5, 0x80, 0x80, 0x80]],
    ["truncated three-byte sequence", [0xe2, 0x82]],
  ])("rejects an %s", (_label, bytes) => {
    expect(parseRobots(new Uint8Array(bytes)).invalidUtf8).toBe(true);
  });

  it("accepts valid multi-byte UTF-8", () => {
    const parsed = parse(
      ["User-agent: *", "Disallow: /café/\u{1f600}"].join("\n"),
    );

    expect(parsed.invalidUtf8).toBe(false);
    expect(parsed.groups[0]?.rules[0]?.path).toBe("/café/\u{1f600}");
  });
});

describe("bounded against hostile input", () => {
  const empty = {
    invalidUtf8: false,
    lineCount: 0,
    groups: [],
    extensions: [],
    malformed: [],
    malformedCount: 0,
  };

  it("refuses a body over the byte limit without parsing it", () => {
    const oversized = new Uint8Array(ROBOTS_PARSE_LIMITS.maxBytes + 1).fill(
      0x41,
    );

    expect(parseRobots(oversized)).toEqual({ ...empty, refusedBy: "bytes" });
  });

  it.each([
    [
      "lines",
      { maxLines: 2 },
      ["User-agent: *", "Disallow: /a", "Disallow: /b"].join("\n"),
    ],
    ["line-length", { maxLineLength: 8 }, "User-agent: *"],
    [
      "groups",
      { maxGroups: 1 },
      ["User-agent: a", "Disallow: /", "User-agent: b"].join("\n"),
    ],
    [
      "rules",
      { maxRules: 1 },
      ["User-agent: a", "Disallow: /x", "Disallow: /y"].join("\n"),
    ],
    [
      "extensions",
      { maxExtensions: 1 },
      ["Sitemap: http://a.invalid/1", "Sitemap: http://a.invalid/2"].join("\n"),
    ],
  ])("refuses at the %s limit", (limit, overrides, text) => {
    expect(parseRobots(encoder.encode(text), overrides)).toEqual({
      ...empty,
      refusedBy: limit,
    });
  });

  it("stays linear on a pathological line of colons", () => {
    const parsed = parse(`${":".repeat(2000)}\nUser-agent: *`);

    expect(parsed.refusedBy).toBeNull();
    expect(parsed.malformedCount).toBe(1);
    expect(parsed.groups).toHaveLength(1);
  });
});

describe("ADR-0002 section 11: the result is a memo value", () => {
  const documents: readonly string[] = [
    "",
    "User-agent: *\nDisallow: /private/\nSitemap: http://a.invalid/s.xml\n",
    "junk\nUser-agent: bad!\nDisallow: nope\n",
  ];

  it.each(documents)("accepts and freezes the parse of %j", (text) => {
    const frozen = acceptMemoValue(parse(text));

    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.groups)).toBe(true);
    expect(Object.isFrozen(frozen.extensions)).toBe(true);
    expect(Object.isFrozen(frozen.malformed)).toBe(true);
  });

  it("accepts a refusal, whose empty arrays must not be a shared node", () => {
    // `assertPlainData` rejects a repeated object exactly as it rejects a
    // cycle, so one hoisted `EMPTY` constant reused for `groups`,
    // `extensions` and `malformed` would fail here.
    const refusal = parseRobots(new Uint8Array(0), { maxBytes: -1 });

    expect(refusal.refusedBy).toBe("bytes");
    expect(() => acceptMemoValue(refusal)).not.toThrow();
  });

  it("has no undefined property, which the validator rejects", () => {
    const parsed = parse("User-agent: *\nDisallow: /x\n");

    for (const value of Object.values(parsed)) {
      expect(value).not.toBeUndefined();
    }
  });
});
