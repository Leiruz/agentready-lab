import type {
  AssertionOutcome,
  AssertionOutcomes,
  ObservationRequest,
  OutcomeKind,
  RoundContext,
  RuleDefinition,
} from "@agentready-lab/core";

import type { ContentSignalReading } from "../parsers/content-signals.js";
import { readContentSignals } from "../parsers/content-signals.js";
import type { ParsedRobots } from "../parsers/robots.js";
import {
  PARSED_ROBOTS_MEMO_KEY,
  parseRobots,
  robotsObservationRequest,
} from "../parsers/robots.js";

/**
 * `web.policy.content-signals`. Registry ordinal 7 (`specs/checks.v0.yaml`).
 *
 * Every metadata value is read from `specs/ruleset.standard.v0.yaml` at
 * `ruleset_version` 0.4.0 and `specs/sources.v0.yaml` at
 * `source_ledger_version` 0.4.0, under the ADR-0002 section 10 mapping.
 * `test/registry.test.ts` re-reads both files and compares, so a value edited
 * here without the spec is a test failure rather than a silent divergence.
 * `implementationStatus` moved to `supported` when the ruleset's
 * `implementation_status` did; the ruleset is the authority for it and the two
 * are held equal by that test.
 *
 * THE RULE THAT CANNOT FAIL, and why that is the finished state rather than an
 * unfinished one.
 *
 * ADR-0009 section 3 retires `content-signals.syntax` outright -- not demoted,
 * not renamed, not carried forward under another id -- and nothing normative
 * replaces it. Every remaining assertion is `recommended` or `advisory`, and
 * `findingStatus` maps a violation of either to `warning`, so **no input to
 * this rule produces `fail` in any mode**. `test/rules/content-signals.test.ts`
 * asserts that as a property of the metadata rather than leaving it as a
 * comment.
 *
 * The reason is that the search for a normative hook was made twice and came
 * back empty both times. `draft-romm-aipref-contentsignals-00` is expired and
 * defines a vocabulary and nothing else: section 3 gives three usage
 * categories, Table 1 in section 4 gives their labels, and there is no
 * robots.txt field syntax, no ABNF, no placement rule and no value grammar
 * anywhere in it. `https://contentsignals.org/` is a JavaScript application
 * shell. RFC 9309 section 2.2.4 defines no syntax for an extension record,
 * explicitly permits a crawler to be lenient with one, and addresses its only
 * `MUST` to the crawler rather than to the publisher, so a publisher cannot
 * violate it. The three tokens `search`, `ai-input` and `ai-train` are a dated
 * external recognition set, and ADR-0009 exists because an earlier revision
 * let exactly that decide a specification verdict.
 *
 * The non-interference `MUST` RFC 9309 section 2.2.4 does contain is this
 * project's own obligation, discharged in `test/rules/robots-parser.test.ts`
 * rather than reported as a verdict about a target. A rule may not declare an
 * assertion whose subject is this scanner.
 *
 * WHAT EACH ASSERTION MEANS.
 *
 * - `content-signals.coverage` (recommended) is a **disclosure**, not a
 *   testable condition: "Report omitted signal dimensions rather than
 *   inferring an unstated yes or no policy". A partial declaration is
 *   `satisfied`, which fixture `sig-002` pins as `spec: pass`, and so is a
 *   complete one. Omission is the optional case this requirement says to
 *   report rather than infer, so a publisher cannot violate it by omitting a
 *   dimension; the ruleset's own delta says "Absence is not a violation of
 *   RFC 9309". Which dimensions were omitted is not carried, because the
 *   ruleset declares `params: []` here and a parameter it does not declare is
 *   an `undeclared-parameter` contract violation. That gap is real and the
 *   ruleset records it as a todo.
 * - `content-signals.effect` (advisory) is the other disclosure: the result is
 *   a declared preference, not consent, prohibition, or verified recipient
 *   behaviour. Nothing in this file claims legal enforceability, and nothing
 *   may. Both disclosures are emitted `satisfied` only when a declaration was
 *   actually read, and are suppressed with the rest whenever it was not, so a
 *   scan that observed nothing never carries a green advisory finding.
 * - `content-signals.conflicting-declaration` (advisory) is `violated`, and so
 *   a `warning`, when one token is declared twice with values that are not the
 *   same string. The pinned source defines no conflict resolution, so this
 *   reports the unresolved state and selects no winner. It is ambiguity, never
 *   a violation.
 * - `content-signals.unrecognized-vocabulary` (advisory) is `violated` when
 *   the declaration carries a token outside Table 1's three labels, or carries
 *   none of them at all, which is the ruleset's own "declares no token that
 *   the dated compatibility snapshot recognizes, or declares an additional
 *   token beyond that set". `recognized-token-count` is the one declared
 *   parameter in the M1 ruleset and is `required`, so **every** outcome for
 *   this assertion carries it, including `not-present` and `indeterminate`.
 *   The verbatim token evidence ADR-0009 sections 4 and 5 describe is an
 *   `excerpt` parameter the ruleset does not authorize, so none is emitted:
 *   that would be an `unauthorized-excerpt` contract violation, not a
 *   formatting preference.
 *
 * NO VERDICT ABOUT A VALUE (ADR-0009 section 5). A declared value reaches no
 * outcome. `readContentSignals` compares one value with another for equality
 * and never reads, classifies or checks one against a set, and it returns no
 * values at all, so this file could not report a verdict about one even by
 * accident. A future contributor may not add `yes`/`no` as an allowed value
 * set because the community examples use them; that needs a pinned source and
 * a new decision.
 *
 * RETRIEVAL SEMANTICS, which are `web.discovery.robots`'s, because the
 * declaration lives in that one document:
 *
 * - `4xx` (RFC 9309 section 2.3.1.3, "unavailable") means no robots.txt is
 *   served, so no declaration is either;
 * - a `2xx` whose parse found no `Content-Signal` record is fixture `sig-006`,
 *   the optional mechanism that is simply not deployed;
 * - both are `not-present` on **all four** assertions together, because
 *   `deriveRuleStatus` refuses `not-applicable` beside an evaluated finding.
 *   `sig-006` pins the four ids for that reason;
 * - `5xx`, a transport error, a `3xx` the same-origin policy would not follow,
 *   a truncated body, a refused robots parse and a refused declaration reading
 *   are all `indeterminate`. A bound of ours is not a conformance failure, and
 *   a bound that hid an unrecognized token would otherwise turn a warning into
 *   a pass.
 *
 * The media type is not re-judged here. RFC 9309 section 2.3 fixes it at
 * `text/plain` and `robots.location` is the assertion that reports it; this
 * rule declares no assertion it could hang a second verdict on.
 *
 * `roundTwoBudget` stays 0: this rule dereferences nothing it discovers. It
 * plans the shared `robotsObservationRequest`, so ADR-0005 section 3's dedup
 * key makes its `/robots.txt` request and `web.discovery.robots`'s one
 * dispatch, and `agentready-lab/parsed-robots/v1` makes them one parse.
 *
 * `test/not-implemented/content-signals.test.ts` is deleted with this
 * implementation.
 */

