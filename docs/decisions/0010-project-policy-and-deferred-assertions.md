# ADR-0010: Project policy as a named source, and deferred assertions

- Status: Accepted
- Decision date: 2026-08-29
- Owners: Initial maintainers
- Applies from: M1

## Context

The engine fails closed on an uncited assertion. `validateRuleAssertions` in
`packages/core/src/engine/validate-outcomes.ts` throws
`assertion-sources-unassigned` for any active assertion whose `source_refs` is
empty, and that is a `ConfigurationError`: exit 2, before a socket opens. The
comment beside it says why, and the reasoning is right. An assertion with no
authoritative source is a packaging defect, nothing a target does can change
it, and no scan of any target could succeed.

Attribution work on 2026-08-29 assigned `source_refs` to the eight M1 rules by
reading each requirement against `specs/sources.v0.yaml`. It cited 26 of the 28
`spec` assertions and refused two. Both refusals are correct, and together they
kept `web.discovery.link` and `agent.discovery.skills` from running at all.

**`links.agent-useful`** reads "Classify selected discovery relations as
agent-useful under a separately versioned AgentReady Lab policy." No source in
the ledger defines an agent-useful relation set, and three repository documents
say so independently. `specs/checks.v0.yaml` carries its own caveat that "RFC
8288 defines Web Linking but does not define a universal set of agent-useful
relation types". `docs/STANDARDS_REGISTRY.md` check 3 says "The allowlist is
compatibility policy." `docs/IMPLEMENTATION_SPEC.md` section 22.3 calls the set
"project-defined". Citing RFC 8288 would have manufactured a normative hook the
RFC does not provide, which is exactly the error ADR-0009 was written to stop:
that decision records the same mistake being made twice for Content Signals,
once by inventing a grammar and once by looking for a normative hook in RFC 9309
section 2.2.4 and finding a `MAY`.

**`skills.archive-safety`** reads "Inspect archive metadata under strict size,
file-count, path, link, and compression-ratio limits without executing content."
`agent-skills-discovery-v0.2.0` defines the `archive` entry type and a `sha256:`
digest over an artifact's raw bytes, and states no limit of any kind. The limits
come from `docs/THREAT_MODEL.md` section 19.6, which is this project's own
control, and which also records that "Downloaded Agent Skills archives are not
unpacked in the MVP."

The two look alike because they share a symptom, and they are not alike. One
assertion has an author and the ledger had no way to name it. The other has no
author yet and cannot be evaluated in M1 even if it did, because the observation
it describes is never made.

What is missing is therefore not two citations. It is two admissions the
registry does not currently let this project make: that the project is
sometimes the author of what it asserts, and that "declared but not evaluated"
is a state distinct from pass, from fail, and from retired.

## Decision

### 1. The project may be a source of its own policy, and it must be labelled as one

Some assertions are honest project policy rather than specification conformance.
The failure mode to avoid is not that the project has policy. It is project
policy wearing a specification's citation. So the policy gets a ledger entry
that can only be read as what it is.

`specs/sources.schema.json` gains one `kind` value and one `status` value:

| Field | New value | Meaning |
| --- | --- | --- |
| `kind` | `project-policy` | Written by this project. Not published, reviewed, or endorsed by anyone else. |
| `status` | `adopted-policy` | In force at the stated `version`, by an accepted decision. |

Both are additions rather than reuse, and the reuse that was available would
have been a misdescription in each case.

**`kind`.** `vendor-convention` is the closest existing value and it is wrong in
the one way that matters: every entry carrying it (`cloudflare-markdown-agents`,
`openai-crawlers`, `google-crawlers`, `anthropic-crawlers`,
`cloudflare-ai-crawl-control`) records a third party's documented behavior that
this project observed on a date. This project is not a third party to its own
policy, and the word "vendor" would put our opinion in the same category as
OpenAI's crawler documentation. `open-source-profile` is worse, because
`agent-skills-discovery-v0.2.0` and `auth-md-repository` carry it and both are
someone else's published profile that this project independently implements. A
profile of our own authorship that we then check against is not the same kind of
artifact, and calling it one would erase the difference. `ecosystem-specification`
and `standards-organization` are not arguable.

