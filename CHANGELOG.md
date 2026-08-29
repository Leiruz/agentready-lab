# Changelog

All notable project changes should be recorded here. The project intends to use
[Semantic Versioning](https://semver.org/) once packages are published and the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) structure for human
readability.

## [Unreleased]

Nothing is released. Every package is `private` at version `0.0.0`, and there
is no npm package, tag, GitHub Action, or hosted service.

### Added

- Initial reviewed implementation blueprint.
- Standards and source snapshot dated 2026-08-28.
- Architecture, threat model, fixture plan, test strategy, roadmap, governance,
  contribution, and Claude Code guidance.
- ADR-0001 through ADR-0010, resolving the contradictions three adversarial
  review rounds found in the blueprint.
- pnpm workspace on Node.js 24, strict TypeScript, enforced package
  boundaries, and CI on deterministic local inputs.
- Three-file specification registry: the frozen external snapshot
  `checks.v0.yaml`, the source ledger `sources.v0.yaml`, and the executable
  ruleset `ruleset.standard.v0.yaml`, with a validator and a generated
  per-rule status table that CI checks against the ruleset.
- Deterministic rule engine: serial dispatch in plan order, representation-aware
  request deduplication, namespaced memoization, and canonical JSON that is
  byte-identical across latency profiles and chunk segmentations.
- `local-loopback` transport, the project's security boundary. It accepts one
  exact IP-literal origin and refuses a host name, so no resolver, hosts file,
  or NSS lookup enters the trust boundary.
- Eight rules, all `supported`: robots, sitemap discovery, HTTP Link discovery,
  Markdown negotiation, AI crawler policy, Content Signals, API Catalog, and
  Agent Skills Discovery. Every assertion carries a pinned source with a
  version and a verification date, and independently written remediation text.
- Human and canonical JSON reporters, and the `check`, `rules list`, and
  `rules explain` commands, with tested exit codes 0, 1, 2, and 4.
- Fixture Worker with 49 protocol fixtures and a known-good base origin, run
  under both Node and the Workers runtime.
- Test kit: in-memory transport, rule-contract harness, and a network sentinel
  that turns an unexpected connection into a test failure.
- 1,949 tests. `pnpm check` runs format, lint, typecheck, both suites,
  registry validation, the generated status table, and the build.

### Changed

- `README.md` and `PROJECT_STATUS.md` no longer describe a design-stage
  blueprint. They describe an early `local-loopback`-only scanner and name what
  does not exist.

### Not implemented

Recorded here because the documentation used to imply otherwise:

- public scanning. `--network-profile ci-public` exits 2 and opens no
  connection. It is an M3 deliverable.
- an installable command. `packages/cli` declares no `bin`.
- the JUnit, SARIF, and GitHub Job Summary reporters, and the GitHub Action.
  All M2.
- a committed JSON Schema for the configuration or the canonical report.
- 14 of the 22 registry checks, whose assertions have no pinned citations yet.
- exit code 3, `--mode compat`, and `--mode interop`, each declared by a
  contract and unreachable at the current rule versions.
- the ADR-0006 layer-B raw socket harness, which fixtures `lnk-001` and
  `lnk-002` need.
