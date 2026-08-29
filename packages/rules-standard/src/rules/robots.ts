import type {
  AssertionOutcome,
  AssertionOutcomes,
  ObservationRequest,
  OutcomeKind,
  RoundContext,
  RuleDefinition,
} from "@agentready-lab/core";

import type { ParsedRobots } from "../parsers/robots.js";
import {
  PARSED_ROBOTS_MEMO_KEY,
  ROBOTS_MEDIA_TYPE,
  parseRobots,
  robotsObservationRequest,
} from "../parsers/robots.js";

/**
 * `web.discovery.robots`. Registry ordinal 1 (`specs/checks.v0.yaml`).
 *
 * Every metadata value is read from `specs/ruleset.standard.v0.yaml` at
 * `ruleset_version` 0.4.0 and `specs/sources.v0.yaml` at
 * `source_ledger_version` 0.4.0, under the ADR-0002 section 10 mapping.
 * `test/registry.test.ts` re-reads both files and compares, so a value edited
 * here without the spec is a test failure rather than a silent divergence.
 * `implementationStatus` stays `planned` for that reason: the ruleset is the
 * authority for it and this change does not edit `specs/`.
 *
 * WHAT EACH ASSERTION MEANS, and where in RFC 9309 it comes from. The ruleset
 * declares no parameters and authorizes no excerpt for any of the three, so
 * every outcome below carries an empty `params`: `validateOutcomeParams`
 * rejects a parameter an assertion does not declare, and the ruleset's own
 * `todo` records that fail-closed state deliberately.
 *
 * - `robots.location` (normative). RFC 9309 section 2.3: "The rules MUST be
 *   accessible in a file named '/robots.txt' (all lowercase) in the top-level
 *   path of the service. The file MUST be UTF-8 encoded [...] and Internet
 *   Media Type 'text/plain'." The path half is satisfied by construction --
 *   `plan()` requests exactly that origin path -- so what remains observable
 *   is the media type of the successful representation. That is the soft-404
 *   of `docs/FIXTURE_CATALOG.md` case `rob-003`: a `200` carrying
 *   `text/html` is a served page, not a robots.txt.
 * - `robots.syntax` (normative). The UTF-8 half of section 2.3, plus section
 *   2.2's ABNF for the three defined records. A line that is neither an
 *   `emptyline`, a `comment`, a defined record nor a section 2.2.4 other
 *   record is outside the grammar. Extension records never violate it: the
 *   ruleset's own delta says "Unknown extension records such as Sitemap and
 *   Content-Signal do not make an otherwise valid REP document invalid", and
 *   ADR-0009 section 3 explains why no strictness can be derived for them.
 * - `robots.not-authz` (advisory) is a **disclosure**, not a testable
 *   condition. `specs/sources.v0.yaml` records it as "REP communicates crawl
 *   preferences; it is not access authorization", and no target behaviour can
 *   make it true or false. It is emitted `satisfied` whenever retrieval
 *   succeeded and suppressed -- as `indeterminate`, or as `not-present`
 *   alongside the others -- whenever it did not, so a failed retrieval is not
 *   reported with an advisory pass beside it. It cannot simply be omitted:
 *   `validateRuleOutcomes` requires exactly one outcome per declared
 *   assertion.
 *
 * RETRIEVAL SEMANTICS, from RFC 9309 section 2.3.1, which is the ruleset
 * delta "Spec mode implements RFC response-class and redirect semantics
 * instead of treating only status 200 as meaningful":
 *
 * - `2xx` (section 2.3.1.1, successful access) is the only class that is
 *   evaluated;
 * - `4xx` (section 2.3.1.3, "unavailable") means the mechanism is not
 *   deployed. Every assertion goes `not-present` **together**, because
 *   `not-applicable` may not sit beside an evaluated finding;
 * - `5xx` (section 2.3.1.4, "unreachable") leaves the file undefined rather
 *   than absent, so it is `indeterminate` and not `not-present`;
 * - a transport error, a `3xx` the same-origin redirect policy would not
 *   follow, and a truncated body are all `indeterminate`. A transport limit
 *   is not a conformance failure, which is the whole point of case `rob-005`.
 *
 * `roundTwoBudget` stays 0: this rule dereferences nothing it discovers. A
 * `Sitemap:` record is handed to `web.discovery.sitemap` through the shared
 * parse, and following it is that rule's budget.
 */

