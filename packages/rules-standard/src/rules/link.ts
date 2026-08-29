import type { RuleDefinition } from "@agentready-lab/core";

/**
 * `web.discovery.link`. Registry ordinal 3 (`specs/checks.v0.yaml`).
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
 * UNRESOLVED, and not a considered choice: `agentready-lab-agent-useful-
 * relations` is this repository's own policy (ADR-0010 section 1). Its ledger
 * entry carries `document` and, by `specs/sources.schema.json`, may never
 * carry a `url`, while `RuleSource.url` in `packages/core` is required and
 * has no `document`. The repository-relative document path is recorded in
 * `url` below because the alternatives are worse: fabricating an `https` URL
 * would be provenance a reader would take for somebody outside this project,
 * which is the exact thing ADR-0010 exists to prevent, and dropping the entry
 * would hide a source this rule rests on. `ReportSource` in
 * `packages/core/src/model/report.ts` has the same shape and therefore the
 * same gap, so the fix belongs to the model rather than to this file.
 *
 * The implementing agent replaces the three bodies, sets `roundTwoBudget` if
 * this rule dereferences anything it discovers, and deletes
 * `test/not-implemented/link.test.ts`.
 */
export const linkRule: RuleDefinition = {
  apiVersion: 1,
  metadata: {
    id: "web.discovery.link",
    externalCompatibilityId: "linkHeaders",
    ruleVersion: "0.1.0",
    ruleset: { id: "standard", version: "0.4.0" },
    title: "Link headers",
    category: "discoverability",
    profiles: ["content", "api", "agent-service", "full"],
    applicability: "applicable",
    modes: ["spec"],
    observationRuntime: ["http"],
    sourceMaturity: "mixed",
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
        id: "rfc8288",
        title: "RFC 8288: Web Linking",
        url: "https://www.rfc-editor.org/rfc/rfc8288",
        kind: "ietf-rfc",
        status: "proposed-standard",
        version: "RFC 8288",
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
        id: "agentready-lab-agent-useful-relations",
        title: "AgentReady Lab agent-useful relation policy",
        url: "docs/decisions/0010-project-policy-and-deferred-assertions.md",
        kind: "project-policy",
        status: "adopted-policy",
        version: "0.1.0",
        verifiedAt: "2026-08-29",
      },
    ],
    assertions: [
      {
        id: "links.parse",
        mode: "spec",
        requirementClass: "normative",
        sourceRefs: [{ sourceId: "rfc8288" }],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "links.relation",
        mode: "spec",
        requirementClass: "normative",
        sourceRefs: [{ sourceId: "rfc8288" }],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "links.agent-useful",
        mode: "spec",
        requirementClass: "advisory",
        sourceRefs: [
          { sourceId: "agentready-lab-agent-useful-relations", section: "2" },
        ],
        params: {},
        excerptAuthorized: false,
      },
    ],
    roundTwoBudget: 0,
  },
  defaultOptions: {},
  plan() {
    throw new Error("web.discovery.link: plan() is not implemented");
  },
  step() {
    throw new Error("web.discovery.link: step() is not implemented");
  },
  finish() {
    throw new Error("web.discovery.link: finish() is not implemented");
  },
};
