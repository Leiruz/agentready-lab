/**
 * Identifiers this manifest is allowed to name.
 *
 * PROVENANCE. This is a hand transcription of `specs/ruleset.standard.v0.yaml`
 * at `ruleset_id: "standard"`, `ruleset_version: "0.2.0"`, limited to the eight
 * M1 rules that `docs/FIXTURE_CATALOG.md` sections 5 to 12 name. It is
 * transcribed rather than imported because `apps/fixtures-worker` declares no
 * dependencies (docs/ARCHITECTURE.md section 4) and therefore has no YAML
 * parser and no filesystem. A cross-check that this table still matches the
 * ruleset belongs in a package that may read files; it does not exist yet.
 *
 * `docs/decisions/0009-content-signals-source-pinning.md` section 3 retires
 * `content-signals.syntax`, so it is absent here and naming it is a validation
 * error, not an unknown id.
 */

/** `docs/IMPLEMENTATION_SPEC.md` and CLAUDE.md, "Modes and statuses". */
export const MODES = ["spec", "compat", "interop"] as const;
export type Mode = (typeof MODES)[number];

/** CLAUDE.md, "Modes and statuses". */
export const STATUSES = [
  "pass",
  "fail",
  "warning",
  "not-applicable",
  "unable-to-check",
  "unsupported-runtime",
] as const;
export type Status = (typeof STATUSES)[number];

/** `specs/ruleset.schema.json`, `profiles`. */
export const PROFILES = [
  "content",
  "api",
  "agent-service",
  "commerce",
  "full",
] as const;
export type Profile = (typeof PROFILES)[number];

/**
 * The eight M1 rules and their `spec.requirements[].id` values, which
 * `docs/decisions/0002-rule-execution-model.md` section 9 makes the
 * `spec`-mode assertion ids and `docs/decisions/0007-report-self-containment.md`
 * section 4 makes the finding codes.
 *
 * Six are in the `content` profile. `web.discovery.api-catalog` is not, and
 * `agent.discovery.skills` is not; their fixtures select `api` and
 * `agent-service` respectively.
 */
export const M1_RULES = {
  "web.discovery.robots": {
    profiles: ["content", "api", "agent-service", "full"],
    assertions: ["robots.location", "robots.syntax", "robots.not-authz"],
  },
  "web.discovery.sitemap": {
    profiles: ["content", "api", "agent-service", "full"],
    assertions: ["sitemap.xml", "sitemap.directive", "sitemap.canonical"],
  },
  "web.discovery.link": {
    profiles: ["content", "api", "agent-service", "full"],
    assertions: ["links.parse", "links.relation", "links.agent-useful"],
  },
  "web.content.markdown-negotiation": {
    profiles: ["content", "api", "agent-service", "full"],
    assertions: [
      "markdown.media-type",
      "markdown.negotiation",
      "markdown.vary",
      "markdown.fidelity",
    ],
  },
  "web.policy.ai-crawler": {
    profiles: ["content", "api", "agent-service", "full"],
    assertions: [
      "ai-rules.rep-parse",
      "ai-rules.token-source",
      "ai-rules.effective-access",
    ],
  },
  "web.policy.content-signals": {
    profiles: ["content", "api", "agent-service", "full"],
    assertions: [
      "content-signals.coverage",
      "content-signals.effect",
      "content-signals.conflicting-declaration",
      "content-signals.unrecognized-vocabulary",
    ],
  },
  "web.discovery.api-catalog": {
    profiles: ["api", "agent-service", "full"],
    assertions: [
      "api-catalog.discovery",
      "api-catalog.linkset",
      "api-catalog.relations",
      "api-catalog.profile",
    ],
  },
  "agent.discovery.skills": {
    profiles: ["agent-service", "full"],
    assertions: [
      "skills.path-schema",
      "skills.entry",
      "skills.digest",
      "skills.archive-safety",
    ],
  },
} as const satisfies Readonly<
  Record<
    string,
    {
      readonly profiles: readonly Profile[];
      readonly assertions: readonly string[];
    }
  >
>;

export type RuleId = keyof typeof M1_RULES;

export const RULE_IDS = Object.keys(M1_RULES) as readonly RuleId[];

export function isRuleId(value: string): value is RuleId {
  return Object.prototype.hasOwnProperty.call(M1_RULES, value);
}

export function assertionIdsFor(rule: RuleId): readonly string[] {
  return M1_RULES[rule].assertions;
}

export function profilesFor(rule: RuleId): readonly Profile[] {
  return M1_RULES[rule].profiles;
}

/** The ruleset version this manifest's expectations are pinned to. */
export const RULESET_ID = "standard";
export const RULESET_VERSION = "0.2.0";

/** `docs/FIXTURE_CATALOG.md` front matter, "Snapshot date". */
export const CATALOG_SNAPSHOT = "2026-08-28";
