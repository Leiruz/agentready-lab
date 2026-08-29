# ADR-0009: Content Signals source pinning

- Status: Accepted
- Decision date: 2026-08-29
- Owners: Initial maintainers
- Applies from: M1

## Context

`docs/FIXTURE_CATALOG.md` section 10 says "The exact grammar and token set are
pinned in the standards registry before implementation", and fixture `sig-003`
expects `spec: fail` for "a recognized token uses a value outside the pinned
grammar".

There is no pinned grammar to fail against.

`docs/STANDARDS_REGISTRY.md` and `specs/checks.v0.yaml` record two sources for
`web.policy.content-signals`:

- `content-signals`: `https://contentsignals.org/`, recorded as an industry
  protocol with status `living-specification` and version "site snapshot
  2026-08-28";
- `content-signals-draft-00`: `draft-romm-aipref-contentsignals-00`, recorded
  with status `expired-draft` and the note "Expired individual draft with no
  standards-track status".

Neither pins a grammar. The registry's own requirement text says "Parse only the
pinned Content Signals vocabulary and allowed values", and no allowed values are
enumerated anywhere in the repository.

**Verified on 2026-08-29:** `https://contentsignals.org/` returned HTTP 200 with
a 1,966-byte JavaScript application shell containing no machine-readable
grammar, token list, or ABNF. A re-fetch while writing this decision returned
the same page, whose entire extractable content is a "Content Signals" heading.

**Verified on 2026-08-29:** the IETF Datatracker page for
`draft-romm-aipref-contentsignals` shows "Expired Internet-Draft (individual)",
"Expired & archived", and "This Internet-Draft is no longer active", with the
latest revision dated 2025-10-01. The page does not display an exact expiry
date. Under the standard 185-day Internet-Draft lifetime, a 2025-10-01
submission expires on 2026-04-04, but that date is computed and not read from
the source, so it must be confirmed and recorded in the source ledger before
this rule ships.

`specs/checks.v0.yaml` already declares `claim_scope: syntax-validation` for
this check, and its own caveat already says "The linked IETF individual draft is
expired". The check's stated scope is therefore already narrower than the
fixture catalog assumes.

The check's third source is `rfc9309`, the Robots Exclusion Protocol. That one
is pinned, normative, and current, and it is the only pinned normative source
this rule has.

### The first accepted revision made the exact error it claimed to avoid

The first revision opened by declaring that no grammar would be invented, then
built a normative `spec: fail` out of compatibility metadata. Adversarial review
on 2026-08-29 caught it, and the review was right.

The three-token set `ai-train`, `search`, `ai-input` was taken from two places,
and the revision named both: the check's `compat.pass_heuristic` ("at least one
preference for ai-train, search, or ai-input") and the `STANDARDS_REGISTRY.md`
check-7 row. That row sits in a column headed **"Published compatibility
pass"**. Both sources are dated external recognition behavior, and
`.claude/rules/standards.md` is explicit about what that can be used for:
IsItAgentReady documentation "is a source for its published check inventory and
dated `compat` heuristics only. It is not the normative authority for an
underlying protocol", and "A compatibility snapshot must never silently override
another source's pinned semantics".

The revision then preserved a normative `fail` on `content-signals.syntax` for a
declaration containing none of those three tokens. That is a compatibility
observation deciding a specification verdict, which is the one thing this rule's
whole documentation trail exists to prevent.

A second defect made it visible. The revision narrowed the fixture and left the
requirement alone, so `specs/checks.v0.yaml` still instructed an implementer to
"Parse only the pinned Content Signals vocabulary and **allowed values**" while
the ADR stated that no value vocabulary exists. The requirement and the decision
that supposedly narrowed it contradicted each other in the same repository.

## Decision

### 1. Do not invent a grammar

No ABNF, no value vocabulary, and no conflict-resolution rule is written for
this rule. `.claude/rules/standards.md` is explicit: "If official sources
conflict or leave a material gap, stop and propose a decision. Do not bury an
interpretation in evaluator code", and "If behavior cannot be tested
deterministically, classify it as advisory, `interop`, or unable to check; do
not invent certainty."

### 2. The three tokens are compatibility metadata and stay in `compat` mode

