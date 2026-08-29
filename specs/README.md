# Standards specifications

This directory holds the machine-readable data contracts for AgentReady Lab's
rules. Listing a rule here is not a claim that executable code for it exists;
`PROJECT_STATUS.md` carries the generated per-rule implementation status.

## Three authorities, one question each

ADR-0008 replaced one file doing three jobs with three files, because the three
questions change on unrelated schedules. The snapshot answers a question about a
third party on a date and must never change. The ruleset answers a question
about this project's behavior and changes whenever behavior does. The ledger
answers a question about the outside world and changes when a draft expires or a
URL is re-verified.

| File | Question it answers | Version axis | Schema |
| --- | --- | --- | --- |
| `checks.v0.yaml` | What did IsItAgentReady publish on 2026-08-28? | `snapshot.captured_at` | `rule.schema.json` |
| `sources.v0.yaml` | Which pinned sources exist, at which versions and verification dates? | `source_ledger_version`, dated by `ledger_date` | `sources.schema.json` |
| `ruleset.standard.v0.yaml` | What does this project's executable ruleset assert? | `ruleset_version` | `ruleset.schema.json` |

`../docs/STANDARDS_REGISTRY.md` is the human-readable audit and maintenance
guide.

### How they join

The three files join on `rule_id` and on source identifier.

- Every `source_refs` identifier, in either the snapshot or the ruleset,
  resolves against **`sources.v0.yaml`** and against nothing else. A source
  identifier the ledger does not declare is a validation failure wherever it
  appears.
- A rule may be in the snapshot only (an external check this project has not
  implemented), in the ruleset only (a native rule with no external
  counterpart), or in both.
- For a `rule_id` in both, every `spec.requirements` id the snapshot published
  is either declared by the ruleset or listed in that rule's
  `retired_requirements`. Dropping one silently is a validation failure;
  retiring one needs an entry naming the accepted ADR that retired it.

### What the snapshot is, and is not

`checks.v0.yaml` is frozen at 22 entries. `maxItems: 22` and
`published_check_count: 22` are correct for what the file is and stay. **It is
never read at scan time.**

Its per-check `spec` and `interop` blocks are this project's initial independent
interpretation, captured on the same date. They stay as frozen historical
content. The executable authority for what a rule asserts is
`ruleset.standard.v0.yaml`.

Its per-check `rule_version` is external snapshot metadata: the rule version
this project intended for that check on `snapshot.captured_at`, recorded beside
the external tool's `ordinal`, `id`, and `compat` block. It is not the native
rule version, it never appears in a report, and it may lag the ruleset by any
distance. The validator prints the difference as a listed delta and never as an
error.

This is forbidden:

- adding a 23rd entry to `checks.v0.yaml`;
- adding a source, a requirement, or any other project artifact to it;
- giving a native rule a fabricated `compat` block, external `id`, or ordinal;
- treating `published_check_count` as this project's rule count;
- reading the snapshot's `rule_version` as the native rule version;
- retiring a snapshot requirement without a `retired_requirements` entry naming
  the ADR that retired it;
- a `compat`-mode result for a rule that appears only in the ruleset;
- a source identifier the ledger does not declare.

`registry_version`, `ruleset_id`, `ruleset_version`, and `sources:` were removed
from `checks.v0.yaml` on 2026-08-29 in the one migration ADR-0008 section 2
records. None of them was a fact about what an external tool published.
`registry_version` did not survive the move: the source-ledger axis is now
`source_ledger_version`, and ADR-0007 removes `registryVersion` from the report
because no artifact carries it any more.

### The version axes

The `v0` filename marks an unstable schema generation. Each file declares its
own `schema_version` for its data shape. Above that:

- `source_ledger_version` versions the pinned source set, including
  provenance-only changes that alter no verdict, and `ledger_date` dates the
  revision so the ledger bounds its own verification dates rather than
  borrowing the snapshot's;
- `ruleset_id` and `ruleset_version` identify the immutable executable
  interpretation a scan reports;
