# Architecture decision records

Accepted decisions in this directory are authoritative. `PROJECT_STATUS.md`
places them second in the conflict-precedence order, below the threat model and
above the implementation specification.

A decision is amended only by a new ADR. Superseding one does not edit it.

## Decision index

| ADR | Applies from | Summary |
| --- | --- | --- |
| [0001](0001-scope-modes-and-scoring.md) | project foundation | The project is local-first, rules expose `spec`/`compat`/`interop` modes separate from profiles, the MVP has eight rule families, and there is no aggregate score or certification level. |
| [0002](0002-rule-execution-model.md) | M1 | A rule is three pure synchronous functions over exactly two engine-driven rounds: `plan`, `step`, `finish`. Rules return assertion outcomes, never statuses, classes, message strings, or source citations; the core derives every status from the ruleset's immutable class mapping, derives citations from the assertion declaration, renders prose from static templates, and validates every template parameter against a per-assertion schema. Request ids are unique per rule for the whole scan. Memo values are validated as acyclic plain data before being frozen. Synchronicity is stated not to be a sandbox. |
| [0003](0003-transport-error-vocabulary.md) | M1 | Two enumerations: 15 public observation error codes, and one internal `ObservationFailure` union declared in core with transport, parser, and engine owners. Adds an ordinary connection-failure reason, adds `resource-budget-exhausted` so parser exhaustion is distinguishable from an ordinary parse failure, and retires the orphaned 10-member architecture enum. |
| [0004](0004-rule-selection-and-applicability.md) | M1 | Profile membership grants selection while applicability governs absence semantics, so opt-in rules need no new flag. Renames the native values to `optional` and `commerce-endpoint-required`, records that the `content` profile selects six M1 rules, defines the `--include`/`--exclude` grammar, drops `rules.severity`, types `rules.options`, and records every validated effective option in the report rather than only those that change a request. |
| [0005](0005-determinism-and-evidence-identity.md) | M1 | M1 executes observations serially in stable plan order, because reserving request counts alone leaves the whole-scan byte budgets racing chunk arrival. Request slots are reserved at plan time; the complete canonical request key, including both byte limits, is defined here rather than delegated; evidence IDs are sequential `ev-001` values assigned per round once that round's plan is stable, and are never the same thing as a reservation. |
| [0006](0006-local-fixture-host-model.md) | M1 | Fixtures are served on one ephemeral port per case on the literal `127.0.0.1`, with no resolver override, hosts file, or special-use domain. Two layers: a shared `Response` handler for ordinary cases, and a non-deployable raw transport harness for redirect-policy, repeated-header-line, framing, timeout, and byte-stream cases, with typed symbolic redirect targets compiled after binding. |
| [0007](0007-report-self-containment.md) | M1 | The canonical report gains a cited-sources array, a top-level `sourceLedgerVersion`, and, in `compat` mode only, an `externalSnapshot` identifying the dated inventory. `registryVersion` is removed because ADR-0008 leaves no artifact carrying `registry_version`. Remediation text lives in a separate `specs/remediation.v0.yaml` keyed by finding code, with a build gate on completeness. |
| [0008](0008-registry-extensibility.md) | M1 | Three authorities: `specs/checks.v0.yaml` frozen at 22 entries as the external compatibility snapshot, an independent versioned source ledger, and the executable native ruleset that is the single machine-readable home for per-rule implementation status and rule version. The snapshot's per-check `rule_version` is snapshot metadata, so the equality invariant is removed; retiring a published requirement needs a `retired_requirements` entry naming an ADR. Adds the missing `ai-rules.effective-access` and `content-signals.conflicting-declaration` assertions to the ruleset, not to the snapshot. |
| [0009](0009-content-signals-source-pinning.md) | M1 | No Content Signals grammar is invented, and no compatibility observation decides a specification verdict. The three-token set stays in `compat` mode. RFC 9309 section 2.2.4 leaves extension records implementation-defined and addresses its one `MUST` to the crawler, so `content-signals.syntax` is retired outright and the rule produces no `spec: fail` at all. `sig-003` becomes an advisory `spec: warning` with `compat: fail`. |
| [0010](0010-project-policy-and-deferred-assertions.md) | M1 | The project may be a source of its own policy, provided the ledger labels it: a new `project-policy` kind and `adopted-policy` status, located by repository `document` rather than an invented URL, forbidden to a `normative` assertion, and never mixed with an external source in one assertion's citations. The AgentReady Lab agent-useful relation policy 0.1.0 adopts `service-desc`, `describedby`, and `api-catalog` deliberately rather than inheriting them from the compatibility heuristic, and `links.agent-useful` cites it while staying advisory. `skills.archive-safety` is deferred rather than passed, because the MVP unpacks no archive: a `deferred` marker names the ADR, the reason, and the un-defer condition, and the assertion produces no finding and is counted as deferred, never as covered. |