The recognized token set is exactly:

```text
ai-train
search
ai-input
```

It comes from a dated external pass heuristic, so it is the vocabulary of the
`compat` assertion and of nothing else. In `compat` mode, a `Content-Signal`
directive expressing a preference for at least one of the three satisfies the
compatibility assertion, and one expressing none of them violates it. That is a
faithful reproduction of a published heuristic, snapshot-dated, and it is the
correct home for the token list.

The set has no authority in `spec` mode beyond section 4's advisory use.

### 3. `content-signals.syntax` is rewritten to rest only on RFC 9309

The requirement text changes from:

> Parse only the pinned Content Signals vocabulary and allowed values,
> preserving the REP group context.

to:

> Parse a `Content-Signal` line as a syntactically valid RFC 9309 record and
> preserve its group association, reporting a line that is not a valid record
> as a violation. Make no claim about which tokens or values are permitted,
> because no pinned source defines either.

This keeps the assertion `normative`, because RFC 9309 is a pinned normative
source that does define robots.txt line and group syntax, and a malformed record
is a violation of it by the publisher. It removes every clause the sources do
not support.

The renamed scope is narrow and it should read that way in `rules explain`: this
assertion checks that a line is well-formed REP and sits in the group the
publisher intended, and nothing else.

### 4. Unrecognized vocabulary is advisory, not a failure

A new assertion is added to `specs/ruleset.standard.v0.yaml`:

```yaml
- id: "content-signals.unrecognized-vocabulary"
  strength: "advisory"
  text: >-
    When a syntactically valid Content-Signal directive declares no token that
    the dated compatibility snapshot recognizes, or declares an additional
    token beyond that set, report the declaration as unrecognized by the
    project's pinned sources and record the tokens verbatim as bounded
    sanitized evidence. This is not a violation of any pinned specification.
```

`advisory` maps to `warning` under ADR-0002 section 5, which is the honest
verdict: the project cannot recognize the declaration and says so, without
claiming the publisher did anything wrong.

### 5. No assertion produces a verdict about a value

Because no value vocabulary is pinned by any source, no assertion in this rule
produces a verdict about a token's value. Declared values are recorded verbatim
as bounded, sanitized evidence and reported as unspecified by the pinned source.

This is the concrete forbidden thing: a future contributor may not add
`yes`/`no` as an allowed value set because the examples on the community site
happen to use them. Adding a value vocabulary requires a pinned source and a new
ADR.

### 6. `sig-003` stops being a specification failure

`sig-003` currently reads "A recognized token uses a value outside the pinned
grammar" with expected `spec: fail`. It becomes:

> A `Content-Signal` directive is a syntactically valid RFC 9309 record but
> declares only tokens outside the dated compatibility set, with no recognized
> token present. Expected `spec: warning` on
> `content-signals.unrecognized-vocabulary`, and `compat: fail` because the
> published heuristic requires at least one of the three tokens.

The `compat: fail` half is new. It is where the three-token set legitimately
decides a verdict, and adding it makes the case assert the mode separation
rather than blur it.

The resulting fixture table:

| Fixture | Condition | `spec` | `compat` |
| --- | --- | --- | --- |
| `sig-001` | recognized values for all three tokens | `pass` | `pass` |
| `sig-002` | one recognized token, valid | `pass`, undeclared dimensions reported | `pass` |
| `sig-003` | zero recognized tokens present | `warning` on `content-signals.unrecognized-vocabulary` | `fail` |
| `sig-004` | one token declared twice with conflicting values | `warning` on `content-signals.conflicting-declaration` | unchanged |
| `sig-005` | a recognized token plus an unknown extension | `warning` on `content-signals.unrecognized-vocabulary` | `pass` |
| `sig-006` | no declaration at all | `not-applicable` | `fail` |

`sig-003` and `sig-005` now report the same `spec` assertion, which is weaker
discrimination than the first revision claimed and should be stated rather than
hidden. They remain distinct cases: the `compat` verdicts are opposite, and the
finding's recognized-token-count parameter is zero in one and non-zero in the
other. The distinction that matters, whether any part of the declaration is
usable, is exactly the distinction the parameter carries.

