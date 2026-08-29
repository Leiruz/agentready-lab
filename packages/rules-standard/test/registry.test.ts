import { readFileSync } from "node:fs";

import type { AssertionDeclaration, RuleSource } from "@agentready-lab/core";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import {
  STANDARD_RULESET,
  aiCrawlerRule,
  apiCatalogRule,
  contentSignalsRule,
  linkRule,
  markdownNegotiationRule,
  robotsRule,
  sitemapRule,
  skillsRule,
} from "../src/index.js";

/**
 * The registration guard for the eight M1 rules.
 *
 * Eight rule families are implemented by separate agents, each replacing one
 * file under `src/rules/`. Nothing else in the package changes, which means
 * nothing else in the package would notice a rule that quietly renamed an
 * assertion, dropped one, promoted an advisory requirement to normative, or
 * copied another rule's id. This test re-reads
 * `specs/ruleset.standard.v0.yaml`, `specs/sources.v0.yaml` and
 * `specs/checks.v0.yaml` and compares every projected field, so the specs stay
 * the authority and `src/rules/*.ts` stays a copy of them.
 *
 * It is not a duplicate of `scripts/validate-registry.ts`, which validates the
 * spec files against each other and never loads a rule.
 */

interface SpecSourceRef {
  readonly source: string;
  readonly section?: string;
}

interface SpecParam {
  readonly name: string;
  readonly kind: string;
  readonly required: boolean;
  readonly allowed_values?: readonly string[];
}

interface SpecAssertion {
  readonly id: string;
  readonly strength: string;
  readonly source_refs: readonly SpecSourceRef[];
  readonly params: readonly SpecParam[];
  readonly excerpt_authorized: boolean;
  readonly deferred?: {
    readonly adr: string;
    readonly reason: string;
    readonly until: string;
  };
}

interface SpecRule {
  readonly rule_id: string;
  readonly rule_version: string;
  readonly title: string;
  readonly category: string;
  readonly maturity: string;
  readonly implementation_status: string;
  readonly profiles: readonly string[];
  readonly runtime: readonly string[];
  readonly applicability: { readonly default: string };
  readonly source_refs: readonly string[];
  readonly spec: { readonly requirements: readonly SpecAssertion[] };
}

interface LedgerSource {
  readonly id: string;
  readonly title: string;
  readonly url?: string;
  readonly document?: string;
  readonly kind: string;
  readonly status: string;
  readonly version?: string;
  readonly verified_at: string;
}

function readSpec(name: string): unknown {
  return parseYaml(
    readFileSync(new URL(`../../../specs/${name}`, import.meta.url), "utf8"),
  );
}

const RULESET = readSpec("ruleset.standard.v0.yaml") as {
  readonly ruleset_id: string;
  readonly ruleset_version: string;
  readonly rules: readonly SpecRule[];
};

const LEDGER = readSpec("sources.v0.yaml") as {
  readonly sources: readonly LedgerSource[];
};

const SNAPSHOT = readSpec("checks.v0.yaml") as {
  readonly checks: readonly {
    readonly ordinal: number;
    readonly id: string;
    readonly rule_id: string;
  }[];
};

/**
 * The individually exported rules, so a contract test can import exactly one.
 * The key is the export name and it is not the registry order: the order is
 * asserted below against the snapshot rather than restated here.
 */
const INDIVIDUAL_EXPORTS = {
  robotsRule,
  sitemapRule,
  linkRule,
  markdownNegotiationRule,
  aiCrawlerRule,
  contentSignalsRule,
  skillsRule,
  apiCatalogRule,
};

const M1_RULE_IDS: ReadonlySet<string> = new Set(
  STANDARD_RULESET.map((rule) => rule.metadata.id),
);

/** The eight M1 rule ids in registry-ordinal order (ADR-0005 section 2). */
const ORDINAL_ORDER: readonly string[] = [...SNAPSHOT.checks]
  .filter((check) => M1_RULE_IDS.has(check.rule_id))
  .sort((left, right) => left.ordinal - right.ordinal)
  .map((check) => check.rule_id);

