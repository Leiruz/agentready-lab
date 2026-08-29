# Test Strategy

- Status: Proposed
- Snapshot date: 2026-08-28
- Applies to: planned `0.1.x` implementation

> [!IMPORTANT]
> This document defines tests that must be implemented. The repository is still
> an implementation blueprint; the commands, packages, fixtures, and CI jobs
> described here do not exist until `PROJECT_STATUS.md` says otherwise.

## 1. Purpose

AgentReady Lab will make conformance claims about hostile HTTP input. A passing
test suite must therefore prove more than successful parsing of a few valid
documents. It must show that:

- verdicts follow pinned source material;
- the same observations always produce the same canonical report;
- invalid and ambiguous inputs do not crash or become false passes;
- rules cannot bypass the observation and network boundaries;
- local tests never require the public Internet;
- the `ci-public` transport is not advertised before its adversarial suite passes;
- reporters preserve, sanitize, and accurately map the core result.

The fixture inventory is maintained in [FIXTURE_CATALOG.md](FIXTURE_CATALOG.md).
The security controls being tested are maintained in
[THREAT_MODEL.md](THREAT_MODEL.md). If this document conflicts with the threat
model, the threat model takes precedence.

## 2. Testing principles

### 2.1 Deterministic by default

Ordinary tests must not depend on public DNS, live websites, external scanners,
the current date, wall-clock timing, random ports chosen without injection, or
the order in which promises settle.

Tests inject:

- a fixed clock when operational metadata is enabled;
- an in-memory observation transport for parser and rule tests;
- an injectable DNS resolver for network-policy tests;
- a deterministic scheduler or explicit abort signal for timeout tests;
- stable tool, schema, profile, and ruleset versions;
- explicit response bytes and header field values.

The canonical report excludes volatile time and duration fields. For a fixed
input, its serialized bytes must be identical across repeated runs.

### 2.2 Test public behavior, not private implementation

Rule tests assert stable rule IDs, assertion IDs, statuses, sanitized evidence,
and source references. They should not depend on internal helper call counts
except where request deduplication or a security budget is itself the contract.

### 2.3 Every verdict needs a counterexample

Every rule assertion and finding code must have, at minimum:

- one case that satisfies it;
- one case that violates it;
- one unavailable or malformed observation where that state is possible;
- a test of any draft-version or compatibility distinction it exposes.

### 2.4 No hidden network access

Unit, contract, reporter, and ordinary integration jobs run with network access
disabled or with global network APIs replaced by a throwing sentinel. A rule
calling global `fetch` is a test failure. Only the local-loopback integration
job may open sockets, and only to the exact server created by the test.

Scheduled live smoke tests are separate, rate-limited, non-blocking, and target
only project-owned fixtures or targets for which permission was recorded.

### 2.5 Security failures are release blockers

Coverage percentages cannot compensate for a missing adversarial test. Any
change to URL parsing, DNS resolution, redirects, socket connection, response
streaming, decompression, budgets, evidence redaction, browser egress, or hosted
scanning requires the relevant security cases to pass.

## 3. Planned test layers

| Layer | Primary location | Transport | Merge-blocking | Purpose |
| --- | --- | --- | --- | --- |
| Type and boundary checks | package sources | none | yes | Enforce strict types and package directions |
| Parser unit tests | `packages/rules-standard/**/test` | none | yes | Exercise bounded pure parsing |
| Rule contract tests | `packages/rules-standard/**/test` | in-memory | yes | Prove rule semantics and evidence |
| Core engine tests | `packages/core/**/test` | in-memory | yes | Prove ordering, deduplication, budgets, status handling |
| Reporter tests | `packages/reporters/**/test` | none | yes | Validate JSON, JUnit, summaries, SARIF, and redaction |
| CLI compatibility tests | `packages/cli/**/test` | in-memory or loopback | yes | Prove help, flags, streams, and exit codes |
| Fixture Worker tests | `apps/fixtures-worker/test` | Workers test runtime | yes | Prove manifest routing and HTTP behavior |
| Local end-to-end tests | `test/integration` | exact loopback origin | yes | Prove CLI-to-report vertical slices |
| `ci-public` transport tests | `test/security` | controlled resolver and servers | M3 and later | Prove the hostile-network boundary |
| GitHub Action tests | `packages/github-action/test` | in-memory or loopback | M2 and later | Prove inputs, outputs, annotations, and summary |
| Deployed fixture smoke tests | scheduled workflow | project-owned fixture hosts | no | Detect deployment or edge drift |
| External compatibility observations | scheduled/manual workflow | documented external API | no | Detect possible interoperability drift |

## 4. Static and architectural checks

M0 CI must prove all of the following before runtime code is added:

- Node.js 24 is the declared development baseline.
- pnpm uses a committed lockfile and frozen installs in CI.
- TypeScript uses strict mode, including unchecked-index and exact-optional
  checks unless an ADR documents a narrower alternative.
- `core` imports no `node:*`, filesystem, process, CLI, reporter, Wrangler, or
  Cloudflare-specific module.