`sig-001` and `sig-004` are otherwise unchanged. `sig-004`'s assertion is
created by ADR-0008.

### 7. The gap is recorded in the source ledger

Both source entries must carry the state of the source, not a rounded-off
version of it:

- `content-signals` records that the site is an application shell with no
  machine-readable grammar as of its `verified_at` date, so a reader does not
  assume "living-specification" implies a retrievable specification;
- `content-signals-draft-00` is cited in every finding message as an
  **expired** Internet-Draft, with its expiry date recorded once it is
  confirmed. A finding may not cite it without the word "expired".

`docs/STANDARDS_REGISTRY.md` already says "The Content Signals Internet-Draft is
expired. The community site may still define a useful convention, but it must
not be called an IETF standard." This decision makes that operative in the
finding templates rather than only in the maintenance guide.

### 8. Publisher declarations only

The rule reports what a publisher declared. It makes no claim about legal
enforceability, consent, prohibition, or whether any recipient honors the
declaration. `content-signals.effect` already carries this as an advisory
assertion, and its message template is the place the disclaimer must appear, not
a footnote in documentation.

## Rationale

The alternative is a grammar written by this project and presented as a pinned
source, which would make `spec` mode a claim about our own invention. That is
the failure ADR-0001 exists to prevent: record ambiguity explicitly, do not
manufacture a pass or a failure.

The first revision's error is worth understanding because it is easy to repeat.
A compatibility heuristic is a real, checkable, dated artifact, and once it is
written down it reads exactly like a specification. The only thing that
distinguishes it is provenance, and provenance is invisible at the point of use.
The defence is structural rather than editorial: compatibility assertions have
their own identifiers and their own requirement class (ADR-0002 section 9), so a
compatibility verdict cannot be emitted under a normative assertion id even by
accident.

Token-name recognition is still useful, and it survives here in two honest
places. In `compat` mode it is the published heuristic, reproduced faithfully.
In `spec` mode it is an advisory note that the project does not recognize what
was declared. What it no longer does is tell a publisher their declaration
violates a specification when no specification says so.

Recording the fetch result rather than the impression matters. "The community
site defines the grammar" is the kind of claim that survives review because it
sounds plausible; a byte count and an HTTP status are checkable.

## Consequences

### Positive

- The rule ships in M1 without a fabricated source and without a compatibility
  observation deciding a specification verdict.
- The requirement text and the decision that narrows it now agree, which they
  did not before.
- Every finding names the expired draft as expired, so a reader cannot mistake
  it for a standards-track requirement.
- `sig-003` gains a `compat` expectation, so the case now demonstrates the mode
  separation instead of quietly depending on it.
- The gap is visible in the source ledger, where a maintainer looks.

### Costs

- The rule is much weaker than the fixture catalog implied. It produces no
  `spec: fail` for any Content Signals condition except a malformed REP record.
  A publisher who writes `ai-train=maybe`, or who declares tokens nobody
  recognizes, gets a warning and an evidence record.
- Users comparing against IsItAgentReady will see `spec` and `compat` disagree
  on `sig-003` where the first revision had them agree. That is the intended
  behavior and it will look like a regression to anyone expecting parity.
- `content-signals.syntax` no longer has a fixture that exercises its `fail`
  path, because none of `sig-001` through `sig-006` serves a malformed REP
  record. `ROADMAP.md` M1's "Every assertion/finding code has a positive and
  negative test" is met by a rule unit test over the parser rather than by a
  protocol fixture. Adding a fixture instead would change the published count of
  49 protocol cases and needs a maintainer decision.
- `sig-003` and `sig-005` share a `spec` assertion, so the two cases are
  separated by their `compat` verdicts and a finding parameter rather than by
  distinct assertion ids.
- If a grammar is later published, this rule changes meaning again, a further
  `rule_version` bump on a rule that has already had one.

### Implementation constraints

- Version bumps are the ones in ADR-0008: `web.policy.content-signals`
  `rule_version`, `ruleset_version`, and `source_ledger_version` all `0.1.0` to
  `0.2.0`. This decision adds no further bump. The rewritten
  `content-signals.syntax` text and the new
  `content-signals.unrecognized-vocabulary` assertion land in
  `specs/ruleset.standard.v0.yaml` in the same change, alongside ADR-0008's
  `content-signals.conflicting-declaration`.
