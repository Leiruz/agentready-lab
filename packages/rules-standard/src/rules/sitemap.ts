import type { RuleDefinition } from "@agentready-lab/core";

/**
 * `web.discovery.sitemap`. Registry ordinal 2 (`specs/checks.v0.yaml`).
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
 * The implementing agent replaces the three bodies, sets `roundTwoBudget`
 * (`sitemap.directive` dereferences a Sitemap record read from robots.txt,
 * which is a round-two discovered request), and deletes
 * `test/not-implemented/sitemap.test.ts`.
 */
export const sitemapRule: RuleDefinition = {
  apiVersion: 1,
  metadata: {
    id: "web.discovery.sitemap",
    externalCompatibilityId: "sitemap",
    ruleVersion: "0.1.0",
    ruleset: { id: "standard", version: "0.4.0" },
    title: "Sitemap",
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
        id: "sitemaps-protocol",
        title: "Sitemaps XML format",
        url: "https://www.sitemaps.org/protocol.html",
        kind: "industry-protocol",
        status: "final",
        version: "living protocol page",
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
        id: "sitemap.xml",
        mode: "spec",
        requirementClass: "normative",
        sourceRefs: [{ sourceId: "sitemaps-protocol" }],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "sitemap.directive",
        mode: "spec",
        requirementClass: "normative",
        sourceRefs: [
          { sourceId: "sitemaps-protocol" },
          { sourceId: "rfc9309", section: "2.2.4" },
        ],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "sitemap.canonical",
        mode: "spec",
        requirementClass: "recommended",
        sourceRefs: [{ sourceId: "sitemaps-protocol" }],
        params: {},
        excerptAuthorized: false,
      },
    ],
    roundTwoBudget: 0,
  },
  defaultOptions: {},
  plan() {
    throw new Error("web.discovery.sitemap: plan() is not implemented");
  },
  step() {
    throw new Error("web.discovery.sitemap: step() is not implemented");
  },
  finish() {
    throw new Error("web.discovery.sitemap: finish() is not implemented");
  },
};