## Open questions recorded but not resolved

- `source_ledger_version` sits inside the ruleset's verdict-bearing projection,
  so a provenance-only ledger bump forces the ruleset digest to move even when
  no rule, assertion, verdict, or message changed. Adding three vendor crawler
  sources on 2026-08-29 moved the ruleset digest from `e9657e90` to `7915ecc0`
  for exactly that reason, while the snapshot digest correctly stayed put. That
  partly defeats the independent-version-axis purpose ADR-0008 section 1 gives
  the ledger. Either the projection should carry the ledger version only when a
  cited source actually changes, or a report should identify the ledger version
  separately from the ruleset digest, as ADR-0007 already does. This surfaced
  during implementation and belongs to whoever revisits ADR-0007 or ADR-0008.
- `ledger_date` has no upper bound, because the project forbids a wall clock in
  validation (`docs/TEST_STRATEGY.md` section 2.1). Requiring it to be no
  earlier than the newest `verified_at` reports the inconsistency from the more
  useful end, but it is logically equivalent to the per-entry ceiling and does
  not prevent a date being laundered by moving the ceiling. What keeps it
  honest is that moving it is a declared, reviewed, one-line edit.
- The `discoverability` versus `discovery` category taxonomy, which disagrees
  with the `rule_id` namespaces and makes `@category:` selectors unpredictable
  (ADR-0008 section 6).
- `hosted-public`, which appears in three public type positions while
  `--network-profile` accepts two values (ADR-0008 section 6).
- The public evidence header shape, which cannot represent repeated `Link`
  fields (ADR-0002, "Noted, not resolved here"). ADR-0006 records the matching
  defect on the fixture-serving side and fixes that half.
- The `commerce` profile data defect: no non-commerce check lists `commerce` in
  its `profiles` array (ADR-0004 section 10).
- Whether the whole-scan byte budget and the whole-scan deadline move onto the
  new `resource-budget-exhausted` code, keep `request-budget-exhausted` and
  `aborted`, or earn codes of their own, and whether
  `request-budget-exhausted` keeps a name that means bytes at two phases. This
  is a report-schema decision deferred to the `1.0.0` cut (ADR-0003 revisit
  conditions). The distinguishability half of this question is closed: parser
  exhaustion now has its own code.
- Whether `network.maxConcurrency` is removed from the configuration schema or
  reactivated at `ci-public`, having been pinned to `1` for M1 (ADR-0005
  section 1).
- Whether `markdown.fidelity` is a specification assertion or project policy
  (ADR-0010 section 6). It is cited to `rfc9110` today by analogy to
  `markdown.negotiation` in the same rule, and no repository document ties
  representation fidelity to any source. RFC 9110 defines no fidelity
  criterion, does not say which content is critical, and does not define
  "invented"; the rule's own caveat forbidding an LLM oracle is this project
  deciding how the check behaves. Keeping `rfc9110` needs a section pointer
  read out of the RFC and recorded; moving it to a `project-policy` source
  needs the criterion written down. Nobody has done either, the assertion is
  `advisory`, and the citation stands until a maintainer settles it.

