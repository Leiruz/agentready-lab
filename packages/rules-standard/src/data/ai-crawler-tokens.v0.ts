/**
 * The pinned AI crawler product-token dataset, version 0.
 *
 * WHY THIS IS A FILE AND NOT A LIST IN THE RULE. RFC 9309 defines no AI
 * crawler class and no registry of product tokens, so the set below is not
 * derivable from the pinned normative source. It is a dated observation of
 * three vendor documentation pages, which `.claude/rules/standards.md` ranks
 * as a snapshot-dated compatibility source and not as normative evidence.
 * `ai-rules.token-source` is advisory for exactly that reason, and its
 * obligation is on this project rather than on a target: version the set, date
 * it, and say which source each token came from.
 *
 * EVERY TOKEN IS CITED, NONE IS RECALLED. `.claude/rules/standards.md` puts
 * model memory outside the source hierarchy, so each entry names the
 * `specs/sources.v0.yaml` ledger id whose `notes` record the token being read
 * from the vendor page on `verifiedAt`. A token nobody can trace to a ledger
 * entry does not belong here, whatever a crawler list elsewhere says.
 *
 * `Claude-Web` IS DELIBERATELY ABSENT. `specs/checks.v0.yaml` names it among
 * its example AI crawler tokens, and that file is the frozen 2026-08-28
 * external snapshot rather than a vendor source. The `anthropic-crawlers`
 * ledger entry records the discrepancy directly: read on 2026-08-29, the
 * vendor article documents `ClaudeBot`, `Claude-User` and `Claude-SearchBot`
 * and does not list `Claude-Web`, and "whoever implements web.policy.ai-
 * crawler must not treat Claude-Web as a currently vendor-documented token on
 * the snapshot's authority". Adding it would be this project asserting a
 * vendor convention no vendor page currently states.
 *
 * CHANGING THE SET IS A VERSION CHANGE. A new token, a removed token or a
 * re-verification is a new `verifiedAt`, a new `version`, a `rule_version`
 * bump on `web.policy.ai-crawler` and updated fixtures. It is not an in-place
 * edit, because the effective access decision a report records depends on it.
 */

/** One product token, and the ledger entry that is the evidence for it. */
export interface AiCrawlerToken {
  /** The vendor's own spelling. RFC 9309 section 2.2.1 matching is case-insensitive. */
  readonly token: string;
  /** A `specs/sources.v0.yaml` id, which is the only provenance that counts. */
  readonly sourceId: string;
}

export interface AiCrawlerTokenDataset {
  readonly version: string;
  /** The date every entry below was read from its vendor source. */
  readonly verifiedAt: string;
  readonly tokens: readonly AiCrawlerToken[];
}

/**
 * The dataset itself.
 *
 * OpenAI documents a fourth token, `OAI-AdsBot`, and Google documents further
 * product tokens that are not AI-usage controls. The ledger records both facts
 * and records that no accepted decision asks this project to recognize them,
 * so they are observed and not included.
 */
export const AI_CRAWLER_TOKENS_V0: AiCrawlerTokenDataset = {
  version: "0.1.0",
  verifiedAt: "2026-08-29",
  tokens: [
    { token: "GPTBot", sourceId: "openai-crawlers" },
    { token: "OAI-SearchBot", sourceId: "openai-crawlers" },
    { token: "ChatGPT-User", sourceId: "openai-crawlers" },
    { token: "Google-Extended", sourceId: "google-crawlers" },
    { token: "ClaudeBot", sourceId: "anthropic-crawlers" },
    { token: "Claude-SearchBot", sourceId: "anthropic-crawlers" },
    { token: "Claude-User", sourceId: "anthropic-crawlers" },
  ],
};

/** The token spellings alone, for `defaultOptions.crawlerTokens`. */
export const AI_CRAWLER_TOKEN_NAMES_V0: readonly string[] =
  AI_CRAWLER_TOKENS_V0.tokens.map((entry) => entry.token);

/**
 * Whether the dataset is versioned, dated and cited, which is the whole of
 * what `ai-rules.token-source` asserts.
 *
 * It is computed rather than assumed. A hard-coded `satisfied` for an
 * assertion the ruleset declares would be a verdict nothing computed, and this
 * predicate is what an edit that dropped the version, emptied the list or left
 * a token with no ledger id would trip.
 */
export function isCitedTokenDataset(dataset: AiCrawlerTokenDataset): boolean {
  return (
    dataset.version.length > 0 &&
    dataset.verifiedAt.length > 0 &&
    dataset.tokens.length > 0 &&
    dataset.tokens.every(
      (entry) => entry.token.length > 0 && entry.sourceId.length > 0,
    )
  );
}