function specRuleFor(ruleId: string): SpecRule {
  const found = RULESET.rules.find((rule) => rule.rule_id === ruleId);
  if (found === undefined) {
    throw new Error(`specs/ruleset.standard.v0.yaml declares no ${ruleId}`);
  }
  return found;
}

function ledgerEntryFor(sourceId: string): LedgerSource {
  const found = LEDGER.sources.find((source) => source.id === sourceId);
  if (found === undefined) {
    throw new Error(`specs/sources.v0.yaml declares no ${sourceId}`);
  }
  return found;
}

function externalIdFor(ruleId: string): string {
  const found = SNAPSHOT.checks.find((check) => check.rule_id === ruleId);
  if (found === undefined) {
    throw new Error(`specs/checks.v0.yaml declares no check for ${ruleId}`);
  }
  return found.id;
}

function expectedSourceRefs(
  refs: readonly SpecSourceRef[],
): AssertionDeclaration["sourceRefs"] {
  return refs.map((ref) =>
    ref.section === undefined
      ? { sourceId: ref.source }
      : { sourceId: ref.source, section: ref.section },
  );
}

function expectedParams(
  params: readonly SpecParam[],
): AssertionDeclaration["params"] {
  return Object.fromEntries(
    params.map((param) => [
      param.name,
      param.allowed_values === undefined
        ? { kind: param.kind, required: param.required }
        : {
            kind: param.kind,
            required: param.required,
            allowedValues: param.allowed_values,
          },
    ]),
  ) as AssertionDeclaration["params"];
}

/**
 * Every M1 requirement lives under the ruleset's `spec:` block, and no rule
 * declares a `compat_assertions` entry: the ruleset's own todo records that no
 * accepted decision names a compat assertion id. So the projected mode is
 * `spec` for every assertion in the set, and `strength` maps straight onto
 * `requirementClass`.
 */
function expectedAssertions(
  requirements: readonly SpecAssertion[],
): readonly AssertionDeclaration[] {
  return requirements.map((requirement) => ({
    id: requirement.id,
    mode: "spec",
    requirementClass: requirement.strength,
    sourceRefs: expectedSourceRefs(requirement.source_refs),
    params: expectedParams(requirement.params),
    excerptAuthorized: requirement.excerpt_authorized,
    ...(requirement.deferred === undefined
      ? {}
      : { deferred: requirement.deferred }),
  })) as readonly AssertionDeclaration[];
}

function expectedSources(sourceIds: readonly string[]): readonly RuleSource[] {
  return sourceIds.map((sourceId) => {
    const entry = ledgerEntryFor(sourceId);
    // `url ?? document`: see the dedicated case below. A project-policy source
    // has a `document` and may never have a `url`, and `RuleSource` has only
    // `url`.
    const locator = entry.url ?? entry.document;
    if (locator === undefined) {
      throw new Error(`${sourceId} has neither a url nor a document`);
    }
    return {
      id: entry.id,
      title: entry.title,
      url: locator,
      kind: entry.kind,
      status: entry.status,
      ...(entry.version === undefined ? {} : { version: entry.version }),
      verifiedAt: entry.verified_at,
    };
  });
}

describe("registration", () => {
  it("registers exactly the eight M1 rules", () => {
    expect(STANDARD_RULESET).toHaveLength(8);
    expect(ORDINAL_ORDER).toHaveLength(8);
  });

  it.each(Object.entries(INDIVIDUAL_EXPORTS))(
    "exports %s individually and registers the same object",
    (_name, rule) => {
      expect(STANDARD_RULESET).toContain(rule);
    },
  );

  it("gives no two rules the same id", () => {
    expect(M1_RULE_IDS.size).toBe(STANDARD_RULESET.length);
  });

  it("orders the registry by the snapshot ordinal", () => {
    // ADR-0005 section 2 makes registry order the order in which request
    // budget is reserved, so this is a scarce-resource priority order and not
    // a cosmetic one. `specs/checks.v0.yaml` is where the ordinals are
    // defined; it is read here and never at scan time.
    expect(STANDARD_RULESET.map((rule) => rule.metadata.id)).toStrictEqual(
      ORDINAL_ORDER,
    );
  });

  it("agrees with the order the ruleset itself lists the eight rules in", () => {
    // Nothing in `scripts/validate-registry.ts` compares the two files, so a
    // reorder of either one would otherwise be silent.
    expect(
      RULESET.rules
        .filter((rule) => M1_RULE_IDS.has(rule.rule_id))
        .map((rule) => rule.rule_id),
    ).toStrictEqual(ORDINAL_ORDER);
  });

  it("declares every registered rule in the pinned ruleset", () => {
    const declared = new Set(RULESET.rules.map((rule) => rule.rule_id));
    expect(
      [...M1_RULE_IDS].filter((ruleId) => !declared.has(ruleId)),
    ).toStrictEqual([]);
  });
});

