# ADR-0002: Rule execution model and observation types

- Status: Accepted
- Decision date: 2026-08-29
- Owners: Initial maintainers
- Applies from: M1

## Context

The blueprint specifies two incompatible rule execution models.

`docs/ARCHITECTURE.md` section 6 defines `RuleV1` with an imperative
`RuleContextV1` exposing `probe()`, `probeAll()`, and `memo()`: a rule decides
what to fetch while it runs. `docs/IMPLEMENTATION_SPEC.md` section 12 defines
`RuleDefinition` with a declarative `observations: ObservationRequest[]` field:
a rule declares everything it needs before it runs.

Neither document defines the types it depends on. `ObservationRequest`,
`ProbeObservation`, `RuleProbeRequest`, and `EvaluationContext` appear in
signatures and are declared nowhere in the repository.

`ARCHITECTURE.md` section 5 step 5 hedges between the models: "Ask each rule for
observation requests or allow it to request observations through an injected
context." FR-3 does not hedge: "Rules declare observations."

Leaving this open is a defect, not flexibility. Cross-rule deduplication, budget
allocation (ADR-0005), the M0 criterion that an invalid configuration performs
no transport call, and the shared robots observation that
`docs/TEST_STRATEGY.md` section 6 requires rules 1, 5, and 6 to reuse all depend
on the answer.

### The first accepted revision of this decision was wrong

The first revision resolved the conflict with a static `observations()` phase
followed by an asynchronous `evaluate()` that could call `context.probe()`. That
design was rejected in adversarial review on 2026-08-29, and the rejection was
correct on five separate counts. This revision replaces it. The reasoning is
recorded rather than deleted, because these failure modes are the argument for
what follows.

1. **It did not compile.** The rule package builds under
   `lib: ["ES2023"], types: []`. Neither `AbortSignal` nor `URL` exists in that
   library set: a test compilation produced TS2304 for both, and for `fetch`.
   `EvaluationContext.signal: AbortSignal` was therefore not implementable in
   the package that was supposed to hold it. `Promise` is a different case and
   the record should be exact: it comes from the ES2015 library and compiles
   there. Promises are removed for reason 2, not because the compiler rejected
   them.
2. **It leaked scheduling into rules.** A rule holding `probe()` can branch on
   response-completion order, detach a probe it never awaits, race two probes,
   hide a probe inside an async memo loader, or issue a request after evaluation
   has apparently finished. `docs/ROADMAP.md` M1 requires that reordering
   promise completion not change canonical JSON, and nothing in that design made
   it so.
3. **It let rules choose verdicts.** `RuleFinding.status` was written by rule
   code and `requirementClass` was optional. A recommended assertion could emit
   `fail` and a violated normative assertion could emit `warning`, contrary to
   the mandatory mapping in `.claude/rules/standards.md` and
   `IMPLEMENTATION_SPEC.md` section 6.1. The core validated status precedence,
   which is a different property.
4. **It let rules write prose from hostile bytes.** `RuleFinding.message` was an
   arbitrary string produced by a rule that had just been handed a bounded but
   target-controlled body, effective URL, redirect chain, and headers. That
   bypasses the query redaction, header suppression, and output-injection
   controls in `docs/THREAT_MODEL.md` sections 20.2 and 20.3, which cannot
   sanitize a string whose structure they do not know.
5. **It claimed a boundary it did not have.** The forbidden list asserted that
   rules do not touch the network, clock, or randomness, with the type system
   named as the enforcement. That was never true, and section 2 below states
   what is actually true instead.

Two further defects, raised against ADR-0005 and closed here, were that
anonymous plan-time budget reservations were being used as evidence identities,
and that compatibility findings had no assertion identifiers of their own.

## Decision

### 1. Execution is exactly two synchronous rounds

A rule is three pure synchronous functions. None returns a promise, receives an
`AbortSignal`, or observes time.

**`plan(input)`** runs before any request. It is a function of the normalized
target, the mode, the profile, and the validated options only, and returns the
rule's complete static request list. "Static" means computed from configuration
before the first request, not a literal array:
`IMPLEMENTATION_SPEC.md` section 12's literal `observations` field cannot
express the AI crawler rule's configured tested path or the Markdown rule's
configured `Accept` value, both of which come from `rules.options` (ADR-0004).

The engine executes and deduplicates that batch. Round one is then complete and
frozen.

**`step(roundOneContext)`** returns either one ordered batch of discovered
requests or the rule's final assertion outcomes. A rule that needs no discovery
returns outcomes here and is done.

**`finish(roundTwoContext)`** runs only for a rule whose `step` returned a
batch, and returns outcomes. It cannot request anything further.

There are exactly two rounds. This is not a generic N-round state machine, and
that is deliberate: all three discovered-resource cases in the fixture catalog
need exactly one follow-up hop.

- `map-002`: the sitemap URL is a `Sitemap` record inside `robots.txt`.
- `web.discovery.api-catalog`: the RFC 9727 `api-catalog` link relation, and the
  registry's safe action "Resolve one selected service description or
  documentation link", both name a URL found in a prior response.
- `skl-007`: the interop artifact URL and its declared digest come from the
  skills index that was just fetched.

Because a rule derives its round-two requests from immutable round-one
observations it can re-read at any time, there is no continuation state to carry
between rounds. A generic state machine would need one, and that state would be
opaque to the engine, unvalidatable, and mutable by the rule.

### 2. Synchronicity is not a sandbox

This decision does not claim that a synchronous signature prevents I/O, and no
release gate may rely on it as if it did.

A synchronous function can still read `Date.now()` or `Math.random()`, import
`node:fs`, `node:child_process`, `node:crypto`, or `node:process`, and start a
`fetch`, `http.request`, `net.connect`, DNS query, timer, or promise without
awaiting it. `types: []` removes ambient Node typings; it does not remove the
module loader, and an explicit import, a cast through `any`, a local `declare`,
an ignored type error, or a side-effecting dependency all reach the same
capabilities.

The real trust boundary for M1 is that **only built-in, reviewed rules exist**.
ADR-0001 section 5 already forbids dynamically loaded third-party rule plugins,
and this decision depends on that. The supporting controls are:

- a lint rule restricting imports in `packages/rules-standard` to an explicit
  allowlist, with every `node:*` specifier, every bare specifier outside the
  allowlist, and every relative escape from the package rejected;