**`status`.** `convention` travels with `vendor-convention` throughout the file
and inherits the same problem. `final`, `living-specification`, and
`proposed-standard` all say "specification", which is precisely the word this
entry must not borrow. `proposal` understates it in the other direction: the
policy is adopted and in force, not offered for consideration.

#### A self-authored source has no URL, and must not be given one

`url` is required by the ledger schema and `checkUrl` in
`scripts/lib/validate-registry.ts` rejects anything that is not `https:`. This
project publishes no URL for its own policy. There is no canonical site, and the
repository has no configured remote.

Writing a plausible `https://` URL beside a self-authored entry would be
fabricating provenance in the field a reader trusts most, in the same file whose
whole purpose is provenance. So `url` becomes conditionally required and a
`project-policy` source carries `document` instead, holding the repository
path of the text:

```yaml
- id: "agentready-lab-agent-useful-relations"
  title: "AgentReady Lab agent-useful relation policy"
  document: "docs/decisions/0010-project-policy-and-deferred-assertions.md"
  kind: "project-policy"
  status: "adopted-policy"
  version: "0.1.0"
  verified_at: "2026-08-29"
```

The schema makes the two locators mutually exclusive in both directions. A
`project-policy` source that carries a `url` is a schema violation, and so is
any other source that carries a `document`. `notes` and `version` are required
on a `project-policy` source and optional everywhere else, because an entry that
does not say what it is and does not say which version it is has given a reader
nothing.

`verified_at` means something different here and the entry says so. On an
external source it is the date the source was fetched and read. On this one it
is the date the policy text and the ledger entry were confirmed to agree.

### 2. The AgentReady Lab agent-useful relation policy, version 0.1.0

Policy 0.1.0 classifies exactly three relation names as agent-useful:

```text
service-desc
describedby
api-catalog
```

Each is adopted for its own reason, and the reason is always the same shape:
following the link gets an agent something machine-readable about the service
rather than something for a human to look at.

- `service-desc` names a machine-readable description of the service behind the
  resource.
- `describedby` names a resource that describes the current one, which is the
  general form of the same idea.
- `api-catalog` is the relation `web.discovery.api-catalog` already validates
  under `rfc9727`, which this ledger pins. A homepage advertising it is pointing
  an agent at the catalog that rule reads.

Everything else is excluded in 0.1.0, and the exclusions are the point of the
assertion. `stylesheet`, `icon`, `canonical`, and the sequential navigation
relations describe presentation, identity, and ordering. Fixture `lnk-005`
serves a syntactically valid header exposing only `rel="stylesheet"` and expects
`spec: pass` for syntax plus a warning for no selected discovery relation. That
expectation is unchanged by this decision and must stay unchanged.

#### The set is adopted, not inherited

`specs/checks.v0.yaml` names the same three relations in its compatibility pass
heuristic. That is a coincidence this decision accepts deliberately, and it does
not make the snapshot the source. ADR-0009 section 2 is explicit that a
compatibility heuristic "has no authority in `spec` mode", and the first
revision of that decision made exactly this mistake by letting a dated external
heuristic decide a specification verdict.

The three reasons above are the authority for policy 0.1.0. If the external
snapshot's heuristic changes on its next capture date, this policy does not
change with it, and a future maintainer comparing the two lists must treat their
agreement as a fact to re-derive rather than a fact to preserve.

#### The policy classifies, and defines nothing

The policy asserts nothing about whether these relation names exist, who
registered them, or what they mean. RFC 8288 remains the only authority for
parsing a `Link` field and for interpreting a relation name, and `links.parse`
and `links.relation` continue to cite `rfc8288` for exactly that. The policy
supplies one thing that no external source supplies, which is the judgment about
which relations are worth an agent's attention.

`links.agent-useful` therefore cites `agentready-lab-agent-useful-relations`
section 2, and nothing else. Its `strength` is `advisory` and stays `advisory`.

