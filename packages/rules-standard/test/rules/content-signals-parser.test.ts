import { describe, expect, it } from "vitest";

import {
  CONTENT_SIGNALS_DRAFT,
  CONTENT_SIGNALS_DRAFT_EXPIRED,
  CONTENT_SIGNALS_DRAFT_EXPIRY,
  CONTENT_SIGNALS_SOURCE_ID,
  CONTENT_SIGNALS_VOCABULARY,
  isPinnedLabel,
} from "../../src/data/content-signals-vocabulary.v0.js";
import {
  CONTENT_SIGNAL_PARSE_LIMITS,
  readContentSignals,
} from "../../src/parsers/content-signals.js";
import type { ContentSignalReading } from "../../src/parsers/content-signals.js";
import { parseRobots } from "../../src/parsers/robots.js";
import type { RobotsExtensionRecord } from "../../src/parsers/robots.js";

/**
 * The pure half of the Content Signals work: no harness, no transport, no
 * engine.
 *
 * `docs/TEST_STRATEGY.md` section 3 puts parser units below the contract tier.
 * Everything here is a property of a record list, and asserting it through a
 * scan would only add ways for the assertion to be satisfied by something
 * other than the reading.
 */

const encoder = new TextEncoder();

function record(value: string, line = 4): RobotsExtensionRecord {
  return { line, field: "content-signal", value };
}

function read(...values: readonly string[]): ContentSignalReading {
  return readContentSignals(
    values.map((value, index) => record(value, index + 4)),
  );
}

describe("the pinned vocabulary", () => {
  it("is exactly Table 1's three labels, in the draft's section order", () => {
    // ADR-0009 section 1: no grammar is invented for this rule, and the token
    // set is closed by the source. A fourth entry here is this project
    // publishing its own vocabulary as a pinned one.
    expect(CONTENT_SIGNALS_VOCABULARY).toEqual([
      { label: "search", definedIn: "3.1", labelledIn: "Table 1 in section 4" },
      {
        label: "ai-input",
        definedIn: "3.2",
        labelledIn: "Table 1 in section 4",
      },
      {
        label: "ai-train",
        definedIn: "3.3",
        labelledIn: "Table 1 in section 4",
      },
    ]);
  });

  it("records the draft as expired, with the expiry read from the source", () => {
    // ADR-0009 section 7 makes "expired" part of every citation of this draft
    // rather than a footnote, and section 3 made confirming the date a release
    // blocker for the rule.
    expect(CONTENT_SIGNALS_DRAFT_EXPIRED).toBe(true);
    expect(CONTENT_SIGNALS_DRAFT_EXPIRY).toBe("2026-04-04");
    expect(CONTENT_SIGNALS_DRAFT).toBe("draft-romm-aipref-contentsignals-00");
    expect(CONTENT_SIGNALS_SOURCE_ID).toBe("content-signals-draft-00");
  });

  it("recognizes the three labels and nothing else", () => {
    expect(["search", "ai-input", "ai-train"].every(isPinnedLabel)).toBe(true);
    // The tokens the fixtures use for the unknown case, and the values the
    // community examples use, which are not labels at all.
    expect(
      ["ai-summarise", "ai-index", "yes", "no", "ai_train", ""].some(
        isPinnedLabel,
      ),
    ).toBe(false);
  });

  it("exposes no allowed value set to be checked against", () => {
    // ADR-0009 section 5's concrete forbidden thing. The vocabulary module is
    // three labels and their citations; an `allowedValues`-shaped field
    // appearing on an entry is the change this test exists to fail.
    for (const entry of CONTENT_SIGNALS_VOCABULARY) {
      expect(Object.keys(entry).sort()).toEqual([
        "definedIn",
        "label",
        "labelledIn",
      ]);
    }
  });
});

