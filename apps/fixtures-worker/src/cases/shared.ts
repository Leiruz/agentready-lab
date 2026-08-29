/** Constructors shared by the case files. Data only. */
import type { ChangedAssertion, FixtureTodo } from "../manifest.js";
import type { Mode, RuleId, Status } from "../ruleset-ids.js";

/**
 * Almost every case carries this. `specs/ruleset.standard.v0.yaml` declares
 * every assertion's `source_refs` and `params` empty with a `todo`, no
 * message-template table exists, and `docs/FIXTURE_CATALOG.md` names an
 * assertion id for only six of the 49 cases. Choosing one for the rest would
 * be an implementer deciding what an accepted decision has not.
 */
export const ASSERTIONS_UNASSIGNED: FixtureTodo = {
  kind: "assertion-ids-unassigned",
  detail:
    "docs/FIXTURE_CATALOG.md states the status but names no assertion id for this case, and specs/ruleset.standard.v0.yaml's own todo leaves every assertion's source_refs and params unassigned.",
};

/**
 * ADR-0002 section 9 fixes only the *format* of a compat assertion id,
 * `compat:<external-id>.<assertion>@<snapshot-date>`. The ruleset's own todo
 * records that no accepted decision names one, so a compat expectation here
 * can carry a status and nothing else.
 */
export const COMPAT_ID_UNASSIGNED: FixtureTodo = {
  kind: "compat-assertion-id-unassigned",
  detail:
    "specs/ruleset.standard.v0.yaml todo: no accepted decision names a compat-mode assertion id, so every rule declares none.",
};

/** The status the crawler-token dataset the `bot-*` expectations depend on. */
export const CRAWLER_DATASET_UNPINNED: FixtureTodo = {
  kind: "rule-input-unpinned",
  detail:
    "docs/FIXTURE_CATALOG.md section 9 requires a small crawler-name dataset pinned with its source date. No such dataset exists in specs/, so the product token in these bodies is fixture content and not a pinned classification input.",
};

export function changed(
  mode: Mode,
  rule: RuleId,
  to: Status,
  assertion: string | null = null,
): ChangedAssertion {
  return { mode, rule, assertion, from: "pass", to };
}

/**
 * A second rule this override necessarily disturbs, whose resulting status no
 * pinned document decides.
 */
export function collateral(
  mode: Mode,
  rule: RuleId,
  reason: string,
): ChangedAssertion {
  return { mode, rule, assertion: null, from: "pass", to: "undecided", reason };
}

export const COLLATERAL_UNDECIDED: FixtureTodo = {
  kind: "collateral-outcome-undecided",
  detail:
    "This override removes a parseable robots.txt, which necessarily moves web.policy.ai-crawler and web.policy.content-signals as well. No pinned document says what those rules then report, so the entries record the movement without inventing a status.",
};
