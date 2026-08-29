import { describe, expect, it } from "vitest";

import {
  PROTOCOL_MAX_ENTRIES,
  PROTOCOL_MAX_LOC_LENGTH,
  SITEMAP_NAMESPACE,
  SITEMAP_PARSE_LIMITS,
  isAbsoluteUrl,
  isW3cDatetime,
  parseSitemapXml,
} from "../../src/parsers/sitemap-xml.js";
import type {
  SitemapParse,
  SitemapParseLimits,
} from "../../src/parsers/sitemap-xml.js";

/**
 * The pure parser tier of `docs/TEST_STRATEGY.md` section 3: no transport, no
 * observation, no engine. Bytes in, a typed outcome out.
 *
 * The distinction these tests exist to protect is the one
 * `docs/decisions/0003-transport-error-vocabulary.md` section 2 draws:
 * `malformed` is a defect of the document and becomes `violated`, while
 * `refused` is a bound or a disabled feature of ours and becomes
 * `indeterminate`. A parser that returned one where the other belongs turns a
 * budget into a conformance verdict, or an XXE attempt into a target's fault.
 */

const NS = SITEMAP_NAMESPACE;

function bytes(xml: string): Uint8Array {
  return new TextEncoder().encode(xml);
}

function parse(
  xml: string,
  limits: Partial<SitemapParseLimits> = {},
): SitemapParse {
  return parseSitemapXml(bytes(xml), limits);
}

const VALID_URLSET = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  `<urlset xmlns="${NS}">`,
  "  <url>",
  "    <loc>http://127.0.0.1:8787/</loc>",
  "    <lastmod>2026-08-28</lastmod>",
  "  </url>",
  "</urlset>",
  "",
].join("\n");

const VALID_INDEX = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  `<sitemapindex xmlns="${NS}">`,
  "  <sitemap>",
  "    <loc>http://127.0.0.1:8787/sitemap-child.xml</loc>",
  "    <lastmod>2026-08-28</lastmod>",
  "  </sitemap>",
  "</sitemapindex>",
  "",
].join("\n");

describe("well-formed documents", () => {
  it("reads a urlset, its namespace and its entries", () => {
    const result = parse(VALID_URLSET);
    expect(result.kind).toBe("urlset");
    if (result.kind !== "urlset") return;
    expect(result.document.namespace).toBe(NS);
    expect(result.document.rootName).toBe("urlset");
    expect(result.document.invalidUtf8).toBe(false);
    expect(result.document.entryCount).toBe(1);
    expect(result.document.entries).toEqual([
      { loc: "http://127.0.0.1:8787/", lastmod: "2026-08-28" },
    ]);
  });

  it("reads a sitemapindex as a distinct kind", () => {
    const result = parse(VALID_INDEX);
    expect(result.kind).toBe("sitemapindex");
    if (result.kind !== "sitemapindex") return;
    expect(result.document.entries[0]?.loc).toBe(
      "http://127.0.0.1:8787/sitemap-child.xml",
    );
  });

  it("resolves a prefixed root through its own xmlns declaration", () => {
    const result = parse(
      `<sm:urlset xmlns:sm="${NS}"><sm:url><sm:loc>http://a/</sm:loc></sm:url></sm:urlset>`,
    );
    expect(result.kind).toBe("urlset");
    if (result.kind !== "urlset") return;
    expect(result.document.namespace).toBe(NS);
    expect(result.document.entries).toEqual([
      { loc: "http://a/", lastmod: null },
    ]);
  });

  it("reports a root outside the sitemap vocabulary as its own kind", () => {
    const result = parse('<html xmlns="http://www.w3.org/1999/xhtml"></html>');
    expect(result).toEqual({
      kind: "other-root",
      rootName: "html",
      namespace: "http://www.w3.org/1999/xhtml",
    });
  });

  it("keeps a urlset whose namespace is wrong, so the rule can judge it", () => {
    const result = parse(
      '<urlset xmlns="http://example.invalid/sitemap"><url><loc>http://a/</loc></url></urlset>',
    );
    expect(result.kind).toBe("urlset");
    if (result.kind !== "urlset") return;
    expect(result.document.namespace).toBe("http://example.invalid/sitemap");
  });

  it("unescapes the five predefined entities and numeric references", () => {
    const result = parse(
      `<urlset xmlns="${NS}"><url><loc>http://a/?x=1&amp;y=2&#45;3&#x2D;4</loc></url></urlset>`,
    );
    expect(result.kind).toBe("urlset");
    if (result.kind !== "urlset") return;
    expect(result.document.entries[0]?.loc).toBe("http://a/?x=1&y=2-3-4");
  });

  it("reads CDATA and comments as text and as nothing", () => {
    const result = parse(
      `<urlset xmlns="${NS}"><!-- c --><url><loc><![CDATA[http://a/?x=<1>]]></loc></url></urlset>`,
    );
    expect(result.kind).toBe("urlset");
    if (result.kind !== "urlset") return;
    expect(result.document.entries[0]?.loc).toBe("http://a/?x=<1>");
  });

  it("counts entries past the retained window", () => {
    const url = "<url><loc>http://a/</loc></url>";
    const result = parse(`<urlset xmlns="${NS}">${url.repeat(5)}</urlset>`, {
      maxKeptEntries: 2,
    });
    expect(result.kind).toBe("urlset");
    if (result.kind !== "urlset") return;
    expect(result.document.entries).toHaveLength(2);
    expect(result.document.entryCount).toBe(5);
  });

  it("flags a body that is not well-formed UTF-8", () => {
    const head = bytes(`<urlset xmlns="${NS}"><url><loc>a`);
    const tail = bytes("</loc></url></urlset>");
    const body = new Uint8Array(head.length + 1 + tail.length);
    body.set(head, 0);
    // A lone continuation byte, which no RFC 3629 sequence can start with.
    body[head.length] = 0x80;
    body.set(tail, head.length + 1);

    const result = parseSitemapXml(body);
    expect(result.kind).toBe("urlset");
    if (result.kind !== "urlset") return;
    expect(result.document.invalidUtf8).toBe(true);
  });
});

