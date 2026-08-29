import type {
  AssertionOutcome,
  AssertionOutcomes,
  ObservationRequest,
  OutcomeKind,
  RoundContext,
  RuleDefinition,
} from "@agentready-lab/core";

import type { AiCrawlerTokenDataset } from "../data/ai-crawler-tokens.v0.js";
import {
  AI_CRAWLER_TOKENS_V0,
  AI_CRAWLER_TOKEN_NAMES_V0,
  isCitedTokenDataset,
} from "../data/ai-crawler-tokens.v0.js";
import type { ParsedRobots, RobotsRule } from "../parsers/robots.js";
import {
  PARSED_ROBOTS_MEMO_KEY,
  parseRobots,
  robotsObservationRequest,
} from "../parsers/robots.js";

/**
 * `web.policy.ai-crawler`. Registry ordinal 6 (`specs/checks.v0.yaml`).
 *
 * Every metadata value is read from `specs/ruleset.standard.v0.yaml` at
 * `ruleset_version` 0.4.0 and `specs/sources.v0.yaml` at
 * `source_ledger_version` 0.4.0, under the ADR-0002 section 10 mapping.
 * `test/registry.test.ts` re-reads both files and compares, so a value edited
 * here without the spec is a test failure rather than a silent divergence.
 * `implementationStatus` stays `planned` for that reason: the ruleset is the
 * authority for it and this change does not edit `specs/`.
 *
 * WHAT THIS RULE REPORTS, AND WHAT IT REFUSES TO REPORT. It reads the one
 * shared `/robots.txt` observation, resolves the RFC 9309 group for each
 * configured product token, and computes the effective access decision for the
 * configured tested path **without fetching that path** -- which is the
 * ruleset's own `interop` caveat, "do not test blocked paths merely to verify
 * that a crawler would be blocked". What it computes is what the publisher
 * declared. No observation of a `robots.txt` can show that a crawler read it,
 * honoured it, or exists, so nothing below ever says a crawler complies with a
 * policy, and an allowed decision is a declaration and not a permission.
 *
 * WHAT EACH ASSERTION MEANS.
 *
 * - `ai-rules.rep-parse` (normative, RFC 9309). Group selection and
 *   allow/disallow precedence have to be resolved from the document as the RFC
 *   defines them. That is possible only over the octets the publisher actually
 *   served: RFC 9309 section 2.3 makes UTF-8 encoding a publisher MUST, and
 *   `parseRobots` reports `invalidUtf8` when the bytes were not well-formed
 *   and were decoded through U+FFFD. Product tokens and path patterns are then
 *   matched against replacement characters rather than against what was
 *   written, so no faithful selection exists and this is `violated`. A merely
 *   *malformed line* is not: section 2.3.1.5 asks crawlers to parse each line
 *   and to be tolerant, so skipping it and selecting over the rest is what the
 *   RFC prescribes. That condition belongs to `robots.syntax`, and this rule
 *   does not re-litigate it.
 * - `ai-rules.token-source` (advisory, three vendor sources). The obligation
 *   is on this project and not on the target: version and cite the token set
 *   used for classification. `isCitedTokenDataset` is the whole test, and
 *   `src/data/ai-crawler-tokens.v0.ts` carries the version, the verification
 *   date and a ledger source id per token. Nothing a target serves can change
 *   it, which is why it is advisory.
 * - `ai-rules.effective-access` (recommended, RFC 9309). The effective
 *   decision for every configured token at the configured path, including
 *   section 2.2.2's default when no group matches. A disallowed decision is
 *   `violated`, which the core derives to `warning` because the ruleset pins
 *   the class at `recommended`. It can never be `fail`, and that is not a
 *   softening: RFC 9309 requires nobody to publish an AI-specific group and
 *   nothing in it makes `Disallow` a protocol violation. The publisher chose
 *   a policy; the finding says an agent cannot reach the path under it.
 *
 * NO PARAMETERS, SO THE SHAPE CARRIES THE DECISION. The ruleset declares
 * `params: []` for all three and authorizes no excerpt, so
 * `validateOutcomeParams` rejects anything this rule tried to attach and the
 * decision has to be expressed as an outcome kind. `web.discovery.robots`
 * emits the same empty `params` for the same reason. The consequence is
 * visible in `docs/FIXTURE_CATALOG.md` section 9: cases `bot-003` and
 * `bot-006` ask for the source group and the default decision to be
 * "recorded", and no report field can hold them today. `effectiveAccess`
 * returns both, and the unit tests assert them; the report carries the
 * verdict alone. The configuration that produced the verdict is recoverable
 * from `effectiveOptions`, which ADR-0004 section 8 requires for this rule by
 * name.
 *
 * `roundTwoBudget` stays 0. Every decision comes from the round-one
 * `/robots.txt` body, and the tested path is deliberately never requested.
 */