/** Rule-local, and never an evidence id (ADR-0002 section 8). */
const OBSERVATION_ID = "robots";

const COVERAGE = "content-signals.coverage";
const EFFECT = "content-signals.effect";
const CONFLICTING = "content-signals.conflicting-declaration";
const UNRECOGNIZED = "content-signals.unrecognized-vocabulary";

function outcome(
  assertion: string,
  kind: OutcomeKind,
  params: AssertionOutcome["params"] = {},
): AssertionOutcome {
  return { assertion, kind, params, observationRefs: [OBSERVATION_ID] };
}

/** The one declared parameter, which `UNRECOGNIZED` requires on every outcome. */
function recognizedTokenCount(count: number): AssertionOutcome["params"] {
  return { "recognized-token-count": { kind: "count", value: count } };
}

/** Every assertion at once, for the whole-retrieval verdicts. */
function uniform(kind: OutcomeKind): AssertionOutcomes {
  return {
    kind: "outcomes",
    outcomes: [
      outcome(COVERAGE, kind),
      outcome(EFFECT, kind),
      outcome(CONFLICTING, kind),
      outcome(UNRECOGNIZED, kind, recognizedTokenCount(0)),
    ],
  };
}

/** A declaration was served and read. The only branch that evaluates one. */
function declared(reading: ContentSignalReading): AssertionOutcomes {
  return {
    kind: "outcomes",
    outcomes: [
      outcome(COVERAGE, "satisfied"),
      outcome(EFFECT, "satisfied"),
      outcome(
        CONFLICTING,
        reading.conflicting.length === 0 ? "satisfied" : "violated",
      ),
      outcome(
        UNRECOGNIZED,
        reading.unrecognized.length === 0 && reading.recognized.length > 0
          ? "satisfied"
          : "violated",
        recognizedTokenCount(reading.recognized.length),
      ),
    ],
  };
}

