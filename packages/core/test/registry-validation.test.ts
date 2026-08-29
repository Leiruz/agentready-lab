import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { validateAgainstSchema } from "../src/schema/json-schema.js";
import { canonicalizeJson } from "../src/schema/canonical-json.js";
import { sha256HexOfUtf8 } from "../src/schema/sha256.js";
import type {
  RegistryIssue,
  RegistryValidationResult,
} from "../../../scripts/lib/validate-registry.js";
import { validateRegistry } from "../../../scripts/lib/validate-registry.js";

// This is the merge-blocking half of `specs/README.md` "Validation". The other
// half is `pnpm specs:validate`, which runs the same pure function over the
// same files. Neither is a copy of the other: the script has the filesystem
// and the exit code, the test has the mutations.

function readSpec(name: string): string {
  return readFileSync(
    new URL(`../../../specs/${name}`, import.meta.url),
    "utf8",
  );
}

const SNAPSHOT = readSpec("checks.v0.yaml");
const SNAPSHOT_SCHEMA = readSpec("rule.schema.json");
const LEDGER = readSpec("sources.v0.yaml");
const LEDGER_SCHEMA = readSpec("sources.schema.json");
const RULESET = readSpec("ruleset.standard.v0.yaml");
const RULESET_SCHEMA = readSpec("ruleset.schema.json");
const REMEDIATION = readSpec("remediation.v0.yaml");
const REMEDIATION_SCHEMA = readSpec("remediation.schema.json");
const TEMPLATES = readSpec("templates.v0.yaml");
const TEMPLATES_SCHEMA = readSpec("templates.schema.json");

const SNAPSHOT_CANONICAL = readSpec("checks.v0.canonical.json");
const SNAPSHOT_DIGEST = readSpec("checks.v0.digest.txt");
const RULESET_CANONICAL = readSpec("ruleset.standard.v0.canonical.json");
const RULESET_DIGEST = readSpec("ruleset.standard.v0.digest.txt");

// ---------------------------------------------------------------------------
// Network sentinel
//
// docs/TEST_STRATEGY.md section 2.4: unit tests run "with global network APIs
// replaced by a throwing sentinel". The validator must never dereference a
// source URL, and this is what makes that a test result rather than a claim.
//
// It is armed here, in the file that needs it, rather than in a `setupFiles`
// entry, because `vitest.config.ts` is owned elsewhere in this change. A
// repository-wide sentinel is the better long-term home for it.
// ---------------------------------------------------------------------------

const NETWORK_GLOBALS = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "navigator",
] as const;

const originals = new Map<string, unknown>();

beforeAll(() => {
  for (const name of NETWORK_GLOBALS) {
    if (!(name in globalThis)) continue;
    originals.set(name, Reflect.get(globalThis, name));
    Reflect.set(globalThis, name, () => {
      throw new Error(
        `network sentinel: ${name} was called by an offline test`,
      );
    });
  }
});

afterAll(() => {
  for (const [name, value] of originals) Reflect.set(globalThis, name, value);
});