#### The policy is the default option value, not a fixed one

ADR-0004 section 8 makes "the versioned agent-useful relation allowlist" a typed
`rules.options` input to `web.discovery.link`. Policy 0.1.0 is the default value
of that option. A user may supply a different allowlist, and ADR-0004 section 8
already requires the complete validated effective option set to be recorded in
the report, including values that came from a rule's `defaultOptions`.

Changing the policy set requires a policy `version` bump, a new `verified_at`,
a `rule_version` bump on `web.discovery.link`, and updated fixtures. It is not
an in-place edit.

### 3. What a project-policy source may never do

These are prohibitions, not guidance. Each one closes a route by which this
project's opinion could be presented as somebody else's specification.

1. **A project-policy source may never be cited by a `normative` assertion.**
   `normative` is the only strength that maps a `violated` outcome to `fail`
   under ADR-0002 section 5. No `fail` may ever rest on this project's own
   opinion about what is worth doing. `recommended` and `advisory` are both
   permitted, because both map to `warning` and the difference between them is
   prose.

2. **An assertion may never cite a project-policy source and an external source
   together.** ADR-0002 section 6 copies `RuleFinding.sourceRefs` from the
   assertion declaration wholesale, so a mixed list renders in a report as one
   authority list, and a reader would take the RFC beside it as endorsement. An
   assertion's `source_refs` is therefore either entirely project-policy or
   entirely external. If a rule needs both, it needs two assertions.

3. **A project-policy source must state what it is in its own `notes`.** The
   first note says the entry was written by this project and that no external
   body has reviewed or endorsed it. `notes` is required on a `project-policy`
   entry for this reason. A reader who reaches the entry through a report and
   not through this decision must still be told.

4. **A finding may not present a user-supplied allowlist under the policy's
   authority.** The citation is fixed per assertion and cannot vary with an
   option, so when the effective allowlist differs from the policy's set, the
   rendered message and `rules explain` must show the effective set rather than
   implying the cited policy produced the verdict. The report already carries
   the effective options; the message template is what must not lie about which
   of the two decided.

5. **A project-policy source may never be cited for a syntax, grammar, or
   relation-semantics claim.** Those belong to whichever external source governs
   them, or to no assertion at all. This is the specific thing ADR-0009 refused
   to do for Content Signals, and admitting a project-policy `kind` must not
   reopen it. The route back in would be to write a grammar, file it as project
   policy, and cite it. That is forbidden.

### 4. `skills.archive-safety` is deferred, not silently passed

The MVP does not unpack archives, so this assertion cannot be evaluated.
Emitting `pass` for an uninspected archive would be a claim the scanner never
checked. Emitting `fail` would be worse, because it would be a claim about a
target that did nothing wrong. Both are available today and neither is honest,
so the ruleset gains a way to say the third thing.

`specs/ruleset.schema.json` gains an optional `deferred` marker on an assertion:

```yaml
deferred:
  adr: "ADR-0010"
  reason: >-
    ...
  until: >-
    ...
```

All three fields are required when the marker is present. `adr` names the
accepted decision that deferred it, on the same reasoning ADR-0008 section 2
uses for `retired_requirements`: a deferral with no decision behind it is the
silent pass this marker exists to prevent. `until` states the event that
un-defers it, not a date.

A deferred assertion:

- is **excluded** from ADR-0002 section 5's requirement that every applicable
  assertion for the active mode carries exactly one outcome;
- **never produces a finding**, of any status, including `not-applicable` and
  `unable-to-check`. It is absent from the report's findings rather than
  present with a neutral verdict;
- is reported by `agentready-lab rules explain <rule-id>` as deferred, with its
  `reason` and its `until` condition;
- is counted by a coverage gate as **deferred**, never as covered. This applies
  to the remediation completeness gate ADR-0007 section 3 defines and to ADR-0002's
  message-template contract test, which must not demand a template for an
  assertion that can never render one;