/** Rule-local, and never an evidence id (ADR-0002 section 8). */
const OBSERVATION_ID = "robots";

const REP_PARSE = "ai-rules.rep-parse";
const TOKEN_SOURCE = "ai-rules.token-source";
const EFFECTIVE_ACCESS = "ai-rules.effective-access";

/** RFC 9309 section 2.2.1's catch-all product token. */
export const WILDCARD_AGENT = "*";

/** ADR-0004 section 8: the configured crawler tokens and the tested path. */
export interface AiCrawlerOptions {
  readonly crawlerTokens: readonly string[];
  readonly testedPath: string;
}

const DEFAULT_TESTED_PATH = "/";

export type AccessDecision = "allowed" | "disallowed";

export interface GroupSelection {
  /**
   * The product token whose group decided the outcome: the lowercased
   * configured token, `*`, or `null` when RFC 9309 section 2.2.1 selected no
   * group at all.
   */
  readonly agent: string | null;
  /** Every rule of every group naming `agent`, merged in document order. */
  readonly rules: readonly RobotsRule[];
}

export interface EffectiveAccess {
  /** The configured token, in the spelling it was configured with. */
  readonly token: string;
  readonly decision: AccessDecision;
  readonly agent: string | null;
  /** The rule that decided it, or `null` for section 2.2.2's default. */
  readonly rule: RobotsRule | null;
}

/**
 * Every rule of every group naming `agent`, or `null` if no group names it.
 *
 * RFC 9309 section 2.2.1 requires the matching groups' rules to be "combined
 * into one group", so a document repeating a product token contributes all of
 * its rules and not only the first group's. `docs/FIXTURE_CATALOG.md` case
 * `bot-005` is that case, and its stated purpose is to "prevent first-group-
 * only parsing".
 *
 * The `null` return distinguishes *no group matched* from *a matching group
 * with no rules*, which section 2.2.2 treats identically at the end (both
 * allow) but which section 2.2.1 does not: a matching empty group stops the
 * fall-through to `*`, and an unmatched token does not.
 */
function mergedRulesFor(
  parsed: ParsedRobots,
  agent: string,
): readonly RobotsRule[] | null {
  let matched = false;
  const rules: RobotsRule[] = [];
  for (const group of parsed.groups) {
    // `groups[].agents` is already lowercased by the parser, which is where
    // section 2.2.1's case-insensitive matching is discharged.
    if (!group.agents.includes(agent)) continue;
    matched = true;
    rules.push(...group.rules);
  }
  return matched ? rules : null;
}

/**
 * RFC 9309 section 2.2.1 group selection for one product token.
 *
 * The specific group wins, and the `*` group applies only when no specific
 * group exists. Case `bot-004` is the inverse test: a wildcard `Disallow`
 * beside a specific `Allow` resolves to allowed, so a wildcard that could
 * outrank a specific group would be caught here rather than in a verdict.
 */
export function selectGroup(
  parsed: ParsedRobots,
  productToken: string,
): GroupSelection {
  const wanted = productToken.toLowerCase();
  const specific = mergedRulesFor(parsed, wanted);
  if (specific !== null) return { agent: wanted, rules: specific };
  const wildcard = mergedRulesFor(parsed, WILDCARD_AGENT);
  if (wildcard !== null) return { agent: WILDCARD_AGENT, rules: wildcard };
  return { agent: null, rules: [] };
}

/**
 * RFC 9309 section 2.2.3 path matching: `*` is any run of characters and a
 * trailing `$` anchors the end of the path.
 *
 * A pattern matches a **prefix** of the path unless `$` ends it, so `/a`
 * matches `/about`. `$` is special only as the last character of the pattern
 * and is an ordinary character anywhere else, which is what section 2.2.3's
 * "designates the end of the match pattern" means and what the reference
 * implementations do.
 *
 * Deliberately not a regular expression. `docs/THREAT_MODEL.md` requires any
 * regex over hostile text to be reviewed for pathological backtracking, and a
 * pattern translated to a regex is target-controlled regex source. Segment
 * scanning has no backtracking to be pathological about: leftmost matching of
 * the segments between wildcards is optimal, so one linear pass decides it.
 */