describe("a declaration is read for which tokens it declares", () => {
  it("reads the complete base declaration of sig-001", () => {
    const reading = read("search=yes, ai-input=yes, ai-train=no");

    expect(reading).toEqual({
      refusedBy: null,
      present: true,
      recognized: ["search", "ai-input", "ai-train"],
      unrecognized: [],
      conflicting: [],
    });
  });

  it("reads a partial declaration as sig-002's one token", () => {
    const reading = read("search=yes");

    expect(reading.present).toBe(true);
    expect(reading.recognized).toEqual(["search"]);
    expect(reading.unrecognized).toEqual([]);
  });

  it("reports sig-004's repeated token with differing values as ambiguous", () => {
    const reading = read("search=yes, ai-train=yes, ai-train=no");

    expect(reading.conflicting).toEqual(["ai-train"]);
    // The conflict does not remove the token from the declaration: no pinned
    // source defines conflict resolution, so neither value wins and both
    // labels are still declared.
    expect(reading.recognized).toEqual(["search", "ai-train"]);
    expect(reading.unrecognized).toEqual([]);
  });

  it("reports sig-005's unknown token beside the known one", () => {
    const reading = read("search=yes, ai-summarise=yes");

    expect(reading.recognized).toEqual(["search"]);
    expect(reading.unrecognized).toEqual(["ai-summarise"]);
    expect(reading.conflicting).toEqual([]);
  });

  it("reports sig-003's only-unknown tokens with nothing recognized", () => {
    const reading = read("ai-summarise=yes, ai-index=no");

    expect(reading.present).toBe(true);
    expect(reading.recognized).toEqual([]);
    expect(reading.unrecognized).toEqual(["ai-summarise", "ai-index"]);
  });

  it("is absent when sig-006 serves no Content-Signal record", () => {
    const reading = readContentSignals([
      { line: 3, field: "sitemap", value: "http://127.0.0.1:8787/sitemap.xml" },
      { line: 9, field: "crawl-delay", value: "10" },
    ]);

    expect(reading).toEqual({
      refusedBy: null,
      present: false,
      recognized: [],
      unrecognized: [],
      conflicting: [],
    });
  });

  it("orders recognized labels by Table 1 and not by the document", () => {
    // The recognized array is a projection of a fixed three-member
    // vocabulary, so a target cannot steer its order.
    expect(read("ai-train=no, search=yes").recognized).toEqual([
      "search",
      "ai-train",
    ]);
  });

  it("reads records across the whole document, not one group", () => {
    // The draft defines no placement rule and the fixture base writes the
    // record above the first `User-agent` line so that no group owns it.
    // Attributing a record to a group would be the invented placement rule
    // ADR-0009 forbids, and would make sig-004's conflict invisible.
    const reading = read("ai-train=yes", "ai-train=no");

    expect(reading.conflicting).toEqual(["ai-train"]);
  });
});

describe("no verdict about a value", () => {
  it("returns no values at all", () => {
    // ADR-0009 section 5, structurally: a caller cannot report a verdict about
    // a value it was never handed.
    expect(Object.keys(read("search=yes")).sort()).toEqual([
      "conflicting",
      "present",
      "recognized",
      "refusedBy",
      "unrecognized",
    ]);
  });

  it.each(["yes", "no", "maybe", "", "ai-train", "42, 43"])(
    "reads search=%s identically",
    (value) => {
      const reading = read(`search=${value}`);

      expect(reading.recognized).toEqual(["search"]);
      expect(reading.conflicting).toEqual([]);
    },
  );

  it("declares the token even with no value at all", () => {
    // A bare token is a declaration of that token. There is no
    // well-formedness condition for it to fail.
    expect(read("search").recognized).toEqual(["search"]);
  });

  it("treats the same value written twice as no conflict", () => {
    expect(read("ai-train=no, ai-train=no").conflicting).toEqual([]);
  });

  it("reports a case difference in a value as ambiguity", () => {
    // Nothing pins what a value means, so this cannot know that `NO` and `no`
    // are one declaration. Reporting the unresolved state is what the conflict
    // assertion is for, and it is a warning either way, never a failure.
    expect(read("ai-train=no, ai-train=NO").conflicting).toEqual(["ai-train"]);
  });
});

