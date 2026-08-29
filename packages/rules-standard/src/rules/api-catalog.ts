import type { RuleDefinition } from "@agentready-lab/core";

/**
 * `web.discovery.api-catalog`. Registry ordinal 13 (`specs/checks.v0.yaml`).
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
 * this rule dereferences an `api-catalog` link it discovers rather than only
 * the well-known path, and deletes
 * `test/not-implemented/api-catalog.test.ts`.
 */
export const apiCatalogRule: RuleDefinition = {
  apiVersion: 1,
  metadata: {
    id: "web.discovery.api-catalog",
    externalCompatibilityId: "apiCatalog",
    ruleVersion: "0.1.0",
    ruleset: { id: "standard", version: "0.4.0" },
    title: "API Catalog",
    category: "discovery",
    profiles: ["api", "agent-service", "full"],
    applicability: "optional",
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
        id: "rfc9727",
        title:
          "RFC 9727: api-catalog: A Well-Known URI and Link Relation to Help Discovery of APIs",
        url: "https://www.rfc-editor.org/rfc/rfc9727",
        kind: "ietf-rfc",
        status: "proposed-standard",
        version: "RFC 9727",
        verifiedAt: "2026-08-28",
      },
      {
        id: "rfc9264",
        title:
          "RFC 9264: Linkset: Media Types and a Link Relation Type for Link Sets",
        url: "https://www.rfc-editor.org/rfc/rfc9264",
        kind: "ietf-rfc",
        status: "proposed-standard",
        version: "RFC 9264",
        verifiedAt: "2026-08-28",
      },
      {
        id: "rfc8288",
        title: "RFC 8288: Web Linking",
        url: "https://www.rfc-editor.org/rfc/rfc8288",
        kind: "ietf-rfc",
        status: "proposed-standard",
        version: "RFC 8288",
        verifiedAt: "2026-08-28",
      },
    ],
    assertions: [
      {
        id: "api-catalog.discovery",
        mode: "spec",
        requirementClass: "normative",
        sourceRefs: [{ sourceId: "rfc9727" }],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "api-catalog.linkset",
        mode: "spec",
        requirementClass: "normative",
        sourceRefs: [{ sourceId: "rfc9264" }],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "api-catalog.relations",
        mode: "spec",
        requirementClass: "normative",
        sourceRefs: [{ sourceId: "rfc9727", section: "4.1" }],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "api-catalog.profile",
        mode: "spec",
        requirementClass: "recommended",
        sourceRefs: [{ sourceId: "rfc9727" }],
        params: {},
        excerptAuthorized: false,
      },
    ],
    roundTwoBudget: 0,
  },
  defaultOptions: {},
  plan() {
    throw new Error("web.discovery.api-catalog: plan() is not implemented");
  },
  step() {
    throw new Error("web.discovery.api-catalog: step() is not implemented");
  },
  finish() {
    throw new Error("web.discovery.api-catalog: finish() is not implemented");
  },
};
