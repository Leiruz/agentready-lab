# ADR-0004: Rule selection, applicability, and opt-in

- Status: Accepted
- Decision date: 2026-08-29
- Owners: Initial maintainers
- Applies from: M1

## Context

Four separate gaps make rule selection unimplementable as specified.

**No opt-in mechanism exists.** Sixteen of the 22 registry checks declare
`applicability.default` of `opt-in` (eleven) or `commerce-opt-in` (five). Three
of the eight M1 rules are among them: `web.policy.content-signals`,
`agent.discovery.skills`, and `web.discovery.api-catalog`. Neither the CLI
contract in `docs/IMPLEMENTATION_SPEC.md` section 10 nor the configuration
example in `docs/ARCHITECTURE.md` section 10 lets a user opt in to anything.
Read literally, three of the eight MVP rules can never run.

**The selector grammar is undefined.** `--include <rule-selector>` and
`--exclude <rule-selector>` appear in the CLI contract with no syntax, while
FR-2 requires an unknown selector to be a hard exit-2 error and
`docs/TEST_STRATEGY.md` section 9 requires a golden test for it.

**`informational` has no defined effect.** Check 8,
`web.identity.web-bot-auth`, declares `applicability.default: "informational"`.
No document says what that does to selection, the summary, or the exit code.

**`--profile commerce` selects nothing useful.** `IMPLEMENTATION_SPEC.md`
section 7 describes the commerce profile as "selected discovery rules plus
opt-in commerce rules", but no check outside ordinals 18 to 22 lists `commerce`
in its `profiles` array. The prose and the data disagree, and the data wins, so
`--profile commerce` selects exactly five commerce checks, all
`commerce-opt-in` and all M6 work.

### A false premise this decision was argued against

The case for this decision was originally put with a claim that the resolution
below leaves a default `content` scan running only five MVP rules, making the
49-fixture acceptance criterion awkward. That claim is false and is corrected
here rather than quietly dropped, because it was used as an argument.

Six M1 rules list `content` in their `profiles` array, not five:
`web.discovery.robots`, `web.discovery.sitemap`, `web.discovery.link`,
`web.content.markdown-negotiation`, `web.policy.ai-crawler`, and
`web.policy.content-signals` (`specs/checks.v0.yaml` lines 395, 440, 485, 576,
624, and 667). Five of those six are `applicable`; the sixth, Content Signals,
is `optional`. Since profile membership alone selects a rule, the `content`
profile selects all six.

The "awkward criterion" half was wrong for an independent reason. The fixture
contract in `TEST_STRATEGY.md` section 10 runs each case with its own selected
rule, profile, and mode, so the 49-case criterion never required a single
default-profile invocation and never depended on how many rules one profile
selects.

## Decision

### 1. Profile membership grants selection; applicability governs absence

These are two different questions and the blueprint conflates them.

A rule is **selected** if the chosen profile appears in its `profiles` array.
`applicability.default` plays no part in selection.

`applicability.default` governs what the absence of the mechanism means.

### 2. The native applicability values are renamed

The registry's `opt-in` and `commerce-opt-in` names are misleading. There is no
user opt-in mechanism, none is needed, and this decision exists partly to
establish that. A reader of `applicability: "opt-in"` reasonably expects a flag
somewhere, and there is none.

The native enum (`RuleMetadata.applicability`, ADR-0002) therefore uses:

| Registry `applicability.default` | Native value | Effect on a selected rule |
| --- | --- | --- |
| `applicable` | `applicable` | Evaluated. Absence of the mechanism may produce `fail` or `warning` where the rule's own requirements say so. |
| `opt-in` | `optional` | Evaluated. Absence of the mechanism yields `not-applicable`. Only a present but non-conforming declaration can produce `fail` or `warning`. |
| `commerce-opt-in` | `commerce-endpoint-required` | As `optional`, and additionally requires a user-supplied known endpoint in `rules.options`. Without it the core resolves the rule to `not-applicable` before `plan()` and never calls it. |
| `informational` | `informational` | Evaluated and reported, but never affects the exit code. |

