# ADR-0008: Registry extensibility and the missing assertions

- Status: Accepted
- Decision date: 2026-08-29
- Owners: Initial maintainers
- Applies from: M1

## Context

`specs/rule.schema.json` pins the registry to exactly 22 checks:

```json
"checks": { "type": "array", "minItems": 22, "maxItems": 22, ... }
"published_check_count": { "const": 22 }
```

`compat` is also in the `check` object's `required` list, and every property is
under `additionalProperties: false`.

Two consequences follow. Any rule that has no external IsItAgentReady
counterpart is schema-invalid, so the project cannot add a native rule at all.
And every check must carry a `compat` block with a `pass_heuristic` and
`status_semantics`, so a hypothetical native rule would have to fabricate an
external heuristic that no external tool publishes.

That conflates "the external tool's dated inventory" with "our executable
ruleset". Preventing exactly that conflation is what `specs/README.md`'s "Three
claims, never one" table, ADR-0001's mode separation, and
`.claude/rules/standards.md`'s source hierarchy all exist to do. The schema
undoes it.

### The first accepted revision defined two authorities, which is one too few

The first revision split the problem into two files, an external compatibility
snapshot and a native ruleset manifest, and had the ruleset reference a source
ledger through a `registry_version` field. Adversarial review on 2026-08-29
pointed out that no source-ledger artifact was ever defined, and the review was
right. The consequences were concrete.

**Sources had nowhere to live but the frozen file.** `specs/checks.v0.yaml`
carries a top-level `sources:` block, and the first revision froze that file. A
native-only rule citing a source the external snapshot never cited would
therefore have required editing the frozen snapshot to add it, which is exactly
the mutation the freeze exists to prevent. The file also carries top-level
`registry_version`, `ruleset_id`, and `ruleset_version`, so the artifact
described as the external snapshot was simultaneously claiming to be the
project's ruleset.

`.claude/rules/standards.md` already lists "the independent source-ledger
`registry_version`" among the required registry fields, so an independent ledger
was always the intent. It simply never got a file.

**Assertions had the same problem, and the first revision walked into it.**
Section 2 of that revision added `ai-rules.effective-access` and
`content-signals.conflicting-declaration` directly to `checks.v0.yaml`, on the
grounds that `spec.requirements` has no `maxItems`. Adding a project assertion to
the file that records what an external tool published on a date is the same
category error as adding a source to it, and it is worse for being an assertion
this project invented.

**Implementation status had two conflicting authorities.** The first revision
required `implementation_status` in the native manifest, while ADR-0002 said
implementation status comes from `PROJECT_STATUS.md` release metadata and from
nothing in the registry. Both cannot be true, and `PROJECT_STATUS.md` in fact
holds project-wide phase prose with no per-rule field at all.

## Decision

### 1. Three authorities, each answering one question

| Artifact | Question it answers | Version axis |
| --- | --- | --- |
| `specs/checks.v0.yaml` | What did IsItAgentReady publish on 2026-08-28? | `snapshot.captured_at` |
| `specs/sources.v0.yaml` | Which pinned sources exist, at which versions and verification dates? | `source_ledger_version` |
| `specs/ruleset.standard.v0.yaml` | What does this project's executable ruleset assert? | `ruleset_version` |

**The external compatibility snapshot** stays frozen at 22 entries.
`maxItems: 22` and `published_check_count: 22` are correct for that purpose and
stay. It is never read at scan time.

**The source ledger** is new, governed by `specs/sources.schema.json`. Every
`source_refs` identifier in either other file resolves against it. It carries the
fields `.claude/rules/standards.md` already requires of a source: exact version
or dated draft or immutable commit, canonical URL, section or schema pointer,
status, maturity, and `verified_at`. It is versioned independently because a
source's verification date changes for reasons that have nothing to do with
either the external snapshot or the executable ruleset.

**The native ruleset** is governed by `specs/ruleset.schema.json`. Required
top-level fields: `schema_version`, `ruleset_id`, `ruleset_version`, the
`source_ledger_version` it draws sources from, and `rules`. Each rule entry
requires `rule_id`, `rule_version`, `title`, `category`, `profiles`, `runtime`,
`applicability` using the native names from ADR-0004 section 2, `source_refs`,
`spec`, `interop`, `implementation_status`, and, where the rule implements
`compat` mode, a `compat_assertions` block declaring the mode-specific assertion
ids ADR-0002 section 9 requires.

