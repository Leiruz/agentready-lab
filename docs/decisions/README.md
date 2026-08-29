# Architecture decision records

Accepted decisions in this directory are authoritative. `PROJECT_STATUS.md`
places them second in the conflict-precedence order, below the threat model and
above the implementation specification.

A decision is amended only by a new ADR. Superseding one does not edit it.

## Decision index

| ADR | Applies from | Summary |
| --- | --- | --- |
| [0001](0001-scope-modes-and-scoring.md) | project foundation | The project is local-first, rules expose `spec`/`compat`/`interop` modes separate from profiles, the MVP has eight rule families, and there is no aggregate score or certification level. |
| [0002](0002-rule-execution-model.md) | M1 | A rule is three pure synchronous functions over exactly two engine-driven rounds: `plan`, `step`, `finish`. Rules return assertion outcomes, never statuses, classes, or message strings; the core derives every status from the ruleset's immutable class mapping and renders prose from static templates. Discovered requests carry provenance and pass an engine origin policy. Synchronicity is stated not to be a sandbox. |
| [0003](0003-transport-error-vocabulary.md) | M1 | Two enumerations: the 14 public observation error codes, and one internal `ObservationFailure` union declared in core with transport, parser, and engine owners. Adds an ordinary connection-failure reason, separates the four resource budgets, and retires the orphaned 10-member architecture enum. |
| [0004](0004-rule-selection-and-applicability.md) | M1 | Profile membership grants selection while applicability governs absence semantics, so opt-in rules need no new flag. Renames the native values to `optional` and `commerce-endpoint-required`, records that the `content` profile selects six M1 rules, defines the `--include`/`--exclude` grammar, drops `rules.severity`, and types `rules.options`. |
| [0005](0005-determinism-and-evidence-identity.md) | M1 | M1 executes observations serially in stable plan order, because reserving request counts alone leaves the whole-scan byte budgets racing chunk arrival. Request slots are reserved at plan time; evidence IDs are sequential `ev-001` values assigned per round once that round's plan is stable, and are never the same thing as a reservation. |
| [0006](0006-local-fixture-host-model.md) | M1 | Fixtures are served on one ephemeral port per case on the literal `127.0.0.1`, with no resolver override, hosts file, or special-use domain. Two layers: a shared `Response` handler for ordinary cases, and a non-deployable raw transport harness for redirect-policy, repeated-header-line, framing, timeout, and byte-stream cases, with typed symbolic redirect targets compiled after binding. |
| [0007](0007-report-self-containment.md) | M1 | The canonical report gains a cited-sources array and `registryVersion`. Remediation text lives in a separate `specs/remediation.v0.yaml` keyed by finding code, with a build gate on completeness. |
| [0008](0008-registry-extensibility.md) | M1 | Three authorities: `specs/checks.v0.yaml` frozen at 22 entries as the external compatibility snapshot, an independent versioned source ledger, and the executable native ruleset that is the single machine-readable home for per-rule implementation status. Adds the missing `ai-rules.effective-access` and `content-signals.conflicting-declaration` assertions to the ruleset, not to the snapshot. |
| [0009](0009-content-signals-source-pinning.md) | M1 | No Content Signals grammar is invented, and no compatibility observation decides a specification verdict. The three-token set stays in `compat` mode, `content-signals.syntax` is rewritten to rest only on RFC 9309, and `sig-003` becomes an advisory `spec: warning` with `compat: fail`. |

## Open questions recorded but not resolved

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
- Whether the whole-scan byte budget and the whole-scan deadline earn public
  error codes of their own, which is a report-schema decision deferred to the
  `1.0.0` cut (ADR-0003 revisit conditions).
- Whether `content-signals.syntax` gets a protocol fixture for its `fail` path,
  which would change the published count of 49 M1 protocol cases, or stays
  covered by a rule unit test. This needs a maintainer decision (ADR-0009
  costs).
- Whether `network.maxConcurrency` is removed from the configuration schema or
  reactivated at `ci-public`, having been pinned to `1` for M1 (ADR-0005
  section 1).