- `specs/checks.v0.yaml` is not edited. Its frozen copy of the old
  `content-signals.syntax` text is historical, and ADR-0008 section 2's superset
  check must record the rewrite as a listed delta rather than treating it as a
  dropped requirement.
- `docs/FIXTURE_CATALOG.md` section 10 must be updated with the section 6 table,
  and its sentence "The exact grammar and token set are pinned in the standards
  registry before implementation" must be replaced, because it is the sentence
  that started this.
- The `content-signals-draft-00` source entry gains its confirmed expiry date
  before the rule ships. That is a release blocker, not a documentation nicety.
- A contract test asserts no finding from this rule carries a verdict about a
  token value.
- A contract test asserts every finding message referencing the draft contains
  "expired".
- A contract test asserts the three-token set appears only in the `compat`
  assertion and in `content-signals.unrecognized-vocabulary`, and never in the
  evaluation path of `content-signals.syntax`.

## Alternatives considered

### Keep the normative `fail` derived from the three-token set

Rejected, and this was the first revision's position. It uses a dated external
compatibility heuristic to decide a specification verdict, which
`.claude/rules/standards.md` forbids twice, and it left the underlying
requirement text unchanged and self-contradictory.

### Defer the `spec` assertion entirely and ship `compat` only

Rejected, narrowly, and it was close. It is the most conservative option and it
would have been correct if the rule had no pinned normative source. It has one:
RFC 9309 governs the line and group syntax of every `robots.txt` record,
including this one, so there is a real normative assertion to make. Making it
and being explicit about how small it is beats making none.

### Defer the whole rule out of M1

Rejected. It is one of the eight rules named in ADR-0001 section 5 and in the
`ROADMAP.md` M1 deliverables, and six of its fixtures are among the 49 M1 must
pass. A narrowed rule with an honest scope beats a missing one.

### Write an ABNF from the community site's examples

Rejected. There is nothing on the site to derive one from, and a grammar
inferred from rendered examples is this project's invention published as a
pinned source.

### Reconstruct the grammar from the expired draft's text

Rejected. An expired individual draft with no standards-track status and no IETF
consensus is not a pin. It may be cited as context, labeled expired, per
`.claude/rules/standards.md`.

### Ship the rule as `detection-only`

Rejected. The registry already declares `syntax-validation`, and RFC 9309 record
validation genuinely is syntax validation. Downgrading the claim scope removes
the one thing the rule can honestly assert.

### Use IsItAgentReady's detection as the grammar

Rejected. A dated external heuristic is `compat` evidence and never a normative
source, per `.claude/rules/standards.md` and ADR-0001 section 3. This is the
rejection the first revision wrote down and then did not follow.

## Revisit conditions

- `draft-romm-aipref-contentsignals` is revived, adopted by the IETF AIPREF
  working group, or replaced by a draft with a defined grammar. That is the
  event that would let `content-signals.syntax` grow a vocabulary clause and
  `sig-003` return to `spec: fail`.
- The Content Signals community publishes a versioned, retrievable,
  machine-readable grammar or token registry.
- A recognized standards body defines a value vocabulary or a conflict
  resolution rule, which would also change `sig-004`.
- The community site's token set changes, requiring a new `verified_at` date, a
  `rule_version` bump, and updated fixtures rather than an in-place edit. Under
  this decision that changes the `compat` assertion only.

## Related documents

- [ADR-0001: Scope, modes, and no aggregate score](0001-scope-modes-and-scoring.md)
- [ADR-0002: Rule execution model and observation types](0002-rule-execution-model.md)
- [ADR-0004: Rule selection, applicability, and opt-in](0004-rule-selection-and-applicability.md)
- [ADR-0007: Report self-containment](0007-report-self-containment.md)
- [ADR-0008: Registry extensibility and missing assertions](0008-registry-extensibility.md)
- [Standards registry](../STANDARDS_REGISTRY.md)
- [Fixture catalog](../FIXTURE_CATALOG.md)