- carries **no** `source_refs`, no `params`, and no excerpt authorization. The
  schema enforces all three, because an assertion that is not evaluated makes no
  claim, and a citation on it would be a claim resting on a source.

**Deferral is not retirement.** ADR-0008 section 2 requires a published
requirement to be retired rather than dropped, and a `retired_requirements`
entry says the project no longer declares it. `skills.archive-safety` is still
declared, keeps its id, keeps its text, and returns when the `until` condition
is met. Retiring it would have lost the requirement, and re-adding it later
would have needed a new id under the reserved-identifier rule.

**The un-defer condition** is an accepted decision permitting a downloaded skill
archive to be unpacked under the controls `docs/THREAT_MODEL.md` section 19.6
lists, naming the limit values. That decision must also assign `source_refs` for
the limits it sets. Under section 1 those may be a project-policy source,
provided section 3's first prohibition holds and the assertion is not
`normative`. `skills.archive-safety` is `recommended` today, which is already
compatible.

#### The marker is data that no code reads yet

`skills.archive-safety` keeps one `todo`, and the todo says why. Two changes are
required and neither belongs to `specs/`:

- `scripts/lib/validate-registry.ts` must accept a `deferred` marker in place of
  a citation, instead of reporting `uncited-assertion` for an assertion with no
  `source_refs` and no `todo`;
- `packages/core/src/engine/validate-outcomes.ts` must exclude a deferred
  assertion from the active set returned by `validateRuleAssertions`, from the
  `assertion-sources-unassigned` check, and from `validateRuleOutcomes`.

Until both land, `agent.discovery.skills` still cannot run. The blocker this
decision clears is in the data, and the code has to follow. The `todo` is
removed with those changes and not before.

### 5. Version axes

| Axis | Artifact | From | To |
| --- | --- | --- | --- |
| `source_ledger_version` | source ledger | `0.3.0` | `0.4.0` |
| `ruleset_version` | ruleset | `0.3.0` | `0.4.0` |
| `web.discovery.link` `rule_version` | ruleset | `0.1.0` | unchanged |
| `agent.discovery.skills` `rule_version` | ruleset | `0.1.0` | unchanged |
| `snapshot.captured_at` | snapshot | `2026-08-28` | unchanged |

`source_ledger_version` moves because a source is added.

`ruleset_version` moves because the executable interpretation changed. Two rules
go from refusing to start to running, and one of them now reports three outcomes
where it declares four assertions. `specs/ruleset.standard.v0.digest.txt` moves
with it. `specs/checks.v0.digest.txt` does not, because the snapshot is not
edited.

#### No `rule_version` bump, and the recommended reason for it was wrong

The attribution work recommended no per-rule bump on two grounds: that this is
"one interpretation change recorded once rather than eight times", and that no
verdict semantics changed. The conclusion is adopted and the first ground is
rejected.

The "eight times" framing is wrong. ADR-0010 touches two rules, not eight. The
other six M1 rules keep the citations attribution assigned them and are not
edited by this decision, so no version on them was ever in question.

The second ground holds for `web.discovery.link` and does not hold for
`agent.discovery.skills`, which is the closest call in this decision.
`links.agent-useful` was `advisory` before and is `advisory` now, the relation
set was already a rule option under ADR-0004 section 8, and `lnk-005` expects
the same warning it always did. Nothing about a verdict moves.
`agent.discovery.skills` is different: it declares four `spec` assertions and
will report three outcomes, a `recommended` assertion that could have produced a
`warning` never will, and `deriveRuleStatus` folds a smaller set. Under
ADR-0008 section 5's own standard, "add public assertion identifiers and change
verdicts", that is half of a bump.

It does not get one, for a reason that is specific and will expire. At
`ruleset_version` `0.3.0` this rule could not execute: `validateRuleAssertions`
threw `assertion-sources-unassigned` before any transport call. No scan has ever
produced a verdict for `agent.discovery.skills`, so no report exists carrying
`rule_version` `0.1.0` for it, and a bump would distinguish a version that
produced verdicts from a version that produced none. That is a distinction with
no reader. `ruleset_version` and the ruleset digest already separate the two
states for anyone who needs them, and both reach the report.

