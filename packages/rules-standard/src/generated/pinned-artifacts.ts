/**
 * GENERATED FILE. Do not edit.
 *
 * Written by `pnpm specs:canonicalise` from specs/ruleset.standard.v0.yaml,
 * specs/sources.v0.yaml, specs/remediation.v0.yaml and
 * specs/templates.v0.yaml. `pnpm specs:validate` regenerates it and fails on
 * any difference, so an edit here is reverted by CI rather than shipped.
 *
 * It exists so that a scan needs no YAML parser and no filesystem: everything
 * ADR-0007 section 1 requires a report to cite is compiled in. See
 * scripts/lib/pinned-artifacts.ts for why the projection happens at build time
 * and what it deliberately leaves out.
 */
import type {
  FindingRemediation,
  MessageTemplates,
  OutcomeKind,
  ProfileId,
  RemediationTable,
  ReportSource,
  RulesetAssertion,
} from "@agentready-lab/core";

/** `ruleset_id`, `ruleset_version` and the digest of the canonical projection. */
export const PINNED_RULESET = {
  id: "standard",
  version: "0.4.0",
  digest:
    "sha256:8919828c825c1e886b518e0364bac80ff02c53f7dca360399e6e68f586bc1195",
} as const;

/** ADR-0007: the axis a report carries in place of a ledger digest. */
export const PINNED_SOURCE_LEDGER_VERSION = "0.4.0";

/** `templates_version` and `remediation_version`, for provenance in a bug report. */
export const PINNED_TEMPLATES_VERSION = "0.1.0";
export const PINNED_REMEDIATION_VERSION = "0.1.0";

/**
 * Every assertion the ruleset declares, in ruleset order, including the
 * deferred and the uncited ones. `RulesetAssertionIndex` drops a deferred
 * assertion and `validateRuleAssertions` refuses a rule whose active
 * assertions cite nothing, so filtering here would move two refusals out of
 * the engine and into a build step.
 */