function evaluate(context: RoundContext<unknown>): AssertionOutcomes {
  const observation = context.observation(OBSERVATION_ID);
  if (observation.kind !== "http" || observation.outcome.kind === "error") {
    return uniform("indeterminate");
  }

  const response = observation.outcome;
  if (response.status >= 400 && response.status <= 499) {
    return uniform("not-present");
  }
  if (response.status < 200 || response.status > 299 || response.truncated) {
    return uniform("indeterminate");
  }

  // The same frozen value `web.discovery.robots` produced, under ADR-0002
  // section 11. Reached only after the branches above establish that this
  // observation carried a body.
  const parsed = context.memo<ParsedRobots>(PARSED_ROBOTS_MEMO_KEY, () =>
    parseRobots(response.body),
  );
  if (parsed.refusedBy !== null) return uniform("indeterminate");

  const reading = readContentSignals(parsed.extensions);
  if (reading.refusedBy !== null) return uniform("indeterminate");
  if (!reading.present) return uniform("not-present");

  return declared(reading);
}
export const contentSignalsRule: RuleDefinition = {
  apiVersion: 1,
  metadata: {
    id: "web.policy.content-signals",
    externalCompatibilityId: "contentSignals",
    ruleVersion: "0.2.0",
    ruleset: { id: "standard", version: "0.4.0" },
    title: "Content Signals",
    category: "bot-access-control",
    profiles: ["content", "api", "agent-service", "full"],
    applicability: "optional",
    modes: ["spec"],
    observationRuntime: ["http"],
    sourceMaturity: "experimental",
    implementationStatus: "supported",
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
        id: "content-signals",
        title: "Content Signals",
        url: "https://contentsignals.org/",
        kind: "industry-protocol",
        status: "living-specification",
        version: "site snapshot 2026-08-28",
        verifiedAt: "2026-08-28",
      },
      {
        id: "content-signals-draft-00",
        title: "Content Signals for AI Preferences",
        url: "https://datatracker.ietf.org/doc/draft-romm-aipref-contentsignals/",
        kind: "ietf-draft",
        status: "expired-draft",
        version: "draft-romm-aipref-contentsignals-00",
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
        id: "content-signals.coverage",
        mode: "spec",
        requirementClass: "recommended",
        sourceRefs: [{ sourceId: "content-signals-draft-00", section: "3" }],
        params: {},
        excerptAuthorized: false,
      },
      {
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
        // The only declared parameter in the whole M1 ruleset. The verbatim
        // token evidence ADR-0009 sections 4 and 5 ask for is an `excerpt`
        // parameter, and the ruleset does not authorize one yet; a rule that
        // emits an excerpt here is an `unauthorized-excerpt` contract
        // violation, not a formatting preference.
        id: "content-signals.unrecognized-vocabulary",
        mode: "spec",
        requirementClass: "advisory",
        sourceRefs: [{ sourceId: "content-signals-draft-00", section: "4" }],
        params: {
          "recognized-token-count": { kind: "count", required: true },
        },
        excerptAuthorized: false,
      },
    ],
    roundTwoBudget: 0,
  },
  defaultOptions: {},
  plan(): readonly ObservationRequest[] {
    return [robotsObservationRequest(OBSERVATION_ID)];
  },
  /**
   * One round is enough, so this always returns outcomes and `finish()` is
   * never reached by `runScan`. `finish()` evaluates the same way rather than
   * throwing, because a `finish` that could only be wrong is worse than one
   * that is simply the same answer.
   */
  step(context: RoundContext<unknown>): AssertionOutcomes {
    return evaluate(context);
  },
  finish(context: RoundContext<unknown>): AssertionOutcomes {
    return evaluate(context);
  },
};