export function pathPatternMatches(pattern: string, path: string): boolean {
  // RFC 9309 section 2.2's ABNF keeps `empty-pattern = *WS` separate from
  // `path-pattern = "/" *UTF8-char-noctl` and gives the empty one no matching
  // semantics. Reading it as a zero-length prefix would make a bare
  // `Disallow:` block the entire site, inverting its universally deployed
  // meaning, so it matches nothing and section 2.2.2's default decides.
  if (pattern.length === 0) return false;

  const anchored = pattern.endsWith("$");
  const segments = (anchored ? pattern.slice(0, -1) : pattern).split("*");
  const first = segments[0] ?? "";
  if (!path.startsWith(first)) return false;

  let at = first.length;
  const last = segments.length - 1;
  for (let index = 1; index <= last; index += 1) {
    const segment = segments[index] ?? "";
    if (index === last && anchored) {
      // The final segment has to land at the end, not merely somewhere after
      // the previous one, so this searches from the right.
      return path.length - segment.length >= at && path.endsWith(segment);
    }
    const found = path.indexOf(segment, at);
    if (found === -1) return false;
    at = found + segment.length;
  }
  return anchored ? at === path.length : true;
}

/**
 * The octet length of a pattern, for RFC 9309 section 2.2.2's "most octets".
 *
 * Octets and not UTF-16 code units: section 2.2 admits any `UTF8-char-noctl`
 * in a path pattern, and two patterns can tie on `String.length` while
 * differing in octets. `*` and `$` are counted, as they are in the reference
 * implementations.
 */
export function patternOctets(pattern: string): number {
  let octets = 0;
  for (const character of pattern) {
    const point = character.codePointAt(0) ?? 0;
    octets += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return octets;
}

/**
 * RFC 9309 section 2.2.2 precedence over one product token's merged group.
 *
 * "The most specific match is the match that has the most octets", and where
 * an `allow` and a `disallow` are equivalent the `allow` is the one to use.
 * When nothing matches, or the group has no rules, the path is allowed; that
 * default is also what an unmatched product token gets, which is case
 * `bot-006`.
 */
export function effectiveAccess(
  parsed: ParsedRobots,
  productToken: string,
  path: string,
): EffectiveAccess {
  const selection = selectGroup(parsed, productToken);
  let best: RobotsRule | null = null;
  let bestOctets = -1;

  for (const rule of selection.rules) {
    if (!pathPatternMatches(rule.path, path)) continue;
    const octets = patternOctets(rule.path);
    if (octets > bestOctets) {
      best = rule;
      bestOctets = octets;
      continue;
    }
    if (octets === bestOctets && rule.type === "allow") {
      best = rule;
    }
  }

  return {
    token: productToken,
    decision:
      best !== null && best.type === "disallow" ? "disallowed" : "allowed",
    agent: selection.agent,
    rule: best,
  };
}

function outcome(assertion: string, kind: OutcomeKind): AssertionOutcome {
  return { assertion, kind, params: {}, observationRefs: [OBSERVATION_ID] };
}

/**
 * Every assertion at once, for the whole-retrieval verdicts.
 *
 * `ai-rules.token-source` goes with them although the dataset is this
 * project's and is unaffected by what the target served. It cannot be omitted
 * -- `validateRuleOutcomes` requires exactly one outcome per declared
 * assertion -- and it cannot pass beside the others, because `not-present` may
 * not sit next to an evaluated outcome and an advisory green beside a scan
 * that observed nothing would read as a partial success. This is the same
 * suppression `robots.not-authz` makes for the same reason.
 */
function uniform(kind: OutcomeKind): AssertionOutcomes {
  return {
    kind: "outcomes",
    outcomes: [
      outcome(REP_PARSE, kind),
      outcome(TOKEN_SOURCE, kind),
      outcome(EFFECTIVE_ACCESS, kind),
    ],
  };
}

function isStringList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown) => typeof item === "string")
  );
}

/**
 * The effective options, narrowed from the untyped bag.
 *
 * ADR-0004 section 8 gives each rule "a JSON Schema for its options, published
 * beside the rule and validated before any transport call", and no such
 * validation exists yet: `resolveRuleOptions` checks key names only. A bare
 * string under `crawlerTokens` is the shape that survives
 * `projectEffectiveOptions` and would still be wrong here, so anything that is
 * not a list of strings falls back to the pinned dataset.
 */
function crawlerTokensOf(options: unknown): readonly string[] {
  if (typeof options !== "object" || options === null) {
    return AI_CRAWLER_TOKEN_NAMES_V0;
  }
  if (!("crawlerTokens" in options)) return AI_CRAWLER_TOKEN_NAMES_V0;
  const configured: unknown = options.crawlerTokens;
  return isStringList(configured) ? configured : AI_CRAWLER_TOKEN_NAMES_V0;
}

