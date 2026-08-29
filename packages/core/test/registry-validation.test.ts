import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { validateAgainstSchema } from "../src/schema/json-schema.js";
import { canonicalizeJson } from "../src/schema/canonical-json.js";
import { sha256HexOfUtf8 } from "../src/schema/sha256.js";
import type { RegistryIssue } from "../../../scripts/lib/validate-registry.js";
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

const REGISTRY = readSpec("checks.v0.yaml");
const SCHEMA = readSpec("rule.schema.json");
const COMMITTED_CANONICAL = readSpec("checks.v0.canonical.json");
const COMMITTED_DIGEST = readSpec("checks.v0.digest.txt");

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
// The registry as committed
// ---------------------------------------------------------------------------

async function validate(
  registryYaml: string,
): Promise<readonly RegistryIssue[]> {
  const result = await validateRegistry({
    registryYaml,
    schemaJson: SCHEMA,
    committed: null,
  });
  return result.issues;
}

const codesOf = (issues: readonly RegistryIssue[]): readonly string[] =>
  issues.map((issue) => issue.code);

describe("specs/checks.v0.yaml as committed", () => {
  it("has no validation issues at all", async () => {
    const result = await validateRegistry({
      registryYaml: REGISTRY,
      schemaJson: SCHEMA,
      committed: {
        canonicalJson: COMMITTED_CANONICAL,
        digest: COMMITTED_DIGEST,
      },
    });
    expect(result.issues).toStrictEqual([]);
  });

  it("keeps the committed canonical JSON and digest current", async () => {
    const result = await validateRegistry({
      registryYaml: REGISTRY,
      schemaJson: SCHEMA,
      committed: null,
    });
    expect(result.artifacts).not.toBeNull();
    expect(result.artifacts?.canonicalJson).toBe(COMMITTED_CANONICAL);
    expect(result.artifacts?.digest).toBe(COMMITTED_DIGEST.trim());
  });

  it("produces a digest that is SHA-256 over the canonical bytes", async () => {
    const hex = await sha256HexOfUtf8(COMMITTED_CANONICAL);
    expect(COMMITTED_DIGEST.trim()).toBe(`sha256:${hex}`);
  });

  it("covers only the verdict-bearing projection", () => {
    const projection = JSON.parse(COMMITTED_CANONICAL) as {
      checks: Record<string, unknown>[];
    };
    const record: unknown = JSON.parse(COMMITTED_CANONICAL);
    expect(Object.keys(record as object)).toStrictEqual([
      "checks",
      "ruleset_id",
      "ruleset_version",
    ]);
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
      expect(COMMITTED_CANONICAL).not.toContain(excluded);
    }
  });

  it("is itself canonical JSON, so re-canonicalizing it is a no-op", () => {
    expect(canonicalizeJson(JSON.parse(COMMITTED_CANONICAL))).toBe(
      COMMITTED_CANONICAL,
    );
  });
});

// ---------------------------------------------------------------------------
// What Draft 2020-12 `format` actually does here
// ---------------------------------------------------------------------------

describe("format keyword behaviour", () => {
  // Under Draft 2020-12, `format` is an annotation and asserts nothing unless
  // the format-assertion vocabulary is declared. `rule.schema.json` does not
  // declare it. Whether a validator asserts anyway is therefore a property of
  // the dependency, not of the contract, and this suite records which it is
  // rather than assuming.
  const brokenDate = REGISTRY.replace(
    'verified_at: "2026-08-28"',
    'verified_at: "yesterday"',
  );

  it("is a property of the library, not of the schema", async () => {
    const { parse } = await import("yaml");
    const data: unknown = parse(brokenDate);
    const violations = validateAgainstSchema(data, JSON.parse(SCHEMA));
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
    const future = REGISTRY.replace(
      'verified_at: "2026-08-28"',
      'verified_at: "2099-01-01"',
    );
    const insecure = REGISTRY.replace(
      'url: "https://www.rfc-editor.org/rfc/rfc9309"',
      'url: "http://www.rfc-editor.org/rfc/rfc9309"',
    );

    for (const mutated of [future, insecure]) {
      const { parse } = await import("yaml");
      const violations = validateAgainstSchema(
        parse(mutated) as unknown,
        JSON.parse(SCHEMA),
      );
      expect(violations).toStrictEqual([]);
    }

    expect(codesOf(await validate(future))).toContain("future-date");
    expect(codesOf(await validate(insecure))).toContain("insecure-url");
  });
});

// ---------------------------------------------------------------------------
// Mutations
//
// A validator that passes on good input proves nothing. Each case below is a
// defect the registry could plausibly acquire in review, applied to a copy of
// the committed text.
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