- a restricted-globals rule rejecting `fetch`, `XMLHttpRequest`, `WebSocket`,
  `process`, `require`, `globalThis` member access, `Date`, `performance`, and
  `Math.random` in rule modules;
- rejection of `eval`, `new Function`, and dynamic `import()` anywhere in the
  rule package, which `THREAT_MODEL.md` section 19.1 already requires of
  parsers;
- dependency inspection: the rule package declares its production dependencies
  explicitly and a check fails when the installed set changes;
- a unit test that runs every rule against a harness in which global `fetch`,
  `Date.now`, and `Math.random` are replaced by functions that throw, proving no
  rule reaches real I/O, the clock, or randomness on any fixture path.

Rounds are adopted for scheduling and determinism, not as a purity proof. What
they actually buy is listed in section 3.

Before any third-party rule is ever permitted, a genuine process or operating
system capability boundary is required: a separate process with no network
access, no filesystem access beyond a read-only rule bundle, and a message
channel carrying only observations and outcomes. Until that exists and has been
reviewed, `apiVersion` remains an internal contract and no plugin loader ships.

### 3. What rounds actually buy

Rounds are worth their verbosity for four properties the asynchronous design
could not provide:

- a rule cannot observe response-completion order, so `ROADMAP.md` M1's
  "Reordering promise completion does not change canonical JSON" becomes
  structural rather than aspirational;
- the whole round-one plan exists before the first socket opens, which is what
  makes the M0 criterion "invalid sample configuration validates as invalid
  without a transport call" and cross-rule deduplication of the shared robots
  observation possible;
- there is no in-flight probe to track, cancel, or orphan, so
  contract-violation cleanup is "discard the round", not "unwind an unknown
  number of pending promises";
- discovery depth is bounded by the contract instead of by a counter a rule
  could exhaust.

### 4. Types

`PublicObservationError` is defined by ADR-0003. Every declaration below
compiles under `strict`, `lib: ["ES2023"]`, `types: []`, and ESM.

```ts
export type RuleStatus =
  | "pass"
  | "fail"
  | "warning"
  | "not-applicable"
  | "unable-to-check"
  | "unsupported-runtime";

export type RequirementClass =
  | "normative"
  | "recommended"
  | "advisory"
  | "compatibility";

export type InterpretationMode = "spec" | "compat" | "interop";
export type ObservationRuntime = "http" | "dns" | "browser";

export type ImplementationStatus =
  | "planned"
  | "experimental"
  | "supported"
  | "deprecated"
  | "removed";

export type RuleApplicability =
  | "applicable"
  | "informational"
  | "optional"
  | "commerce-endpoint-required";

/** Where a discovered URL was read from. Required, and checked by the engine. */
export interface DiscoveredProvenance {
  /** A rule-local observation id from a completed round. */
  readonly fromObservation: string;
  /** JSON Pointer, header field name, or `robots.txt` line number. */
  readonly locator: string;
}

export type ObservationTarget =
  | { readonly kind: "page" }
  | { readonly kind: "origin-path"; readonly path: string }
  | {
      readonly kind: "discovered";
      readonly url: string;
      readonly provenance: DiscoveredProvenance;
    };

export interface HttpObservationRequest {
  readonly kind: "http";
  /** Unique within one rule for the whole scan. Never an evidence id. */
  readonly id: string;
  readonly method: "GET" | "HEAD";
  readonly target: ObservationTarget;
  readonly accept: string;
  readonly redirects: "follow-same-origin" | "reject";
  readonly maxEncodedBytes: number;
  readonly maxDecodedBytes: number;
}

export type DnsQueryName =
  | { readonly kind: "target-host" }
  | { readonly kind: "target-host-prefixed"; readonly prefix: string }
  | {
      readonly kind: "discovered";
      readonly name: string;
      readonly provenance: DiscoveredProvenance;
    };

export interface DnsObservationRequest {
  readonly kind: "dns";
  readonly id: string;
  readonly name: DnsQueryName;
  readonly recordType: "A" | "AAAA" | "TXT" | "SVCB" | "URI";
}

export type ObservationRequest = HttpObservationRequest | DnsObservationRequest;

export interface HttpObservation {
  readonly kind: "http";
  readonly id: string;
  readonly request: {
    readonly method: "GET" | "HEAD";
    readonly url: string;
    readonly headers: ReadonlyMap<string, readonly string[]>;
  };
  readonly outcome:
    | {
        readonly kind: "response";
        readonly status: number;
        readonly effectiveUrl: string;
        readonly headers: ReadonlyMap<string, readonly string[]>;
        readonly body: Uint8Array;
        readonly truncated: boolean;
        readonly encodedBytes: number;
        readonly decodedBytes: number;
        readonly bodySha256: string;
        readonly redirects: readonly {
          readonly status: number;
          readonly location: string;
          readonly decision: "followed" | "blocked";
        }[];
      }
    | { readonly kind: "error"; readonly error: PublicObservationError };
}

export interface DnsObservation {
  readonly kind: "dns";
  readonly id: string;
  readonly query: { readonly name: string; readonly recordType: string };
  readonly outcome:
    | {
        readonly kind: "answer";
        readonly rcode: string;
        readonly records: readonly {
          readonly type: string;
          readonly value: string;
        }[];
        readonly dnssec: "secure" | "insecure" | "bogus" | "indeterminate";
      }
    | { readonly kind: "error"; readonly error: PublicObservationError };
}

export type ProbeObservation = HttpObservation | DnsObservation;

export interface TargetDescriptor {
  readonly requestedUrl: string;
  readonly pageUrl: string;
  readonly origin: string;
  readonly scope: "local" | "remote";
  readonly networkProfile: "local-loopback" | "ci-public";
}

export interface PlanInput<Options> {
  readonly mode: InterpretationMode;
  readonly profile: Readonly<{ id: string; version: string }>;
  readonly target: TargetDescriptor;
  readonly options: Readonly<Options>;
}

export interface RoundContext<Options> extends PlanInput<Options> {
  /**
   * Resolves a rule-local request id from any completed round. An id the rule
   * did not request in a completed round is a contract violation.
   */
  observation(id: string): ProbeObservation;
  /** Deeply frozen shared parse result. The loader is synchronous. */
  memo<T>(namespacedKey: string, load: () => T): T;
}

export type OutcomeKind =
  | "satisfied"
  | "violated"
  | "not-present"
  | "indeterminate";

export type FindingParam =
  | { readonly kind: "count"; readonly value: number }
  | { readonly kind: "http-status"; readonly value: number }
  | { readonly kind: "token"; readonly value: string }
  | { readonly kind: "header-name"; readonly value: string }
  | { readonly kind: "media-type"; readonly value: string }
  | { readonly kind: "origin-path"; readonly value: string }
  | { readonly kind: "json-pointer"; readonly value: string }
  | { readonly kind: "excerpt"; readonly value: string };

export interface AssertionOutcome {
  /** A versioned assertion id declared by this rule for the active mode. */
  readonly assertion: string;
  readonly kind: OutcomeKind;
  /**
   * Bounded typed parameters for the static template. Never free prose, and
   * validated against the assertion's declared parameter schema (section 6).
   */
  readonly params: Readonly<Record<string, FindingParam>>;
  /** Rule-local observation ids. The core rewrites these to evidence ids. */
  readonly observationRefs: readonly string[];
}

export interface RequestBatch {
  readonly kind: "requests";
  readonly requests: readonly ObservationRequest[];
}

export interface AssertionOutcomes {
  readonly kind: "outcomes";
  readonly outcomes: readonly AssertionOutcome[];
}

export interface RuleSource {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly kind: string;
  readonly status: string;
  readonly version?: string;
  readonly verifiedAt: string;
}

export type FindingParamKind = FindingParam["kind"];

export interface ParamSpec {
  readonly kind: FindingParamKind;
  /** A required parameter absent from an outcome is a contract violation. */
  readonly required: boolean;
  /**
   * Closed value set for this parameter. Absent means the kind's grammar is
   * the only constraint. A parameter whose values are drawn from a pinned
   * vocabulary declares that vocabulary here.
   */
  readonly allowedValues?: readonly string[];
}

export interface AssertionDeclaration {
  readonly id: string;
  readonly mode: InterpretationMode;
  readonly requirementClass: RequirementClass;
  /** The only sources a finding for this assertion may cite. */
  readonly sourceRefs: readonly Readonly<{
    sourceId: string;
    section?: string;
  }>[];
  /** Every parameter this assertion's templates may reference. */
  readonly params: Readonly<Record<string, ParamSpec>>;
  /** True only where the ruleset explicitly authorizes a bounded excerpt. */
  readonly excerptAuthorized: boolean;
}

export interface RuleMetadata {
  readonly id: string;
  /** null for a native rule with no external counterpart (ADR-0008). */
  readonly externalCompatibilityId: string | null;
  readonly ruleVersion: string;
  readonly ruleset: Readonly<{ id: string; version: string }>;
  readonly title: string;
  readonly category: string;
  readonly profiles: readonly string[];
  readonly applicability: RuleApplicability;
  readonly modes: readonly InterpretationMode[];
  readonly observationRuntime: readonly ObservationRuntime[];
  readonly sourceMaturity: string;
  readonly implementationStatus: ImplementationStatus;
  readonly sources: readonly RuleSource[];
  /** Every assertion the rule may report, with its mode and class. */
  readonly assertions: readonly AssertionDeclaration[];
  /** Maximum round-two requests. Reserved before round one (ADR-0005). */
  readonly roundTwoBudget: number;
}

/** Constructed by the core. A rule never builds one. */
export interface RuleFinding {
  readonly code: string;
  readonly mode: InterpretationMode;
  readonly requirementClass: RequirementClass;
  readonly status: RuleStatus;
  readonly message: string;
  readonly sourceRefs: readonly Readonly<{
    sourceId: string;
    section?: string;
  }>[];
  readonly evidenceRefs: readonly string[];
}

export interface RuleResult {
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly status: RuleStatus;
  readonly gate: "enforced" | "informational";
  readonly findings: readonly RuleFinding[];
}

export interface RuleDefinition<Options = unknown> {
  readonly apiVersion: 1;
  readonly metadata: RuleMetadata;
  readonly defaultOptions: Readonly<Options>;
  plan(input: PlanInput<Options>): readonly ObservationRequest[];
  step(context: RoundContext<Options>): RequestBatch | AssertionOutcomes;
  finish(context: RoundContext<Options>): AssertionOutcomes;
}
```