The registry keeps its published strings, because `specs/checks.v0.yaml` is a
frozen external compatibility snapshot (ADR-0008) and the strings are part of
what was recorded. The rename is a mapping performed when the registry is
projected into `RuleMetadata`, and the mapping table above is the whole of it.
The native ruleset manifest introduced by ADR-0008 uses the native names
directly.

So `--profile agent-service` runs `agent.discovery.skills` with no separate
flag, and `skl-006` gets its expected `spec: not-applicable` because the
mechanism is absent, not because the rule was skipped. The same reading makes
`sig-006` and `rob-002` come out as the fixture catalog already specifies.

This is consistent with ADR-0001 section 3: "An optional mechanism can be
`not-applicable`; absence is not automatically a universal web failure."

Absence is decided per assertion, not per rule. `web.discovery.link` is
`applicable`, yet `lnk-006` expects `spec: not-applicable` when no `Link` field
exists, because `links.parse` is an obligation about parsing fields that are
present and RFC 8288 does not require a site to emit any. `applicable` permits a
rule's requirements to treat absence as a violation; it does not mandate it.

### 3. Profiles are diagnostic rule sets, not deployment mandates

A profile answers "which families of rules are worth running against this kind
of target". It does not assert that every rule it selects describes something
the target ought to deploy.

The `content` profile selecting `web.policy.content-signals` does not mean a
documentation site should publish Content Signals. It means that if the site
publishes them, this scan will check them, and if it does not, the result is
`not-applicable`. That is the entire content of `optional`, and it is why
adding a rule to a profile is a low-cost editorial decision rather than a policy
claim about the web.

Fixture manifests state their own rule, profile, mode, and options
(`TEST_STRATEGY.md` section 10 step 3), so a fixture never inherits a profile by
default and no acceptance criterion depends on the size of one.

### 4. `informational` results are reported and gated out

`RuleResult` carries `gate: "enforced" | "informational"` (ADR-0002). The exit
code considers only results with `gate: "enforced"`. `--strict-warnings` and
`--strict-unable` do not promote an informational result.

An informational result still appears in `results`, still counts in `summary`,
and still carries full findings and evidence. Without the `gate` field a reader
would see `fail: 1` beside exit code 0 and have no way to explain it from the
report alone.

### 5. Selector grammar

```text
selector-list     = selector *( "," selector )
selector          = rule-id / namespace-glob / category-selector
                  / profile-selector
rule-id           = <an exact rule_id in the pinned ruleset>
namespace-glob    = 1*( label "." ) "*"
category-selector = "@category:" name
profile-selector  = "@profile:" name
label             = lowercase-alnum *( lowercase-alnum / "-" )
```

- `web.discovery.robots` matches exactly that rule.
- `web.*` matches every rule whose id begins with `web.`; `web.discovery.*`
  matches that namespace.
- `@category:bot-access-control` matches by registry `category`.
- `@profile:api` matches every rule listing that profile.
- Elements are comma-separated with no whitespace trimming.

Exit code 2, before any transport call, for every one of these:

- an unknown `rule_id`;
- a namespace glob that matches zero rules in the pinned ruleset;
- an unknown category or profile name;
- a `*` anywhere but as the final component, or any other wildcard form;
- an empty element, including a trailing or doubled comma;
- an uppercase character;
- a version suffix such as `web.discovery.robots@0.1.0`, which is not part of
  the M1 grammar because `--ruleset` already pins versions;
- the external camelCase compatibility `id`, such as `robotsTxt`. Native
  selectors use `rule_id` only, per `.claude/rules/standards.md`.

A repeated element is accepted and idempotent.

### 6. Include and exclude

`--exclude` always wins. A rule named by both `--include` and `--exclude` is
excluded, and this is not an error.