describe("the network sentinel itself", () => {
  it("is armed, so the offline assertions below mean something", () => {
    expect(originals.has("fetch")).toBe(true);
    expect(() => globalThis.fetch("https://example.invalid/")).toThrow(
      /network sentinel/,
    );
  });
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** One of the five files, replaced; the others as committed. */
interface Override {
  readonly snapshotYaml?: string;
  readonly ledgerYaml?: string;
  readonly rulesetYaml?: string;
  readonly remediationYaml?: string;
  readonly templatesYaml?: string;
}

async function run(override: Override = {}): Promise<RegistryValidationResult> {
  return validateRegistry({
    snapshotYaml: override.snapshotYaml ?? SNAPSHOT,
    snapshotSchemaJson: SNAPSHOT_SCHEMA,
    ledgerYaml: override.ledgerYaml ?? LEDGER,
    ledgerSchemaJson: LEDGER_SCHEMA,
    rulesetYaml: override.rulesetYaml ?? RULESET,
    rulesetSchemaJson: RULESET_SCHEMA,
    remediationYaml: override.remediationYaml ?? REMEDIATION,
    remediationSchemaJson: REMEDIATION_SCHEMA,
    templatesYaml: override.templatesYaml ?? TEMPLATES,
    templatesSchemaJson: TEMPLATES_SCHEMA,
    committed: null,
  });
}

async function validate(
  override: Override = {},
): Promise<readonly RegistryIssue[]> {
  return (await run(override)).issues;
}

const codesOf = (issues: readonly RegistryIssue[]): readonly string[] =>
  issues.map((issue) => issue.code);

// ---------------------------------------------------------------------------
// The three authorities as committed
// ---------------------------------------------------------------------------

describe("specs/ as committed", () => {
  it("has no validation issues at all", async () => {
    const result = await validateRegistry({
      snapshotYaml: SNAPSHOT,
      snapshotSchemaJson: SNAPSHOT_SCHEMA,
      ledgerYaml: LEDGER,
      ledgerSchemaJson: LEDGER_SCHEMA,
      rulesetYaml: RULESET,
      rulesetSchemaJson: RULESET_SCHEMA,
      remediationYaml: REMEDIATION,
      remediationSchemaJson: REMEDIATION_SCHEMA,
      templatesYaml: TEMPLATES,
      templatesSchemaJson: TEMPLATES_SCHEMA,
      committed: {
        snapshot: {
          canonicalJson: SNAPSHOT_CANONICAL,
          digest: SNAPSHOT_DIGEST,
        },
        ruleset: { canonicalJson: RULESET_CANONICAL, digest: RULESET_DIGEST },
      },
    });
    expect(result.issues).toStrictEqual([]);
  });

  it("keeps both committed canonical JSON files and digests current", async () => {
    const result = await run();
    expect(result.artifacts).not.toBeNull();
    expect(result.artifacts?.snapshot.canonicalJson).toBe(SNAPSHOT_CANONICAL);
    expect(result.artifacts?.snapshot.digest).toBe(SNAPSHOT_DIGEST.trim());
    expect(result.artifacts?.ruleset.canonicalJson).toBe(RULESET_CANONICAL);
    expect(result.artifacts?.ruleset.digest).toBe(RULESET_DIGEST.trim());
  });

  it("produces digests that are SHA-256 over the canonical bytes", async () => {
    expect(SNAPSHOT_DIGEST.trim()).toBe(
      `sha256:${await sha256HexOfUtf8(SNAPSHOT_CANONICAL)}`,
    );
    expect(RULESET_DIGEST.trim()).toBe(
      `sha256:${await sha256HexOfUtf8(RULESET_CANONICAL)}`,
    );
  });

  it("seals the snapshot on its own identity, not on a ruleset it no longer carries", () => {
    const record: unknown = JSON.parse(SNAPSHOT_CANONICAL);
    // ADR-0008 section 2 migrated `ruleset_id` and `ruleset_version` out of
    // this file, so the snapshot's identity is now its capture date.
    expect(Object.keys(record as object)).toStrictEqual([
      "captured_at",
      "checks",
    ]);
    const projection = record as { checks: Record<string, unknown>[] };
    expect(projection.checks).toHaveLength(22);
    for (const check of projection.checks) {
      expect(Object.keys(check)).toStrictEqual([
        "applicability",
        "profiles",
        "rule_id",
        "rule_version",
        "runtime",
        "source_refs",
        "spec",
      ]);
    }
    // The prose fields must be absent, or a typo fix invalidates every pinned
    // report. This asserts their absence as text, so a nested `title` would
    // fail too.
    for (const excluded of [
      '"title"',
      '"notes"',
      '"caveats"',
      '"verified_at"',
      '"deltas"',
      '"compat"',
      '"sources"',
      '"registry_version"',
    ]) {
      expect(SNAPSHOT_CANONICAL).not.toContain(excluded);
    }
  });

  it("covers only the ruleset's verdict-bearing projection", () => {
    const record: unknown = JSON.parse(RULESET_CANONICAL);
    expect(Object.keys(record as object)).toStrictEqual([
      "rules",
      "ruleset_id",
      "ruleset_version",
      "source_ledger_version",
    ]);
    const projection = record as { rules: Record<string, unknown>[] };
    expect(projection.rules).toHaveLength(22);
    for (const rule of projection.rules) {
      expect(Object.keys(rule)).toStrictEqual([
        "applicability",
        "compat_assertions",
        "implementation_status",
        "profiles",
        "retired_requirements",
        "rule_id",
        "rule_version",
        "runtime",
        "source_refs",
        "spec",
      ]);
    }
    for (const excluded of ['"title"', '"maturity"', '"deltas"', '"interop"']) {
      expect(RULESET_CANONICAL).not.toContain(excluded);
    }
  });

  it("is itself canonical JSON, so re-canonicalizing is a no-op", () => {
    expect(canonicalizeJson(JSON.parse(SNAPSHOT_CANONICAL))).toBe(
      SNAPSHOT_CANONICAL,
    );
    expect(canonicalizeJson(JSON.parse(RULESET_CANONICAL))).toBe(
      RULESET_CANONICAL,
    );
  });
});

// ---------------------------------------------------------------------------
// The case ADR-0008's first revision rejected
// ---------------------------------------------------------------------------

describe("the M1 data ADR-0008 section 5 requires to be accepted", () => {
  it("accepts snapshot 0.1.0 beside ruleset 0.2.0 and prints the difference", async () => {
    // The removed equality invariant. `specs/checks.v0.yaml` records `0.1.0`
    // for both bumped rules, the file is frozen, and the ruleset creates them
    // at `0.2.0`.
    expect(SNAPSHOT).toContain('rule_id: "web.policy.ai-crawler"');
    expect(RULESET).toContain('rule_id: "web.policy.ai-crawler"');

    const result = await run();
    expect(result.issues).toStrictEqual([]);

    const deltas = result.notes.filter(
      (note) => note.code === "rule-version-delta",
    );
    expect(deltas).toHaveLength(2);
    for (const delta of deltas) {
      expect(delta.message).toContain("ruleset 0.2.0, snapshot 0.1.0");
    }
  });

  it("treats content-signals.syntax as retired rather than declared or dropped", async () => {
    expect(SNAPSHOT).toContain('id: "content-signals.syntax"');
    expect(RULESET).toContain('- id: "content-signals.syntax"\n        adr:');
    // Declared nowhere in the ruleset's requirements.
    expect(RULESET).not.toContain('        - id: "content-signals.syntax"');

    const result = await run();
    expect(codesOf(result.issues)).not.toContain("dropped-requirement");
    expect(
      result.notes.filter((note) => note.code === "requirement-retired"),
    ).toHaveLength(1);
  });

  it("lists exactly the three additions the decisions specify", async () => {
    const added = (await run()).notes
      .filter((note) => note.code === "requirement-added")
      .map((note) => note.message);
    expect(added).toHaveLength(3);
    expect(added.join("\n")).toContain('"ai-rules.effective-access"');
    expect(added.join("\n")).toContain(
      '"content-signals.conflicting-declaration"',
    );
    expect(added.join("\n")).toContain(
      '"content-signals.unrecognized-vocabulary"',
    );
  });
});

// ---------------------------------------------------------------------------
// Two artifacts, two clocks
//
// ADR-0008 section 1 versions the ledger independently "because a source's
// verification date changes for reasons that have nothing to do with" the
// snapshot. Bounding every `verified_at` by `snapshot.captured_at`
// contradicted that and made a source verified after the snapshot was
// captured impossible to record at all. Each file now declares its own
// ceiling, and neither is a wall clock.
// ---------------------------------------------------------------------------

describe("the ledger's own date axis", () => {
  it("records sources verified after the snapshot was captured", async () => {
    expect(SNAPSHOT).toContain('captured_at: "2026-08-28"');
    expect(LEDGER).toContain('ledger_date: "2026-08-29"');
    // Not hypothetical: the vendor crawler-token sources were verified the day
    // after the snapshot was captured, so the snapshot-bounded ceiling
    // rejected the committed ledger.
    expect(LEDGER).toContain('verified_at: "2026-08-29"');
    expect(await validate()).toStrictEqual([]);
  });

  it("treats ledger_date as an inclusive ceiling", async () => {
    const onTheDay = LEDGER.replace(
      'verified_at: "2026-08-28"',
      'verified_at: "2026-08-29"',
    );
    expect(onTheDay).not.toBe(LEDGER);
    expect(codesOf(await validate({ ledgerYaml: onTheDay }))).not.toContain(
      "future-date",
    );
  });

  it("does not bound a ledger date by the snapshot's capture date", async () => {
    // The snapshot's own date moves back a week and no ledger entry is
    // affected, which is the whole of the fix.
    expect(LEDGER).toContain('verified_at: "2026-08-28"');
    const earlier = SNAPSHOT.replace(
      'captured_at: "2026-08-28"',
      'captured_at: "2026-08-21"',
    );
    expect(earlier).not.toBe(SNAPSHOT);
    expect(codesOf(await validate({ snapshotYaml: earlier }))).not.toContain(
      "future-date",
    );
  });

  it("names the ledger date, not the snapshot date, when it rejects one", async () => {
    const late = LEDGER.replace(
      'verified_at: "2026-08-28"',
      'verified_at: "2026-08-30"',
    );
    const issue = (await validate({ ledgerYaml: late })).find(
      (candidate) => candidate.code === "future-date",
    );
    expect(issue?.message).toContain("ledger date 2026-08-29");
    expect(issue?.location).toContain("specs/sources.v0.yaml");
  });

  it("reports a lowered ceiling on ledger_date itself, not only on the entries", async () => {
    // Both ends of the same inconsistency. The per-entry `future-date` issues
    // say every later source is wrong; the `ledger_date` issue says the one
    // field a maintainer actually needs to look at is wrong.
    const lowered = LEDGER.replace(
      'ledger_date: "2026-08-29"',
      'ledger_date: "2026-08-01"',
    );
    const issue = (await validate({ ledgerYaml: lowered })).find(
      (candidate) => candidate.code === "ledger-date-before-verification",
    );
    expect(issue?.location).toBe("specs/sources.v0.yaml#/ledger_date");
    expect(issue?.message).toContain("2026-08-29");
  });
});

// ---------------------------------------------------------------------------
// What Draft 2020-12 `format` actually does here
// ---------------------------------------------------------------------------

describe("format keyword behaviour", () => {
  // Under Draft 2020-12, `format` is an annotation and asserts nothing unless
  // the format-assertion vocabulary is declared. `sources.schema.json` does not
  // declare it. Whether a validator asserts anyway is therefore a property of
  // the dependency, not of the contract, and this suite records which it is
  // rather than assuming.
  const brokenDate = LEDGER.replace(
    'verified_at: "2026-08-28"',
    'verified_at: "yesterday"',
  );

  it("is a property of the library, not of the schema", async () => {
    const { parse } = await import("yaml");
    const data: unknown = parse(brokenDate);
    const violations = validateAgainstSchema(data, JSON.parse(LEDGER_SCHEMA));
    const formatViolations = violations.filter(
      (violation) => violation.keyword === "format",
    );

    // Observed with @cfworker/json-schema 4.1.1: it asserts every `format` in
    // its own table, unconditionally, so this one IS caught by the schema
    // step. That is more than Draft 2020-12 promises, it is not portable to a
    // validator that follows the draft, and it still does not catch a real
    // date in the future or an http: URI. The explicit checks below are what
    // this project relies on.
    expect(formatViolations.length).toBeGreaterThan(0);
    expect(formatViolations[0]?.instanceLocation).toContain("verified_at");
  });

  it("does not assert what no format can express, so the explicit checks do", async () => {
    // A `format: date` value that is a real, well-formed date in the future,
    // and a `format: uri` value that parses but is plaintext HTTP. Both are
    // schema-clean under any conforming validator.
    const future = LEDGER.replace(
      'verified_at: "2026-08-28"',
      'verified_at: "2099-01-01"',
    );
    const insecure = LEDGER.replace(
      'url: "https://www.rfc-editor.org/rfc/rfc9309"',
      'url: "http://www.rfc-editor.org/rfc/rfc9309"',
    );

    for (const mutated of [future, insecure]) {
      const { parse } = await import("yaml");
      const violations = validateAgainstSchema(
        parse(mutated) as unknown,
        JSON.parse(LEDGER_SCHEMA),
      );
      expect(violations).toStrictEqual([]);
    }

    expect(codesOf(await validate({ ledgerYaml: future }))).toContain(
      "future-date",
    );
    expect(codesOf(await validate({ ledgerYaml: insecure }))).toContain(
      "insecure-url",
    );
  });
});

// ---------------------------------------------------------------------------
// Mutations
//
// A validator that passes on good input proves nothing. Each case below is a
// defect the data could plausibly acquire in review, applied to a copy of the
// committed text of exactly one of the three files.
// ---------------------------------------------------------------------------

/** Appends a syntactically complete 23rd check by copying the first one. */
function withTwentyThirdCheck(yaml: string): string {
  const start = yaml.indexOf("  - ordinal: 1\n");
  const end = yaml.indexOf("  - ordinal: 2\n");
  const block = yaml
    .slice(start, end)
    .replace("- ordinal: 1", "- ordinal: 23")
    .replace('id: "robotsTxt"', 'id: "robotsTxtExtra"')
    .replace(
      'rule_id: "web.discovery.robots"',
      'rule_id: "web.discovery.robots-extra"',
    )
    .replaceAll('id: "robots.', 'id: "robots-extra.');
  return `${yaml.trimEnd()}\n\n${block}`;
}

type Which = "snapshotYaml" | "ledgerYaml" | "rulesetYaml";

const MUTATIONS: readonly {
  readonly name: string;
  readonly file: Which;
  readonly code: string;
  readonly mutate: (yaml: string) => string;
}[] = [
  {
    name: "a duplicate YAML key",
    file: "snapshotYaml",
    code: "yaml-parse-error",
    mutate: (yaml) =>
      yaml.replace(
        'schema_version: "0"\n',
        'schema_version: "0"\nschema_version: "0"\n',
      ),
  },
  {
    name: "a duplicate rule_id in the snapshot",
    file: "snapshotYaml",
    code: "duplicate-rule-id",
    mutate: (yaml) =>
      yaml.replace(
        'rule_id: "web.discovery.sitemap"',
        'rule_id: "web.discovery.robots"',
      ),
  },
  {
    name: "a duplicate rule_id in the ruleset",
    file: "rulesetYaml",
    code: "duplicate-rule-id",
    mutate: (yaml) =>
      yaml.replace(
        'rule_id: "web.discovery.sitemap"',
        'rule_id: "web.discovery.robots"',
      ),
  },
  {
    name: "a duplicate compatibility check id",
    file: "snapshotYaml",
    code: "duplicate-check-id",
    mutate: (yaml) => yaml.replace('id: "sitemap"', 'id: "robotsTxt"'),
  },
  {
    name: "a non-contiguous ordinal",
    file: "snapshotYaml",
    code: "ordinal-not-contiguous",
    mutate: (yaml) => yaml.replace("- ordinal: 22", "- ordinal: 23"),
  },
  {
    name: "an out-of-order ordinal",
    file: "snapshotYaml",
    code: "ordinal-not-ascending",
    mutate: (yaml) =>
      yaml
        .replace("- ordinal: 1\n", "- ordinal: 2\n")
        .replace(
          '- ordinal: 2\n    id: "sitemap"',
          '- ordinal: 1\n    id: "sitemap"',
        ),
  },
  {
    name: "a snapshot source_refs entry that resolves to nothing",
    file: "snapshotYaml",
    code: "unresolved-source-ref",
    mutate: (yaml) =>
      yaml.replace(
        'source_refs: ["isit-2026-08-28", "rfc9309"]',
        'source_refs: ["isit-2026-08-28", "rfc9999"]',
      ),
  },
  {
    // ADR-0008: "a source identifier used anywhere that the ledger does not
    // declare". `robotsTxt` is a snapshot identifier, not a ledger source, and
    // citing one where the other belongs is the realistic confusion.
    name: "a ruleset assertion citing a snapshot identifier instead of a ledger source",
    file: "rulesetYaml",
    code: "unresolved-source-ref",
    mutate: (yaml) =>
      yaml.replace(
        '- source: "content-signals-draft-00"',
        '- source: "robotsTxt"',
      ),
  },
  {
    name: "a source no check and no rule references",
    file: "ledgerYaml",
    code: "orphan-source",
    // The ledger is the only file mutated, so the citation has to be broken
    // from this side: renaming the id leaves the original referenced by both
    // other files and the new one referenced by neither.
    mutate: (yaml) =>
      yaml.replace('- id: "sitemaps-protocol"', '- id: "sitemaps-protocol-v2"'),
  },
  {
    name: "a verified_at of yesterday",
    file: "ledgerYaml",
    code: "malformed-date",
    mutate: (yaml) =>
      yaml.replace('verified_at: "2026-08-28"', 'verified_at: "yesterday"'),
  },
  {
    name: "a verified_at that is not a real calendar date",
    file: "ledgerYaml",
    code: "impossible-date",
    mutate: (yaml) =>
      yaml.replace('verified_at: "2026-08-28"', 'verified_at: "2026-02-30"'),
  },
  {
    // The ledger's ceiling is `ledger_date`, not `snapshot.captured_at`
    // (ADR-0008 section 1). 2026-08-30 is one day past the declared ledger
    // date; 2026-08-29 is the ledger date itself and is accepted, which the
    // "two clocks" suite below asserts.
    name: "a verified_at after the ledger date",
    file: "ledgerYaml",
    code: "future-date",
    mutate: (yaml) =>
      yaml.replace('verified_at: "2026-08-28"', 'verified_at: "2026-08-30"'),
  },
  {
    name: "a ledger_date earlier than the newest verified_at",
    file: "ledgerYaml",
    code: "ledger-date-before-verification",
    mutate: (yaml) =>
      yaml.replace('ledger_date: "2026-08-29"', 'ledger_date: "2026-08-01"'),
  },
  {
    name: "a ledger_date that is not a real calendar date",
    file: "ledgerYaml",
    code: "impossible-date",
    mutate: (yaml) =>
      yaml.replace('ledger_date: "2026-08-29"', 'ledger_date: "2026-02-30"'),
  },
  {
    name: "a snapshot captured_at that is not a real calendar date",
    file: "snapshotYaml",
    code: "impossible-date",
    mutate: (yaml) =>
      yaml.replace('captured_at: "2026-08-28"', 'captured_at: "2026-02-30"'),
  },
  {
    name: "an http:// source URL",
    file: "ledgerYaml",
    code: "insecure-url",
    mutate: (yaml) =>
      yaml.replace(
        'url: "https://www.rfc-editor.org/rfc/rfc9309"',
        'url: "http://www.rfc-editor.org/rfc/rfc9309"',
      ),
  },
  {
    name: "a 23rd check",
    file: "snapshotYaml",
    code: "unexpected-check-count",
    mutate: withTwentyThirdCheck,
  },
  {
    name: "an assertion id reused by another rule in the snapshot",
    file: "snapshotYaml",
    code: "duplicate-requirement-id",
    mutate: (yaml) =>
      yaml.replace('id: "sitemap.xml"', 'id: "robots.location"'),
  },
  {
    name: "an assertion id reused by another rule in the ruleset",
    file: "rulesetYaml",
    code: "duplicate-assertion-id",
    mutate: (yaml) =>
      yaml.replace('- id: "sitemap.xml"', '- id: "robots.location"'),
  },
  {
    name: "a duplicate source id",
    file: "ledgerYaml",
    code: "duplicate-source-id",
    mutate: (yaml) => yaml.replace('- id: "rfc8288"', '- id: "rfc9309"'),
  },

  // --- ADR-0008's new invariants ------------------------------------------

  {
    name: "a retirement with no adr",
    file: "rulesetYaml",
    code: "retirement-without-adr",
    mutate: (yaml) => yaml.replace('        adr: "ADR-0009"\n', ""),
  },
  {
    name: "a retirement with no reason",
    file: "rulesetYaml",
    code: "retirement-without-reason",
    mutate: (yaml) => yaml.replace(/ {8}reason: >-\n(?: {10}.*\n)+/, ""),
  },
  {
    name: "a retirement of something the snapshot never published",
    file: "rulesetYaml",
    code: "retirement-not-published",
    mutate: (yaml) =>
      yaml.replace(
        '      - id: "content-signals.syntax"',
        '      - id: "content-signals.invented"',
      ),
  },
  {
    // The superset check. A snapshot requirement the ruleset neither declares
    // nor retires has been silently dropped, which is the thing ADR-0008
    // section 2 exists to prevent.
    name: "a snapshot assertion missing from the ruleset with no retirement",
    file: "rulesetYaml",
    code: "dropped-requirement",
    mutate: (yaml) =>
      yaml.replace(
        '        - id: "robots.not-authz"',
        '        - id: "robots.not-authz-renamed"',
      ),
  },
  {
    name: "a duplicate parameter name within one assertion",
    file: "rulesetYaml",
    code: "duplicate-parameter-name",
    mutate: (yaml) =>
      yaml.replace(
        '            - name: "recognized-token-count"\n              kind: "count"\n              required: true\n',
        '            - name: "recognized-token-count"\n              kind: "count"\n              required: true\n' +
          '            - name: "recognized-token-count"\n              kind: "token"\n              required: false\n',
      ),
  },
  {
    name: "an excerpt parameter the assertion is not authorized to carry",
    file: "rulesetYaml",
    code: "unauthorized-excerpt",
    mutate: (yaml) =>
      yaml.replace(
        '              kind: "count"',
        '              kind: "excerpt"',
      ),
  },
  {
    name: "an assertion that cites nothing and records no todo",
    file: "rulesetYaml",
    code: "uncited-assertion",
    mutate: (yaml) =>
      yaml.replace(
        '          source_refs: []\n          params: []\n          excerpt_authorized: false\n          todo:\n            - "source_refs unassigned; see the ruleset todo"\n            - "params unassigned; see the ruleset todo"\n',
        "          source_refs: []\n          params: []\n          excerpt_authorized: false\n",
      ),
  },
  {
    name: "a compat pass heuristic on a ruleset rule",
    file: "rulesetYaml",
    code: "forbidden-ruleset-field",
    mutate: (yaml) =>
      yaml.replace(
        '    spec:\n      claim_scope: "normative-conformance"',
        '    compat:\n      pass_heuristic: "invented"\n    spec:\n      claim_scope: "normative-conformance"',
      ),
  },
  {
    name: "a ruleset drawing sources from a ledger version that is not the ledger's",
    file: "rulesetYaml",
    code: "source-ledger-version-mismatch",
    // The version this names must differ from whatever the ledger currently
    // declares, and naming the ledger's own previous value does not: this case
    // silently stopped mutating when ADR-0010 moved both files to 0.4.0. A
    // version no ledger will ever carry cannot go stale that way.
    mutate: (yaml) =>
      yaml.replace(
        /^source_ledger_version: "[0-9.]+"$/m,
        'source_ledger_version: "99.0.0"',
      ),
  },

  // --- ADR-0010's new invariants ------------------------------------------

  {
    // Prohibition 1. `normative` is the only strength that maps a `violated`
    // outcome to `fail`, so no fail may rest on this project's own opinion.
    name: "a normative assertion citing the project-policy source",
    file: "rulesetYaml",
    code: "project-policy-normative-citation",
    mutate: (yaml) =>
      yaml.replace(
        '- id: "links.agent-useful"\n          strength: "advisory"',
        '- id: "links.agent-useful"\n          strength: "normative"',
      ),
  },
  {
    // Prohibition 2. ADR-0002 section 6 copies this list into a finding
    // wholesale, so a mixed list renders as one authority list and the RFC
    // beside the policy reads as endorsement.
    name: "an assertion mixing the project-policy source with an RFC",
    file: "rulesetYaml",
    code: "project-policy-source-mixed",
    mutate: (yaml) =>
      yaml.replace(
        '- source: "agentready-lab-agent-useful-relations"\n              section: "2"\n',
        '- source: "agentready-lab-agent-useful-relations"\n              section: "2"\n            - source: "rfc8288"\n',
      ),
  },
  {
    name: "a deferral that never says what would un-defer it",
    file: "rulesetYaml",
    code: "deferred-marker-incomplete",
    mutate: (yaml) => yaml.replace(/ {12}until: >-\n(?: {14}.*\n)+/, ""),
  },
  {
    name: "a deferred assertion that also cites a source",
    file: "rulesetYaml",
    code: "deferred-assertion-not-inert",
    mutate: (yaml) =>
      yaml.replace(
        "source_refs: []\n          deferred:\n",
        'source_refs:\n            - source: "agent-skills-discovery-v0.2.0"\n          deferred:\n',
      ),
  },
];

describe("mutations of the three authorities", () => {
  it.each(MUTATIONS)(
    "rejects $name with $code",
    async ({ file, code, mutate }) => {
      const original =
        file === "snapshotYaml"
          ? SNAPSHOT
          : file === "ledgerYaml"
            ? LEDGER
            : RULESET;
      const mutated = mutate(original);
      expect(mutated, "the mutation did not change anything").not.toBe(
        original,
      );
      expect(codesOf(await validate({ [file]: mutated }))).toContain(code);
    },
  );

  it("accepts the rule-level inventory that lists the policy beside an RFC", async () => {
    // The deliberate exception ADR-0010 records. `web.discovery.link` lists
    // `rfc8288` and `agentready-lab-agent-useful-relations` in its rule-level
    // `source_refs`, which is an inventory of what the rule rests on and is
    // never what a finding cites. Both prohibitions bind at assertion level
    // only, so the committed file must stay clean: if this ever fails, the
    // check has been written one level too high.
    expect(RULESET).toContain(
      '      - "agentready-lab-agent-useful-relations"',
    );
    expect(codesOf(await validate())).toStrictEqual([]);
  });

  it("changes the ruleset digest when a verdict-bearing field changes", async () => {
    const mutated = RULESET.replace(
      'implementation_status: "planned"',
      'implementation_status: "experimental"',
    );
    const result = await run({ rulesetYaml: mutated });
    expect(result.artifacts?.ruleset.digest).not.toBe(RULESET_DIGEST.trim());
    // And the snapshot's seal is untouched by a ruleset edit, which is the
    // whole reason there are two digests.
    expect(result.artifacts?.snapshot.digest).toBe(SNAPSHOT_DIGEST.trim());
  });

  it("leaves the digest alone when only prose changes", async () => {
    // The whole reason the projections exist. `title` is required by both
    // schemas and appears in reports, but it cannot change a verdict.
    const mutated = RULESET.replace(
      'title: "robots.txt"',
      'title: "robots.txt (corrected)"',
    );
    expect(mutated).not.toBe(RULESET);
    const result = await run({ rulesetYaml: mutated });
    expect(result.issues).toStrictEqual([]);
    expect(result.artifacts?.ruleset.digest).toBe(RULESET_DIGEST.trim());
  });

  it("reports a stale committed artifact for either file", async () => {
    const result = await validateRegistry({
      snapshotYaml: SNAPSHOT,
      snapshotSchemaJson: SNAPSHOT_SCHEMA,
      ledgerYaml: LEDGER,
      ledgerSchemaJson: LEDGER_SCHEMA,
      rulesetYaml: RULESET,
      rulesetSchemaJson: RULESET_SCHEMA,
      remediationYaml: REMEDIATION,
      remediationSchemaJson: REMEDIATION_SCHEMA,
      templatesYaml: TEMPLATES,
      templatesSchemaJson: TEMPLATES_SCHEMA,
      committed: {
        snapshot: {
          canonicalJson: `${SNAPSHOT_CANONICAL} `,
          digest:
            "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        },
        ruleset: {
          canonicalJson: `${RULESET_CANONICAL} `,
          digest:
            "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        },
      },
    });
    expect(codesOf(result.issues)).toStrictEqual([
      "stale-canonical-json",
      "stale-digest",
      "stale-canonical-json",
      "stale-digest",
    ]);
  });
});

describe("hostile and malformed input", () => {
  it("reports every problem in one run rather than stopping at the first", async () => {
    const mutated = SNAPSHOT.replace(
      'rule_id: "web.discovery.sitemap"',
      'rule_id: "web.discovery.robots"',
    ).replace('id: "sitemap.xml"', 'id: "robots.location"');
    const codes = codesOf(await validate({ snapshotYaml: mutated }));
    expect(codes).toContain("duplicate-rule-id");
    expect(codes).toContain("duplicate-requirement-id");
  });

  it("rejects a YAML alias bomb instead of expanding it", async () => {
    const bomb = [
      "a: &a [x, x, x, x, x, x, x, x, x]",
      "b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a]",
      "c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b]",
      "d: [*c, *c, *c, *c, *c, *c, *c, *c, *c]",
      "",
    ].join("\n");
    expect((await validate({ rulesetYaml: bomb })).length).toBeGreaterThan(0);
  });

  it("rejects a file that is not a mapping", async () => {
    expect(
      codesOf(await validate({ ledgerYaml: "- just\n- a\n- list\n" })),
    ).toContain("not-a-mapping");
  });

  it("rejects an unreadable schema without crashing", async () => {
    const result = await validateRegistry({
      snapshotYaml: SNAPSHOT,
      snapshotSchemaJson: "{ not json",
      ledgerYaml: LEDGER,
      ledgerSchemaJson: LEDGER_SCHEMA,
      rulesetYaml: RULESET,
      rulesetSchemaJson: RULESET_SCHEMA,
      remediationYaml: REMEDIATION,
      remediationSchemaJson: REMEDIATION_SCHEMA,
      templatesYaml: TEMPLATES,
      templatesSchemaJson: TEMPLATES_SCHEMA,
      committed: null,
    });
    expect(codesOf(result.issues)).toStrictEqual(["schema-unreadable"]);
  });

  it("reports schema violations and semantic issues together", async () => {
    const codes = codesOf(
      await validate({ snapshotYaml: withTwentyThirdCheck(SNAPSHOT) }),
    );
    expect(codes).toContain("unexpected-check-count");
    expect(codes).toContain("schema-violation");
  });
});

// ---------------------------------------------------------------------------
// Remediation coverage
//
// ADR-0007 section 3 makes the section 24 release criterion "every rule has
// pinned sources and independent remediation text" a failing build rather than
// a checklist line, and `runScan` refuses a scan with `remediation-missing`
// before a socket opens. These mutations are what make that claim testable:
// each one is the specific defect a check exists to catch, written into a copy
// of the committed file.
// ---------------------------------------------------------------------------

/** The whole `entries` element for one finding code. */
function entryFor(code: string): string {
  const start = REMEDIATION.indexOf(`  - finding_code: "${code}"\n`);
  expect(start).toBeGreaterThan(-1);
  const next = REMEDIATION.indexOf("\n  - finding_code:", start + 1);
  const end = next === -1 ? REMEDIATION.length : next + 1;
  return REMEDIATION.slice(start, end);
}

/** A copy of the committed file with one more entry, cloned from `robots.location`. */
function withExtraEntry(
  code: string,
  ruleId: string,
  entryClass = "required-correction",
): string {
  const clone = entryFor("robots.location")
    .replace('finding_code: "robots.location"', `finding_code: "${code}"`)
    .replace('rule_id: "web.discovery.robots"', `rule_id: "${ruleId}"`)
    .replace('class: "required-correction"', `class: "${entryClass}"`);
  return `${REMEDIATION}${clone}`;
}

describe("remediation covers exactly the assertions that can produce a finding", () => {
  it("covers all 27 active cited M1 assertions and nothing else", async () => {
    // Twenty-eight assertions carry citations across the eight M1 rules;
    // ADR-0010 defers the twenty-eighth. The other fourteen rules cite
    // nothing, so no scan can configure them and none is owed text here.
    expect(REMEDIATION.match(/^ {2}- finding_code:/gm)).toHaveLength(27);
    expect(REMEDIATION).not.toContain('finding_code: "skills.archive-safety"');
    expect(await validate()).toStrictEqual([]);
  });

  it("classes every entry by its assertion's strength, never by choice", () => {
    // Fifteen normative assertions, and twelve recommended or advisory ones. A
    // fail can never carry recommended-hardening, and the ruleset declares no
    // compat assertion, so nothing here carries a compatibility-workaround.
    expect(REMEDIATION.match(/class: "required-correction"/g)).toHaveLength(15);
    expect(REMEDIATION.match(/class: "recommended-hardening"/g)).toHaveLength(
      12,
    );
    expect(REMEDIATION).not.toContain('class: "compatibility-workaround"');
  });

  it("rejects a missing entry for an active assertion", async () => {
    const mutated = REMEDIATION.replace(entryFor("markdown.media-type"), "");
    expect(mutated).not.toBe(REMEDIATION);
    const issues = await validate({ remediationYaml: mutated });
    expect(codesOf(issues)).toStrictEqual(["remediation-missing"]);
    expect(issues[0]?.message).toContain('"markdown.media-type"');
  });

  it("rejects an entry for an assertion no rule declares", async () => {
    const issues = await validate({
      remediationYaml: withExtraEntry(
        "robots.invented",
        "web.discovery.robots",
      ),
    });
    expect(codesOf(issues)).toStrictEqual(["remediation-unknown-assertion"]);
    expect(issues[0]?.message).toContain('"robots.invented"');
  });

  it("rejects an entry for the deferred assertion", async () => {
    // ADR-0010 section 4: declared, never evaluated, so it can produce no
    // finding, so remediating it would be advice about a verdict that is
    // unreachable.
    const issues = await validate({
      remediationYaml: withExtraEntry(
        "skills.archive-safety",
        "agent.discovery.skills",
        "recommended-hardening",
      ),
    });
    expect(codesOf(issues)).toStrictEqual([
      "remediation-for-deferred-assertion",
    ]);
    expect(issues[0]?.message).toContain("ADR-0010");
  });

  it("rejects an entry for a retired assertion", async () => {
    // ADR-0009 retired content-signals.syntax and nothing normative replaced
    // it. An entry for it would be remediation for a requirement this project
    // stopped making.
    const issues = await validate({
      remediationYaml: withExtraEntry(
        "content-signals.syntax",
        "web.policy.content-signals",
      ),
    });
    expect(codesOf(issues)).toStrictEqual([
      "remediation-for-retired-assertion",
    ]);
    expect(issues[0]?.message).toContain("ADR-0009");
  });

  it("rejects a class the assertion's strength does not support", async () => {
    // markdown.vary is `recommended`, so a violation derives `warning`.
    // Calling its fix a required correction claims a conformance defect the
    // status itself denies.
    const mutated = REMEDIATION.replace(
      entryFor("markdown.vary"),
      entryFor("markdown.vary").replace(
        'class: "recommended-hardening"',
        'class: "required-correction"',
      ),
    );
    expect(mutated).not.toBe(REMEDIATION);
    const issues = await validate({ remediationYaml: mutated });
    expect(codesOf(issues)).toStrictEqual(["remediation-class-mismatch"]);
    expect(issues[0]?.message).toContain("recommended");
  });

  it("rejects the same mismatch in the other direction", async () => {
    // robots.location is `normative`, so a violation derives `fail`, and a
    // `fail` must never carry recommended-hardening.
    const mutated = REMEDIATION.replace(
      entryFor("robots.location"),
      entryFor("robots.location").replace(
        'class: "required-correction"',
        'class: "recommended-hardening"',
      ),
    );
    expect(mutated).not.toBe(REMEDIATION);
    expect(codesOf(await validate({ remediationYaml: mutated }))).toStrictEqual(
      ["remediation-class-mismatch"],
    );
  });

  it("rejects an entry filed under the wrong rule", async () => {
    const mutated = REMEDIATION.replace(
      entryFor("sitemap.canonical"),
      entryFor("sitemap.canonical").replace(
        'rule_id: "web.discovery.sitemap"',
        'rule_id: "web.discovery.robots"',
      ),
    );
    expect(mutated).not.toBe(REMEDIATION);
    expect(codesOf(await validate({ remediationYaml: mutated }))).toStrictEqual(
      ["remediation-rule-mismatch"],
    );
  });

  it("rejects the same finding code twice", async () => {
    const mutated = `${REMEDIATION}${entryFor("robots.location")}`;
    expect(codesOf(await validate({ remediationYaml: mutated }))).toStrictEqual(
      ["duplicate-finding-code"],
    );
  });

  it("rejects a citation the assertion does not rest on", async () => {
    // ADR-0007 section 4: remediation may not drift away from the requirement
    // it explains. rfc8288 is a real ledger source and robots.location does
    // not rest on it, so this is drift rather than an unresolved identifier.
    const mutated = REMEDIATION.replace(
      entryFor("robots.location"),
      entryFor("robots.location").replace(
        'source_refs: ["rfc9309"]',
        'source_refs: ["rfc9309", "rfc8288"]',
      ),
    );
    expect(mutated).not.toBe(REMEDIATION);
    expect(codesOf(await validate({ remediationYaml: mutated }))).toStrictEqual(
      ["remediation-source-drift"],
    );
  });

  it("rejects a citation the ledger does not declare", async () => {
    const mutated = REMEDIATION.replace(
      entryFor("robots.location"),
      entryFor("robots.location").replace(
        'source_refs: ["rfc9309"]',
        'source_refs: ["rfc-invented"]',
      ),
    );
    expect(mutated).not.toBe(REMEDIATION);
    expect(codesOf(await validate({ remediationYaml: mutated }))).toStrictEqual(
      ["unresolved-source-ref"],
    );
  });

  it("rejects text written against a different ruleset version", async () => {
    const mutated = REMEDIATION.replace(
      'ruleset_version: "0.4.0"',
      'ruleset_version: "0.3.0"',
    );
    expect(mutated).not.toBe(REMEDIATION);
    expect(codesOf(await validate({ remediationYaml: mutated }))).toStrictEqual(
      ["remediation-ruleset-mismatch"],
    );
  });

  it("rejects a duplicate key rather than letting the last one win", async () => {
    const mutated = REMEDIATION.replace(
      '  - finding_code: "robots.syntax"\n',
      '  - finding_code: "robots.syntax"\n    finding_code: "robots.syntax"\n',
    );
    expect(mutated).not.toBe(REMEDIATION);
    expect(codesOf(await validate({ remediationYaml: mutated }))).toStrictEqual(
      ["yaml-parse-error"],
    );
  });

  it("bounds at 240 characters the summary that enters the report", async () => {
    const mutated = REMEDIATION.replace(
      entryFor("robots.location"),
      entryFor("robots.location").replace(
        "    summary: >-\n",
        `    summary: "${"x".repeat(241)}"\n    unused: >-\n`,
      ),
    );
    expect(mutated).not.toBe(REMEDIATION);
    expect(codesOf(await validate({ remediationYaml: mutated }))).toContain(
      "schema-violation",
    );
  });

  it("prints every entry that says its pinned source prescribes no fix", async () => {
    const open = (await run()).notes.filter(
      (note) =>
        note.code === "open-todo" &&
        note.location.startsWith("specs/remediation.v0.yaml"),
    );
    expect(open).toHaveLength(6);
  });
});