`ProbeObservation` carries the bounded decoded body; `PublicEvidence` does not.
The rule sees bytes, the report sees a digest and a length. The `dns` kind
exists although `dns.discovery.dns-aid` is deferred to M4: the type must exist
without the capability, and a rule requiring an unavailable runtime yields
`unsupported-runtime`, never `fail`.

`maxEncodedBytes` is new. `THREAT_MODEL.md` section 16 budgets encoded and
decoded bytes separately and says a rule may lower a limit; the previous type
let a rule lower only the decoded one.

### 5. Rules return outcomes, and the core derives every status

A rule reports what it observed about an assertion. It does not report a status
and it does not report a requirement class. The class is loaded from the pinned
ruleset, keyed by assertion id and mode, and it is immutable for a given
`ruleset_version`.

```ts
export class RuleContractViolation extends Error {}

export function findingStatus(
  outcome: OutcomeKind,
  requirementClass: RequirementClass,
): RuleStatus {
  switch (outcome) {
    case "satisfied":
      return "pass";
    case "not-present":
      return "not-applicable";
    case "indeterminate":
      return "unable-to-check";
    case "violated":
      switch (requirementClass) {
        case "normative":
        case "compatibility":
          return "fail";
        case "recommended":
        case "advisory":
          return "warning";
        default: {
          const unreachable: never = requirementClass;
          throw new RuleContractViolation(String(unreachable));
        }
      }
    default: {
      const unreachable: never = outcome;
      throw new RuleContractViolation(String(unreachable));
    }
  }
}

const RULE_STATUS_PRECEDENCE = [
  "fail",
  "unable-to-check",
  "unsupported-runtime",
  "warning",
  "pass",
  "not-applicable",
] as const satisfies readonly RuleStatus[];

export function deriveRuleStatus(statuses: readonly RuleStatus[]): RuleStatus {
  if (statuses.length === 0) {
    throw new RuleContractViolation("an invoked rule returned no outcomes");
  }
  const inapplicable = statuses.filter(
    (status) => status === "not-applicable",
  ).length;
  if (inapplicable !== 0 && inapplicable !== statuses.length) {
    throw new RuleContractViolation(
      "not-applicable cannot coexist with an evaluated finding",
    );
  }
  for (const status of RULE_STATUS_PRECEDENCE) {
    if (statuses.includes(status)) {
      return status;
    }
  }
  throw new RuleContractViolation("unknown finding status");
}
```