describe("malformed documents are the target's defect", () => {
  /** `docs/FIXTURE_CATALOG.md` case `map-004`. */
  it("rejects an unclosed element", () => {
    const result = parse(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<urlset xmlns="${NS}">`,
        "  <url>",
        "    <loc>http://127.0.0.1:8787/",
        "  </url>",
        "</urlset>",
        "",
      ].join("\n"),
    );
    // `</url>` closes `<loc>` by name mismatch before end of input is reached.
    expect(result).toEqual({
      kind: "malformed",
      reason: "mismatched-end-tag",
    });
  });

  it("rejects a document whose root is never closed", () => {
    expect(parse(`<urlset xmlns="${NS}"><url></url>`)).toEqual({
      kind: "malformed",
      reason: "unclosed-element",
    });
  });

  it.each([
    ["no root element", "   \n  ", "no-root"],
    ["content after the root", `<urlset xmlns="${NS}"/>x`, "trailing-content"],
    ["a second root", `<urlset xmlns="${NS}"/><urlset/>`, "trailing-content"],
    ["an unterminated comment", "<!-- forever", "unterminated"],
    ["an unquoted attribute", "<urlset xmlns=x/>", "bad-attribute"],
    ["a missing attribute value", "<urlset xmlns/>", "bad-attribute"],
    ["a bad start-tag name", "<1urlset/>", "bad-name"],
    ["an unknown markup declaration", "<!ENTITY x>", "bad-markup"],
    [
      "a truncated character reference",
      "<urlset>&amp",
      "bad-character-reference",
    ],
  ])("rejects %s", (_case, xml, reason) => {
    expect(parse(xml)).toEqual({ kind: "malformed", reason });
  });
});

describe("refusals are our bound, never a verdict", () => {
  /**
   * `docs/FIXTURE_CATALOG.md` case `sec-008`. The proof is in three parts: the
   * outcome is a refusal and not a parse, the reason names the DOCTYPE, and no
   * part of the entity or its system identifier appears anywhere in the
   * result. A parser that expanded `&xxe;` would have had to read the internal
   * subset to find the declaration, and this one never gets that far.
   */
  it("refuses a DOCTYPE with an external entity, and expands nothing", () => {
    const systemId = "file:///etc/passwd";
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<!DOCTYPE urlset [ <!ENTITY xxe SYSTEM "${systemId}"> ]>`,
      `<urlset xmlns="${NS}">`,
      "  <url><loc>&xxe;</loc></url>",
      "</urlset>",
    ].join("\n");

    const result = parse(xml);
    expect(result).toEqual({ kind: "refused", reason: "doctype" });
    const rendered = JSON.stringify(result);
    expect(rendered).not.toContain(systemId);
    expect(rendered).not.toContain("passwd");
    expect(rendered).not.toContain("ENTITY");
  });

  it("refuses an http SYSTEM identifier the same way", () => {
    const result = parse(
      '<!DOCTYPE urlset SYSTEM "http://127.0.0.1:9/evil.dtd"><urlset/>',
    );
    expect(result).toEqual({ kind: "refused", reason: "doctype" });
    expect(JSON.stringify(result)).not.toContain("evil.dtd");
  });

  it("refuses a reference that is neither predefined nor numeric", () => {
    expect(
      parse(`<urlset xmlns="${NS}"><url><loc>&xxe;</loc></url></urlset>`),
    ).toEqual({ kind: "refused", reason: "entity" });
  });

  /**
   * A decoded `&` is text and is never rescanned. Without this an attacker
   * could smuggle a reference through `&#38;`, which is the second half of
   * every entity-expansion trick and the reason expansion happens once.
   */
  it("does not re-interpret a decoded ampersand as a new reference", () => {
    const result = parse(
      `<urlset xmlns="${NS}"><url><loc>&#38;xxe;</loc></url></urlset>`,
    );
    expect(result.kind).toBe("urlset");
    if (result.kind !== "urlset") return;
    expect(result.document.entries[0]?.loc).toBe("&xxe;");
  });

  it("refuses an XInclude element", () => {
    expect(
      parse(
        `<urlset xmlns="${NS}"><xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="http://127.0.0.1:9/x"/></urlset>`,
      ),
    ).toEqual({ kind: "refused", reason: "xinclude" });
  });

  it("refuses a body over the byte cap rather than truncating it", () => {
    expect(parse(VALID_URLSET, { maxBytes: 16 })).toEqual({
      kind: "refused",
      reason: "bytes",
    });
  });

  it("pins the threat-model depth at 64 and refuses past it", () => {
    expect(SITEMAP_PARSE_LIMITS.maxDepth).toBe(64);
    const deep = (levels: number): string =>
      `<urlset xmlns="${NS}">${"<a>".repeat(levels)}${"</a>".repeat(levels)}</urlset>`;

    // The root occupies depth 0, so 63 further elements fit and the 64th does
    // not. `<a>` is outside the sitemap vocabulary, so the document parses to
    // an entry-less urlset rather than to anything meaningful.
    expect(parse(deep(63)).kind).toBe("urlset");
    expect(parse(deep(64))).toEqual({ kind: "refused", reason: "depth" });
    expect(parse(deep(6), { maxDepth: 4 })).toEqual({
      kind: "refused",
      reason: "depth",
    });
  });

  it("refuses past the node cap", () => {
    const url = "<url><loc>http://a/</loc></url>";
    expect(
      parse(`<urlset xmlns="${NS}">${url.repeat(4)}</urlset>`, {
        maxNodes: 5,
      }),
    ).toEqual({ kind: "refused", reason: "nodes" });
  });

  it("refuses past the attribute cap", () => {
    expect(parse('<urlset a="1" b="2" c="3"/>', { maxAttributes: 2 })).toEqual({
      kind: "refused",
      reason: "attributes",
    });
  });

  it("refuses an oversized attribute value or text run", () => {
    const long = "x".repeat(64);
    expect(parse(`<urlset a="${long}"/>`, { maxValueLength: 8 })).toEqual({
      kind: "refused",
      reason: "value-length",
    });
    expect(
      parse(`<urlset xmlns="${NS}"><url><loc>${long}</loc></url></urlset>`, {
        maxValueLength: 8,
      }),
    ).toEqual({ kind: "refused", reason: "value-length" });
  });
});

