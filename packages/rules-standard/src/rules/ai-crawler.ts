import type { RuleDefinition } from "@agentready-lab/core";

/**
 * `web.policy.ai-crawler`. Registry ordinal 6 (`specs/checks.v0.yaml`).
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
 * The implementing agent replaces the three bodies, declares the crawler
 * tokens and tested path in `defaultOptions` (ADR-0004 section 8 records every
 * effective option, and this rule is the reason that is required), and deletes
 * `test/not-implemented/ai-crawler.test.ts`. It shares one `/robots.txt`
 * observation with `web.discovery.robots` and `web.policy.content-signals`
 * through the `agentready-lab/parsed-robots/v1` memo key, and
 * `ai-rules.effective-access` computes the decision without fetching the
 * tested path.
 */
export const aiCrawlerRule: RuleDefinition = {
  apiVersion: 1,
  metadata: {
    id: "web.policy.ai-crawler",
    externalCompatibilityId: "robotsTxtAiRules",
    ruleVersion: "0.2.0",
    ruleset: { id: "standard", version: "0.4.0" },
    title: "AI bot rules",
    category: "bot-access-control",
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
        id: "rfc9309",
        title: "RFC 9309: Robots Exclusion Protocol",
        url: "https://www.rfc-editor.org/rfc/rfc9309",
        kind: "ietf-rfc",
        status: "proposed-standard",
        version: "RFC 9309",
        verifiedAt: "2026-08-28",
      },
      {
        id: "cloudflare-ai-crawl-control",
        title: "Cloudflare AI Crawl Control",
        url: "https://developers.cloudflare.com/ai-crawl-control/",
        kind: "vendor-convention",
        status: "convention",
        version: "documentation snapshot 2026-08-28",
        verifiedAt: "2026-08-28",
      },
      {
        id: "openai-crawlers",
        title: "OpenAI bots and crawlers",
        url: "https://developers.openai.com/api/docs/bots",
        kind: "vendor-convention",
        status: "convention",
        version: "documentation snapshot 2026-08-29",
        verifiedAt: "2026-08-29",
      },
      {
        id: "google-crawlers",
        title: "Google common crawlers",
        url: "https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers",
        kind: "vendor-convention",
        status: "convention",
        version: "documentation snapshot 2026-08-29",
        verifiedAt: "2026-08-29",
      },
      {
        id: "anthropic-crawlers",
        title:
          "Does Anthropic crawl data from the web, and how can site owners block the crawler?",
        url: "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler",
        kind: "vendor-convention",
        status: "convention",
        version: "documentation snapshot 2026-08-29",
        verifiedAt: "2026-08-29",
      },
    ],
    assertions: [
      {
        id: "ai-rules.rep-parse",
        mode: "spec",
        requirementClass: "normative",
        sourceRefs: [{ sourceId: "rfc9309" }],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "ai-rules.token-source",
        mode: "spec",
        requirementClass: "advisory",
        sourceRefs: [
          { sourceId: "openai-crawlers" },
          { sourceId: "google-crawlers" },
          { sourceId: "anthropic-crawlers" },
        ],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "ai-rules.effective-access",
        mode: "spec",
        requirementClass: "recommended",
        sourceRefs: [{ sourceId: "rfc9309" }],
        params: {},
        excerptAuthorized: false,
      },
    ],
    roundTwoBudget: 0,
  },
  defaultOptions: {},
  plan() {
    throw new Error("web.policy.ai-crawler: plan() is not implemented");
  },
  step() {
    throw new Error("web.policy.ai-crawler: step() is not implemented");
  },
  finish() {
    throw new Error("web.policy.ai-crawler: finish() is not implemented");
  },
};