#### The first revision of this function was wrong in both directions

It returned `not-applicable` for an empty status array and threw whenever the
array was longer than one and contained a `not-applicable`. Adversarial review
on 2026-08-29 rejected both branches and was right about both.

**Multiple inapplicable findings were rejected.** Every `not-present` outcome
maps to `not-applicable`, and a rule with several assertions over one absent
mechanism produces several of them at once. `web.policy.content-signals` has
four `spec` assertions after ADR-0008 and ADR-0009, and fixture `sig-006` makes
all four inapplicable together by serving no declaration at all. The old
condition turned the catalog's own expected result into an exit-4 crash. The
test is now whether the set is **mixed**, not how long it is.

**A silent rule produced a verdict.** Zero outcomes returned `not-applicable`,
which is a status, from a rule that reported nothing. A rule that fell through
its own branches, or that lost an outcome to a typo in an assertion id, was
indistinguishable in the report from a rule that correctly found nothing to
check. That is now an enumerated contract violation and exits 4.

`deriveRuleStatus` runs only for a rule the engine actually invoked. A rule the
core resolved before `plan()`, because its runtime is unavailable or because
`commerce-endpoint-required` had no endpoint, never reaches it and is not
covered by the zero-outcome violation.

#### `not-present` describes the mechanism, not one condition inside it

The mixture check is only coherent if `not-present` means one thing, so this
decision fixes what it means: **the mechanism this rule is about is not
deployed on the target.** It is a property of the observation set, so every
assertion of the rule sees the same answer, and a rule's outcome set is
therefore either entirely `not-present` or contains none at all.

An assertion whose specific condition never arises inside a mechanism that *is*
deployed reports `satisfied`, because the obligation is met, or `indeterminate`
where the rule could not tell. `content-signals.conflicting-declaration` on a
declaration with no repeated token is `satisfied`, not `not-present`. This is
what ADR-0004 section 2 means by absence being decided per assertion: `lnk-006`
has no `Link` field at all, so the mechanism is absent and every `Link`
assertion is `not-present` together.

Every assertion the rule declares for the active mode must carry exactly one
outcome. Combined with the rule above, that makes the rule-level applicability
result core-owned and checkable: a rule cannot become `not-applicable` by
staying quiet, and it cannot become `pass` by omitting the assertion it would
have failed.

This is what makes "only a violated applicable normative requirement is `fail`"
enforceable. Under the previous design it was a rule-author convention.

A `compatibility`-class violation is `fail` in `compat` mode, and that is not an
exception to the sentence above: it is a different claim, made in a different
mode, under an identifier that is not a normative requirement id. Fixtures
`lnk-006` and `skl-006` require exactly this, `spec: not-applicable` beside
`compat: fail`. Section 9 keeps the two identifier spaces apart so the
compatibility verdict can never be read as a specification verdict.

`unsupported-runtime` is produced only by the core capability check, before
`plan()` is called. No rule can return it.

Each of the following is a contract violation and exits 4:

- an outcome naming an assertion the rule does not declare, or declares for a
  different mode;
- more than one outcome for the same assertion in one run;
- an invoked rule returning zero outcomes;
- an assertion the rule declares for the active mode with no outcome;
- an outcome set mixing `not-present` with any evaluated outcome kind;
- an outcome kind outside the four above, which the compiler catches for
  in-repo rules and the ruleset validator catches for a manifest read from
  disk;
- a `compatibility`-class assertion evaluated outside `compat` mode, or a
  `normative`, `recommended`, or `advisory` assertion evaluated in `compat`
  mode;
- a rule whose `applicability` is `commerce-endpoint-required` returning any
  outcome when no endpoint was configured; the core resolves that rule to
  `not-applicable` before `plan()` and never calls it;
- a round-two batch larger than `metadata.roundTwoBudget`;
- a parameter the assertion does not declare, a parameter of the wrong kind, a
  parameter value failing its kind's grammar or its declared allowlist, a
  missing required parameter, or an `excerpt` parameter on an assertion whose
  declaration does not authorize one (section 6);
- a rule-local request id reused anywhere in that rule's scan (section 8);
- a memo value that is not acyclic plain data with an approved prototype
  (section 11).

The first three of these replace a silent default. A rule that returns nothing,
or that omits one assertion, previously produced a plausible-looking report.

Whole-scan budget exhaustion is not a contract violation. It materializes as an
error observation (ADR-0005) and normally yields `indeterminate`.

There is one thing this does not enforce, and it should be named rather than
implied. Only the rule can read `robots.txt`, so only the rule can say whether
the mechanism was present, and a rule that reported `not-present` for a
mechanism it actually saw would produce a wrong `not-applicable`. What the core
removes is the class of error where the severity is wrong: a recommended
assertion cannot become `fail`, and a normative violation cannot be softened to
`warning`, under any rule implementation.

### 6. Finding prose is a static template, not a rule-supplied string

`RuleFinding.message` is rendered by the core from a template table keyed by
assertion id and outcome kind, published beside the ruleset and versioned with
it. A rule supplies only bounded typed parameters.

```ts
const UNSAFE_TEXT =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

function sanitizeText(value: string): string {
  return value.replace(UNSAFE_TEXT, "\ufffd");
}

export function sanitizeParam(param: FindingParam): string {
  switch (param.kind) {
    case "count":
    case "http-status":
      return String(param.value);
    case "excerpt":
      return sanitizeText(param.value).slice(0, 256);
    default:
      return sanitizeText(param.value).slice(0, 128);
  }
}

export type MessageTemplates = ReadonlyMap<
  string,
  Readonly<Record<OutcomeKind, string | undefined>>
>;

export function renderMessage(
  templates: MessageTemplates,
  assertion: string,
  outcome: OutcomeKind,
  params: Readonly<Record<string, FindingParam>>,
): string {
  const template = templates.get(assertion)?.[outcome];
  if (template === undefined) {
    throw new RuleContractViolation(
      `no message template for ${assertion} ${outcome}`,
    );
  }
  return template.replace(/\{([a-z][a-z0-9-]*)\}/g, (_match, name: string) => {
    const param = params[name];
    if (param === undefined) {
      throw new RuleContractViolation(`missing template parameter ${name}`);
    }
    return sanitizeParam(param);
  });
}
```

