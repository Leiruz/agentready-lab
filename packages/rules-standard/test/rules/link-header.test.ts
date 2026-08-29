import { describe, expect, it } from "vitest";

import type {
  LinkFieldResult,
  ParsedLink,
} from "../../src/parsers/link-header.js";
import {
  MAX_LINK_FIELD_CHARS,
  MAX_LINK_FIELD_VALUES,
  parseLinkField,
} from "../../src/parsers/link-header.js";

/**
 * Pure unit tests for the RFC 8288 `Link` field scanner.
 *
 * `docs/TEST_STRATEGY.md` section 3 puts parser units below the contract tier:
 * no transport, no fixture, no server. The scanner is the hardest thing in this
 * rule, so it carries the heavier suite, and `link.test.ts` covers the six
 * catalog cases end to end.
 */

function links(values: readonly string[]): readonly ParsedLink[] {
  const result = parseLinkField(values);
  if (result.kind !== "parsed") {
    throw new Error(
      `expected a parse, got ${result.kind}: ${JSON.stringify(result)}`,
    );
  }
  return result.links;
}

/** The single link a one-link field must produce. */
function only(values: readonly string[]): ParsedLink {
  const parsed = links(values);
  if (parsed.length !== 1) {
    throw new Error(`expected exactly one link, got ${String(parsed.length)}`);
  }
  const [link] = parsed;
  if (link === undefined) throw new Error("unreachable");
  return link;
}

function malformed(values: readonly string[]): LinkFieldResult {
  const result = parseLinkField(values);
  if (result.kind !== "malformed") {
    throw new Error(`expected a syntax failure, got ${result.kind}`);
  }
  return result;
}

function paramValue(link: ParsedLink, name: string): string | null | undefined {
  return link.params.find((param) => param.name === name)?.value;
}

describe("the comma separates only outside a quoted string", () => {
  it("keeps a comma inside a quoted title", () => {
    const link = only([
      '<https://example.invalid/a>; rel="describedby"; title="Foo, Bar"',
    ]);
    expect(link.target).toBe("https://example.invalid/a");
    expect(paramValue(link, "title")).toBe("Foo, Bar");
  });

  it("splits on a comma that is outside the quotes", () => {
    const parsed = links([
      '</a>; rel="describedby"; title="Foo, Bar", </b>; rel="stylesheet"',
    ]);
    expect(parsed.map((link) => link.target)).toStrictEqual(["/a", "/b"]);
    expect(parsed[1]?.relations).toStrictEqual([
      { kind: "registered", value: "stylesheet" },
    ]);
  });

  it("keeps a semicolon and angle brackets inside a quoted value", () => {
    const link = only(['</a>; rel="next"; title="a;b<c>d"']);
    expect(paramValue(link, "title")).toBe("a;b<c>d");
  });
});

describe("quoted strings", () => {
  it("unescapes a quoted pair", () => {
    const link = only(['</a>; rel="next"; title="say \\"hi\\" now"']);
    expect(paramValue(link, "title")).toBe('say "hi" now');
  });

  it("unescapes an escaped backslash", () => {
    const link = only(['</a>; rel="next"; title="a\\\\b"']);
    expect(paramValue(link, "title")).toBe("a\\b");
  });

  it("fails the whole field on an unclosed quote", () => {
    expect(malformed(['</a>; rel="next"; title="unclosed'])).toStrictEqual({
      kind: "malformed",
      error: "unterminated-quoted-string",
      fieldIndex: 0,
      offset: 24,
    });
  });

  it("fails on a trailing backslash that escapes the closing quote", () => {
    expect(malformed(['</a>; rel="next"; title="oops\\"'])).toMatchObject({
      error: "unterminated-quoted-string",
    });
  });

  it("returns no link at all, not the ones before the unclosed quote", () => {
    // RFC 8288 Appendix B is a deliberately liberal parser and would return
    // `/a` here. Appendix B is informative; the section 3 ABNF is the grammar,
    // and returning a prefix would let a target hide `/b` behind an open quote
    // and still be reported as parsed.
    expect(malformed(['</a>; rel="next", </b>; title="open'])).toStrictEqual({
      kind: "malformed",
      error: "unterminated-quoted-string",
      fieldIndex: 0,
      offset: 30,
    });
  });
});