Two entries were removed on 2026-08-29 because the decisions that owned them
changed. `content-signals.syntax`'s missing `fail`-path fixture is moot now that
ADR-0009 retires the assertion; the published count of 49 M1 protocol cases is
unchanged.

## Reconciliation required before implementation

`CLAUDE.md` says to stop and report when authoritative documents, schemas,
tests, and code disagree, and `PROJECT_STATUS.md` places accepted decisions
second in the precedence order, above `docs/IMPLEMENTATION_SPEC.md`. The
decisions above are therefore authoritative and the documents below are stale,
but the disagreements are not resolved until those documents are edited. No
implementation work may begin while any row is open.

Every row was checked against the current ADR text on 2026-08-29. Section
numbers are the stale document's own.

| Stale document | Section | What disagrees | Governing decision |
| --- | --- | --- | --- |
| `docs/ARCHITECTURE.md` | 5 | Step 5 hedges between declared and imperatively requested observations, and the intro permits "bounded concurrency" | ADR-0002 section 1, ADR-0005 section 1 |
| `docs/ARCHITECTURE.md` | 6 | `RuleV1`, `RuleContextV1`, `probe`, `probeAll`, and a three-member `RequirementClass` | ADR-0002 section 4 |
| `docs/ARCHITECTURE.md` | 7 | The request cache key names a singular "body limit", and the memo example is `await context.memo(...)` | ADR-0005 section 3, ADR-0002 section 11 |
| `docs/ARCHITECTURE.md` | 8 | The orphaned 10-member `TransportErrorCode` | ADR-0003 section 1 |
| `docs/ARCHITECTURE.md` | 9 | 14-member `PublicObservationError.code`; optional three-member `RuleFinding.requirementClass`; no `gate`, `remediation`, `sources`, `sourceLedgerVersion`, `externalSnapshot`, or `effectiveOptions`; evidence headers as `Readonly<Record<string, string>>`; `hosted-public` in two type positions | ADR-0002 section 4, ADR-0003 section 3, ADR-0004 sections 4 and 8, ADR-0007 sections 1 and 2 |
| `docs/ARCHITECTURE.md` | 10 | The configuration example carries `"severity": {}` and `"maxConcurrency": 2` | ADR-0004 section 7, ADR-0005 section 1 |
| `docs/IMPLEMENTATION_SPEC.md` | 7 | The commerce profile prose that no `profiles` array implements | ADR-0004 section 10 |
| `docs/IMPLEMENTATION_SPEC.md` | 11 | "three independent public version axes", which is now five | ADR-0007 costs, ADR-0008 section 1 |
| `docs/IMPLEMENTATION_SPEC.md` | 12 | `RuleDefinition` with a literal `observations` field, and a three-member `RequirementClass` | ADR-0002 sections 1 and 4 |
| `docs/IMPLEMENTATION_SPEC.md` | 13 | The report example and the 14-member public error enum | ADR-0003 section 3, ADR-0004 section 8, ADR-0007 section 1 |
| `docs/FIXTURE_CATALOG.md` | 2.2 | The `*.fixture.test` hostname model | ADR-0006 |
| `docs/FIXTURE_CATALOG.md` | 10 | "The exact grammar and token set are pinned in the standards registry before implementation", `sig-003`'s `spec: fail`, and the `sig-005` expectation | ADR-0009 sections 3 and 6 |
| `docs/TEST_STRATEGY.md` | 7 | "evidence IDs are stable for the same sanitized observation"; the singular "body limit" in the deduplication list; "result order is unchanged when observations resolve in a different order" | ADR-0005 sections 3, 5, and 7 |
| `docs/ROADMAP.md` | M1 acceptance criteria | "Reordering promise completion does not change canonical JSON" names a mechanism the serial dispatcher does not have | ADR-0005 section 7 |
| `docs/THREAT_MODEL.md` | 26 | Keeps its example reason list, but needs a note that the executable enumeration is ADR-0003's | ADR-0003 implementation constraints |
| `PROJECT_STATUS.md` | "What is authoritative today", and a new generated per-rule table | The authoritative list omits `docs/decisions/` although the precedence list ranks it second, and no generated implementation-status table exists | ADR-0008 section 3 |
| `specs/checks.v0.yaml` | top level | `registry_version`, `ruleset_id`, `ruleset_version`, and `sources:` migrate out to the ledger and the ruleset | ADR-0008 section 2 |
| `specs/rule.schema.json` | top level | Requires the four migrated fields; keeps its 22-entry caps. `specs/sources.schema.json` and `specs/ruleset.schema.json` do not exist, and the latter must carry per-assertion `source_refs`, parameter schemas, excerpt authorization, and `retired_requirements` | ADR-0008 sections 1 and 2, ADR-0002 section 6 |
| `specs/README.md` | "Files", version axes | Describes two files, calls `checks.v0.yaml` "a source ledger", and lists four version axes on that one file | ADR-0008 section 1 |
| `specs/README.md` | "Assertions", "Validation" | "assertion with no `source_refs` and no `todo` is a validation failure" omits the `deferred` alternative, and nothing records that a `project-policy` source is located by `document` rather than a URL | ADR-0010 sections 1 and 4 |
| `.claude/rules/standards.md` | "Registry contract" | Requires `checks.v0.yaml` to retain top-level `ruleset_id`/`ruleset_version` and names the source-ledger axis `registry_version` | ADR-0008 sections 1 and 2 |