The 256-character excerpt cap is `THREAT_MODEL.md` section 16's bounded text
evidence limit. The control set removed by `sanitizeText` is section 20.3's
list: C0 controls, DEL and C1, and the bidirectional formatting characters.

This is the concrete forbidden thing: a rule may not construct a message. It
cannot interpolate a hostname, a header value, a redirect location, a body
excerpt it chose itself, or an exception. Those are the four routes by which
target-controlled bytes reached the previous design's report.

#### A static template alone does not bound what fills its holes

The previous revision stopped there, and adversarial review on 2026-08-29 was
right that stopping there is not enough. Two gaps were left open.

**Any string could enter any typed slot.** Seven of the eight `FindingParam`
variants carry a `string`, `sanitizeParam` only strips control characters and
truncates, and the assertion did not say which parameters it takes. A rule
holding a bounded but target-controlled body could put an arbitrary 128
characters into a `token` slot, and a template reading "declared token {token}"
would render it. `THREAT_MODEL.md` sections 3.5 and 20.1 permit only the
evidence needed to explain an assertion, and 27.6 requires that a marker placed
in a header, a query, or a body never reaches a report. Truncation is not that
control.

**Rules chose their own citations.** `AssertionOutcome` carried `sourceRefs`, so
a rule could cite any source in the ledger for any assertion, including citing
RFC 9309 for something RFC 9309 does not say. That is precisely the failure
ADR-0009 records twice for Content Signals, and no type prevented it.

#### Each assertion declares its sources and its parameters

`AssertionDeclaration` now carries `sourceRefs`, `params`, and
`excerptAuthorized` (section 4), all read from the pinned ruleset. Two rules
follow.

**Citations are derived, never supplied.** `RuleFinding.sourceRefs` is copied
from the declaration of the assertion the outcome names, and from nowhere else.
A rule cannot cite a source, cannot add a section pointer, and cannot cite a
source the assertion does not rest on. `AssertionOutcome.sourceRefs` is removed
from the type, so this is not a validation the core performs but a value a rule
can no longer produce.

**Parameters are validated per assertion, before rendering.** Name, kind,
grammar, and allowlist are all checked. `excerpt` is reserved: an assertion may
carry one only where the ruleset explicitly authorizes it, which is the
declaration of what `THREAT_MODEL.md` section 20.1 calls the excerpt "when the
rule requires it".

```ts
const PARAM_GRAMMAR: Readonly<Record<FindingParamKind, RegExp | null>> = {
  count: null,
  "http-status": null,
  excerpt: null,
  token: /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/,
  "header-name": /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/,
  "media-type":
    /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,127}\/[!#$%&'*+.^_`|~0-9A-Za-z-]{1,127}$/,
  // Printable ASCII only, minus space, "#", "?" and DEL.
  "origin-path": /^\/[!-"$->@-~]{0,1024}$/,
  // RFC 6901, with "/" and "~" escaped as the standard requires.
  "json-pointer": /^(?:\/(?:[!-.0-}]|~[01])*){0,32}$/,
};

export function validateOutcomeParams(
  declaration: AssertionDeclaration,
  params: Readonly<Record<string, FindingParam>>,
): void {
  for (const [name, param] of Object.entries(params)) {
    const spec = declaration.params[name];
    if (spec === undefined) {
      throw new RuleContractViolation(
        `${declaration.id} declares no parameter ${name}`,
      );
    }
    if (param.kind !== spec.kind) {
      throw new RuleContractViolation(
        `${declaration.id} parameter ${name} must be ${spec.kind}`,
      );
    }
    if (param.kind === "excerpt" && !declaration.excerptAuthorized) {
      throw new RuleContractViolation(
        `${declaration.id} is not authorized to carry an excerpt`,
      );
    }
    switch (param.kind) {
      case "count":
      case "http-status": {
        if (!Number.isInteger(param.value) || param.value < 0) {
          throw new RuleContractViolation(
            `${declaration.id} parameter ${name} is not a whole count`,
          );
        }
        break;
      }
      default: {
        const grammar = PARAM_GRAMMAR[param.kind];
        if (grammar !== null && !grammar.test(param.value)) {
          throw new RuleContractViolation(
            `${declaration.id} parameter ${name} fails its grammar`,
          );
        }
        if (
          spec.allowedValues !== undefined &&
          !spec.allowedValues.includes(param.value)
        ) {
          throw new RuleContractViolation(
            `${declaration.id} parameter ${name} is outside its allowed values`,
          );
        }
        break;
      }
    }
  }
  for (const [name, spec] of Object.entries(declaration.params)) {
    if (spec.required && params[name] === undefined) {
      throw new RuleContractViolation(
        `${declaration.id} requires parameter ${name}`,
      );
    }
  }
}
```

`excerpt` has no grammar because a bounded sanitized excerpt is target text by
definition. Its control is `excerptAuthorized` plus the 256-character cap, not a
pattern. Every other string kind has one, and the grammars above are the M1 set:
they are data in the ruleset schema, versioned with it, and not a constant a
rule can widen.

The remaining gap should be named rather than implied. A `token` that satisfies
the grammar and any declared allowlist is still target-derived text inside a
report, and for an assertion whose whole point is to say which token was
declared, that is the intended behavior. What the schema removes is the ability
to put something that is not a token there. The security tests in section 7
cover the rest by measurement rather than by argument.

### 7. Discovered requests carry provenance and pass an engine origin policy

`ObservationTarget.discovered` requires `provenance`, and the engine checks it
before dispatch. The rule does not decide whether a discovered URL is
authorized; it says where the URL came from, and the engine decides.

```ts
export type DiscoveredRejection =
  | "malformed"
  | "userinfo"
  | "fragment"
  | "forbidden-scheme"
  | "forbidden-port"
  | "cross-origin"
  | "unsafe-query"
  | "unknown-provenance";

export type DiscoveredDecision =
  | { readonly kind: "authorized"; readonly url: string }
  | { readonly kind: "rejected"; readonly reason: DiscoveredRejection };
