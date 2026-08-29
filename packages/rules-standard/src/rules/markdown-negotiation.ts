import type { RuleDefinition } from "@agentready-lab/core";

/**
 * `web.content.markdown-negotiation`. Registry ordinal 5
 * (`specs/checks.v0.yaml`).
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
 * `test/not-implemented/markdown-negotiation.test.ts`. Both representations
 * are round-one requests: `plan()` receives the configured `Accept` value in
 * `options`, and two `HttpObservationRequest`s over the same page with
 * different `accept` values do not deduplicate (ADR-0005).
 */
export const markdownNegotiationRule: RuleDefinition = {
  apiVersion: 1,
  metadata: {
    id: "web.content.markdown-negotiation",
    externalCompatibilityId: "markdownNegotiation",
    ruleVersion: "0.1.0",
    ruleset: { id: "standard", version: "0.4.0" },
    title: "Markdown negotiation",
    category: "content-accessibility",
    profiles: ["content", "api", "agent-service", "full"],
    applicability: "applicable",
    modes: ["spec"],
    observationRuntime: ["http"],
    sourceMaturity: "convention",
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
        id: "cloudflare-markdown-agents",
        title: "Cloudflare Markdown for Agents",
        url: "https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/",
        kind: "vendor-convention",
        status: "convention",
        version: "documentation snapshot 2026-08-28",
        verifiedAt: "2026-08-28",
      },
      {
        id: "rfc7763",
        title: "RFC 7763: The text/markdown Media Type",
        url: "https://www.rfc-editor.org/rfc/rfc7763",
        kind: "ietf-rfc",
        status: "informational-rfc",
        version: "RFC 7763",
        verifiedAt: "2026-08-28",
      },
      {
        id: "rfc9110",
        title: "RFC 9110: HTTP Semantics",
        url: "https://www.rfc-editor.org/rfc/rfc9110",
        kind: "ietf-rfc",
        status: "internet-standard",
        version: "RFC 9110 / STD 97",
        verifiedAt: "2026-08-28",
      },
    ],
    assertions: [
      {
        id: "markdown.media-type",
        mode: "spec",
        requirementClass: "normative",
        sourceRefs: [{ sourceId: "rfc7763", section: "2" }],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "markdown.negotiation",
        mode: "spec",
        requirementClass: "normative",
        sourceRefs: [{ sourceId: "rfc9110" }],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "markdown.vary",
        mode: "spec",
        requirementClass: "recommended",
        sourceRefs: [{ sourceId: "rfc9110", section: "12.5.5" }],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "markdown.fidelity",
        mode: "spec",
        requirementClass: "advisory",
        sourceRefs: [{ sourceId: "rfc9110" }],
        params: {},
        excerptAuthorized: false,
      },
    ],
    roundTwoBudget: 0,
  },
  defaultOptions: {},
  plan() {
    throw new Error(
      "web.content.markdown-negotiation: plan() is not implemented",
    );
  },
  step() {
    throw new Error(
      "web.content.markdown-negotiation: step() is not implemented",
    );
  },
  finish() {
    throw new Error(
      "web.content.markdown-negotiation: finish() is not implemented",
    );
  },
};