This reason is available exactly once. The decision that un-defers
`skills.archive-safety` will be changing a rule that has produced reports, and
it **must** bump `agent.discovery.skills` `rule_version`. So must any later
change to the relation set in policy 0.1.0, for `web.discovery.link`.

The lane this agent was given did not decide it. Bumping would have required
regenerating the `PROJECT_STATUS.md` table, which is convenient to avoid and is
not a reason; had `agent.discovery.skills` ever produced a report at `0.1.0`,
the answer here would have been the other one.

### 6. Recorded, not resolved: `markdown.fidelity`

The attribution work flagged `markdown.fidelity`, cited to `rfc9110`, as its
lowest-confidence call, and it is left as it stands for a maintainer to settle.
The citation is not changed by this decision.

The assertion reads "Check that critical headings, links, code, and factual text
remain represented without invented content." No repository document ties
fidelity to any source. The attribution reasoned by analogy to
`markdown.negotiation` in the same rule, which cites `rfc9110` for content
negotiation.

**For keeping `rfc9110`.** RFC 9110 defines a representation as a rendering of
a resource's current state, so a Markdown representation that omits or invents
content is arguably not a representation of the same resource. The rule already
rests on RFC 9110 for negotiation, and the two assertions are about the same
exchange.

**For calling it project policy.** RFC 9110 has no fidelity criterion. It does
not say which content is critical, does not define "invented", and offers
nothing to test a specific pair of representations against. The rule's own
`interop` caveat says "Do not use an LLM as the pass/fail oracle for semantic
fidelity", which is this project deciding how the check behaves, not a source
constraining it. If the check is real, its criterion is ours, and section 1 now
provides an honest home for it.

The reason to leave it open rather than settle it here is that the two
resolutions differ in kind. Keeping `rfc9110` needs a section pointer read out
of the RFC, which is a reading nobody in this repository has done and recorded.
Moving it to project policy needs the fidelity criterion written down, which
nobody has written. Choosing between them without doing either would be picking
the answer that requires less work, and `markdown.fidelity` is `advisory`, so
nothing is blocked while it stands.

## Rationale

The registry already had a defence against a compatibility observation deciding
a specification verdict: ADR-0002 section 9 gives compatibility assertions their
own identifiers and their own requirement class, so a `compat` verdict cannot be
emitted under a normative assertion id even by accident. ADR-0009's rationale
explains why that defence is structural rather than editorial, and the sentence
generalizes: "A compatibility heuristic is a real, checkable, dated artifact,
and once it is written down it reads exactly like a specification. The only
thing that distinguishes it is provenance, and provenance is invisible at the
point of use."

Project policy is the same hazard from a different direction, and it had no
defence at all. The ledger could hold only external sources, so an assertion
resting on our own judgment had two options: borrow somebody's RFC, or refuse to
run. Attribution took the second, correctly, and that is why two rules were
blocked. Adding `project-policy` gives the honest third option and makes the
provenance visible in a field, which is where the ADR-0009 rationale says it has
to be.

Refusing the URL matters more than it looks. Every other defence here is a label
a careful reader checks. A fabricated `https://` link is the one thing a reader
would not check, because it looks like the answer to the question they were
asking. The schema making `url` and `document` mutually exclusive means the
mistake cannot be made quietly.

Deferral is the same argument applied to time rather than authorship. The
registry could express "this is required", "this was required and no longer is",
and, through an empty citation list, "we have not decided". It could not express
"we have decided, and the answer is that this is not evaluated yet". Without
that, the pressure on a maintainer who wants the rule to run is to pick a
verdict, and the available verdicts are a false pass and a false fail. Giving
the state a name and a required `until` condition is cheaper than either, and it
keeps the assertion visible instead of quietly correct.

Making the deferred assertion carry no sources, no parameters, and no template
is not tidiness. It removes the surface on which a deferred assertion could
accumulate the appearance of being checked.

