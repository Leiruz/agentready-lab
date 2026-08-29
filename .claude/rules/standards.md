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

Use `specs/checks.v0.yaml` and its schema as the machine-readable source of
truth. A check entry must retain the fields required by that schema, including:

- stable native `rule_id`, external compatibility `id`, and assertion
  identifiers;
- explicit `rule_version`, top-level `ruleset_id`/`ruleset_version`, and the
  independent source-ledger `registry_version`;
- exact `spec`, `compat`, or `interop` mode applicability;
- source maturity and requirement classification;
- exact version, dated draft, release, RFC, or immutable commit;
- canonical source URL and relevant section or schema pointer;
- applicability, discovery, assertion, and expected-outcome semantics;
- source verification or compatibility-observation date.

Check `maturity` is source maturity, not implementation status. Check `runtime`
is the required observation capability (`http`, `dns`, or `browser`), not
permission for rule code to perform direct I/O.

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
