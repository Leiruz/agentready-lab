---
paths:
  - "**/*.test.ts"
  - "**/*.spec.ts"
  - "test/**"
  - "packages/testkit/**"
  - "apps/fixtures-worker/**"
  - "schemas/**"
  - ".github/workflows/**"
---

# Testing rules

Follow `docs/TEST_STRATEGY.md`. Before M0, referenced scripts are planned and
may not exist; never claim they ran. After a script becomes authoritative in
`PROJECT_STATUS.md`, use it exactly as documented.

## Test-first loop

1. Express the expected external behavior in a failing test or fixture.
2. Run the narrowest available test and confirm the failure is relevant.
3. Implement the smallest complete change.
4. Run the targeted test and affected package suite.
5. Run milestone-required contract, integration, security, and golden tests.
6. Once implemented by M0, finish with `pnpm check`.

Show commands and results. If a check cannot run, explain why and do not imply
that the change is verified.

## Determinism

- Default tests use injected transports, resolvers, clocks, and randomness.
- Normal CI must not use public DNS, public sites, an external scanner, or the
  current wall clock.
- Canonical output order must not depend on response or task completion order.
- Separate volatile envelope metadata from byte-stable canonical reports.
- Live observations are scheduled, permission-scoped, rate-limited,
  non-blocking, and limited to project-owned or explicitly authorized targets.

## Rule coverage

Every implemented rule needs contract tests and, where relevant, fixtures for:

- valid applicable behavior;
- violated normative behavior;
- recommendation/advisory warning behavior;
- absence and `not-applicable` behavior;
- malformed syntax or wrong media type;
- soft 404s, redirects, and relative discovery references;
- timeout, truncation, parser failure, and resource-limit outcomes;
- supported, unsupported, and drifted source versions;
- mode differences among `spec`, `compat`, and `interop`.

Assert the exact status vocabulary: `pass`, `fail`, `warning`,
`not-applicable`, `unable-to-check`, and `unsupported-runtime`. Test that
transport/environment errors are not mislabeled as conformance failures.

## Layer requirements

- Parser/evaluator unit tests are pure and offline.
- Rule contract tests run each rule against the shared testkit.
- Integration tests use controlled local fixtures.
- Network changes run the adversarial security matrix.
- JSON validates against its committed schema.
- Human, JUnit, GitHub Summary, and SARIF reporters have bounded, escaped output
  and compatibility/golden tests appropriate to their milestone.
- SARIF produces repository locations only from an explicit safe source map.
- CLI/config/report changes test help text, schemas, and exit codes 0 through 4.
- GitHub Action source changes run `pnpm action:verify` after that command exists.

## Test integrity

Do not commit `.only`, unexplained skips, timing sleeps, public-network
dependencies, or retries that conceal deterministic failures. Do not weaken an
assertion to match a bug. Broad snapshots may supplement, but never replace,
specific behavioral assertions.

A security or standards bug fix requires a regression test that fails before
the fix. Fixture-specific production branches are prohibited.