## Consequences

### Positive

- The two blocked M1 rules are unblocked in the data. All 28 `spec` assertions
  across the eight M1 rules are now either cited or explicitly deferred, and
  none would raise `assertion-sources-unassigned`.
- This project's judgment is citable without being disguised. A report showing
  a `links.agent-useful` warning names the AgentReady Lab policy as its source,
  with `kind: project-policy`, and a reader can see in one field that no
  external body said this.
- The agent-useful relation set is written down, versioned, dated, and given
  reasons for the first time. It was previously described by three documents as
  project-defined without any document defining it.
- "Not evaluated" is now distinct from `pass`, `fail`, `not-applicable`,
  `unable-to-check`, and retired, and carries the decision that made it so.
- A relation-set change and a policy change both now require a version bump
  somewhere visible, rather than an edit to an allowlist nobody versions.

### Costs

- The source ledger holds two kinds of thing that a reader must keep apart, and
  the labels are what keep them apart. Section 3 is a set of prohibitions
  because there is no structural bar against a future contributor filing an
  invented grammar as project policy and citing it. The bar is review.
- One new enum value in each of two published enums, and a conditional branch in
  a schema that was previously flat. `sources.schema.json` is harder to read
  than it was.
- `ReportSource` in `packages/core/src/model/report.ts` declares
  `readonly url: string`, which a `project-policy` source cannot satisfy. The
  type has to change before a report can cite one.
- `agent.discovery.skills` will report three outcomes against four declared
  assertions, which looks like a defect until the reader reaches the `deferred`
  marker. That is the intended trade against a fourth outcome that would be a
  false claim.
- The `deferred` marker is data no code reads yet, so `skills.archive-safety`
  keeps a `todo` and its rule still cannot run. The decision is recorded ahead
  of the code that honours it.
- Nothing in this decision improves `markdown.fidelity`, which may be the same
  problem in a third place.

### Implementation constraints

- `scripts/lib/validate-registry.ts` must treat a `deferred` marker as an
  alternative to a `todo` in the `uncited-assertion` check, and must report a
  deferred assertion as a listed note beside the existing deltas, so that
  `pnpm specs:validate` prints every deferral on a clean run.
- The same validator must enforce section 3's second prohibition, which the
  schema cannot: an assertion's `source_refs` may not mix a `project-policy`
  source with any other kind. It must also enforce the first, that no assertion
  with `strength: normative` cites a `project-policy` source. Both need the
  ledger and the ruleset together, which is why they are validator checks and
  not schema keywords.
- `packages/core/src/engine/validate-outcomes.ts` must exclude a deferred
  assertion from `validateRuleAssertions`'s returned active set, so that it is
  never reached by the `assertion-sources-unassigned` check and never demanded
  by `validateRuleOutcomes`. A rule that reports an outcome for a deferred
  assertion is a `RuleContractViolation`, not a silently accepted extra.
- `deriveRuleStatus` is unaffected and must stay unaffected. A deferred
  assertion contributes no status, so a rule all of whose assertions were
  deferred would return no outcomes, which ADR-0002 section 5 already treats as
  a contract violation. That is the correct answer, and no rule in M1 is in that
  state.
- `ReportSource` becomes a union, so that no projected source can carry both
  locators or neither. The remaining half of the rule, that `document` appears
  only when `kind` is `project-policy`, is not expressible here without closing
  `kind` to a literal union that would duplicate the ledger's enum in code, so a
  contract test asserts that half over the projected ledger. Verified to compile
  under `--strict --exactOptionalPropertyTypes`, and verified to reject both a
  source carrying two locators and a source carrying none:

  ```ts
  export interface ReportSourceBase {
    readonly id: string;
    readonly title: string;
    readonly kind: string;
    readonly status: string;
    readonly version?: string;
    readonly verifiedAt: string;
  }

  /** An external source, located by its published URL. */
  export interface ExternalReportSource extends ReportSourceBase {
    readonly url: string;
    readonly document?: never;
  }

  /** ADR-0010 section 1. Self-authored, located by repository path. */
  export interface ProjectPolicyReportSource extends ReportSourceBase {
    readonly kind: "project-policy";
    readonly version: string;
    readonly url?: never;
    readonly document: string;
  }

  export type ReportSource =
    | ExternalReportSource
    | ProjectPolicyReportSource;
  ```