const MUTATIONS: readonly {
  readonly name: string;
  readonly code: string;
  readonly mutate: (yaml: string) => string;
}[] = [
  {
    name: "a duplicate YAML key",
    code: "yaml-parse-error",
    mutate: (yaml) =>
      yaml.replace(
        'schema_version: "0"\n',
        'schema_version: "0"\nschema_version: "0"\n',
      ),
  },
  {
    name: "a duplicate rule_id",
    code: "duplicate-rule-id",
    mutate: (yaml) =>
      yaml.replace(
        'rule_id: "web.discovery.sitemap"',
        'rule_id: "web.discovery.robots"',
      ),
  },
  {
    name: "a duplicate compatibility check id",
    code: "duplicate-check-id",
    mutate: (yaml) => yaml.replace('id: "sitemap"', 'id: "robotsTxt"'),
  },
  {
    name: "a non-contiguous ordinal",
    code: "ordinal-not-contiguous",
    mutate: (yaml) => yaml.replace("- ordinal: 22", "- ordinal: 23"),
  },
  {
    name: "an out-of-order ordinal",
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
    name: "a source_refs entry that resolves to nothing",
    code: "unresolved-source-ref",
    mutate: (yaml) =>
      yaml.replace(
        'source_refs: ["isit-2026-08-28", "rfc9309"]',
        'source_refs: ["isit-2026-08-28", "rfc9999"]',
      ),
  },
  {
    name: "a source no check references",
    code: "orphan-source",
    mutate: (yaml) =>
      yaml
        .replaceAll('"sitemaps-protocol", ', "")
        .replaceAll(', "sitemaps-protocol"', ""),
  },
  {
    name: "a verified_at of yesterday",
    code: "malformed-date",
    mutate: (yaml) =>
      yaml.replace('verified_at: "2026-08-28"', 'verified_at: "yesterday"'),
  },
  {
    name: "a verified_at that is not a real calendar date",
    code: "impossible-date",
    mutate: (yaml) =>
      yaml.replace('verified_at: "2026-08-28"', 'verified_at: "2026-02-30"'),
  },
  {
    name: "a verified_at after the snapshot date",
    code: "future-date",
    mutate: (yaml) =>
      yaml.replace('verified_at: "2026-08-28"', 'verified_at: "2026-08-29"'),
  },
  {
    name: "an http:// source URL",
    code: "insecure-url",
    mutate: (yaml) =>
      yaml.replace(
        'url: "https://www.rfc-editor.org/rfc/rfc9309"',
        'url: "http://www.rfc-editor.org/rfc/rfc9309"',
      ),
  },
  {
    name: "a 23rd check",
    code: "unexpected-check-count",
    mutate: withTwentyThirdCheck,
  },
  {
    name: "an assertion id reused by another rule",
    code: "duplicate-requirement-id",
    mutate: (yaml) =>
      yaml.replace('id: "sitemap.xml"', 'id: "robots.location"'),
  },
  {
    name: "a duplicate source id",
    code: "duplicate-source-id",
    mutate: (yaml) => yaml.replace('- id: "rfc8288"', '- id: "rfc9309"'),
  },
];

describe("mutations of the registry", () => {
  it.each(MUTATIONS)("rejects $name with $code", async ({ code, mutate }) => {
    const mutated = mutate(REGISTRY);
    expect(mutated, "the mutation did not change anything").not.toBe(REGISTRY);
    expect(codesOf(await validate(mutated))).toContain(code);
  });

  it("changes the digest when a verdict-bearing field changes", async () => {
    const mutated = REGISTRY.replace(
      'rule_version: "0.1.0"',
      'rule_version: "0.2.0"',
    );
    const result = await validateRegistry({
      registryYaml: mutated,
      schemaJson: SCHEMA,
      committed: null,
    });
    expect(result.artifacts?.digest).not.toBe(COMMITTED_DIGEST.trim());
  });

  it("leaves the digest alone when only prose changes", async () => {
    // The whole reason the projection exists. `title` is required by the
    // schema and appears in reports, but it cannot change a verdict.
    const mutated = REGISTRY.replace(
      'title: "robots.txt"',
      'title: "robots.txt (corrected)"',
    );
    expect(mutated).not.toBe(REGISTRY);
    const result = await validateRegistry({
      registryYaml: mutated,
      schemaJson: SCHEMA,
      committed: null,
    });
    expect(result.issues).toStrictEqual([]);
    expect(result.artifacts?.digest).toBe(COMMITTED_DIGEST.trim());
  });

  it("reports a stale committed artifact", async () => {
    const result = await validateRegistry({
      registryYaml: REGISTRY,
      schemaJson: SCHEMA,
      committed: {
        canonicalJson: `${COMMITTED_CANONICAL} `,
        digest:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      },
    });
    expect(codesOf(result.issues)).toStrictEqual([
      "stale-canonical-json",
      "stale-digest",
    ]);
  });
});

describe("hostile and malformed input", () => {
  it("reports every problem in one run rather than stopping at the first", async () => {
    const mutated = REGISTRY.replace(
      'rule_id: "web.discovery.sitemap"',
      'rule_id: "web.discovery.robots"',
    ).replace('id: "sitemap.xml"', 'id: "robots.location"');
    const codes = codesOf(await validate(mutated));
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
    const issues = await validate(bomb);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("rejects a registry that is not a mapping", async () => {
    expect(codesOf(await validate("- just\n- a\n- list\n"))).toContain(
      "not-a-mapping",
    );
  });

  it("rejects an unreadable schema without crashing", async () => {
    const result = await validateRegistry({
      registryYaml: REGISTRY,
      schemaJson: "{ not json",
      committed: null,
    });
    expect(codesOf(result.issues)).toStrictEqual(["schema-unreadable"]);
  });

  it("reports schema violations and semantic issues together", async () => {
    const codes = codesOf(await validate(withTwentyThirdCheck(REGISTRY)));
    expect(codes).toContain("unexpected-check-count");
    expect(codes).toContain("schema-violation");
  });
});