- each ruleset rule's `rule_version` identifies that rule's semantics;
- `snapshot.captured_at` dates the external inventory and does not move,
  because the snapshot is not edited.

A breaking field change requires a new schema generation and filename. A
verdict-changing interpretation increments the affected `rule_version` and
`ruleset_version`. Two of the twenty-two rules ship at `0.2.0` while twenty ship
at `0.1.0`; that is the point of separate axes, not an inconsistency.

## Three claims, never one

Every rule has three independent sections:

| Section | What it may claim | What it must not claim |
| --- | --- | --- |
| `compat` | A dated public heuristic would recognize an observation. | That the target conforms to the linked protocol. |
| `spec` | Evidence satisfies requirements from a pinned source. | That a static document proves an end-to-end implementation. |
| `interop` | A bounded, non-mutating interaction succeeded. | Certification, security, or support beyond the exact action tested. |

The snapshot's `compat` descriptions are independently written from
<https://isitagentready.com/llms-full.txt>. They are snapshot facts about a
published external contract, not normative requirements and not a copy of
Cloudflare's implementation. IsItAgentReady's UI, direct API, URL Scanner API,
and documentation can drift independently.

A `compat` assertion carries its own versioned identifier and its own
`compatibility` requirement class, so a compatibility verdict can never be
emitted under a normative assertion id. ADR-0002 section 9 fixes the shape:
`compat:<external-id>.<assertion>@<snapshot-date>`.

Each snapshot entry has two deliberately different identifiers:

- `id` preserves the external IsItAgentReady check key, such as
  `markdownNegotiation`;
- `rule_id` is AgentReady Lab's stable namespaced public identifier, such as
  `web.content.markdown-negotiation`.

Native reports, CLI selectors, fixtures, and finding codes use `rule_id`. Only
compatibility adapters use `id`, and a native rule with no external counterpart
has none: its `RuleMetadata.externalCompatibilityId` is `null`. Neither
identifier may be silently renamed after a version is published.

`maturity` describes the pinned source set, not implementation status. Its
values are `stable`, `mixed`, `draft`, `experimental`, `convention`, and `beta`.
Implementation status is the separate `planned`/`experimental`/`supported`/
`deprecated`/`removed` vocabulary, and it lives in the ruleset's
`implementation_status`. The `runtime` values (`http`, `dns`, `browser`)
describe observation capabilities a rule needs; they never grant a rule direct
network access.

The `category` taxonomy is unresolved: `discoverability` and `discovery` are
both permitted, nothing distinguishes them, and they disagree with the `rule_id`
namespaces. `@category:` selectors are therefore unstable until the ADR that
fixes it lands (ADR-0008 section 6).

## What the ruleset declares per assertion

ADR-0002 section 6 removed two choices from rule code and put them here, so a
rule cannot make them:

- `source_refs`: the only sources a finding for that assertion may cite. A rule
  cannot cite a source, add a section pointer, or cite something the assertion
  does not rest on.
- `params` and `excerpt_authorized`: the bounded typed parameters the
  assertion's message template may reference, and whether a bounded excerpt of
  target text is authorized at all. An outcome carrying an undeclared parameter
  is a contract violation, so an empty `params` list is the fail-closed state
  rather than a gap.

A `todo` array on the ruleset, on a rule, on an assertion, or on a ledger source
records a value an accepted decision requires but does not supply. It is not a
placeholder for a value nobody looked up: the validator prints every one, and an
assertion with no `source_refs` and no `todo` is a validation failure.

## Verdict policy

- `pass` requires an applicable assertion and sufficient evidence.
- `fail` is reserved for an evaluated, applicable normative assertion.
- A failed SHOULD/recommendation is normally `warning`.
- An irrelevant rule is `not-applicable`; it is not a pass.
- Missing or unsafe-to-fetch evidence is `unable-to-check`; it is not a fail.
- A runtime-only surface such as WebMCP is `unsupported-runtime` outside a
  compatible browser harness.