describe("field values and physical lines", () => {
  it("parses several field values as one list", () => {
    const parsed = links([
      '</openapi.json>; rel="service-desc"',
      '</about>; rel="describedby"',
    ]);
    expect(parsed.map((link) => link.target)).toStrictEqual([
      "/openapi.json",
      "/about",
    ]);
  });

  it("gives a combined value the same result as separate lines", () => {
    // The two input shapes the rule must handle: an observation carrying
    // repeated field lines as an array, and a normalized single value that
    // joined them with a comma.
    const separate = links([
      '</openapi.json>; rel="service-desc"',
      '</about>; rel="describedby"; title="A, B"',
    ]);
    const combined = links([
      '</openapi.json>; rel="service-desc", </about>; rel="describedby"; title="A, B"',
    ]);
    expect(combined).toStrictEqual(separate);
  });

  it("reports which field value failed", () => {
    expect(malformed(['</a>; rel="next"', '</b>; rel="open'])).toMatchObject({
      fieldIndex: 1,
    });
  });

  it("accepts an empty field value as an empty list", () => {
    expect(links([""])).toStrictEqual([]);
    expect(links(["   "])).toStrictEqual([]);
  });

  it("accepts the empty list elements RFC 7230 section 7 permits", () => {
    expect(links([', , </a>; rel="next" , ,'])).toHaveLength(1);
  });
});

describe("parameters", () => {
  it("lowercases parameter names", () => {
    const link = only(['</a>; REL="Next"; TiTlE=x']);
    expect(link.params.map((param) => param.name)).toStrictEqual([
      "rel",
      "title",
    ]);
  });

  it("keeps the first occurrence of a repeated parameter", () => {
    // RFC 8288 sections 3.3 and 3.4: "occurrences after the first MUST be
    // ignored by parsers".
    const link = only(['</a>; rel="first"; rel="second"; title=a; title=b']);
    expect(link.params).toStrictEqual([
      { name: "rel", value: "first" },
      { name: "title", value: "a" },
    ]);
  });

  it("treats title* as an ordinary parameter and applies first-wins to it", () => {
    // `*` is a `tchar`, so an RFC 8187 extended value needs no special
    // tokenization: it is a parameter name like any other. The value is
    // carried through undecoded, because decoding percent-escapes into a
    // charset needs a decoder this package does not have.
    const link = only([
      "</a>; rel=next; title*=UTF-8'en'%C2%A3%20rates; title*=UTF-8''second",
    ]);
    expect(paramValue(link, "title*")).toBe("UTF-8'en'%C2%A3%20rates");
  });

  it("carries a quoted title* beside a plain title", () => {
    const link = only([
      '</a>; rel=next; title="pounds"; title*="UTF-8\'\'%C2%A3"',
    ]);
    expect(paramValue(link, "title")).toBe("pounds");
    expect(paramValue(link, "title*")).toBe("UTF-8''%C2%A3");
  });

  it("accepts a parameter written with no value", () => {
    expect(paramValue(only(["</a>; rel=next; nopull"]), "nopull")).toBeNull();
  });

  it("accepts OWS and BWS around the delimiters and the equals sign", () => {
    const link = only(['  </a>  ;  rel  =  "next"  ;  type = "text/plain"  ']);
    expect(paramValue(link, "rel")).toBe("next");
    expect(paramValue(link, "type")).toBe("text/plain");
  });

  it("rejects an unquoted value that is not a single token", () => {
    // `text/plain` contains `/`, which is not a `tchar`, so the ABNF requires
    // it quoted. The scanner stops at the `/` and the leftover is not a
    // delimiter.
    expect(malformed(["</a>; rel=next; type=text/plain"])).toMatchObject({
      error: "expected-parameter-delimiter",
    });
  });

  it("rejects a semicolon with no parameter after it", () => {
    expect(malformed(['</a>; rel="next";'])).toMatchObject({
      error: "expected-parameter-name",
    });
  });

  it("rejects an equals sign with no value after it", () => {
    expect(malformed(["</a>; rel="])).toMatchObject({
      error: "expected-parameter-value",
    });
  });
});

