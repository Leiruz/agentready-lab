---
paths:
  - "specs/**"
  - "schemas/**"
  - "packages/rules-standard/**"
  - "packages/testkit/**"
  - "apps/fixtures-worker/**"
  - "docs/STANDARDS_REGISTRY.md"
  - "docs/FIXTURE_CATALOG.md"
  - "docs/decisions/**"
---

# Standards and rule semantics

## Source hierarchy

Use sources in this order:

1. A pinned normative specification published by its recognized owner.
2. Normative schemas or test vectors published with that specification.
3. An accepted decision under `docs/decisions/` resolving a documented gap.
4. Snapshot-dated interoperability or compatibility observations.

IsItAgentReady documentation is a source for its published check inventory and
dated `compat` heuristics only. It is not the normative authority for an
underlying protocol. Search summaries, tutorials, generated answers, and model
memory are not normative evidence.

## Registry contract

The machine-readable source of truth is three files, not one, and each answers
exactly one question (ADR-0008):

- `specs/checks.v0.yaml` records what IsItAgentReady published on
  `snapshot.captured_at`. It is frozen at 22 entries and is never read at scan
  time. Nothing may be added to it.
- `specs/sources.v0.yaml` is the independent source ledger. Every `source_refs`
  identifier in either other file resolves against it and against nothing else.
  Its axis is `source_ledger_version`; there is no `registry_version` any more,
  in any file or in a report.
- `specs/ruleset.standard.v0.yaml` is the executable native ruleset and the only
  authority for what this project asserts.

Each file must retain the fields its schema requires, including:

- stable native `rule_id` and assertion identifiers, in the ruleset; the
  external compatibility `id` only in the snapshot, where a native rule with no
  external counterpart simply has none;
- the ruleset's per-rule `rule_version` and top-level
  `ruleset_id`/`ruleset_version`, and the ledger's independent
  `source_ledger_version`. The snapshot's per-check `rule_version` is frozen
  external metadata: never the native rule version, never in a report, and free
  to lag the ruleset by any distance;
- per-rule `implementation_status` in the ruleset, which is the single
  machine-readable authority for it. `PROJECT_STATUS.md`'s per-rule table is
  generated from that field and checked in CI;
- exact `spec`, `compat`, or `interop` mode applicability;
- source maturity and requirement classification;
- per assertion, the `source_refs` a finding may cite, the parameter schema its
  message template may reference, and whether a bounded excerpt is authorized.
  A rule chooses none of these;
- exact version, dated draft, release, RFC, or immutable commit;
- canonical source URL and relevant section or schema pointer;
- applicability, discovery, assertion, and expected-outcome semantics;
- source verification or compatibility-observation date.

A requirement the snapshot published may be retired, and may not be dropped. A
`retired_requirements` entry naming the accepted ADR that retired it and a
reason is what makes the difference; a retirement with no `adr` fails
validation.

`maturity` is source maturity, not implementation status. `runtime` is the
required observation capability (`http`, `dns`, or `browser`), not permission
for rule code to perform direct I/O.

An undated mutable URL may aid discovery but is insufficient provenance by
itself. Do not copy entire external specifications into the repository unless
their license and terms explicitly permit redistribution.

## Interpretation rules

- `spec` implements the pinned source independently.
- `compat` records dated recognition behavior without claiming conformance.
- `interop` performs only approved, safe, non-mutating actions within a stated
  request and resource budget.
- A `2xx` response or present file does not by itself prove support. Validate
  media type, representation, syntax, version, and required semantics.
- Only a violated applicable normative requirement yields `fail` by default.
  Recommended and advisory violations yield `warning` unless an explicit strict
  policy promotes them.
- Missing optional material is not `fail`.
- Unsupported versions, malformed content, absence, transport errors,
  inapplicability, and unsupported runtime capability are distinct conditions.
- If official sources conflict or leave a material gap, stop and propose a
  decision. Do not bury an interpretation in evaluator code.
- If behavior cannot be tested deterministically, classify it as advisory,
  `interop`, or unable to check; do not invent certainty.

Keep known compatibility mismatches separate from normative behavior. A
compatibility snapshot must never silently override ARD, UCP/AP2, OAuth
protected-resource metadata, or another source's pinned semantics.

## Standards changes

A verdict-changing standards update requires:

- old and new source versions and sections;
- an explanation of the semantic difference;
- positive, negative, absent, malformed, and version-drift fixtures as relevant;
- compatibility expectations for the prior `rule_version`;
- rule/ruleset version changes required by the implementation specification;
- changelog and generated-registry updates;
- maintainer review before merge.

Never mutate historical semantics under an existing immutable ruleset version.
Retired rule IDs and finding codes remain reserved.

Use `rule_id` in native reports, CLI selectors, fixtures, and finding codes.
Use the camelCase `id` only when mapping the dated external compatibility
contract. Never expose the compatibility ID as if it were the native rule API.

## Fixture provenance

Each fixture manifest must identify the rule/assertion, mode, source version,
intended condition, expected status, and whether the case is normative,
recommended, advisory, ambiguous, or compatibility-only.

Fixtures test externally observable behavior. Never add fixture-specific
branches to production parsers or evaluators.