- Experimental discovery mechanisms are opt-in. Absence alone is not a
  specification failure.
- Commerce rules require a user-selected commerce profile and a known endpoint.
  Heuristic ecommerce classification may be reported as evidence but must not
  silently change applicability.

## Source pinning

RFC URLs are stable identifiers. Living specifications and draft repositories
must additionally be pinned to a release, date, draft number, or commit before
their executable rules merge. A moving `/latest/` link is a discovery URL, not
a reproducibility pin.

Each ledger source records `verified_at`. Updating that field alone is not a
substitute for reviewing schemas, examples, discovery paths, requirement words,
and security considerations.

## Validation

`pnpm run specs:validate` performs all of the following, and
`pnpm run specs:canonicalise` is the same run with permission to rewrite its
generated output:

1. parse all three files with duplicate-key rejection and bounded alias
   expansion;
2. validate each against its JSON Schema Draft 2020-12 contract;
3. enforce the semantic constraints JSON Schema cannot express here:
   - source ids, compatibility check ids, native rule ids, ordinals, requirement
     ids, and ruleset assertion ids are unique;
   - snapshot ordinals are contiguous from 1 through 22 and exactly 22 checks
     are present;
   - every `source_refs` identifier in the snapshot and in the ruleset resolves
     in the ledger, and no ledger source is cited by nothing;
   - the ruleset's `source_ledger_version` matches the ledger's;
   - no ruleset rule carries a `compat` block, an `ordinal`, or an external
     `id`;
   - every parameter name is unique within its assertion, and an `excerpt`
     parameter appears only where `excerpt_authorized` is true;
   - every snapshot requirement for a shared `rule_id` is declared by the
     ruleset or retired with an `adr` and a `reason`;
   - every URL uses HTTPS except a source whose normative identifier is HTTP;
   - every date is a real calendar date, no snapshot date is after
     `snapshot.captured_at`, and no ledger `verified_at` is after the ledger's
     own `ledger_date`, which may not itself precede the newest `verified_at`;
4. serialize the two canonical projections and verify the committed artifacts
   are current.

Additions, retirements, changed requirement text, `rule_version` differences
between the snapshot and the ruleset, and every recorded `todo` are printed as
listed deltas. None of them is an error.

Do not fetch source URLs during normal tests. The validator has no transport, no
filesystem, and no clock: a source URL is parsed and classified, never
dereferenced, and the "today" a date check uses is declared in the file that
owns the date, `snapshot.captured_at` for the snapshot and `ledger_date` for
the ledger. A separately scheduled drift job may report changes without
rewriting the files or changing CI verdicts.

### Generated artifacts

| Artifact | Covers | Purpose |
| --- | --- | --- |
| `checks.v0.canonical.json`, `checks.v0.digest.txt` | `snapshot.captured_at` and the snapshot's per-check verdict-bearing fields | the seal that proves the frozen file was not edited |
| `ruleset.standard.v0.canonical.json`, `ruleset.standard.v0.digest.txt` | the ruleset's identity and its per-rule verdict-bearing fields | the ruleset digest a report carries |

Each projection excludes what cannot change a verdict: titles, prose deltas,
caveats, and `interop`. Fixing a typo in a caveat must not invalidate every
pinned report. The ledger has no digest; ADR-0007 puts `sourceLedgerVersion` in
the report instead.

## Change procedure

1. Open an issue naming the protocol version and observed delta.
2. Add or update positive, negative, ambiguous, and unable-to-check fixtures.
3. Cite the exact source section or schema and classify each assertion as
   normative, recommended, or advisory.
4. Run compatibility and specification tests separately.
5. Record whether previous results change and bump the correct ledger, rule, and
   ruleset version axes.
6. Regenerate the canonical artifacts and the `PROJECT_STATUS.md` table
   (`pnpm run specs:canonicalise`, `pnpm run status:write`).
7. Request review from someone other than the author for standards and security
   changes.

Do not silently reinterpret an old draft. Preserve the old ruleset when users
may need reproducible historical results.