export const PINNED_ASSERTIONS: readonly RulesetAssertion[] = [
  {
    ruleId: "web.discovery.robots",
    id: "robots.location",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [{ sourceId: "rfc9309" }],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "web.discovery.robots",
    id: "robots.syntax",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [{ sourceId: "rfc9309" }],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "web.discovery.robots",
    id: "robots.not-authz",
    mode: "spec",
    requirementClass: "advisory",
    sourceRefs: [{ sourceId: "rfc9309" }],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "web.discovery.sitemap",
    id: "sitemap.xml",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [{ sourceId: "sitemaps-protocol" }],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "web.discovery.sitemap",
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
    ruleId: "web.discovery.sitemap",
    id: "sitemap.canonical",
    mode: "spec",
    requirementClass: "recommended",
    sourceRefs: [{ sourceId: "sitemaps-protocol" }],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "web.discovery.link",
    id: "links.parse",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [{ sourceId: "rfc8288" }],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "web.discovery.link",
    id: "links.relation",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [{ sourceId: "rfc8288" }],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "web.discovery.link",
    id: "links.agent-useful",
    mode: "spec",
    requirementClass: "advisory",
    sourceRefs: [
      { sourceId: "agentready-lab-agent-useful-relations", section: "2" },
    ],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "dns.discovery.dns-aid",
    id: "dnsaid.version",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "dns.discovery.dns-aid",
    id: "dnsaid.svcb",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "dns.discovery.dns-aid",
    id: "dnsaid.dnssec",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "web.content.markdown-negotiation",
    id: "markdown.media-type",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [{ sourceId: "rfc7763", section: "2" }],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "web.content.markdown-negotiation",
    id: "markdown.negotiation",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [{ sourceId: "rfc9110" }],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "web.content.markdown-negotiation",
    id: "markdown.vary",
    mode: "spec",
    requirementClass: "recommended",
    sourceRefs: [{ sourceId: "rfc9110", section: "12.5.5" }],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "web.content.markdown-negotiation",
    id: "markdown.fidelity",
    mode: "spec",
    requirementClass: "advisory",
    sourceRefs: [{ sourceId: "rfc9110" }],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "web.policy.ai-crawler",
    id: "ai-rules.rep-parse",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [{ sourceId: "rfc9309" }],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "web.policy.ai-crawler",
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
    ruleId: "web.policy.ai-crawler",
    id: "ai-rules.effective-access",
    mode: "spec",
    requirementClass: "recommended",
    sourceRefs: [{ sourceId: "rfc9309" }],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "web.policy.content-signals",
    id: "content-signals.coverage",
    mode: "spec",
    requirementClass: "recommended",
    sourceRefs: [{ sourceId: "content-signals-draft-00", section: "3" }],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "web.policy.content-signals",
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
    ruleId: "web.policy.content-signals",
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
    ruleId: "web.policy.content-signals",
    id: "content-signals.unrecognized-vocabulary",
    mode: "spec",
    requirementClass: "advisory",
    sourceRefs: [{ sourceId: "content-signals-draft-00", section: "4" }],
    params: { "recognized-token-count": { kind: "count", required: true } },
    excerptAuthorized: false,
  },
  {
    ruleId: "web.identity.web-bot-auth",
    id: "webbotauth.directory",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "web.identity.web-bot-auth",
    id: "webbotauth.httpsig",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "agent.discovery.mcp-server-card",
    id: "mcp-card.pin",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "agent.discovery.mcp-server-card",
    id: "mcp-card.fields",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "agent.discovery.mcp-server-card",
    id: "mcp-card.endpoint",
    mode: "spec",
    requirementClass: "recommended",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "agent.discovery.a2a-agent-card",
    id: "a2a.card-required",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "agent.discovery.a2a-agent-card",
    id: "a2a.interfaces",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "agent.discovery.a2a-agent-card",
    id: "a2a.unknown-fields",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "agent.discovery.skills",
    id: "skills.path-schema",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [{ sourceId: "agent-skills-discovery-v0.2.0" }],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "agent.discovery.skills",
    id: "skills.entry",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [{ sourceId: "agent-skills-discovery-v0.2.0" }],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "agent.discovery.skills",
    id: "skills.digest",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [{ sourceId: "agent-skills-discovery-v0.2.0" }],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "agent.discovery.skills",
    id: "skills.archive-safety",
    mode: "spec",
    requirementClass: "recommended",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
    deferred: {
      adr: "ADR-0010",
      reason:
        "Two independent reasons, either of which is sufficient. Uncited: this assertion's text sets five limits and agent-skills-discovery-v0.2.0 supports two of them. Its Archive Safety section does state path and link rules: an archive MUST NOT contain path traversal sequences or absolute paths, and a client unpacking one MUST reject archives containing symlinks or hard links that resolve outside the skill directory. What the draft states nowhere is a number. It gives no byte size, no file count and no compression ratio, and leaves the total unpacked size as a reasonable limit for the client to choose. Those three numeric limits are docs/THREAT_MODEL.md section 19.6, which is this project's own control rather than a ledger source, so the assertion as written cannot rest on the draft alone. An earlier revision of this reason said the draft states no path or link limit either. That was false, and it came from a ledger note written from the draft's Discovery Index section alone; the entry now records the Archive Safety section it omitted. Unevaluable: section 19.6 also records that the MVP does not unpack an archive at all, so nothing observes the metadata this assertion is about. An uninspected archive reported as pass would be a claim the scanner never checked, and reported as fail would be a claim about a target that did nothing wrong.",
      until:
        "An accepted decision permits unpacking a downloaded skill archive under the controls docs/THREAT_MODEL.md section 19.6 lists, and names the limit values. That decision must also assign source_refs for the limits it sets, which under ADR-0010 section 1 may be a project-policy source provided the assertion is not normative.",
    },
  },
  {
    ruleId: "agent.browser.webmcp",
    id: "webmcp.runtime",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "agent.browser.webmcp",
    id: "webmcp.tool-shape",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "web.discovery.api-catalog",
    id: "api-catalog.discovery",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [{ sourceId: "rfc9727" }],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "web.discovery.api-catalog",
    id: "api-catalog.linkset",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [{ sourceId: "rfc9264" }],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "web.discovery.api-catalog",
    id: "api-catalog.relations",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [{ sourceId: "rfc9727", section: "4.1" }],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "web.discovery.api-catalog",
    id: "api-catalog.profile",
    mode: "spec",
    requirementClass: "recommended",
    sourceRefs: [{ sourceId: "rfc9727" }],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "auth.discovery.oauth-authorization-server",
    id: "oauth-metadata.location",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "auth.discovery.oauth-authorization-server",
    id: "oauth-metadata.issuer",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "auth.discovery.oauth-authorization-server",
    id: "oauth-metadata.fields",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "auth.discovery.oauth-authorization-server",
    id: "oauth-metadata.urls",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "auth.discovery.oauth-protected-resource",
    id: "prm.location",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "auth.discovery.oauth-protected-resource",
    id: "prm.response",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "auth.discovery.oauth-protected-resource",
    id: "prm.resource",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "auth.discovery.oauth-protected-resource",
    id: "prm.authorization-servers",
    mode: "spec",
    requirementClass: "advisory",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "auth.discovery.auth-md",
    id: "authmd.pin",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "auth.discovery.auth-md",
    id: "authmd.oauth-base",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "auth.discovery.auth-md",
    id: "authmd.extension",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "agent.discovery.ard",
    id: "ard.discovery",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "agent.discovery.ard",
    id: "ard.entry",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "agent.discovery.ard",
    id: "ard.schema",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "agent.discovery.ard",
    id: "ard.official-cli",
    mode: "spec",
    requirementClass: "advisory",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "commerce.payment.x402",
    id: "x402.version",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "commerce.payment.x402",
    id: "x402.payment-required",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "commerce.payment.x402",
    id: "x402.no-payment",
    mode: "spec",
    requirementClass: "advisory",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "commerce.payment.mpp",
    id: "payment-discovery.document",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "commerce.payment.mpp",
    id: "payment-discovery.operation",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "commerce.payment.mpp",
    id: "payment-discovery.version",
    mode: "spec",
    requirementClass: "advisory",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "commerce.discovery.ucp",
    id: "ucp.profile-wrapper",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "commerce.discovery.ucp",
    id: "ucp.date-version",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "commerce.discovery.ucp",
    id: "ucp.endpoints",
    mode: "spec",
    requirementClass: "recommended",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "commerce.discovery.acp",
    id: "acp.version",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "commerce.discovery.acp",
    id: "acp.discovery",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "commerce.discovery.acp",
    id: "acp.beta-label",
    mode: "spec",
    requirementClass: "advisory",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "commerce.payment.ap2",
    id: "ap2.compat-legacy",
    mode: "spec",
    requirementClass: "advisory",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
  {
    ruleId: "commerce.payment.ap2",
    id: "ap2.v0.2",
    mode: "spec",
    requirementClass: "normative",
    sourceRefs: [],
    params: {},
    excerptAuthorized: false,
  },
];

export const PINNED_SOURCE_LEDGER: ReadonlyMap<string, ReportSource> = new Map<
  string,
  ReportSource
>([
  [
    "agentready-lab-agent-useful-relations",
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
  [
    "isit-2026-08-28",
    {
      id: "isit-2026-08-28",
      title: "Is Your Site Agent-Ready? — Full Documentation",
      url: "https://isitagentready.com/llms-full.txt",
      kind: "compatibility-contract",
      status: "compatibility-snapshot",
      version: "snapshot 2026-08-28",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "cloudflare-launch-2026-04-17",
    {
      id: "cloudflare-launch-2026-04-17",
      title: "Introducing the Agent Readiness score",
      url: "https://blog.cloudflare.com/agent-readiness/",
      kind: "vendor-convention",
      status: "convention",
      version: "2026-04-17",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "rfc9309",
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
  [
    "sitemaps-protocol",
    {
      id: "sitemaps-protocol",
      title: "Sitemaps XML format",
      url: "https://www.sitemaps.org/protocol.html",
      kind: "industry-protocol",
      status: "final",
      version: "living protocol page",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "rfc8288",
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
  [
    "rfc9727",
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
  ],
  [
    "rfc9264",
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
  ],
  [
    "dns-aid-02",
    {
      id: "dns-aid-02",
      title: "DNS for AI Discovery (DNS-AID)",
      url: "https://datatracker.ietf.org/doc/draft-mozleywilliams-dnsop-dnsaid/",
      kind: "ietf-draft",
      status: "active-draft",
      version: "draft-mozleywilliams-dnsop-dnsaid-02",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "rfc9460",
    {
      id: "rfc9460",
      title:
        "RFC 9460: Service Binding and Parameter Specification via the DNS",
      url: "https://www.rfc-editor.org/rfc/rfc9460",
      kind: "ietf-rfc",
      status: "proposed-standard",
      version: "RFC 9460",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "cloudflare-markdown-agents",
    {
      id: "cloudflare-markdown-agents",
      title: "Cloudflare Markdown for Agents",
      url: "https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/",
      kind: "vendor-convention",
      status: "convention",
      version: "documentation snapshot 2026-08-28",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "rfc7763",
    {
      id: "rfc7763",
      title: "RFC 7763: The text/markdown Media Type",
      url: "https://www.rfc-editor.org/rfc/rfc7763",
      kind: "ietf-rfc",
      status: "informational-rfc",
      version: "RFC 7763",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "rfc9110",
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
  [
    "cloudflare-ai-crawl-control",
    {
      id: "cloudflare-ai-crawl-control",
      title: "Cloudflare AI Crawl Control",
      url: "https://developers.cloudflare.com/ai-crawl-control/",
      kind: "vendor-convention",
      status: "convention",
      version: "documentation snapshot 2026-08-28",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "openai-crawlers",
    {
      id: "openai-crawlers",
      title: "OpenAI bots and crawlers",
      url: "https://developers.openai.com/api/docs/bots",
      kind: "vendor-convention",
      status: "convention",
      version: "documentation snapshot 2026-08-29",
      verifiedAt: "2026-08-29",
    },
  ],
  [
    "google-crawlers",
    {
      id: "google-crawlers",
      title: "Google common crawlers",
      url: "https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers",
      kind: "vendor-convention",
      status: "convention",
      version: "documentation snapshot 2026-08-29",
      verifiedAt: "2026-08-29",
    },
  ],
  [
    "anthropic-crawlers",
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
  [
    "content-signals",
    {
      id: "content-signals",
      title: "Content Signals",
      url: "https://contentsignals.org/",
      kind: "industry-protocol",
      status: "living-specification",
      version: "site snapshot 2026-08-28",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "content-signals-draft-00",
    {
      id: "content-signals-draft-00",
      title: "Content Signals for AI Preferences",
      url: "https://datatracker.ietf.org/doc/draft-romm-aipref-contentsignals/",
      kind: "ietf-draft",
      status: "expired-draft",
      version: "draft-romm-aipref-contentsignals-00",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "webbotauth-wg",
    {
      id: "webbotauth-wg",
      title: "IETF Web Bot Auth Working Group",
      url: "https://datatracker.ietf.org/wg/webbotauth/about/",
      kind: "standards-organization",
      status: "living-specification",
      version: "working group status 2026-08-28",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "webbotauth-protocol-02",
    {
      id: "webbotauth-protocol-02",
      title: "Web Bot Auth HTTP Message Signatures Protocol",
      url: "https://datatracker.ietf.org/doc/draft-meunier-webbotauth-httpsig-protocol/",
      kind: "ietf-draft",
      status: "active-draft",
      version: "draft-meunier-webbotauth-httpsig-protocol-02",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "rfc9421",
    {
      id: "rfc9421",
      title: "RFC 9421: HTTP Message Signatures",
      url: "https://www.rfc-editor.org/rfc/rfc9421",
      kind: "ietf-rfc",
      status: "proposed-standard",
      version: "RFC 9421",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "cloudflare-webbotauth",
    {
      id: "cloudflare-webbotauth",
      title: "Cloudflare Web Bot Auth verification",
      url: "https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/",
      kind: "vendor-convention",
      status: "convention",
      version: "documentation snapshot 2026-08-28",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "mcp-sep-2127",
    {
      id: "mcp-sep-2127",
      title: "MCP Server Card proposal (SEP-2127)",
      url: "https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127",
      kind: "open-proposal",
      status: "open-pr",
      version: "open PR snapshot 2026-08-28",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "a2a-v1.0",
    {
      id: "a2a-v1.0",
      title: "A2A Protocol Specification",
      url: "https://a2a-protocol.org/latest/specification/",
      kind: "ecosystem-specification",
      status: "final",
      version: "1.0",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "a2a-v1.0-definitions",
    {
      id: "a2a-v1.0-definitions",
      title: "A2A v1.0 normative definitions",
      url: "https://a2a-protocol.org/latest/definitions/",
      kind: "ecosystem-specification",
      status: "final",
      version: "1.0",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "agent-skills-discovery-v0.2.0",
    {
      id: "agent-skills-discovery-v0.2.0",
      title: "Agent Skills Discovery RFC",
      url: "https://github.com/cloudflare/agent-skills-discovery-rfc",
      kind: "open-source-profile",
      status: "active-draft",
      version: "0.2.0",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "webmcp-cg",
    {
      id: "webmcp-cg",
      title: "WebMCP API",
      url: "https://webmachinelearning.github.io/webmcp/",
      kind: "w3c-community-report",
      status: "community-report",
      version: "living Community Group report snapshot 2026-08-28",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "rfc8414",
    {
      id: "rfc8414",
      title: "RFC 8414: OAuth 2.0 Authorization Server Metadata",
      url: "https://www.rfc-editor.org/rfc/rfc8414",
      kind: "ietf-rfc",
      status: "proposed-standard",
      version: "RFC 8414",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "openid-discovery-1.0",
    {
      id: "openid-discovery-1.0",
      title: "OpenID Connect Discovery 1.0",
      url: "https://openid.net/specs/openid-connect-discovery-1_0.html",
      kind: "openid-specification",
      status: "final",
      version: "1.0 incorporating errata set 2",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "rfc9728",
    {
      id: "rfc9728",
      title: "RFC 9728: OAuth 2.0 Protected Resource Metadata",
      url: "https://www.rfc-editor.org/rfc/rfc9728",
      kind: "ietf-rfc",
      status: "proposed-standard",
      version: "RFC 9728",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "auth-md-repository",
    {
      id: "auth-md-repository",
      title: "auth.md reference repository",
      url: "https://github.com/workos/auth.md",
      kind: "open-source-profile",
      status: "proposal",
      version: "repository snapshot 2026-08-28",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "auth-md-site",
    {
      id: "auth-md-site",
      title: "Auth.md",
      url: "https://workos.com/auth-md",
      kind: "vendor-convention",
      status: "convention",
      version: "site snapshot 2026-08-28",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "ard-v0.91",
    {
      id: "ard-v0.91",
      title: "Agentic Resource Discovery Specification",
      url: "https://agenticresourcediscovery.org/spec/",
      kind: "ecosystem-specification",
      status: "proposal",
      version: "0.91, 2026-08-26",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "ard-repository",
    {
      id: "ard-repository",
      title: "ARD specification repository",
      url: "https://github.com/ards-project/ard-spec",
      kind: "open-source-profile",
      status: "proposal",
      version: "0.91",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "ai-catalog-predecessor",
    {
      id: "ai-catalog-predecessor",
      title: "AI Catalog predecessor proposal",
      url: "https://github.com/Agent-Card/ai-catalog",
      kind: "open-proposal",
      status: "proposal",
      version: "predecessor snapshot 2026-08-28",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "x402-v2",
    {
      id: "x402-v2",
      title: "x402 documentation",
      url: "https://docs.x402.org/",
      kind: "ecosystem-specification",
      status: "living-specification",
      version: "2",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "x402-repository",
    {
      id: "x402-repository",
      title: "x402 Foundation protocol repository",
      url: "https://github.com/x402-foundation/x402",
      kind: "open-source-profile",
      status: "living-specification",
      version: "v2 family, snapshot 2026-08-28",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "payment-discovery-00",
    {
      id: "payment-discovery-00",
      title: "Payment Discovery",
      url: "https://paymentauth.org/draft-payment-discovery-00.txt",
      kind: "ietf-draft",
      status: "active-draft",
      version: "draft-payment-discovery-00, 2026-08-24",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "mpp-site",
    {
      id: "mpp-site",
      title: "Machine Payments Protocol",
      url: "https://mpp.dev/",
      kind: "ecosystem-specification",
      status: "living-specification",
      version: "site snapshot 2026-08-28",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "ucp-2026-08-25",
    {
      id: "ucp-2026-08-25",
      title: "Universal Commerce Protocol Specification",
      url: "https://ucp.dev/specification/overview/",
      kind: "ecosystem-specification",
      status: "living-specification",
      version: "2026-08-25",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "acp-2026-04-17",
    {
      id: "acp-2026-04-17",
      title: "Agentic Commerce Protocol repository",
      url: "https://github.com/agentic-commerce-protocol/agentic-commerce-protocol",
      kind: "open-source-profile",
      status: "beta",
      version: "2026-04-17",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "acp-site",
    {
      id: "acp-site",
      title: "Agentic Commerce Protocol",
      url: "https://agenticcommerce.dev/",
      kind: "ecosystem-specification",
      status: "beta",
      version: "site snapshot 2026-08-28",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "ap2-v0.2",
    {
      id: "ap2-v0.2",
      title: "Agent Payments Protocol specification",
      url: "https://ap2-protocol.org/ap2/specification/",
      kind: "ecosystem-specification",
      status: "living-specification",
      version: "0.2",
      verifiedAt: "2026-08-28",
    },
  ],
  [
    "ap2-repository",
    {
      id: "ap2-repository",
      title: "Agent Payments Protocol repository",
      url: "https://github.com/google-agentic-commerce/AP2",
      kind: "open-source-profile",
      status: "living-specification",
      version: "0.2",
      verifiedAt: "2026-08-28",
    },
  ],
]);

export const PINNED_TEMPLATES: MessageTemplates = new Map<
  string,
  Readonly<Record<OutcomeKind, string>>
>([
  [
    "robots.location",
    {
      satisfied:
        "/robots.txt was served from the origin root with the text/plain media type RFC 9309 fixes for the file.",
      violated:
        "The successful /robots.txt response did not declare the text/plain media type RFC 9309 fixes for the file, so what this origin serves at that path is not a robots.txt a crawler is obliged to read as one.",
      "not-present":
        'The origin answered /robots.txt with a client-error status, which RFC 9309 reads as "unavailable": no robots policy is published here, and every path is allowed by default.',
      indeterminate:
        "The /robots.txt retrieval produced no representation this scan could read: the request failed, the status was outside the successful class, or the body was cut at this scanner's size limit. The published location and media type are therefore unknown.",
    },
  ],
  [
    "robots.syntax",
    {
      satisfied:
        "robots.txt decoded as UTF-8 and every line was a record RFC 9309 defines or an extension record it permits, so group selection and precedence resolve from the file as written.",
      violated:
        "robots.txt was not well-formed UTF-8, or carried lines matching no record RFC 9309 defines. A crawler skips what it cannot parse, so the policy those lines were meant to express is not the policy that will be applied.",
      "not-present":
        "The origin answered /robots.txt with a client-error status, so there is no published document whose syntax could be read.",
      indeterminate:
        "The robots.txt was not read to the end: the retrieval failed, the status was outside the successful class, the body was cut at this scanner's size limit, or the parse stopped at its own bound. A limit of this scanner is not a defect in the file.",
    },
  ],
  [
    "robots.not-authz",
    {
      satisfied:
        "Disclosure: the Robots Exclusion Protocol states crawl preferences, not access authorization. A path that only robots.txt disallows stays reachable by anything that does not consult the file, so it must never be relied on to protect a secret.",
      violated:
        "A robots.txt preference was reported as an access-control decision. Nothing in RFC 9309 grants or denies access to a resource, and a preference read as authorization would overstate what was observed.",
      "not-present":
        "No robots.txt is published at this origin, so there is no crawl preference to distinguish from access authorization.",
      indeterminate:
        "The robots.txt retrieval did not complete, so this scan reports no crawl preference and the distinction between a preference and an access decision has nothing to attach to.",
    },
  ],
  [
    "sitemap.xml",
    {
      satisfied:
        "The sitemap parsed as well-formed UTF-8 XML with a urlset or sitemapindex root in the Sitemaps protocol namespace, at least one entry, a location in every entry, and no more entries than the protocol allows.",
      violated:
        "The sitemap does not meet the Sitemaps protocol's document requirements: its media type, XML well-formedness, root element, namespace, UTF-8 encoding, the presence of at least one located entry, or the 50,000-entry ceiling. A consumer cannot read it as a sitemap.",
      "not-present":
        "No sitemap is published: the conventional path is not served and robots.txt declares no Sitemap record. The Sitemaps protocol is opt-in, so its absence is not a defect.",
      indeterminate:
        "The sitemap was not read: the retrieval failed, the status was outside the successful class, the body was cut at this scanner's size limit, or the parse stopped at one of this scanner's own bounds.",
    },
  ],
  [
    "sitemap.directive",
    {
      satisfied:
        "Either robots.txt declares no Sitemap record, in which case this obligation never arises, or the record it declares is an absolute URL that named a document this scan retrieved.",
      violated:
        "The Sitemap record in robots.txt is not an absolute URL, or the document it names could not be retrieved. Either way a consumer that starts discovery from robots.txt is left with nothing to fetch.",
      "not-present":
        "No sitemap is published at all: the conventional path is not served and robots.txt declares no Sitemap record, so there is no discovery directive to follow.",
      indeterminate:
        "Whether robots.txt declares a Sitemap record could not be established, or the document that record names was not retrieved to a readable state, so the discovery step was not completed.",
    },
  ],
  [
    "sitemap.canonical",
    {
      satisfied:
        "Every sitemap location is an absolute URL on this origin and under the protocol's length limit, and every last-modified value present is a W3C Datetime.",
      violated:
        "A sitemap entry carries a location that is relative, over the protocol's length limit, or on another origin, or a last-modified value that is not a W3C Datetime. Whether a timestamp is truthful is not observable and is not claimed here.",
      "not-present":
        "No sitemap is published, so there are no locations whose canonical form could be judged.",
      indeterminate:
        "The sitemap entries were not all read, so no statement about the form of the locations they carry would cover the whole document.",
    },
  ],
  [
    "links.parse",
    {
      satisfied:
        "Every Link field line parsed under the RFC 8288 grammar, including multiple field lines, commas between link-values, and quoted parameters.",
      violated:
        "A Link field line does not match the RFC 8288 grammar. A conforming parser stops at the syntax error, so the link-values after it are not read at all.",
      "not-present":
        "The page response carries no Link field. Web linking over HTTP is optional, so not using it is not a defect.",
      indeterminate:
        "The Link field was not parsed: the page retrieval failed, or the parse stopped at one of this scanner's own bounds. A bound of this scanner says nothing about the field.",
    },
  ],
  [
    "links.relation",
    {
      satisfied:
        "Every parsed link-value carries a rel parameter whose relation types are each a registered name or a URI, which are the two forms RFC 8288 defines.",
      violated:
        "A link-value carries no rel parameter, or a relation type that is neither a registered name nor a URI. RFC 8288 makes rel mandatory and fixes those two forms, so such a link states no relation at all.",
      "not-present":
        "The page response carries no Link field, so there are no relation types to interpret.",
      indeterminate:
        "The relation types could not be read, because the page retrieval failed, the parse stopped at one of this scanner's own bounds, or a syntax error ended it before the remaining link-values were reached.",
    },
  ],
  [
    "links.agent-useful",
    {
      satisfied:
        "At least one link-value whose context is this page advertises a discovery relation named by this project's separately versioned agent-useful relation policy.",
      violated:
        "No link-value whose context is this page advertises a discovery relation named by this project's separately versioned agent-useful relation policy. That policy is this project's own opinion about what is worth an agent's attention, not a requirement of any standard.",
      "not-present":
        "The page response carries no Link field, so there is nothing to classify against this project's agent-useful relation policy.",
      indeterminate:
        "The link-values could not be read far enough to classify them, because the page retrieval failed, the parse stopped at one of this scanner's own bounds, or a syntax error ended it early.",
    },
  ],
  [
    "markdown.media-type",
    {
      satisfied:
        "The request that accepted text/markdown returned a successful response labelled text/markdown, the media type RFC 7763 registers.",
      violated:
        "The request that accepted text/markdown did not return a successful response labelled text/markdown. A representation is what its Content-Type says it is, so Markdown bytes under another label are not a Markdown representation.",
      "not-present":
        "No Markdown representation was requested for this target, so there is no labelled response whose media type could be judged.",
      indeterminate:
        "The text/markdown request produced no response this scan could read, so the media type it would have carried is unknown.",
    },
  ],
  [
    "markdown.negotiation",
    {
      satisfied:
        "The request that accepted HTML was not answered with Markdown, so this origin served a representation the client actually asked for.",
      violated:
        "A request that accepted HTML was answered with a text/markdown representation. Serving Markdown to a client that did not ask for it is not content negotiation, and a client with no Markdown parser receives something it cannot render.",
      "not-present":
        "No HTML representation was requested, so there is no negotiated response to judge.",
      indeterminate:
        "The HTML request produced no response this scan could read, so which representation this origin selected for it is unknown.",
    },
  ],
  [
    "markdown.vary",
    {
      satisfied:
        "The Markdown response names Accept in Vary, so a shared cache cannot hand it to a request that asked for a different representation.",
      violated:
        "The Markdown response does not name Accept in Vary. Vary is the field that tells a cache which request headers selected this representation, so without it a cache may serve the Markdown to a client that asked for HTML.",
      "not-present":
        "No Markdown representation was requested, so there is no response whose Vary field could be read.",
      indeterminate:
        "The Markdown request produced no response this scan could read, so its Vary field is unknown.",
    },
  ],
  [
    "markdown.fidelity",
    {
      satisfied:
        "Neither gross-loss condition this bounded structural proxy tests fired: the Markdown carries a heading where the HTML has one, and it contains the HTML title text. This is not a check that the two representations say the same thing.",
      violated:
        "The Markdown representation drops structure the HTML carries: it has no heading at all where the HTML has one, or it does not contain the HTML title text. This is a bounded structural proxy, not a judgement about meaning.",
      "not-present":
        "Neither representation was requested, so there is nothing to compare.",
      indeterminate:
        "The two representations were not comparable: one was not retrieved successfully, was not labelled with the media type expected of it, was truncated, or was larger than this proxy reads. No fidelity comparison was made.",
    },
  ],
  [
    "ai-rules.rep-parse",
    {
      satisfied:
        "robots.txt decoded as UTF-8, so group selection and allow/disallow precedence for a named product token resolve from the octets this origin actually served.",
      violated:
        "robots.txt was not well-formed UTF-8. Product tokens and path patterns then match replacement characters instead of what was written, so no faithful RFC 9309 group selection exists for any crawler token.",
      "not-present":
        "The origin answered /robots.txt with a client-error status, so there is no document from which to resolve a group for any crawler token.",
      indeterminate:
        "The robots.txt was not read to the end, so group selection and precedence were never resolved. That is a limit of this scan, not a statement about the file.",
    },
  ],
  [
    "ai-rules.token-source",
    {
      satisfied:
        "The crawler token set behind this classification is this build's pinned dataset, which carries its own version, its verification date, and a source ledger identifier for every token.",
      violated:
        "The crawler token set behind this classification is not the pinned, cited dataset, so the classification rests on tokens with no recorded version and no recorded provenance.",
      "not-present":
        "No robots.txt is published at this origin, so no token was classified and no dataset is claimed beside a scan that observed nothing.",
      indeterminate:
        "The robots.txt was not read, so no token was classified and no dataset is claimed beside a scan that reached no verdict.",
    },
  ],
  [
    "ai-rules.effective-access",
    {
      satisfied:
        "Every configured crawler token may reach the configured tested path under RFC 9309 precedence, including the default decision where no group matches that token.",
      violated:
        "At least one configured crawler token is disallowed from the configured tested path under RFC 9309 precedence. The publisher is entitled to that policy; this says an agent using that token cannot reach the path, not that any specification was breached.",
      "not-present":
        "The origin answered /robots.txt with a client-error status, so no group exists and no effective access decision was computed.",
      indeterminate:
        "No effective access decision was computed: either the robots.txt was not read, or no crawler token is configured, and an empty set of decisions is reported as such rather than as a pass.",
    },
  ],
  [
    "content-signals.coverage",
    {
      satisfied:
        "The Content-Signal declaration is reported as written. Dimensions it omits are reported as omitted, and no unstated yes or no policy is inferred for them.",
      violated:
        "A Content-Signal declaration was reported with a policy inferred for a dimension it does not state. An omitted dimension carries no declared preference in either direction.",
      "not-present":
        "No Content-Signal declaration is published: either no robots.txt is served, or the one served carries no Content-Signal record. This is an optional mechanism that is not deployed.",
      indeterminate:
        "The Content-Signal declaration was not read, so no statement about which dimensions it covers would be complete.",
    },
  ],
  [
    "content-signals.effect",
    {
      satisfied:
        "Disclosure: a Content-Signal declaration is a preference this publisher stated. It is not consent, not a prohibition, and not evidence that any recipient read it or honoured it.",
      violated:
        "A Content-Signal declaration was described as consent, as a prohibition, or as verified recipient behaviour. It is a stated preference, and nothing observed here can establish what any recipient did with it.",
      "not-present":
        "No Content-Signal declaration is published, so there is no stated preference whose effect could be described.",
      indeterminate:
        "The Content-Signal declaration was not read, so there is no stated preference whose effect could be described.",
    },
  ],
  [
    "content-signals.conflicting-declaration",
    {
      satisfied:
        "No signal token is declared more than once with differing values inside one group, so every declared token has a single value.",
      violated:
        "The same signal token is declared more than once with differing values inside one group. The pinned source defines no conflict resolution, so the declaration is reported as unresolved and no winner is chosen. This is ambiguity, not a breach of any specification.",
      "not-present":
        "No Content-Signal declaration is published, so there is nothing that could conflict.",
      indeterminate:
        "The Content-Signal declaration was not read, so a token repeated with differing values could have gone unseen.",
    },
  ],
  [
    "content-signals.unrecognized-vocabulary",
    {
      satisfied:
        "The Content-Signal declaration uses only tokens the dated compatibility snapshot recognizes, of which it names {recognized-token-count}.",
      violated:
        "The Content-Signal declaration names a token outside the set the dated compatibility snapshot recognizes, or names none of that set at all; it names {recognized-token-count} recognized tokens. This is unrecognized by this project's pinned sources and is not a violation of any specification.",
      "not-present":
        "No Content-Signal declaration is published, so no vocabulary was read.",
      indeterminate:
        "The Content-Signal declaration was not read, so its vocabulary is unknown and an unrecognized token could have gone unseen.",
    },
  ],
  [
    "skills.path-schema",
    {
      satisfied:
        "The skills index is served at the v0.2.0 well-known path and is a JSON object carrying the schema identifier and document shape that version defines.",
      violated:
        "The v0.2.0 skills index is not served in the form the pinned draft defines: the document is not valid JSON, is not an object, or does not carry the v0.2.0 schema identifier and shape. Serving only the pre-v0.2 path is the same outcome, because a v0.2 consumer does not look there.",
      "not-present":
        "Neither the v0.2.0 skills index path nor the pre-v0.2 path is served, so this optional discovery mechanism is not deployed.",
      indeterminate:
        "The skills index was not read: the retrieval failed, the status was outside the successful class, the body was truncated, or it was larger than this scan reads.",
    },
  ],
  [
    "skills.entry",
    {
      satisfied:
        "Every entry in the skills index carries a name, an allowed type, a description, a URL and a digest in the syntax v0.2.0 requires of each.",
      violated:
        "An entry in the skills index omits a field v0.2.0 requires, or carries one whose value is outside the syntax that version defines for it. A consumer validating the index against the draft rejects it.",
      "not-present":
        "No skills index is served, so there are no entries to validate.",
      indeterminate:
        "The entries were not validated, because the index itself could not be read as a v0.2.0 document.",
    },
  ],
  [
    "skills.digest",
    {
      satisfied:
        "Every declared digest is a lowercase hexadecimal SHA-256 value of the length v0.2.0 requires. This scan fetched no artifact, so no digest was compared against bytes.",
      violated:
        "A declared digest is not a lowercase hexadecimal SHA-256 value of the length v0.2.0 requires, so it could not match any artifact even if one were fetched.",
      "not-present":
        "No skills index is served, so there are no declared digests.",
      indeterminate:
        "The declared digests were not read, because the index itself could not be read as a v0.2.0 document.",
    },
  ],
  [
    "api-catalog.discovery",
    {
      satisfied:
        "The well-known API catalog resource RFC 9727 defines was served successfully with the application/linkset+json media type.",
      violated:
        "The well-known API catalog resource was served, but not with the application/linkset+json media type RFC 9727 requires, so a consumer following the RFC will not read it as a catalog.",
      "not-present":
        "No API catalog is served at the well-known resource RFC 9727 defines. The mechanism is opt-in and its absence is not a defect.",
      indeterminate:
        "The well-known API catalog resource produced no representation this scan could read: the retrieval failed, the status was outside the successful class, or the body was cut at this scanner's size limit.",
    },
  ],
  [
    "api-catalog.linkset",
    {
      satisfied:
        "The catalog document parses as an RFC 9264 linkset: a JSON object with a linkset array whose members each carry an anchor and well-formed link context objects.",
      violated:
        "The catalog document is not a valid RFC 9264 linkset: it is not JSON, not an object, carries no linkset array, or a member is missing its anchor or carries a malformed link context object.",
      "not-present":
        "No API catalog is served, so there is no linkset document to validate.",
      indeterminate:
        "The linkset syntax was not judged, because the catalog document was not retrieved as a readable application/linkset+json representation.",
    },
  ],
  [
    "api-catalog.relations",
    {
      satisfied:
        "The linkset carries at least one link to an API endpoint under a relation RFC 9727 uses for that purpose.",
      violated:
        "The linkset carries no link to an API endpoint: it is empty, or every member uses a relation that names something other than an API. RFC 9727 requires the catalog to include hyperlinks to API endpoints, so a catalog without one discovers nothing.",
      "not-present":
        "No API catalog is served, so there are no relations to require.",
      indeterminate:
        "The relations were not judged, because the catalog document could not be read as a valid linkset.",
    },
  ],
  [
    "api-catalog.profile",
    {
      satisfied:
        "The catalog response declares the RFC 9727 profile URI in the profile parameter of its media type.",
      violated:
        "The catalog response does not declare the RFC 9727 profile URI in the profile parameter of its media type, so a consumer cannot tell from the media type alone that this linkset is an API catalog.",
      "not-present":
        "No API catalog is served, so there is no media type whose profile parameter could be read.",
      indeterminate:
        "The profile parameter was not read, because the catalog document was not retrieved as a readable representation.",
    },
  ],
]);

export const PINNED_REMEDIATION: RemediationTable = new Map<
  string,
  FindingRemediation
>([
  [
    "robots.location",
    {
      class: "required-correction",
      summary:
        "Publish the rules at the lowercase path /robots.txt on this exact origin and return them as a successful response body, which is the one place RFC 9309 tells a crawler to look.",
    },
  ],
  [
    "robots.syntax",
    {
      class: "required-correction",
      summary:
        "Serve robots.txt as UTF-8 and write each rule as an RFC 9309 record: a user-agent line opens a group, and the allow and disallow lines that follow belong to the group above them.",
    },
  ],
  [
    "robots.not-authz",
    {
      class: "recommended-hardening",
      summary:
        "Protect anything confidential at the resource itself, not with a Disallow line. RFC 9309 states a preference to cooperating crawlers, and the paths a robots.txt names are published to every reader.",
    },
  ],
  [
    "sitemap.xml",
    {
      class: "required-correction",
      summary:
        "Serve the sitemap as UTF-8 XML rooted in urlset or sitemapindex in the Sitemaps 0.9 namespace, keep every loc inside the sitemap's own directory, and split it before the protocol's per-file limits.",
    },
  ],
  [
    "sitemap.directive",
    {
      class: "required-correction",
      summary:
        "Give every Sitemap record in robots.txt a complete absolute URL, and make that URL serve the sitemap. The record is the only pointer a crawler following this route has.",
    },
  ],
  [
    "sitemap.canonical",
    {
      class: "recommended-hardening",
      summary:
        "List each page once, under the absolute canonical URL you want fetched, and set lastmod only when it reflects a real change to that page. Otherwise omit lastmod.",
    },
  ],
  [
    "links.parse",
    {
      class: "required-correction",
      summary:
        "Emit Link fields in RFC 8288 syntax: the target URI inside angle brackets, each parameter after a semicolon, values quoted where the grammar requires it, and multiple links separated by commas.",
    },
  ],
  [
    "links.relation",
    {
      class: "required-correction",
      summary:
        "Set rel to a registered relation name exactly, or to an absolute URI for a relation that is not registered. A near miss such as service-description is a different token with no registered meaning.",
    },
  ],
  [
    "links.agent-useful",
    {
      class: "recommended-hardening",
      summary:
        "No link here carries a relation this project's own policy 0.1.0 counts as agent-useful: service-desc, describedby, or api-catalog. That policy is our opinion and no specification requires any of them.",
    },
  ],
  [
    "markdown.media-type",
    {
      class: "required-correction",
      summary:
        "Label the Markdown representation Content-Type: text/markdown, the media type RFC 7763 registers. text/plain, text/x-markdown and application/octet-stream each tell a client something different.",
    },
  ],
  [
    "markdown.negotiation",
    {
      class: "required-correction",
      summary:
        "Select the representation from the request's Accept header, and keep both representations the same resource. A request that accepts only HTML must receive HTML, whatever else the origin can produce.",
    },
  ],
  [
    "markdown.vary",
    {
      class: "recommended-hardening",
      summary:
        "Add Accept to the Vary header on every response whose body was selected by it, including both representations, so a shared cache stores them separately instead of reusing one for the other.",
    },
  ],
  [
    "markdown.fidelity",
    {
      class: "recommended-hardening",
      summary:
        "The Markdown and HTML representations differ in content this check looked at. RFC 9110 defines no fidelity criterion, so treat this as a report of the difference and decide yourself whether it matters.",
    },
  ],
  [
    "ai-rules.rep-parse",
    {
      class: "required-correction",
      summary:
        "Put each crawler's rules in a group opened by a user-agent line naming that product token, and let RFC 9309 group selection and most-specific match decide the result rather than line order.",
    },
  ],
  [
    "ai-rules.token-source",
    {
      class: "recommended-hardening",
      summary:
        "The crawler tokens this project recognises come from three vendor documentation pages read on a date, not from a specification. Check the vendor's current page for the exact token before relying on it.",
    },
  ],
  [
    "ai-rules.effective-access",
    {
      class: "recommended-hardening",
      summary:
        "The rules as published resolve to a disallow for this token at the tested path. If that is deliberate, nothing needs fixing; if not, the edit is in that token's own group.",
    },
  ],
  [
    "content-signals.coverage",
    {
      class: "recommended-hardening",
      summary:
        "Name all three of the draft's usage categories, search, ai-input and ai-train, or accept that an omitted one states nothing. This report will never read an absent category as a yes or a no.",
    },
  ],
  [
    "content-signals.effect",
    {
      class: "recommended-hardening",
      summary:
        "A Content Signals declaration records a preference. It is not consent, not a prohibition, and not evidence that any recipient honoured it, so do not rely on it as the control over how content is used.",
    },
  ],
  [
    "content-signals.conflicting-declaration",
    {
      class: "recommended-hardening",
      summary:
        "The same signal category is declared twice with different values in one group, and no pinned source says which wins. Remove the duplicate so the category is stated once with the value you intend.",
    },
  ],
  [
    "content-signals.unrecognized-vocabulary",
    {
      class: "recommended-hardening",
      summary:
        "This declaration names a token outside the three the pinned draft defines. If it was a spelling of search, ai-input or ai-train, correct it; otherwise nothing here reads it and nothing is wrong with your file.",
    },
  ],
  [
    "skills.path-schema",
    {
      class: "required-correction",
      summary:
        "Serve the index at /.well-known/agent-skills/index.json with the exact v0.2.0 $schema identifier and a skills array. An absent $schema is read as v0.1.0 and an unrecognised one stops a client entirely.",
    },
  ],
  [
    "skills.entry",
    {
      class: "required-correction",
      summary:
        "Give every skills entry all five required fields: a lowercase hyphenated name of 1 to 64 characters, a type of skill-md or archive, a description, a url, and a digest of sha256: plus 64 lowercase hex.",
    },
  ],
  [
    "skills.digest",
    {
      class: "required-correction",
      summary:
        "Recompute the declared digest over the artifact's raw bytes whenever the artifact changes, and publish it as sha256: plus 64 lowercase hex. A stale digest makes the skill unusable to a client that checks.",
    },
  ],
  [
    "api-catalog.discovery",
    {
      class: "required-correction",
      summary:
        "Publish the catalog at /.well-known/api-catalog, or advertise wherever it lives with a Link whose rel is api-catalog. RFC 9727 defines both routes and a consumer needs one of them.",
    },
  ],
  [
    "api-catalog.linkset",
    {
      class: "required-correction",
      summary:
        "Serve the catalog as application/linkset+json: an object with a linkset array whose members each carry an anchor and their links by relation type. An HTML page or a bare array is not a linkset.",
    },
  ],
  [
    "api-catalog.relations",
    {
      class: "required-correction",
      summary:
        "Put at least one real API in the catalog, linked with the relation types RFC 9727 section 4.1 specifies. A syntactically valid linkset whose array is empty or unrelated is a catalog of nothing.",
    },
  ],
  [
    "api-catalog.profile",
    {
      class: "recommended-hardening",
      summary:
        "Advertise the profile RFC 9727 defines for an API catalog, so a consumer can tell a catalog from any other linkset before parsing it. Take the profile URI from the RFC itself.",
    },
  ],
]);

/** `profile.version` in the canonical report, per profile id. */
export const PINNED_PROFILE_VERSIONS: Readonly<Record<ProfileId, string>> = {
  content: "0.4.0",
  api: "0.4.0",
  "agent-service": "0.4.0",
  commerce: "0.4.0",
  full: "0.4.0",
};