- `rules-standard` imports no socket, DNS, filesystem, environment, clock,
  randomness, or global-network implementation.
- only `transport-node` can implement target I/O for the `ci-public` profile.
- packages have no dependency cycles or undeclared dependencies.
- fixture code imports no Node-only runtime package.
- executable third-party rule loading is absent from the MVP.

Use TypeScript project references/package exports plus a small import-boundary
check. Avoid adding a large architectural framework solely for this purpose.

## 5. Parser tests

Parsers are pure functions over bounded bytes and normalized metadata. Tests
must cover:

- empty input, maximum accepted input, and one byte above the limit;
- valid UTF-8, a UTF-8 BOM where the source permits it, and malformed encoding;
- line endings (`LF` and `CRLF`) and final lines without a newline;
- case-insensitive tokens where specified, while preserving case-sensitive data;
- duplicate, unknown, and conflicting fields;
- relative and absolute URL resolution;
- hostile control characters and very long tokens;
- malformed JSON, excessive nesting, and schema-valid but semantically invalid
  JSON;
- malformed XML and rejection of `DOCTYPE`/entity declarations;
- Link field values containing quoted commas and multiple field lines;
- media-type parameters and case-insensitive media-type comparison;
- bounded regex behavior over adversarial input.

Parser tests must not treat tolerant parsing as conformance. When a standard
requires an implementation to ignore an unknown field, the test should assert
that known fields remain usable and that the unknown field is preserved only as
bounded evidence if needed.

## 6. Rule contract tests

Each rule contract test supplies a pinned rule definition, explicit target,
mode, profile, observation set, and expected result. It asserts:

- rule ID, `ruleVersion`, and selected mode;
- final status and requirement class;
- stable assertion/finding codes;
- exact evidence references, not complete response bodies;
- source document version and section;
- independently written remediation category;
- no unexpected request;
- expected request representation, including `Accept`;
- deterministic result ordering.

The eight MVP rule families are:

1. Robots Exclusion Protocol;
2. sitemap discovery;
3. HTTP Link discovery;
4. Markdown content negotiation;
5. AI crawler policy;
6. Content Signals;
7. API Catalog;
8. Agent Skills Discovery v0.2.0.

The robots retrieval and parsed representation must be shared by rules 1, 5,
and 6 through the namespaced memo. A contract test must prove that the shared
HTTP observation occurs once and that representation-distinct homepage probes
do not deduplicate.

## 7. Core engine tests

The engine suite must verify:

### Configuration and selection

- invalid configuration makes zero transport calls;
- an unknown mode, profile, ruleset, rule ID, or version is exit code 2 at the
  CLI boundary;
- include/exclude selection is stable and explicit;
- unsupported runtime capability becomes `unsupported-runtime`, not `fail`;
- absence of an optional experimental mechanism becomes `not-applicable` where
  the profile says it does not apply.

### Scheduling and memoization

- rule evaluation follows registry order;
- result order is unchanged when observations resolve in a different order;
- identical probes deduplicate across rules;
- probes differing by `Accept`, redirect policy, body limit, or network profile do not
  deduplicate;
- a failed memo loader cannot poison a later scan;
- a whole-scan request budget cannot be exceeded.

### Error normalization

- raw socket/parser stacks never enter the canonical report;
- typed transport conditions map to the documented status semantics;
- one `unable-to-check` does not become a whole-scan abort unless continued
  evaluation would violate policy;
- caller cancellation remains distinguishable from a target timeout;
- an unexpected rule exception becomes an invariant failure in built-in code,
  rather than a fabricated target violation.

### Canonicalization

- arrays and header names are in canonical order;
- evidence IDs are stable for the same sanitized observation;
- random IDs, timestamps, durations, and completion order are absent;
- repeated serialization is byte-for-byte identical;
- reporters cannot mutate the frozen report.

## 8. Reporter tests

### Human reporter

- required failures, recommendations, unavailable checks, and not-applicable
  checks are visually distinct without relying only on color;
- `NO_COLOR` and a non-TTY produce no ANSI sequences;
- untrusted values are bounded and control characters are escaped;
- rule and finding order is stable.

### JSON reporter

- every golden report validates against the committed Draft 2020-12 schema;
- machine-readable stdout contains JSON only;
- diagnostics go to stderr;
- canonical output omits the optional metadata envelope by default;
- unknown future additive fields can be handled according to the schema policy.

### JUnit reporter

- one selected rule maps to one `<testcase>`;
- `fail` maps to `<failure>`;
- `unable-to-check` and `unsupported-runtime` map to `<error>` by default;
- `not-applicable` maps to `<skipped>`;
- multiple findings are combined portably;
- hostile text is correctly XML-escaped and bounded;
- declared counts match emitted elements.

### GitHub Summary and annotations

- the Job Summary needs no pull-request write permission;
- annotations are capped and remaining findings stay visible in the summary;
- workflow-command injection and control characters are neutralized;
- no pull-request comment is attempted by default.

### SARIF

- output validates as SARIF 2.1.0;
- rule IDs, severities, and partial fingerprints remain stable;
- only explicit, validated repository-relative source mappings create code
  locations;
