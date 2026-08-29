import type {
  AssertionOutcome,
  AssertionOutcomes,
  ObservationRequest,
  OutcomeKind,
  RoundContext,
  RuleDefinition,
} from "@agentready-lab/core";

import type { ParsedLink } from "../parsers/link-header.js";
import { parseLinkField } from "../parsers/link-header.js";

/** The rule-local id of the one observation this rule makes. */
const PAGE = "page";

/**
 * The three relation names of AgentReady Lab agent-useful relation policy
 * 0.1.0 (ADR-0010 section 2).
 *
 * This is project policy and not a specification. It classifies; it defines
 * nothing about the relation names themselves, which belong to RFC 8288. The
 * set agreeing with the heuristic in `specs/checks.v0.yaml` is a coincidence
 * ADR-0010 section 2 accepts deliberately and forbids inheriting: a future
 * maintainer comparing the two lists re-derives the agreement rather than
 * preserving it.
 *
 * Changing the set requires a policy version bump, a new `verified_at`, a
 * `rule_version` bump here and updated fixtures. It is not an in-place edit.
 */
export const AGENT_USEFUL_RELATIONS_0_1_0: readonly string[] = [
  "service-desc",
  "describedby",
  "api-catalog",
];

/** ADR-0004 section 8: the versioned agent-useful relation allowlist. */
export interface LinkOptions {
  readonly agentUsefulRelations: readonly string[];
}

/**
 * `web.discovery.link`. Registry ordinal 3 (`specs/checks.v0.yaml`).
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
 * UNRESOLVED, and reported rather than worked around: **nothing resolves a
 * relative target.** `docs/IMPLEMENTATION_SPEC.md` section 22.3 requires
 * "Resolves relative targets against the effective response URL", and
 * ADR-0002's implementation constraints say "Rules never construct a URL, they
 * call `context.resolve()`". `RoundContext` in
 * `packages/core/src/model/rule.ts` declares `observation` and `memo` and
 * nothing else, `URL` is an undeclared identifier in this package, and
 * `authorizeDiscoveredUrl` in the core takes an absolute URL. So this rule
 * selects the base a resolver would use, which is
 * `HttpObservation.outcome.effectiveUrl` and never `request.url`, and reports
 * a relative target unresolved. `roundTwoBudget` stays 0 for the same reason:
 * a rule that cannot resolve a relative target cannot dereference one.
 *
 * `test/not-implemented/link.test.ts` is deleted with this implementation.
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
  defaultOptions: {
    agentUsefulRelations: AGENT_USEFUL_RELATIONS_0_1_0,
  } satisfies LinkOptions,
  /**
   * The homepage as HTML.
   *
   * `Accept: text/html` is the canonical page representation of ADR-0005
   * section 2's plan table, which is also what `web.content.markdown-
   * negotiation` requests for its HTML baseline, so the two deduplicate onto
   * one transport call. `Number.MAX_SAFE_INTEGER` says "I lower no limit":
   * `effectiveLimit` in the core mins it with the scan ceiling, so the
   * canonical key carries the ceiling and matches any other rule that also
   * lowers nothing. A smaller cap here would fork the key and cost a second
   * request for the same bytes.
   */
  plan(): readonly ObservationRequest[] {
    return [
      {
        kind: "http",
        id: PAGE,
        method: "GET",
        target: { kind: "page" },
        accept: "text/html",
        redirects: "follow-same-origin",
        maxEncodedBytes: Number.MAX_SAFE_INTEGER,
        maxDecodedBytes: Number.MAX_SAFE_INTEGER,
      },
    ];
  },
  step(context): AssertionOutcomes {
    return { kind: "outcomes", outcomes: evaluate(context) };
  },
  /**
   * Unreachable through `runScan`, which calls `finish` only for a rule whose
   * `step` returned a second request batch, and this rule never does. It
   * evaluates rather than throwing because the contract is that `finish`
   * returns the rule's outcomes, and a `finish` that threw would be a trap for
   * whoever gives this rule a round two.
   */
  finish(context): AssertionOutcomes {
    return { kind: "outcomes", outcomes: evaluate(context) };
  },
};

function outcome(assertion: string, kind: OutcomeKind): AssertionOutcome {
  // No message string, and no parameters: `specs/ruleset.standard.v0.yaml`
  // declares `params: []` for all three assertions, so any parameter here is
  // an `undeclared-parameter` contract violation. The prose is a pinned
  // template the core renders.
  return { assertion, kind, params: {}, observationRefs: [PAGE] };
}

function outcomesOf(
  parse: OutcomeKind,
  relation: OutcomeKind,
  agentUseful: OutcomeKind,
): readonly AssertionOutcome[] {
  return [
    outcome("links.parse", parse),
    outcome("links.relation", relation),
    outcome("links.agent-useful", agentUseful),
  ];
}