The ruleset manifest has no `compat` pass heuristic, no `ordinal`, and no
camelCase `id`. A native rule with no external counterpart simply has no external
identity, and `RuleMetadata.externalCompatibilityId` is `null` for it.

The three files are joined on `rule_id` and on source identifier. A rule may
appear in the snapshot only (an external check this project has not
implemented), in the ruleset only (a native rule with no external counterpart),
or in both.

### 2. The migration out of the snapshot file, done once

`specs/checks.v0.yaml` currently carries top-level `registry_version`,
`ruleset_id`, `ruleset_version`, and `sources:`. None of those is a fact about
what an external tool published. They move to the source ledger and the native
ruleset before M1, in one recorded migration, and the snapshot keeps
`schema_version`, `snapshot`, `modes`, and `checks`.

The snapshot's per-check `spec` and `interop` blocks are the project's initial
independent interpretation, captured on the same date. They stay in the file as
frozen historical content and are **not read at runtime**. The executable
authority for what a rule asserts is `specs/ruleset.standard.v0.yaml`.

To keep that from becoming silent drift, the validator asserts that for any
`rule_id` present in both files, the ruleset's `spec.requirements` ids are a
superset of the snapshot's, and reports every addition as a listed delta. The
ruleset may add an assertion; it may not quietly drop one that was published.

This is forbidden:

- adding a 23rd entry to `checks.v0.yaml`;
- adding a source, a requirement, or any other project artifact to
  `checks.v0.yaml`;
- giving a native rule a fabricated `compat` block, a fabricated external `id`,
  or an ordinal;
- treating `published_check_count` as this project's rule count, or reporting it
  to users as such;
- the same `rule_id` carrying different `rule_version` semantics across files;
- a `compat`-mode result for a rule that appears only in the ruleset manifest;
- a source identifier used anywhere that the ledger does not declare.

### 3. Per-rule implementation status has exactly one authority

`implementation_status` in `specs/ruleset.standard.v0.yaml` is the single
machine-readable source. `RuleMetadata.implementationStatus` is projected from
it and from nothing else, which is the correction ADR-0002 section 10 now
records.

`PROJECT_STATUS.md` keeps its project-wide phase prose and its status
vocabulary, and gains a per-rule table that is **generated** from the ruleset. A
CI check regenerates it and fails when the checked-in file differs, so the
document stays a summary and never becomes a competing source. It is never
derived from `maturity`, which describes the pinned source set.

### 4. Two concrete data defects, fixed by adding requirements to the ruleset

Both fixes are additions to `specs/ruleset.standard.v0.yaml` plus version bumps.
Neither touches `checks.v0.yaml`.

#### 4a. `web.policy.ai-crawler` cannot express its own fixtures

The check has six fixtures (`bot-001` through `bot-006`) and two assertions:
`ai-rules.rep-parse` (normative) and `ai-rules.token-source` (advisory). The
first is about parsing precedence; the second is about citing the crawler-token
registry.

Neither can carry `bot-002`'s expected "`spec: warning` with access decision
`disallowed`" or `bot-006`'s "`spec: pass` with default access decision
recorded". Under ADR-0002 an assertion id must be declared for the rule, so these
two fixtures currently have no assertion to report against.

Add a third requirement:

```yaml
- id: "ai-rules.effective-access"
  strength: "recommended"
  text: >-
    Compute and record the effective RFC 9309 access decision for each
    configured crawler token at the configured tested path, including the
    default decision when no group matches, and report a disallowed decision
    as a warning about agent reachability rather than as a protocol failure.
```

`strength: "recommended"` is chosen so that a `violated` outcome maps to
`warning` under ADR-0002 section 5's class mapping, which is what `bot-002`
expects. It is an awkward fit and worth naming as such: the existing two
requirements in this check are phrased as obligations on the evaluator rather
than on the target, because the check's `claim_scope` is `detection-only`, and
this one follows that voice.

This assertion can never produce `fail`. A publisher who disallows a crawler has
made a decision, not a protocol violation, and `IMPLEMENTATION_SPEC.md`
section 22.5 already requires that the rule "does not treat a blanket disallow
as agent accessibility". The `warning` is about reachability for the configured
agent, and the message template must say so.

#### 4b. `sig-004` expects an assertion that does not exist

`docs/FIXTURE_CATALOG.md` section 10 expects fixture `sig-004` to produce
`content-signals.conflicting-declaration`. The registry declares only
`content-signals.syntax`, `content-signals.coverage`, and
`content-signals.effect`.

Add:

```yaml
- id: "content-signals.conflicting-declaration"
  strength: "advisory"
  text: >-
    When the same signal token is declared more than once with conflicting
    values inside one REP group and the pinned source defines no conflict
    resolution, report the conflict and the unresolved state instead of
    selecting a winner.
```

`advisory` rather than `recommended`: both map to `warning`, and `advisory` is
the accurate label because there is no pinned recommendation being violated.
There is a gap in the source. The catalog's own note says `sig-004` "records an
interoperability warning unless a later pinned source defines normative conflict
handling", which is a description of an advisory finding.

ADR-0009 makes two further changes to the same rule in the same version bump: it
rewrites `content-signals.syntax` so that it rests only on RFC 9309, and it adds
an advisory `content-signals.unrecognized-vocabulary`. Those belong to that
decision; they are named here so the Content Signals entry is not edited twice.

### 5. Version numbers

The changes add public assertion identifiers and change verdicts, which
`.claude/rules/standards.md` requires be reflected on the rule and ruleset axes.

| Axis | From | To |
| --- | --- | --- |
| `web.policy.ai-crawler` `rule_version` | `0.1.0` | `0.2.0` |
| `web.policy.content-signals` `rule_version` | `0.1.0` | `0.2.0` |
| `ruleset_version` | `0.1.0` | `0.2.0` |
| `source_ledger_version` | `0.1.0` | `0.2.0` |

`source_ledger_version` moves because ADR-0009 requires the
`content-signals-draft-00` entry to record a confirmed expiry date and the
`content-signals` entry to record that the site is an application shell.
`ruleset_version` moves because the executable interpretation changed. The
snapshot's `snapshot.captured_at` does not move, because the snapshot is not
edited. The remaining twenty checks keep `rule_version` `0.1.0`, which is the
point of having separate axes. `specs/ruleset.standard.v0.yaml` is created at
`ruleset_version` `0.2.0` so the files agree from the start.

### 6. Recorded, not resolved

Two inconsistencies are noted here so they are not rediscovered, and are
deliberately left for their own decisions.

**Category taxonomy.** `rule.schema.json` allows both `discoverability` and
`discovery` as `category` values. Nothing in the repository distinguishes them,
and both disagree with the `rule_id` namespaces: `web.discovery.robots` has
category `discoverability` while `web.discovery.api-catalog` has category
`discovery`. Since `@category:` is a selector (ADR-0004), a user cannot predict
which one selects a given rule. Resolving it changes a published enum and every
affected check's data, so it needs its own ADR.

**`hosted-public`.** The string appears in three public type positions in
`docs/ARCHITECTURE.md`: `RuleContextV1.target.networkProfile` (line 274),
`CanonicalScanReportV1.target.networkProfile` (line 388), and
`PublicNetworkPolicy.id` (line 397). The CLI accepts only
`--network-profile <local-loopback|ci-public>`, and
`THREAT_MODEL.md` section 9 lists `hosted-public` as future. A value that can be
serialized into a report but never selected is either a premature type or a
missing flag, and ADR-0001 section 2 is clear that hosted scanning needs its own
decision first. ADR-0002 omits it from the rule-facing target descriptor for
that reason; the report and policy types are not changed here.

## Rationale

The 22-entry cap is right for what `checks.v0.yaml` actually is and wrong for
what the schema forces it to be. Separating the files keeps the snapshot's
integrity, which is what makes `compat` mode honest, while letting the ruleset
grow at its own pace under its own review.

Three authorities rather than two follows from asking what each artifact is for.
The snapshot answers a question about a third party on a date and must never
change. The ruleset answers a question about this project's behavior and changes
whenever behavior does. Sources answer a question about the outside world and
change when a draft expires or a URL is re-verified, on a schedule unrelated to
either. Two files forced the third question into one of the first two, and it
landed in the file that must not change.

The two data defects are the same defect twice: a fixture expecting a verdict no
declared assertion can carry. ADR-0002's rule that an assertion id must be
declared for the rule turns both into build failures, so fixing the data is not
optional once that rule lands.

Bumping version numbers for two added assertions is deliberate friction. Editing
in place because nothing has shipped yet would establish exactly the habit that
`.claude/rules/standards.md`'s "Never mutate historical semantics under an
existing immutable ruleset version" exists to prevent.

## Consequences

### Positive

- Native rules become possible without fabricating external metadata.
- A native-only rule can cite a source the external tool never cited, without
  touching the frozen snapshot.