describe.each(
  STANDARD_RULESET.map((rule) => [rule.metadata.id, rule] as const),
)("%s", (ruleId, rule) => {
  const spec = specRuleFor(ruleId);
  const metadata = rule.metadata;

  it("uses rule contract version 1", () => {
    expect(rule.apiVersion).toBe(1);
  });

  it("projects the ruleset fields under the ADR-0002 section 10 mapping", () => {
    expect(metadata.ruleVersion).toBe(spec.rule_version);
    expect(metadata.title).toBe(spec.title);
    expect(metadata.category).toBe(spec.category);
    expect(metadata.sourceMaturity).toBe(spec.maturity);
    expect(metadata.implementationStatus).toBe(spec.implementation_status);
    expect(metadata.applicability).toBe(spec.applicability.default);
    expect(metadata.profiles).toStrictEqual(spec.profiles);
    expect(metadata.observationRuntime).toStrictEqual(spec.runtime);
    expect(metadata.ruleset).toStrictEqual({
      id: RULESET.ruleset_id,
      version: RULESET.ruleset_version,
    });
  });

  it("takes its external compatibility id from the snapshot", () => {
    expect(metadata.externalCompatibilityId).toBe(externalIdFor(ruleId));
  });

  it("declares exactly the ruleset assertions, with their classes", () => {
    // The strong form of "every assertion a rule declares exists in the
    // ruleset for that rule": same ids, same order, same class, same
    // citations, same parameter schema, same excerpt authorization, same
    // deferral. A rule that escalates a class is exit 4 at scan time
    // (`validateRuleAssertions`); catching it here costs nothing.
    expect(metadata.assertions).toStrictEqual(
      expectedAssertions(spec.spec.requirements),
    );
  });

  it("resolves every rule-level source against the ledger", () => {
    expect(metadata.sources).toStrictEqual(expectedSources(spec.source_refs));
  });

  it("declares spec mode only", () => {
    // Not an editorial choice. Every assertion in the ruleset is a `spec`
    // requirement: no rule declares a `compat_assertions` entry, and no
    // accepted decision names an interop-mode assertion id. A rule that
    // declared `compat` or `interop` here would give `runRuleContract` a
    // default mode for which `validateRuleAssertions` throws
    // `no-assertion-for-mode`.
    expect(metadata.modes).toStrictEqual(["spec"]);
  });
});

it("records the one project-policy source by its document path", () => {
  // UNRESOLVED, recorded here so it is visible rather than buried in a
  // comment. `specs/sources.schema.json` forbids a `url` on a
  // `project-policy` source and requires a repository-relative `document`;
  // `RuleSource` and `ReportSource` in `packages/core` require a `url` and
  // have no `document`. The two cannot both be satisfied. The document path
  // is recorded in `url` because inventing an `https` URL for this project's
  // own policy is the exact thing ADR-0010 section 1 exists to prevent, and
  // dropping the entry would hide a source `web.discovery.link` rests on.
  const entry = ledgerEntryFor("agentready-lab-agent-useful-relations");
  expect(entry.url).toBeUndefined();
  expect(entry.document).toBe(
    "docs/decisions/0010-project-policy-and-deferred-assertions.md",
  );
  expect(
    linkRule.metadata.sources.find(
      (source) => source.id === "agentready-lab-agent-useful-relations",
    )?.url,
  ).toBe(entry.document);
});