/**
 * The tested path, which must be a path and not a URL.
 *
 * A value that does not start with `/` cannot be what RFC 9309 section 2.2.2
 * compares a pattern against, and resolving one into a path would be this rule
 * doing URL work it has no `URL` for, so it falls back to the origin root.
 */
function testedPathOf(options: unknown): string {
  if (typeof options !== "object" || options === null) {
    return DEFAULT_TESTED_PATH;
  }
  if (!("testedPath" in options)) return DEFAULT_TESTED_PATH;
  const configured: unknown = options.testedPath;
  return typeof configured === "string" && configured.startsWith("/")
    ? configured
    : DEFAULT_TESTED_PATH;
}

/**
 * The one outcome kind for `ai-rules.effective-access` over every token.
 *
 * The assertion is about agent reachability, so any configured token that
 * cannot reach the path is the finding. A configuration with no tokens
 * computes no decision at all and reports `indeterminate` rather than an
 * empty-set pass.
 */
function accessOutcome(decisions: readonly EffectiveAccess[]): OutcomeKind {
  if (decisions.length === 0) return "indeterminate";
  return decisions.every((entry) => entry.decision === "allowed")
    ? "satisfied"
    : "violated";
}

function evaluate(context: RoundContext<unknown>): AssertionOutcomes {
  const observation = context.observation(OBSERVATION_ID);
  if (observation.kind !== "http" || observation.outcome.kind === "error") {
    return uniform("indeterminate");
  }

  // RFC 9309 section 2.3.1, read exactly as `web.discovery.robots` reads it:
  // 4xx is section 2.3.1.3 "unavailable" and the mechanism is absent; 5xx is
  // section 2.3.1.4 "unreachable", which leaves the file undefined rather than
  // absent; a truncated body is our own budget and never the publisher's
  // fault.
  const response = observation.outcome;
  if (response.status >= 400 && response.status <= 499) {
    return uniform("not-present");
  }
  if (response.status < 200 || response.status > 299 || response.truncated) {
    return uniform("indeterminate");
  }

  // The shared parse of ADR-0002 section 11 and `docs/ARCHITECTURE.md`
  // section 7. `plan()` issues the request `web.discovery.robots` issues, so
  // the engine dispatches one `/robots.txt` for both rules, and this loader
  // runs for whichever of them the engine reaches first.
  const parsed = context.memo<ParsedRobots>(PARSED_ROBOTS_MEMO_KEY, () =>
    parseRobots(response.body),
  );
  if (parsed.refusedBy !== null) {
    // RFC 9309 section 2.5 makes the parsing limit the crawler's own, so a
    // refusal says nothing about the publisher and is never `violated`.
    return uniform("indeterminate");
  }

  const dataset: AiCrawlerTokenDataset = AI_CRAWLER_TOKENS_V0;
  const path = testedPathOf(context.options);
  const decisions = crawlerTokensOf(context.options).map((token) =>
    effectiveAccess(parsed, token, path),
  );

  return {
    kind: "outcomes",
    outcomes: [
      outcome(REP_PARSE, parsed.invalidUtf8 ? "violated" : "satisfied"),
      outcome(
        TOKEN_SOURCE,
        isCitedTokenDataset(dataset) ? "satisfied" : "violated",
      ),
      outcome(EFFECTIVE_ACCESS, accessOutcome(decisions)),
    ],
  };
}

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
  defaultOptions: {
    crawlerTokens: AI_CRAWLER_TOKEN_NAMES_V0,
    testedPath: DEFAULT_TESTED_PATH,
  } satisfies AiCrawlerOptions,
  /**
   * The shared `/robots.txt` observation, and nothing else.
   *
   * `robotsObservationRequest` rather than a request literal of this rule's
   * own: ADR-0005 section 3 keys deduplication on the method, URL, `Accept`,
   * redirect policy and byte caps, so a literal that drifted by one field
   * would be a second fetch of the same file instead of the one observation
   * four rules share.
   */
  plan(): readonly ObservationRequest[] {
    return [robotsObservationRequest(OBSERVATION_ID)];
  },
  /**
   * One round is enough, so `finish()` is never reached by `runScan`. It
   * evaluates the same way rather than throwing, because a `finish` that could
   * only be wrong is worse than one that is simply the same answer.
   */
  step(context: RoundContext<unknown>): AssertionOutcomes {
    return evaluate(context);
  },
  finish(context: RoundContext<unknown>): AssertionOutcomes {
    return evaluate(context);
  },
};