- The `deferred` marker is read from the pinned ruleset alongside the rest of an
  assertion's declaration, and a rule cannot see it or set it:

  ```ts
  export interface AssertionDeferral {
    /** The accepted decision that deferred it, as `ADR-0010`. */
    readonly adr: string;
    readonly reason: string;
    /** The event that un-defers it. */
    readonly until: string;
  }

  export interface DeclaredAssertion {
    readonly id: string;
    readonly sourceRefs: readonly string[];
    /** Present only on a deferred assertion, which is never evaluated. */
    readonly deferred?: AssertionDeferral;
  }

  export function isEvaluated(assertion: DeclaredAssertion): boolean {
    return assertion.deferred === undefined;
  }
  ```

- `agentready-lab rules explain <rule-id>` lists a deferred assertion in a
  section of its own, with `reason` and `until`, and never in the list of
  assertions the rule evaluates. A reader must not have to infer the deferral
  from an assertion's absence.
- The message-template contract test of ADR-0002's implementation constraints
  enumerates every assertion in the pinned ruleset. It must skip deferred
  assertions rather than demanding a template that could never render.
- `specs/README.md` says "assertion with no `source_refs` and no `todo` is a
  validation failure", which is now incomplete. It needs the `deferred`
  alternative and a line on `project-policy` sources having `document` rather
  than a URL. Its rule that "every URL uses HTTPS" is unaffected, because a
  `project-policy` source has no URL to check.
- `docs/IMPLEMENTATION_SPEC.md` section 22.3 says this rule "distinguishes RFC
  8288 syntax from project-defined 'agent-useful' relations", which is still
  true and now under-specified. It should name the policy source.

Nothing else in the repository becomes stale. `docs/STANDARDS_REGISTRY.md` check
3 describes the external tool's allowlist and remains accurate about it.
`docs/FIXTURE_CATALOG.md` `lnk-005` already separates "web-link conformance from
project-defined usefulness" and its expected result is unchanged.
`docs/THREAT_MODEL.md` section 19.6 is unchanged and is now the cited reason for
a deferral rather than an uncitable source.

## Alternatives considered

### Cite RFC 8288 for `links.agent-useful`

Rejected, and it is the alternative this decision exists to refuse. RFC 8288
defines link syntax, context, and relation types. It does not classify any
relation as useful to an agent, and three repository documents already say so.
Citing it would manufacture a normative hook and would put a project judgment
behind an IETF Proposed Standard's name, which is the error ADR-0009 records
being made twice.

### Cite the compatibility snapshot for `links.agent-useful`

Rejected. `isit-2026-08-28` is a dated external heuristic, and ADR-0001 section
3 and ADR-0009 section 2 both hold that a compatibility observation has no
authority in `spec` mode. It would also make our advisory verdict move whenever
somebody else's detector changed.

### Drop `links.agent-useful` and keep only the two RFC 8288 assertions

Rejected. The classification is the useful half of the rule for an agent-facing
scanner, and `lnk-005` exists specifically to prove that valid syntax with no
discovery relation still earns a warning. Dropping it would also need a
`retired_requirements` entry under ADR-0008 section 2, retiring something the
project actively wants.

### Reuse `vendor-convention` or `open-source-profile` for the policy

Rejected in section 1. Both are occupied by third-party artifacts, and using
either would put this project's opinion in a category the file otherwise
reserves for other people's documents. An enum value is cheap; a category error
in a provenance file is not.

### Give the policy source a plausible `https://` URL

Rejected. The project has no published policy URL and no configured remote, so
any URL would be invented. The `url` field is the one a reader trusts without
checking, which is exactly why nothing may be invented in it.