describe("value predicates", () => {
  it("pins the protocol's own limits", () => {
    expect(PROTOCOL_MAX_ENTRIES).toBe(50_000);
    expect(PROTOCOL_MAX_LOC_LENGTH).toBe(2048);
  });

  it.each([
    ["http://example.com/", true],
    ["https://example.com/a?b=c", true],
    ["HTTP://example.com/", true],
    ["ftp://example.com/", true],
    ["/nested.xml", false],
    ["nested.xml", false],
    ["//example.com/a", false],
    ["", false],
    [":http", false],
    ["1http://x/", false],
  ])("decides absoluteness of %s", (value, expected) => {
    expect(isAbsoluteUrl(value)).toBe(expected);
  });

  it.each([
    ["2026", true],
    ["2026-08", true],
    ["2026-08-28", true],
    ["2026-08-28T14:30Z", true],
    ["2026-08-28T14:30:05Z", true],
    ["2026-08-28T14:30:05.123+08:00", true],
    ["2026-08-28T14:30:05-05:00", true],
    ["2026-8-28", false],
    ["2026-08-28T14:30", false],
    ["2026-08-28 14:30Z", false],
    ["yesterday", false],
    ["", false],
  ])("decides the W3C Datetime form of %s", (value, expected) => {
    expect(isW3cDatetime(value)).toBe(expected);
  });
});
