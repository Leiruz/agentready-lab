import type { RuleDefinition } from "@agentready-lab/core";

/**
 * `web.policy.content-signals`. Registry ordinal 7 (`specs/checks.v0.yaml`).
 *
 * Metadata only. `plan`, `step` and `finish` throw, because
 * `implementation_status` for this rule is `planned` in
 * `specs/ruleset.standard.v0.yaml` and a placeholder returning `satisfied`
 * would be a verdict nothing computed.
 *
 * Every metadata value is read from `specs/ruleset.standard.v0.yaml` at
 * `ruleset_version` 0.4.0 and `specs/sources.v0.yaml` at
 * `source_ledger_version` 0.4.0, under the ADR-0002 section 10 mapping.
 * `test/registry.test.ts` re-reads both files and compares, so a value edited
 * here without the spec is a test failure rather than a silent divergence.
 *
 * Two details the types do not show. `content-signals.syntax` is retired under
 * ADR-0009 and must not be reintroduced under any id. All four assertions go
 * `not-present` together when no declaration is served, which fixture sig-006
 * exercises and `deriveRuleStatus` permits only as an unmixed set.
 *
 * The implementing agent replaces the three bodies, sets `roundTwoBudget` if
 * this rule dereferences anything it discovers, and deletes
 * `test/not-implemented/content-signals.test.ts`. It shares one `/robots.txt`
 * observation with `web.discovery.robots` and `web.policy.ai-crawler` through
 * the `agentready-lab/parsed-robots/v1` memo key.
 */
export const contentSignalsRule: RuleDefinition = {
  apiVersion: 1,
  metadata: {
    id: "web.policy.content-signals",
    externalCompatibilityId: "contentSignals",
    ruleVersion: "0.2.0",
    ruleset: { id: "standard", version: "0.4.0" },
    title: "Content Signals",
    category: "bot-access-control",
    profiles: ["content", "api", "agent-service", "full"],
    applicability: "optional",
    modes: ["spec"],
    observationRuntime: ["http"],
    sourceMaturity: "experimental",
    implementationStatus: "planned",
    sources: [
      {
        id: "isit-2026-08-28",
        title: "Is Your Site Agent-Ready? — Full Documentation",
        url: "https://isitagentready.com/llms-full.txt",
        kind: "compatibility-contract",
        status: "compatibility-snapshot",
        version: "snapshot 2026-08-28",
        verifiedAt: "2026-08-28",
      },
      {
        id: "content-signals",
        title: "Content Signals",
        url: "https://contentsignals.org/",
        kind: "industry-protocol",
        status: "living-specification",
        version: "site snapshot 2026-08-28",
        verifiedAt: "2026-08-28",
      },
      {
        id: "content-signals-draft-00",
        title: "Content Signals for AI Preferences",
        url: "https://datatracker.ietf.org/doc/draft-romm-aipref-contentsignals/",
        kind: "ietf-draft",
        status: "expired-draft",
        version: "draft-romm-aipref-contentsignals-00",
        verifiedAt: "2026-08-28",
      },
      {
        id: "rfc9309",
        title: "RFC 9309: Robots Exclusion Protocol",
        url: "https://www.rfc-editor.org/rfc/rfc9309",
        kind: "ietf-rfc",
        status: "proposed-standard",
        version: "RFC 9309",
        verifiedAt: "2026-08-28",
      },
    ],
    assertions: [
      {
        id: "content-signals.coverage",
        mode: "spec",
        requirementClass: "recommended",
        sourceRefs: [{ sourceId: "content-signals-draft-00", section: "3" }],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "content-signals.effect",
        mode: "spec",
        requirementClass: "advisory",
        sourceRefs: [
          { sourceId: "content-signals-draft-00" },
          { sourceId: "content-signals" },
        ],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "content-signals.conflicting-declaration",
        mode: "spec",
        requirementClass: "advisory",
        sourceRefs: [
          { sourceId: "content-signals-draft-00" },
          { sourceId: "rfc9309", section: "2.2.4" },
        ],
        params: {},
        excerptAuthorized: false,
      },
      {
        // The only declared parameter in the whole M1 ruleset. The verbatim
        // token evidence ADR-0009 sections 4 and 5 ask for is an `excerpt`
        // parameter, and the ruleset does not authorize one yet; a rule that
        // emits an excerpt here is an `unauthorized-excerpt` contract
        // violation, not a formatting preference.
        id: "content-signals.unrecognized-vocabulary",
        mode: "spec",
        requirementClass: "advisory",
        sourceRefs: [{ sourceId: "content-signals-draft-00", section: "4" }],
        params: {
          "recognized-token-count": { kind: "count", required: true },
        },
        excerptAuthorized: false,
      },
    ],
    roundTwoBudget: 0,
  },
  defaultOptions: {},
  plan() {
    throw new Error("web.policy.content-signals: plan() is not implemented");
  },
  step() {
    throw new Error("web.policy.content-signals: step() is not implemented");
  },
  finish() {
    throw new Error("web.policy.content-signals: finish() is not implemented");
  },
};