describe("leniency, which RFC 9309 section 2.2.4 permits", () => {
  it("matches a label case-insensitively", () => {
    // Leniency can only move a token from unrecognized to recognized, which is
    // the direction that avoids inventing a warning.
    expect(read("Search=Yes, AI-Train=No").recognized).toEqual([
      "search",
      "ai-train",
    ]);
  });

  it("ignores whitespace around a token and its value", () => {
    expect(read("  search  =  yes  ,\tai-input=yes").recognized).toEqual([
      "search",
      "ai-input",
    ]);
  });

  it("skips an empty item rather than complaining about it", () => {
    const reading = read("search=yes,,  , ai-train=no,");

    expect(reading.recognized).toEqual(["search", "ai-train"]);
    expect(reading.unrecognized).toEqual([]);
  });

  it("keeps a value that contains its own separator", () => {
    // The first `=` splits the item, so this declares one token whose value
    // happens to contain another. It is still not a verdict about the value.
    const reading = read("search=a=b");

    expect(reading.recognized).toEqual(["search"]);
    expect(reading.unrecognized).toEqual([]);
  });

  it("counts a repeated distinct token once", () => {
    expect(read("ai-x=1, ai-x=1, ai-x=1").unrecognized).toEqual(["ai-x"]);
  });
});

describe("the field name", () => {
  it("reads Content-Signal out of a real robots.txt, comment stripped", () => {
    const parsed = parseRobots(
      encoder.encode(
        [
          "# base",
          "Sitemap: http://127.0.0.1:8787/sitemap.xml",
          "Content-Signal: search=yes, ai-train=no  # preference, not consent",
          "",
          "User-agent: *",
          "Allow: /",
        ].join("\n"),
      ),
    );

    expect(readContentSignals(parsed.extensions).recognized).toEqual([
      "search",
      "ai-train",
    ]);
  });

  it("does not read another extension record as a declaration", () => {
    const parsed = parseRobots(
      encoder.encode(
        ["Content-Signals: search=yes", "Crawl-delay: 10"].join("\n"),
      ),
    );

    // `Content-Signals` is not the field the examples use, and guessing at a
    // second spelling would be inventing a syntax. It is simply another
    // section 2.2.4 other record.
    expect(readContentSignals(parsed.extensions).present).toBe(false);
  });
});

describe("bounded input", () => {
  it("refuses more records than the bound rather than reading some", () => {
    const records = Array.from(
      { length: CONTENT_SIGNAL_PARSE_LIMITS.maxRecords + 1 },
      () => record("search=yes"),
    );

    expect(readContentSignals(records)).toEqual({
      refusedBy: "records",
      present: false,
      recognized: [],
      unrecognized: [],
      conflicting: [],
    });
  });

  it("refuses more declarations than the bound", () => {
    const items = Array.from(
      { length: CONTENT_SIGNAL_PARSE_LIMITS.maxDeclarations + 1 },
      (_unused, index) => `ai-x${String(index)}=1`,
    ).join(",");

    expect(readContentSignals([record(items)]).refusedBy).toBe("declarations");
  });

  it("reads a declaration exactly at each bound", () => {
    // The negative control for the two above: without it, "refused" is equally
    // consistent with a bound that is off by one in the other direction.
    const atRecordBound = Array.from(
      { length: CONTENT_SIGNAL_PARSE_LIMITS.maxRecords },
      () => record("search=yes"),
    );
    const atItemBound = Array.from(
      { length: CONTENT_SIGNAL_PARSE_LIMITS.maxDeclarations },
      () => "search=yes",
    ).join(",");

    expect(readContentSignals(atRecordBound).recognized).toEqual(["search"]);
    expect(readContentSignals([record(atItemBound)]).refusedBy).toBeNull();
  });

  it("takes a lowered bound from the caller", () => {
    expect(
      readContentSignals([record("search=yes"), record("ai-train=no")], {
        maxRecords: 1,
      }).refusedBy,
    ).toBe("records");
  });
});
