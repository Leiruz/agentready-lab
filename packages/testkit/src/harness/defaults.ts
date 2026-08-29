import type {
  AnyRuleDefinition,
  FindingRemediation,
  MessageTemplates,
  NetworkPolicyIdentity,
  OutcomeKind,
  ReportSource,
  RulesetAssertion,
  TargetDescriptor,
} from "@agentready-lab/core";

/**
 * The pinned-artifact defaults a rule contract test should not have to write.
 *
 * `runScan` refuses to start unless the ruleset, the source ledger, the
 * message templates and the remediation table all resolve, which is correct
 * for a product and hostile to a test whose subject is one assertion. These
 * derive each of them from the rule under test, so a test states only what it
 * is actually testing.
 *
 * Every value is a constant. Nothing here reads a clock, a port, an
 * environment variable or the filesystem.
 */

/** The loopback target of `docs/ARCHITECTURE.md` section 8's fixture host. */
export const DEFAULT_TARGET: TargetDescriptor = {
  requestedUrl: "http://127.0.0.1:8787/",
  pageUrl: "http://127.0.0.1:8787/",
  origin: "http://127.0.0.1:8787",
  scope: "local",
  networkProfile: "local-loopback",
};

export const DEFAULT_NETWORK_POLICY: NetworkPolicyIdentity = {
  id: "local-loopback",
  version: "0.1.0",
  allowedSchemes: ["http", "https"],
  allowedPorts: [8787],
  sameOriginDiscovery: true,
};

const OUTCOME_KINDS: readonly OutcomeKind[] = [
  "satisfied",
  "violated",
  "not-present",
  "indeterminate",
];

/**
 * The pinned ruleset declarations for a set of rules, taken from the rules'
 * own metadata.
 *
 * This is the default and not the only option on purpose. ADR-0002 section 5
 * makes the ruleset the authority and the rule's copy the claim, so a test
 * about class escalation or a mode mismatch supplies its own list, and the two
 * disagreeing is the thing under test.
 */
export function assertionsOf(
  rules: readonly AnyRuleDefinition[],
): readonly RulesetAssertion[] {
  return rules.flatMap((rule) =>
    rule.metadata.assertions.map((declaration) => ({
      ...declaration,
      ruleId: rule.metadata.id,
    })),
  );
}

/**
 * A template for every assertion and every outcome kind.
 *
 * A missing template is a `missing-message-template` contract violation, which
 * would make every test that forgot one fail for the same uninteresting
 * reason. A test about template rendering supplies its own.
 */
export function templatesFor(
  assertions: readonly RulesetAssertion[],
): MessageTemplates {
  const templates = new Map<
    string,
    Readonly<Partial<Record<OutcomeKind, string>>>
  >();
  for (const declaration of assertions) {
    const byKind: Partial<Record<OutcomeKind, string>> = {};
    for (const kind of OUTCOME_KINDS) {
      byKind[kind] = `${declaration.id} is ${kind}`;
    }
    templates.set(declaration.id, byKind);
  }
  return templates;
}

/** ADR-0007 section 3 requires an entry for every active assertion. */
export function remediationFor(
  assertions: readonly RulesetAssertion[],
): ReadonlyMap<string, FindingRemediation> {
  return new Map(
    assertions.map((declaration) => [
      declaration.id,
      {
        class:
          declaration.requirementClass === "normative"
            ? ("required-correction" as const)
            : declaration.requirementClass === "compatibility"
              ? ("compatibility-workaround" as const)
              : ("recommended-hardening" as const),
        summary: `Fix ${declaration.id}.`,
      },
    ]),
  );
}

/**
 * A ledger entry for every source the given assertions cite.
 *
 * An assertion citing a source the ledger does not resolve is exit 2 before
 * any dispatch, so a test that only cares about a verdict would otherwise have
 * to hand-write a ledger to reach the verdict at all.
 */
export function sourceLedgerFor(
  assertions: readonly RulesetAssertion[],
): ReadonlyMap<string, ReportSource> {
  const ledger = new Map<string, ReportSource>();
  for (const declaration of assertions) {
    for (const ref of declaration.sourceRefs) {
      if (ledger.has(ref.sourceId)) continue;
      ledger.set(ref.sourceId, {
        id: ref.sourceId,
        title: `Test source ${ref.sourceId}`,
        url: `https://example.invalid/${ref.sourceId}`,
        kind: "test-fixture",
        status: "pinned",
        verifiedAt: "2026-08-28",
      });
    }
  }
  return ledger;
}