- absolute and traversal paths are rejected;
- unmapped remote findings are not disguised as repository files;
- a test documents that GitHub does not display a code-scanning result without
  a repository artifact location.

## 9. CLI tests

Every public command and flag requires help-text and behavior golden tests.

| Exit | Required test |
| ---: | --- |
| `0` | Completed scan passes selected strictness policy |
| `1` | Completed scan contains a failure or promoted warning/unavailable result |
| `2` | Invalid argument, configuration, selector, profile, or combination |
| `3` | Whole scan cannot continue safely because of network/security/budget policy |
| `4` | Injected internal invariant violation |

Additional cases:

- JSON stdout is clean while diagnostics use stderr;
- `SIGINT`/caller cancellation terminates predictably;
- output files are not partially replaced after a failed serialization;
- the `local-loopback` profile requires an exact loopback origin;
- the `ci-public` profile is rejected until M3 exists;
- command examples shown as planned before implementation are not published as
  working documentation.

## 10. Local fixture integration

The fixture manifest is compiled into both an in-memory adapter and the Worker
handler. Ordinary integration tests use the same declarative cases without a
public deployment.

For every fixture:

1. validate ID, host-label safety, and unique route keys;
2. start the exact loopback origin or use the Workers test runtime;
3. run the selected rule/profile/mode;
4. compare the result with the manifest expectation;
5. assert no additional route was requested;
6. assert that the override changes only its declared assertions relative to
   the known-good base;
7. serialize and schema-validate the report.

The public Worker must contain only compile-time cases. Tests reject an open
redirect, arbitrary response query, arbitrary upstream URL, or proxy route.

## 11. `ci-public` transport adversarial suite

M3 cannot be completed until all cases in the security section of
[FIXTURE_CATALOG.md](FIXTURE_CATALOG.md) pass. The suite uses an injected
resolver and controlled local servers to prove policy without contacting the
Internet.

Mandatory properties include:

- all A and AAAA answers are classified;
- any private/special-use answer rejects a mixed set;
- IPv4-mapped IPv6 and alternate textual forms do not bypass classification;
- the actual socket is pinned to an authorized address while Host and TLS SNI
  remain the original hostname;
- every redirect repeats parse, resolution, classification, and authorization;
- ambient proxy variables, cookies, and credentials are not used;
- compressed and decompressed limits are enforced while streaming;
- total request, byte, redirect, and elapsed budgets stop work;
- diagnostic evidence remains sanitized.

An ordinary `fetch()` preceded by a DNS check is not an acceptable passing
implementation.

## 12. CI plan

### M0/M1 merge workflow

Run on Node.js 24 with a frozen pnpm install:

1. formatting check;
2. lint and package-boundary check;
3. TypeScript typecheck;
4. unit and contract tests with network disabled;
5. Workers fixture tests;
6. local integration tests;
7. build and package-content inspection.

Linux is the required merge platform. Once the CLI exists, add non-blocking
Windows and macOS smoke jobs, promoting them to required after their behavior is
stable.

### M2 additions

- public schema compatibility tests;
- GitHub Action unit/integration tests;
- Action bundle reproducibility (`ncc` output produces no diff);
- JUnit and SARIF validation;
- permissions tests/examples using `pull_request`, not unsafe
  `pull_request_target` execution.

### M3 additions

- full network security suite;
- dependency audit for the transport stack;
- supported Node patch-line matrix if more than Node 24 is deliberately
  supported;
- manual review requirement for changes under `transport-node` and
  `test/security`.

### Scheduled, non-blocking workflow

- deploy/smoke project-owned public fixtures;
- compare local and deployed response facts;
- perform explicitly approved external compatibility observations;
- open or update an issue on drift; never change a PR verdict automatically.

## 13. Coverage policy

Coverage is a diagnostic, not the definition of correctness. Initial thresholds
may be set at 85% line and branch coverage for `core`, `rules-standard`, and
`transport-node`, but release gates additionally require:

- every public status transition tested;
- every finding/assertion code reached;
- every parser limit and failure family tested;
- every security case mapped to a named test;
- no skipped or todo test in a release-critical suite without a linked issue
  and explicit milestone decision.

Do not add meaningless tests merely to increase a percentage.

## 14. Planned commands

These commands are targets for M0 and are not currently implemented:

```text
pnpm test
pnpm test:unit
pnpm test:integration
pnpm test:security
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check
```

`pnpm check` should be the single local pre-push command and must include every
merge-blocking deterministic check.

## 15. Test-change review checklist

For any test or fixture change, reviewers verify:

- [ ] The expected behavior cites a pinned source or accepted ADR.
- [ ] The test is deterministic and uses no unauthorized public target.
- [ ] A changed verdict includes ruleset/version impact analysis.
- [ ] A bug fix adds a failing regression test before or with the fix.
- [ ] Sanitization assertions cover any newly retained evidence.
- [ ] A security control was not weakened merely to make a fixture pass.
- [ ] Golden output changes are explained field by field.
- [ ] The fixture catalog and project status remain accurate.