function isStringList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown) => typeof item === "string")
  );
}

/**
 * The effective allowlist, narrowed from the untyped option bag.
 *
 * ADR-0004 section 8 gives each rule "a JSON Schema for its options, published
 * beside the rule and validated before any transport call", and no such
 * validation exists yet: `resolveRuleOptions` checks key names only. The one
 * shape that survives `projectEffectiveOptions` and would still be wrong here
 * is a bare string, which `Array.prototype.includes` would turn into the
 * substring search `links.relation` exists to forbid. Anything that is not a
 * list of strings therefore falls back to policy 0.1.0.
 */
function agentUsefulRelationsOf(options: unknown): readonly string[] {
  if (typeof options !== "object" || options === null) {
    return AGENT_USEFUL_RELATIONS_0_1_0;
  }
  if (!("agentUsefulRelations" in options)) {
    return AGENT_USEFUL_RELATIONS_0_1_0;
  }
  const configured: unknown = options.agentUsefulRelations;
  return isStringList(configured) ? configured : AGENT_USEFUL_RELATIONS_0_1_0;
}

/**
 * RFC 8288 section 3.3: `rel` "MUST be present", and each relation type is
 * either a registered name or a URI.
 */
function hasWellFormedRelations(link: ParsedLink): boolean {
  return (
    link.relations.length > 0 &&
    link.relations.every((relation) => relation.kind !== "invalid")
  );
}

/**
 * Whether a link-value says something about the page that served it.
 *
 * RFC 8288 section 3.2: an `anchor` moves the link's context to another
 * resource, so an anchored `service-desc` is not this page advertising its own
 * service description. An absent anchor means the context is the effective
 * response URL, and an empty anchor is a same-document reference that resolves
 * back to it (RFC 3986 section 5.4). Any other anchor is a relative or absolute
 * reference this rule cannot compare without resolving it, so the link is
 * conservatively left out of the classification rather than credited to a page
 * it may not describe.
 */
function contextIsThisPage(link: ParsedLink, base: string): boolean {
  const anchor =
    link.params.find((param) => param.name === "anchor")?.value ?? null;
  if (anchor === null) return true;
  return anchor === "" || anchor === base;
}

function isAgentUseful(
  link: ParsedLink,
  base: string,
  allowlist: readonly string[],
): boolean {
  if (!contextIsThisPage(link, base)) return false;
  // Only a registered relation type can match the policy set, whose three
  // members are registered names. An extension relation is a URI and is
  // compared as one, never as a substring.
  return link.relations.some(
    (relation) =>
      relation.kind === "registered" && allowlist.includes(relation.value),
  );
}

function evaluate(context: RoundContext<unknown>): readonly AssertionOutcome[] {
  const observation = context.observation(PAGE);
  // A transport or DNS failure is not a conformance failure
  // (`.claude/rules/standards.md`). The `kind` test is the type narrowing the
  // core's `ProbeObservation` union needs; this rule plans one HTTP request.
  if (observation.kind !== "http" || observation.outcome.kind === "error") {
    return outcomesOf("indeterminate", "indeterminate", "indeterminate");
  }

  const fields = observation.outcome.headers.get("link") ?? [];
  if (fields.length === 0) {
    // Absence of an optional mechanism is not a failure. All three assertions
    // report `not-present` together, because the mechanism is a property of
    // the response and not of one assertion.
    return outcomesOf("not-present", "not-present", "not-present");
  }

  const parsed = parseLinkField(fields);
  if (parsed.kind === "bounded") {
    // A parse this rule refused to finish says nothing about the target.
    return outcomesOf("indeterminate", "indeterminate", "indeterminate");
  }
  if (parsed.kind === "malformed") {
    // The field does not match the RFC 8288 section 3 grammar. The relation
    // and policy questions are then unanswerable rather than answered `no`:
    // the links after the syntax error were never read.
    return outcomesOf("violated", "indeterminate", "indeterminate");
  }

  // The base a relative target resolves against, per
  // `docs/IMPLEMENTATION_SPEC.md` section 22.3: the effective response URL
  // after redirects, never `observation.request.url`.
  const base = observation.outcome.effectiveUrl;
  const relations = parsed.links.every(hasWellFormedRelations)
    ? "satisfied"
    : "violated";
  const allowlist = agentUsefulRelationsOf(context.options);
  const useful = parsed.links.some((link) =>
    isAgentUseful(link, base, allowlist),
  );
  // ADR-0010 section 3: `links.agent-useful` is advisory and stays advisory,
  // so a missing agent-useful relation derives `warning` and can never derive
  // `fail`. The rule reports the outcome kind and the core derives the status.
  return outcomesOf("satisfied", relations, useful ? "satisfied" : "violated");
}