```

The engine rejects a discovered request, before any socket opens, when:

- `provenance.fromObservation` does not name a completed observation belonging
  to the same rule, or that observation was an error;
- the URL does not parse, or carries userinfo, or carries a fragment;
- the scheme is not `http` or `https`;
- the port is not the authorized origin's port, or is on the forbidden-port
  list in `THREAT_MODEL.md` section 11;
- the origin differs from the authorized target origin, which under
  `local-loopback` means any cross-origin probe including a different loopback
  port and the name `localhost`;
- the query string carries a credential-shaped parameter, in which case the
  request is refused rather than redacted, because a redacted request is still
  a request that transmits the secret.

A rejected request becomes an error observation with the public code
`url-policy-blocked` (ADR-0003) and normally yields `indeterminate`. Query
values that survive are redacted in evidence per section 20.2. Redaction applies
to evidence and refusal applies to dispatch; these are two different controls
and neither substitutes for the other.

The security tests required by this section are target-controlled cookies and
authorization-like headers, a query secret, terminal and workflow control
sequences in a header and in a body, and a malformed discovered URL in each of
the rejection categories above.

Section 6's parameter schema adds one more, and it is a measurement rather than
an argument. For **every** parameter of **every** assertion in the ruleset, a
fixture serves a unique secret marker and an output-injection payload in the
position that parameter is derived from, and the test asserts that the marker
appears in no report, no reporter output, and no log, and that the payload
renders inertly. Not one representative parameter: every one, enumerated from
the ruleset so a new parameter cannot be added without a case appearing. This is
`THREAT_MODEL.md` section 27.6's marker test applied per parameter path rather
than per output format.

### 8. Request identity, deduplication, and evidence identity are three things

`ObservationRequest.id` is rule-local and **unique within one rule for the whole
scan**, across both rounds. A duplicate anywhere in that rule's scan is a
contract violation and exits 4. It is never an evidence id and never appears in
a report.

The previous revision scoped uniqueness to one rule and one round, so ids could
be reused between rounds and were internally keyed by `(ruleId, round, id)`.
Adversarial review on 2026-08-29 showed that made them unresolvable, and it is
right: `context.observation(id)` and `AssertionOutcome.observationRefs` both
carry a bare id with no round, and `finish()` can legitimately cite a round-one
observation, so an id reused across rounds has two answers at exactly the point
where the core must pick one. Scan-wide uniqueness is the smaller of the two
fixes. The alternative, a typed `{ round, id }` reference in both positions,
costs a wider rule-facing type and a migration for every citation site in order
to buy a rule the freedom to reuse a string, which no M1 rule wants.

Per round, after every selected rule has returned that round's batch:

1. canonicalize each request with the key defined in ADR-0005 section 3;
2. deduplicate in registry order, then in each rule's declaration order;
3. execute the deduplicated batch;
4. once the round's plan is stable, assign evidence ids in that same order.

Every rule-local id that canonicalized onto a shared request becomes an alias
for it. `context.observation(id)` resolves through the alias and returns the
same frozen observation object to every rule that asked for it, so the shared
robots observation costs one slot, one dispatch, and one evidence entry.

The core rewrites `AssertionOutcome.observationRefs` from rule-local ids to
canonical evidence ids when it builds `RuleFinding.evidenceRefs`, deduplicating
and sorting them. Two rules citing the same observation cite the same evidence
id. A rule-local id naming no request in a completed round exits 4. Because ids
are unique for the rule's whole scan, that rewrite needs only `(ruleId, id)` and
never has to guess a round.

Budget slots and evidence ids are therefore separate: slots are anonymous and
reserved before round one, and ids are assigned per round after that round's
plan is stable. Round-two URLs do not exist at reservation time, which is
precisely why the two cannot be the same numbering. ADR-0005 carries the
reservation rules.

### 9. Assertion ids, and compatibility gets its own

A `spec`-mode assertion id is exactly a requirement `id` declared for that rule
in the pinned ruleset. A `compat`-mode assertion id is a separate, versioned
identifier declared in the rule's compatibility block.

A compatibility finding must never reuse a normative `spec.requirements[].id`
merely because one rule implements both modes. Compatibility assertion ids are
namespaced so that the difference is visible in the report, and a compatibility
finding cites the compatibility snapshot, not the normative source:

```text
compat:<external-id>.<assertion>@<snapshot-date>
```

For example, `compat:linkHeaders.recognized-relation@2026-08-28`.

Each compatibility assertion carries `requirementClass: "compatibility"` and its
own remediation class, distinct from any normative remediation. This is what
lets `lnk-006` and `skl-006` hold opposite `spec` and `compat` verdicts on the
same observation without either verdict borrowing the other's identifier or
authority. ADR-0008 places these declarations in the native ruleset manifest.

Every assertion id in a run, of either kind, must appear in
`metadata.assertions` with a matching mode, which turns a missing registry
assertion into a contract failure rather than a wording problem.

### 10. Registry to metadata mapping

| Registry field | Metadata field |
| --- | --- |
| `rule_id` | `id` |
| `id` (camelCase, compatibility snapshot only) | `externalCompatibilityId` |
| `rule_version` | `ruleVersion` |
| `maturity` | `sourceMaturity` |
| `runtime` | `observationRuntime` |
| `profiles` | `profiles` |
| `applicability.default`, renamed per ADR-0004 | `applicability` |
| `spec.requirements[].id` plus `compat` assertion ids | `assertions` |
| `implementation_status` in the native ruleset manifest | `implementationStatus` |
| top-level `ruleset_id` / `ruleset_version` | `ruleset` |

`implementationStatus` comes from the native ruleset manifest and from nowhere
else. The previous revision said it came from `PROJECT_STATUS.md` and from
nothing in the registry, which directly contradicted ADR-0008's requirement that
the manifest carry `implementation_status`, and `PROJECT_STATUS.md` holds
project-wide phase information with no per-rule field at all. ADR-0008 makes the
manifest the single machine-readable authority and `PROJECT_STATUS.md` a
generated summary. It is never derived from `maturity`, which describes the
pinned source set.

### 11. Memo values are validated as plain data, then deeply frozen

`ARCHITECTURE.md` section 7 prescribes one shared parsed robots representation
consumed by three rules, while section 1 promises that "one rule cannot change
another rule's evidence". Nothing makes the shared value immutable, so the
second promise does not currently hold. Memo results are deeply frozen before
being returned, and the loader is synchronous like everything else a rule runs:

```ts
export function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }
  return value;
}
```

What it costs: one full walk per memo key, and a real restriction on what a memo
may hold. `Object.freeze` does not stop `Map.prototype.set`, `Set.prototype.add`,
or a write into a `Uint8Array` element, so memo values are restricted to plain
objects, arrays, strings, numbers, booleans, and `null`. A parser wanting to
return a `Map` returns a frozen array of frozen pairs instead. A contract test
must prove a mutation attempt on a memo result throws under ESM strict mode.

#### The previous revision stated the restriction and enforced nothing

It said `deepFreeze` is generic over `T`, acknowledged that freezing does not
immobilize a `Map`, a `Set`, or a typed array, declared those values forbidden,
and then defined neither a validation nor a violation. Adversarial review on
2026-08-29 was right that a restriction with no check is a comment. Worse, the
walk itself reads every own property, so a getter returning a fresh object on
each call would have been invoked by the freezing pass and would have defeated
it silently.

Memo results are therefore **validated before they are cached**, and rejection
is an enumerated contract violation that exits 4 (section 5). Validation runs
first and freezing second, because the freezing walk is only safe once accessors
are known to be absent.

```ts
const PLAIN_PROTOTYPES: readonly unknown[] = [
  Object.prototype,
  Array.prototype,
  null,
];