- `compat` mode keeps a snapshot that is genuinely a snapshot, unedited.
- Implementation status has one machine-readable home, and the conflict with
  ADR-0002 is closed rather than restated.
- `bot-002`, `bot-006`, and `sig-004` become implementable.
- The version-axis discipline is exercised before anything ships, on a change
  small enough to review.

### Costs

- Three registry files and three schemas, with validation logic for the joins
  between them.
- The snapshot's `spec` blocks and the ruleset's are near-duplicates on the
  twenty shared rules, and only the superset check keeps them from diverging by
  omission. A reader must know which one the scanner reads.
- The one-time migration of `sources:` and three top-level fields out of
  `checks.v0.yaml` is itself an edit to a file this decision then freezes, which
  is only acceptable because it happens before M1 and is recorded here.
- `PROJECT_STATUS.md` gains a generated section, so it can no longer be edited
  freely by hand in that region.
- Two of the eight M1 rules ship at `rule_version` `0.2.0` while six ship at
  `0.1.0`, which looks inconsistent without this ADR.
- The category taxonomy stays broken through M1, so `@category:` selectors are
  documented as unstable until it is fixed.

### Implementation constraints

- `specs/README.md` must describe all three files and their joins.
- `specs/sources.schema.json` and `specs/ruleset.schema.json` are written in M1;
  `rule.schema.json` keeps its 22-entry constraints.
- The validation script checks that a `rule_id` in the snapshot and the ruleset
  carries the same `rule_version`, that no ruleset entry declares a `compat`
  pass heuristic, that every `source_refs` id resolves in the ledger, and that
  the ruleset's requirement ids are a superset of the snapshot's per shared
  rule.
- A CI check regenerates the `PROJECT_STATUS.md` per-rule table and fails on a
  difference.
- `@category:` selector documentation must warn that the taxonomy is unresolved.
- The `web.policy.ai-crawler` and `web.policy.content-signals` fixture
  expectations are updated in the same change as the version bumps.

## Alternatives considered

### Two files, with sources left in the snapshot

Rejected, and this was the first revision's position. It leaves a native-only
rule unable to cite a new source without editing the file the decision freezes,
and it leaves the snapshot claiming a `ruleset_id` and `ruleset_version` that
belong to a different artifact.

### Raise `maxItems` and let native rules into `checks.v0.yaml`

Rejected. The 22 is a fact about an external tool on a date. Changing it means
the file records nothing verifiable, and `compat` results would cite a snapshot
including checks the external tool never published.

### Make `compat` optional in the existing schema

Rejected. It is the smaller edit but leaves one file answering three questions,
and the `snapshot` block, ordinals, and external `id` would still be meaningless
for native rules.

### Keep `PROJECT_STATUS.md` as the implementation-status source

Rejected. It is prose, it has no per-rule field, and a status a machine must read
in order to reject `--include` on a `planned` rule (ADR-0004 section 6) cannot
live in a document that is not machine-readable.

### Move the snapshot's `spec` and `interop` blocks into the ruleset now

Rejected for M1, narrowly. It is the cleaner end state and it is a revisit
condition, but it turns a frozen file into a substantially rewritten one on the
same day the freeze is declared, and the superset check gives most of the
benefit at a fraction of the churn.

### Leave the fixtures unimplementable until M4

Rejected. `bot-002` and `bot-006` are M1 fixtures for an M1 rule, and
`ROADMAP.md` M1 requires all 49 protocol fixtures to pass.

### Edit the registry in place without version bumps

Rejected. Nothing has shipped, but the versioning discipline is the product.

## Revisit conditions

- IsItAgentReady publishes a different check count, creating a second dated
  snapshot rather than an edit to this one.
- The first native-only rule is written, exercising `ruleset.schema.json` and
  `sources.schema.json` for real and possibly showing that fields were missed.
- The snapshot's frozen `spec` blocks drift far enough from the ruleset that
  carrying both stops being useful, at which point they move.
- The category taxonomy ADR lands.
- A hosted profile decision lands, resolving the `hosted-public` question.

## Related documents

- [ADR-0002: Rule execution model and observation types](0002-rule-execution-model.md)
- [ADR-0004: Rule selection, applicability, and opt-in](0004-rule-selection-and-applicability.md)
- [ADR-0007: Report self-containment](0007-report-self-containment.md)
- [ADR-0009: Content Signals source pinning](0009-content-signals-source-pinning.md)
- [Standards registry](../STANDARDS_REGISTRY.md)
- [Fixture catalog](../FIXTURE_CATALOG.md)
