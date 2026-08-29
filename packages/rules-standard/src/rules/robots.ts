import type { RuleDefinition } from "@agentready-lab/core";

/**
 * `web.discovery.robots`. Registry ordinal 1 (`specs/checks.v0.yaml`).
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
 * The implementing agent replaces the three bodies, sets `roundTwoBudget` if
 * this rule dereferences anything it discovers, and deletes
 * `test/not-implemented/robots.test.ts`.
 */
export const robotsRule: RuleDefinition = {
  apiVersion: 1,
  metadata: {
    id: "web.discovery.robots",
    externalCompatibilityId: "robotsTxt",
    ruleVersion: "0.1.0",
    ruleset: { id: "standard", version: "0.4.0" },
    title: "robots.txt",
    category: "discoverability",
    profiles: ["content", "api", "agent-service", "full"],
    applicability: "applicable",
    modes: ["spec"],
    observationRuntime: ["http"],
    sourceMaturity: "stable",
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
        id: "robots.location",
        mode: "spec",
        requirementClass: "normative",
        sourceRefs: [{ sourceId: "rfc9309" }],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "robots.syntax",
        mode: "spec",
        requirementClass: "normative",
        sourceRefs: [{ sourceId: "rfc9309" }],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "robots.not-authz",
        mode: "spec",
        requirementClass: "advisory",
        sourceRefs: [{ sourceId: "rfc9309" }],
        params: {},
        excerptAuthorized: false,
      },
    ],
    roundTwoBudget: 0,
  },
  defaultOptions: {},
  plan() {
    throw new Error("web.discovery.robots: plan() is not implemented");
  },
  step() {
    throw new Error("web.discovery.robots: step() is not implemented");
  },
  finish() {
    throw new Error("web.discovery.robots: finish() is not implemented");
  },
};