function assertPlainData(value: unknown, seen: Set<object>): void {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value !== "object") {
    throw new RuleContractViolation(`memo value of type ${typeof value}`);
  }
  if (value === null) {
    return;
  }
  if (seen.has(value)) {
    throw new RuleContractViolation("memo value is cyclic or shares a node");
  }
  seen.add(value);
  if (!PLAIN_PROTOTYPES.includes(Object.getPrototypeOf(value))) {
    throw new RuleContractViolation("memo value has a non-plain prototype");
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") {
      throw new RuleContractViolation("memo value has a symbol-keyed property");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new RuleContractViolation("memo value has an accessor property");
    }
    assertPlainData(descriptor.value, seen);
  }
}

export function acceptMemoValue<T>(value: T): T {
  assertPlainData(value, new Set<object>());
  return deepFreeze(value);
}
```

`memo()` calls `acceptMemoValue` on the loader's result and caches only what it
returns. Four things this rejects are worth naming, because each one is a way
the previous revision's promise could have been broken without any code looking
wrong:

- a `Map`, `Set`, `Date`, `Uint8Array`, `RegExp`, `Error`, or class instance,
  caught by the prototype check rather than by a list of banned constructors,
  so a type nobody thought of is rejected too;
- an accessor property, whether or not it is enumerable;
- a cycle, and also a plain object appearing twice in one memo value, which is
  rejected together with cycles because the walk cannot tell them apart without
  a second pass and neither is worth one;
- `undefined` anywhere, including as a property value, because canonical JSON
  cannot distinguish a `undefined` property from an absent one and the report
  must not depend on which the parser produced.

A `null` prototype is permitted alongside `Object.prototype` because
`Object.create(null)` is the safer shape for a parser building a map keyed by
target-controlled strings, and forbidding it would push parsers toward the
prototype-polluting alternative.

`Object.isFrozen` short-circuits `deepFreeze` but not `assertPlainData`, so a
frozen `Map` is still rejected. Validation is a property of the value, not of
its freeze state.

### 12. Forbidden

- a `Promise`, `async` function, `AbortSignal`, `URL`, timer, or callback
  scheduled for later, anywhere in the rule-facing interface;
- rules calling global `fetch`, Undici, `node:http`, DNS, sockets, the
  filesystem, environment variables, the clock, or randomness, enforced by the
  controls in section 2 and not by the signature;
- a rule returning a status, a requirement class, a message string, or a source
  reference;
- a rule returning `unsupported-runtime`;
- an outcome set mixing `not-present` with an evaluated outcome kind;
- an invoked rule returning no outcomes, or omitting an assertion it declares
  for the active mode;
- a `not-present` outcome used for a condition that did not arise inside a
  mechanism the target does deploy;
- a third round, a round-two batch exceeding `roundTwoBudget`, or a round-one
  request naming an absolute discovered URL;
- a discovered request without provenance, or one the engine origin policy
  rejected being retried through another path;
- an assertion id outside `metadata.assertions`, or used in the wrong mode;
- a compatibility finding citing a normative requirement id or a normative
  source instead of the compatibility snapshot;
- a parameter the assertion does not declare, of the wrong kind, failing its
  grammar or allowlist, or an `excerpt` on an assertion that is not authorized
  to carry one;
- a rule-local request id reused anywhere within one rule's scan, or treated as
  an evidence id;
- mutating a memo result, or storing in one a `Map`, `Set`, `Date`,
  `Uint8Array`, `RegExp`, class instance, accessor property, symbol key, cycle,
  or `undefined`.

## Rationale

Two rounds put the boundary where the information appears. Everything knowable
from configuration is knowable before the network is touched, which is what
makes pre-flight validation, deduplication, and stable budget allocation
possible. Everything knowable only from a response is fetched through the same
policy as everything else, so discovery does not become a second, weaker
transport path. Fixing the count at two rather than parameterizing it removes
continuation state that nothing in M1 needs.

Deriving status in the core keeps one precedence rule in one place, and more
importantly moves the requirement-class mapping out of rule code entirely. The
previous design's rule-written `status` field was the single largest gap between
what this project promises about `fail` and what its types could enforce.

Static templates are the same argument applied to prose. A sanitizer cannot
safely bound a string whose structure it does not know, so the structure is
fixed and only the leaves vary. This costs expressiveness at exactly the place
where expressiveness is a liability.

Saying plainly that synchronicity is not a sandbox is not a weakening. A control
believed to be enforced by the compiler receives no further review, and the
first plugin proposal would have inherited a boundary that never existed.

## Consequences

### Positive

- An invalid configuration is rejected with zero transport calls.
- The full round-one plan exists before the first socket opens.
- The robots observation is planned once and shared by three rules.
- Response arrival order is not observable by rule code at all.
- A recommended assertion cannot produce `fail` under any rule implementation.
- A rule cannot become `not-applicable` by returning nothing, and cannot become
  `pass` by omitting the assertion it would have failed.
- No target-controlled string reaches a report through a finding message, and
  what reaches a template parameter is constrained by name, kind, grammar, and
  allowlist rather than by length alone.
- A finding cites the sources its assertion rests on, because a rule has no way
  to supply a citation at all.
- A memo value that a freeze cannot immobilize is rejected before it is cached,
  rather than being listed as forbidden and accepted.
- A compatibility verdict and a specification verdict on the same mechanism
  carry different identifiers, classes, and cited sources.
- The rule package compiles under `lib: ["ES2023"], types: []`.

### Costs

- Rules are more verbose: three entry points instead of one, and round-two
  logic must be expressible as a function of round-one observations.
- A rule cannot express a message a template does not already contain, so
  adding diagnostic detail is a ruleset change with a version bump.
- Template and parameter tables must be written, reviewed, and covered for
  every assertion and outcome kind, which is more surface than a string field.
- Each assertion now also carries its authoritative sources, a parameter schema,
  and an excerpt authorization, so a new assertion is a four-part ruleset change
  before any rule code exists.
- Requiring an outcome for every declared assertion means a rule cannot stay
  silent about a dimension it has not implemented yet. It must report
  `indeterminate` and say so, which is more honest and more verbose.
- Memo validation walks the whole value a second time before freezing it, and
  forbids shapes a parser might reasonably have produced, notably a shared
  subtree appearing under two keys.
- The two-round limit is a hard ceiling. A future mechanism needing two hops
  requires a new ADR, not a configuration value.
- The security boundary now depends on lint rules, dependency inspection, and a
  no-I/O test, all of which a contributor with commit access can disable. That
  is why third-party rules stay forbidden until a process boundary exists.

### Implementation constraints

- The rule package pins `lib: ["ES2023"], types: []` and a compile test asserts
  that `AbortSignal`, `URL`, `fetch`, and `process` are unresolvable there.
- ADR-0007 says remediation is keyed by finding code, "which ADR-0002 makes
  identical to a registry requirement `id`". After section 9 that is true only
  of `spec`-mode codes, and remediation coverage must extend to compatibility
  assertion ids. The sentence is corrected in ADR-0007; the coverage gate
  belongs to the report-schema work.
- `ARCHITECTURE.md` section 6 must be replaced by a reference to this ADR,
  because `RuleV1`, `RuleContextV1`, `probe`, and `probeAll` no longer exist.
- `specs/ruleset.schema.json` (ADR-0008) must carry, per declared assertion, the
  authoritative `source_refs`, the parameter schema, and the excerpt
  authorization that section 6 requires, and must reject an assertion that
  declares a parameter no template for that assertion references.
- A contract test enumerates every assertion in the pinned ruleset and asserts
  that every template placeholder resolves to a declared parameter and every
  required declared parameter appears in at least one template.
- The engine test suite covers the section 5 violations directly: a rule
  returning no outcomes, a rule omitting one declared assertion, and an outcome
  set mixing `not-present` with an evaluated kind, each asserted to exit 4.
- A test asserts that a rule reusing one request id across its two rounds exits
  4, and that two different rules using the same id string do not collide.
- A memo test passes a `Map`, a `Set`, a `Uint8Array`, an object with a getter,
  an object with a symbol key, a cyclic object, a shared subtree, and an
  `undefined` property, and asserts each exits 4 before anything is cached.

### Noted, not resolved here

`ARCHITECTURE.md` section 9 models public evidence headers as
`Readonly<Record<string, string>>`, which cannot represent the two `Link` field
lines fixture `lnk-001` requires. `HttpObservation` above uses
`ReadonlyMap<string, readonly string[]>`. The public evidence shape needs the
same correction, which belongs to the report-schema work. ADR-0006 records the
matching defect on the fixture-serving side.

## Alternatives considered

### Keep the async `evaluate()` with `context.probe()`

Rejected, and the five specific reasons are recorded in `## Context` rather than
summarized here, because the first revision of this ADR accepted that design and
the record should show why it was withdrawn.