Two of these were not on the review's list of six and are recorded here because
checking the ADR text found them: `ARCHITECTURE.md` sections 7 and 10 carry the
defects that ADR-0005 section 3 and ADR-0004 section 7 fix, and
`IMPLEMENTATION_SPEC.md`, `ROADMAP.md`, `specs/README.md`, and
`.claude/rules/standards.md` disagree with accepted decisions in the sections
named above.

### One conflict that needs a maintainer decision, not an edit

ADR-0002's implementation constraints require "a compile test asserts that
`AbortSignal`, `URL`, `fetch`, and `process` are unresolvable" in the rule
package. The M0 scaffold, committed after the ADRs, declares `URL` in
`types/runtime-neutral-globals.d.ts` and includes that file from both
`packages/core/tsconfig.json` and `packages/rules-standard/tsconfig.json`, with
a comment arguing that `URL` is a global in every target runtime. Both positions
are defensible and they cannot both stand. Resolving it either narrows the
compile test to three identifiers or removes `URL` from the allow-list, and
either way it changes what a security control asserts, so it is a decision
rather than a documentation fix.

**Resolved on 2026-08-29: `URL` is permitted in `core` only, and forbidden in
`rules-standard`.** The compile test keeps all four identifiers, and it keeps
them where rule code lives. `URL` is a pure parser with no I/O, no clock and no
randomness; `core` legitimately needs it to implement `context.resolve()`; and
rules never construct a URL at all, because ADR-0002 has them call
`context.resolve()` instead. Narrowing the test to three identifiers would have
weakened it everywhere in order to permit something only one package needs.

The change this requires is one line: remove the
`"files": ["../../types/runtime-neutral-globals.d.ts"]` entry from
`packages/rules-standard/tsconfig.json`, leaving it on
`packages/core/tsconfig.json`. That file's own header, which says both packages
are allowed to use its declarations, then needs correcting to name `core` only.
`packages/rules-standard/src/` was verified to compile under
`lib: ["ES2023"]`, `types: []` with no ambient globals file, so nothing else
moves. The package tsconfig includes `src/**/*.ts` only, so the `new URL(...)`
in `packages/rules-standard/test/index.test.ts` is unaffected: tests compile
under the root `tsconfig.test.json` with `types: ["node"]`.