describe("targets", () => {
  it("accepts an empty target, which is a same-document reference", () => {
    expect(only(['<>; rel="self"']).target).toBe("");
  });

  it("keeps a relative target exactly as served and resolves nothing", () => {
    expect(only(['<./openapi.json?v=1>; rel="service-desc"']).target).toBe(
      "./openapi.json?v=1",
    );
  });

  it("rejects a list element that does not begin with an angle bracket", () => {
    expect(malformed(['https://example.invalid/a; rel="next"'])).toMatchObject({
      error: "expected-link-target",
      offset: 0,
    });
  });

  it("rejects an unterminated target", () => {
    expect(malformed(['<https://example.invalid/a; rel="next"'])).toMatchObject(
      { error: "unterminated-link-target" },
    );
  });

  it("rejects a link-value followed by something that is not a delimiter", () => {
    expect(malformed(["</a> rel=next"])).toMatchObject({
      error: "expected-parameter-delimiter",
    });
  });
});

describe("relation types", () => {
  it("lowercases a registered relation type", () => {
    expect(only(['</a>; rel="SerVice-Desc"']).relations).toStrictEqual([
      { kind: "registered", value: "service-desc" },
    ]);
  });

  it("splits several relation types on whitespace", () => {
    const link = only(['</a>; rel="describedby  service-desc\tnext"']);
    expect(link.relations.map((relation) => relation.value)).toStrictEqual([
      "describedby",
      "service-desc",
      "next",
    ]);
  });

  it("keeps an extension relation URI verbatim", () => {
    expect(
      only(['</a>; rel="https://Example.invalid/rel/Agent"']).relations,
    ).toStrictEqual([
      { kind: "extension", value: "https://Example.invalid/rel/Agent" },
    ]);
  });

  it("marks a name that is neither a registered type nor a URI invalid", () => {
    expect(only(['</a>; rel="agent_useful"']).relations).toStrictEqual([
      { kind: "invalid", value: "agent_useful" },
    ]);
  });

  it("reports no relations when rel is absent", () => {
    expect(only(['</a>; title="no rel here"']).relations).toStrictEqual([]);
  });

  it("reports no relations for a valueless rel", () => {
    expect(only(["</a>; rel"]).relations).toStrictEqual([]);
  });

  it("reports no relations for an empty rel", () => {
    expect(only(['</a>; rel=""']).relations).toStrictEqual([]);
  });

  it("takes the relations from the first rel only", () => {
    expect(
      only(['</a>; rel="next"; rel="service-desc"']).relations,
    ).toStrictEqual([{ kind: "registered", value: "next" }]);
  });
});

describe("bounds", () => {
  it("refuses an over-long field rather than parsing it", () => {
    const element = "</a>; rel=next, ";
    const filler = element.repeat(1 + MAX_LINK_FIELD_CHARS / element.length);
    expect(filler.length).toBeGreaterThan(MAX_LINK_FIELD_CHARS);
    expect(parseLinkField([filler])).toStrictEqual({
      kind: "bounded",
      limit: "field-length",
    });
  });

  it("sums the length bound across field values", () => {
    const half = "x".repeat(MAX_LINK_FIELD_CHARS / 2 + 1);
    expect(parseLinkField([half, half])).toStrictEqual({
      kind: "bounded",
      limit: "field-length",
    });
  });

  it("refuses too many field values rather than parsing them", () => {
    const many = Array.from(
      { length: MAX_LINK_FIELD_VALUES + 1 },
      () => "</a>; rel=next",
    );
    expect(parseLinkField(many)).toStrictEqual({
      kind: "bounded",
      limit: "field-value-count",
    });
  });

  it("parses a field exactly at the length bound", () => {
    const one = '</a>; rel="next"';
    const padded = one + " ".repeat(MAX_LINK_FIELD_CHARS - one.length);
    expect(padded).toHaveLength(MAX_LINK_FIELD_CHARS);
    expect(links([padded])).toHaveLength(1);
  });
});