/** Rule-local, and never an evidence id (ADR-0002 section 8). */
const OBSERVATION_ID = "robots";

const LOCATION = "robots.location";
const SYNTAX = "robots.syntax";
const NOT_AUTHZ = "robots.not-authz";

function outcome(assertion: string, kind: OutcomeKind): AssertionOutcome {
  return { assertion, kind, params: {}, observationRefs: [OBSERVATION_ID] };
}

/** Every assertion at once, for the three whole-retrieval verdicts. */
function uniform(kind: OutcomeKind): AssertionOutcomes {
  return {
    kind: "outcomes",
    outcomes: [
      outcome(LOCATION, kind),
      outcome(SYNTAX, kind),
      outcome(NOT_AUTHZ, kind),
    ],
  };
}

/**
 * The media type of a response, without its parameters.
 *
 * A representation with no `Content-Type` at all does not declare the media
 * type RFC 9309 section 2.3 requires, so it is treated the same as one that
 * declares the wrong one. The `charset` parameter is deliberately not read:
 * section 2.3's UTF-8 requirement is checked against the actual bytes by the
 * parser, which is the substantive test, and a declared `us-ascii` would be a
 * false violation of it.
 */
function mediaTypeOf(
  headers: ReadonlyMap<string, readonly string[]>,
): string | null {
  const first = headers.get("content-type")?.[0];
  if (first === undefined) return null;
  const semicolon = first.indexOf(";");
  const essence = semicolon === -1 ? first : first.slice(0, semicolon);
  return essence.trim().toLowerCase();
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

  // ADR-0002 section 11 freezes this and hands the same value to
  // `web.policy.ai-crawler`, `web.policy.content-signals` and
  // `web.discovery.sitemap`, so it is one parse of one observation.
  const parsed = context.memo<ParsedRobots>(PARSED_ROBOTS_MEMO_KEY, () =>
    parseRobots(response.body),
  );

  const syntax: OutcomeKind =
    parsed.refusedBy !== null
      ? // A bounded parsing budget stopped us. RFC 9309 section 2.5 makes that
        // limit the crawler's own, so it says nothing about the publisher.
        "indeterminate"
      : parsed.invalidUtf8 || parsed.malformedCount > 0
        ? "violated"
        : "satisfied";

  return {
    kind: "outcomes",
    outcomes: [
      outcome(
        LOCATION,
        mediaTypeOf(response.headers) === ROBOTS_MEDIA_TYPE
          ? "satisfied"
          : "violated",
      ),
      outcome(SYNTAX, syntax),
      outcome(NOT_AUTHZ, "satisfied"),
    ],
  };
}

export const robotsRule: RuleDefinition = {
  apiVersion: 1,
  metadata: {
    id: "web.discovery.robots",
    externalCompatibilityId: "robotsTxt",
    ruleVersion: "0.1.0",
    ruleset: { id: "standard", version: "0.4.0" },
    title: "robots.txt",
    category: "discoverability",
    profiles: ["content", "api", "agent-service", "full"],
    applicability: "applicable",
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
        id: "robots.location",
        mode: "spec",
        requirementClass: "normative",
        sourceRefs: [{ sourceId: "rfc9309" }],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "robots.syntax",
        mode: "spec",
        requirementClass: "normative",
        sourceRefs: [{ sourceId: "rfc9309" }],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "robots.not-authz",
        mode: "spec",
        requirementClass: "advisory",
        sourceRefs: [{ sourceId: "rfc9309" }],
        params: {},
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