### Pure declaration, as FR-3 states

Rejected: `map-002`, API Catalog link resolution, and `skl-007` are inherently
two-phase. Forcing them into one phase means fetching every plausible discovery
URL speculatively, wasting the 24-request budget on requests the target never
advertised.

### Pure imperative probing, as `ARCHITECTURE.md` section 6 states

Rejected: it makes pre-flight budget checking impossible and defeats the M0
criterion that an invalid configuration performs no transport call.

### A generic N-round state machine with rule-held continuation state

Rejected: no M1 mechanism needs a second hop, the state would be opaque to the
engine and mutable by the rule, and an unbounded round count reintroduces the
budget starvation that fixed rounds remove.

### Let rules keep `status` but validate it against the class

Rejected: the validator would have to recompute the status in order to compare
it, at which point the rule-supplied value is decoration that can only disagree.

### Let rules keep `message` and sanitize it aggressively

Rejected: sanitizing an arbitrary string means guessing its structure. The
aggressive version deletes the characters that made the message useful, and the
permissive version is the injection surface `THREAT_MODEL.md` section 20.3
describes.

### A transport handle per rule

Rejected: it recreates the boundary `SEC-ARCH-01` and `SEC-ARCH-02` exist to
prevent.

### Run rules in a worker or separate process now

Rejected for M1 as premature: with only built-in reviewed rules the added cost
buys no reduction in the actual threat. The design is recorded in section 2 as
the prerequisite for third-party rules rather than dropped.

## Revisit conditions

- A rule family needs a second discovery hop, which requires a new ADR and not a
  larger budget constant.
- A third-party rule API is proposed, at which point section 2's process
  boundary becomes a prerequisite and `apiVersion` gains a handshake.
- Browser observation arrives at M6 and needs a third observation kind.
- Template rendering proves too rigid for a rule whose useful diagnostic is
  genuinely structural rather than parametric.
- Deep freezing proves measurably costly on large parsed documents.

## Related documents

- [ADR-0001: Scope, modes, and no aggregate score](0001-scope-modes-and-scoring.md)
- [ADR-0003: Unified transport error vocabulary](0003-transport-error-vocabulary.md)
- [ADR-0004: Rule selection, applicability, and opt-in](0004-rule-selection-and-applicability.md)
- [ADR-0005: Determinism and evidence identity](0005-determinism-and-evidence-identity.md)
- [ADR-0008: Registry extensibility and missing assertions](0008-registry-extensibility.md)
- [Architecture](../ARCHITECTURE.md)
- [Implementation specification](../IMPLEMENTATION_SPEC.md)
- [Threat model](../THREAT_MODEL.md)
- [Test strategy](../TEST_STRATEGY.md)