### Emit `pass` for `skills.archive-safety` because no archive was unpacked

Rejected. Nothing was inspected, so a pass would report a check that did not
happen. This is the failure mode ADR-0001 section 6 describes as rewarding a
site for a property nobody verified.

### Emit `not-applicable` or `unable-to-check` instead of deferring

Rejected, and these are the two near misses. `not-applicable` means the rule
does not apply to the target, and ADR-0002 section 5 additionally forbids it
coexisting with an evaluated finding in the same rule, so the whole of
`agent.discovery.skills` would have to go inapplicable to carry it.
`unable-to-check` means required evidence could not be obtained or parsed
safely, which describes a failed observation rather than an observation the
scanner never attempts. Both would put a project decision into a target-facing
vocabulary and make the report say something about the site instead of
something about the scanner.

### Retire `skills.archive-safety` under ADR-0008 section 2

Rejected. Retirement says the project no longer declares the requirement, and
this project intends to evaluate it as soon as unpacking is permitted. Retiring
would lose the text, and the reserved-identifier rule would force a new id when
it returned.

### Add a project-policy source for the section 19.6 archive limits and cite it

Rejected. It would make the assertion citable while leaving it unevaluable,
which is the worse of the two states: an assertion that looks configured and
still cannot run. It would also record a limits policy that is not in force,
because section 19.6 says no archive is unpacked, so there are no limits being
applied to anything.

### Bump `rule_version` on both changed rules

Rejected in section 5, narrowly and for one expiring reason. Neither rule has
ever executed under `ruleset_version` `0.3.0`, so there is no earlier verdict
for a bumped version to be distinguished from.

### Resolve `markdown.fidelity` in this decision

Rejected. Both resolutions require work nobody has done, either reading a
section of RFC 9110 and recording the reading, or writing a fidelity criterion.
Choosing without doing either would be choosing the cheaper answer, and the
assertion is `advisory`, so nothing waits on it.

## Revisit conditions

This decision can be amended only through a new ADR. Relevant triggers include:

- an accepted decision permits unpacking a downloaded skill archive under the
  `docs/THREAT_MODEL.md` section 19.6 controls, which un-defers
  `skills.archive-safety` and requires an `agent.discovery.skills`
  `rule_version` bump;
- a recognized standards body or a registry publishes a set of relations
  described as agent-facing, which would move `links.agent-useful` from project
  policy to a pinned source and would be a `rule_version` bump on
  `web.discovery.link`;
- the project decides whether an `alternate` link naming a Markdown
  representation belongs in the relation policy. It is deliberately absent from
  0.1.0 and no decision covers it;
- a maintainer settles `markdown.fidelity` in either direction;
- a second project-policy source is proposed. The first one is a decision; a
  pattern of them is a different question, and section 3's prohibitions should
  be re-read as a set before the ledger holds several;
- `specs/checks.v0.yaml` is superseded by a later external snapshot whose
  relation heuristic differs from policy 0.1.0, which under section 2 changes
  nothing automatically and must be re-derived rather than followed.

Until a new ADR says otherwise, three things are release invariants: no
`normative` assertion cites a `project-policy` source, no assertion mixes a
`project-policy` source with an external one, and no deferred assertion emits a
finding.

## Related documents

- [ADR-0001: Local-first scope, interpretation modes, and no aggregate score](0001-scope-modes-and-scoring.md)
- [ADR-0002: Rule execution model and observation types](0002-rule-execution-model.md)
- [ADR-0004: Rule selection and applicability](0004-rule-selection-and-applicability.md)
- [ADR-0007: Report self-containment](0007-report-self-containment.md)
- [ADR-0008: Registry extensibility](0008-registry-extensibility.md)
- [ADR-0009: Content Signals source pinning](0009-content-signals-source-pinning.md)
- [Standards registry](../STANDARDS_REGISTRY.md)
- [Implementation specification](../IMPLEMENTATION_SPEC.md)
- [Fixture catalog](../FIXTURE_CATALOG.md)
- [Threat model](../THREAT_MODEL.md)