`--include` selects a rule the profile does not list. It does not change absence
semantics: an `optional` rule included explicitly still reports
`not-applicable` when the mechanism is absent. Letting a command-line flag turn
an absent optional mechanism into a `fail` would let configuration manufacture a
verdict, which `.claude/rules/standards.md` forbids ("Missing optional material
is not `fail`").

`--include` cannot select a rule whose `implementationStatus` is `planned`, or
whose required `observationRuntime` is unavailable. The first is exit 2; the
second produces `unsupported-runtime`, per `TEST_STRATEGY.md` section 7.

### 7. `rules.severity` is dropped

The `docs/ARCHITECTURE.md` section 10 configuration example includes
`"severity": {}`. It is removed from the configuration schema and must not be
reintroduced without a new ADR.

`--strict-warnings` and `--strict-unable` already cover the only legitimate use,
promoting a whole status class under a pinned policy. A per-rule severity knob
is a per-rule weight, and a set of per-rule weights is the aggregate score that
ADR-0001 forbids as a release invariant. It would also let configuration promote
a `recommended` requirement to `fail`, which contradicts the requirement class
recorded in the registry and which ADR-0002 section 5 now enforces in the core.

### 8. `rules.options` is the typed per-rule input

Each rule owns a JSON Schema for its options, published beside the rule and
validated before any transport call. Unknown keys are exit 2. Seven of the eight
M1 rules take options:

| Rule | Options |
| --- | --- |
| `web.discovery.robots` | the agent product token whose group is selected |
| `web.discovery.sitemap` | whether to dereference a robots-declared sitemap, and the maximum number of sitemap documents |
| `web.discovery.link` | the versioned agent-useful relation allowlist |
| `web.content.markdown-negotiation` | the negotiated media type and whether the profile requires a Markdown representation |
| `web.policy.ai-crawler` | the configured crawler tokens and the tested path |
| `web.discovery.api-catalog` | whether to resolve one service-description link in interop mode |
| `agent.discovery.skills` | the single skill name selected for the interop artifact fetch |

`web.policy.content-signals` takes no options; its recognized token set is
pinned by ADR-0009 rather than configured.

Options are inputs to `plan()`, `step()`, and `finish()` (ADR-0002). They are
recorded in the report only where they change what was requested, and never as a
free-form blob.

### 9. Precedence

Command-line flag, then configuration file, then profile default, then registry
default. The first source that specifies a value wins.

One exception, which is not a precedence rule but a floor: for every security
budget in `docs/THREAT_MODEL.md` section 16, the effective value is the
**minimum** across all sources. Configuration and rule options may lower a
budget and may never raise it. There is no ordering under which a config file
widens a security boundary.

### 10. `--profile commerce` is rejected in M1

`--profile commerce` exits 2 with a message naming the two reasons: the commerce
rules are M6 work per ADR-0001 section 5 and `docs/ROADMAP.md`, and the
`profiles` arrays in `specs/checks.v0.yaml` do not implement the profile that
`IMPLEMENTATION_SPEC.md` section 7 describes.

The data defect is recorded, not silently patched. Adding `commerce` to the
`profiles` array of eleven non-commerce checks changes which rules run for that
profile and belongs to the ADR that introduces commerce, with fixtures.

## Rationale

Separating selection from absence semantics resolves the opt-in gap without
adding a flag, and it is the only reading under which the fixture catalog's
existing `not-applicable` expectations are reachable. An `--opt-in` flag would
produce the same fixtures with more surface area and one more thing to pin in
CI.

Renaming the native values costs one mapping table and removes a standing
invitation to look for a flag that does not exist. `commerce-endpoint-required`
also says the thing that actually distinguishes those five rules, which is that
they need a user-supplied endpoint, not that a user opted in.

The selector grammar is deliberately small. Prefix globs and two attribute
selectors cover the real cases without introducing a matching language whose
corner cases need their own tests. Failing loudly on a zero-match glob matters
more than a tolerant matcher: a typo that silently runs fewer rules in CI is
worse than a broken build.

## Consequences

### Positive

- Three M1 rules become reachable without a new flag.
- The applicability vocabulary no longer implies a mechanism that does not
  exist.
- Unknown selectors fail at exit 2 before the network is touched.
- Informational results stay visible without silently changing the gate.
- Configuration cannot widen a security budget under any precedence order.

### Costs

- The registry and the native ruleset use different words for the same
  applicability, and the mapping table is one more thing to keep correct.
- `--profile commerce` is a documented error in M1 rather than a degraded run.
- A user who wants an absent optional mechanism to fail cannot get it from
  configuration; that needs a rule-level ADR and a registry change.
- Seven per-rule option schemas must be written, versioned, and tested in M1.
- Dropping `rules.severity` removes an escape hatch some CI users will want.

### Implementation constraints

- The configuration schema drops `rules.severity` and types `rules.options` as a
  map from `rule_id` to that rule's validated option object.
- The registry-to-metadata projection applies the section 2 rename, and a
  contract test asserts the two vocabularies map one to one with no residue.
- `RuleResult.gate` is added to the report schema and the JSON reporter.
- `agentready-lab rules list` prints `rule_id`, category, profiles,
  applicability using the native names, and gate, so a selector can be written
  without reading YAML.
- Golden tests cover each exit-2 selector form listed above.
- A test asserts the `content` profile selects six M1 rules, so the count in
  `## Context` cannot silently drift.

## Alternatives considered

### An explicit `--opt-in <rule-selector>` flag

Rejected. It duplicates `--include`, adds a third selection axis to pin in CI,
and makes no fixture expectation reachable that this decision does not.

### Correct the registry so those rules become `applicable`

Rejected, and worth stating in full because it is the resolution that looks like
a data fix.

It is not a reading of the registry; it changes verdict policy. Moving Content
Signals, Agent Skills, and API Catalog to `applicable` means the absence of an
optional mechanism can produce `fail`, which is exactly what
`.claude/rules/standards.md` forbids and what ADR-0001 section 3 was written to
prevent.

It also breaks the fixtures that rest on the present-versus-absent split.
`skl-006` expects `spec: not-applicable` for an absent v0.2 discovery endpoint;
under `applicable` that absence becomes a potential `fail`, inverting the case's
stated purpose, which the catalog gives as "Profile applicability". `sig-006`
expects `spec: not-applicable` for a target with no Content Signals declaration
at all, and takes the same inversion. The Content Signals rule's discriminating
power is entirely in the difference between an absent declaration and a present
one, and `applicable` erases it.

The same argument was originally made against the pre-existing `sig-003`
expectation of `spec: fail`, on the grounds that resolution C demotes a required
failure into one case among many. ADR-0009 has since changed `sig-003` to a
`warning` for a separate and better reason, so that half of the argument no
longer applies and is recorded here only so the change of footing is visible.
`skl-006` and `sig-006` carry it on their own.

A registry edit that changes verdicts for three rules, inverts two fixtures, and
contradicts two accepted policies is not a smaller change than a selection rule.

### Treat `opt-in` as "not selected unless named"

Rejected. It makes `--profile agent-service` select zero agent rules, the same
defect as `--profile commerce`, and contradicts the profile table in
`IMPLEMENTATION_SPEC.md` section 7.

### Keep the registry's `opt-in` name in the native enum

Rejected. It is the smaller diff, but the word describes a mechanism this
decision explicitly declines to build, and every future reader would look for
the flag.

### Glob or regular-expression selectors

Rejected. A general matcher needs its own escaping, anchoring, and
case-sensitivity rules, all of which become CLI public contract.

### Keep `rules.severity` restricted to demotion only

Rejected. Demotion-only still encodes a per-rule weight, and a project that
cannot fail on a rule it selected should exclude the rule instead.

### Add `commerce` to eleven `profiles` arrays now

Rejected. It changes rule selection for a profile with no fixtures, no rules,
and no milestone, in a registry ADR-0008 freezes.

## Revisit conditions

- M6 introduces commerce and must fix the `profiles` data defect with fixtures.
- A CI need is demonstrated that `--strict-warnings` and `--strict-unable`
  cannot express, reopening per-rule policy.
- The ruleset grows past the point where prefix globs suffice.
- Batch scanning arrives, which changes how options are scoped.
- A second registry snapshot uses different applicability strings, at which
  point the mapping table becomes versioned rather than fixed.

## Related documents

- [ADR-0001: Scope, modes, and no aggregate score](0001-scope-modes-and-scoring.md)
- [ADR-0002: Rule execution model and observation types](0002-rule-execution-model.md)
- [ADR-0008: Registry extensibility and missing assertions](0008-registry-extensibility.md)
- [ADR-0009: Content Signals source pinning](0009-content-signals-source-pinning.md)
- [Implementation specification](../IMPLEMENTATION_SPEC.md)
- [Fixture catalog](../FIXTURE_CATALOG.md)
- [Test strategy](../TEST_STRATEGY.md)
