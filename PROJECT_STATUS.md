# Project Status

Last updated: 2026-08-29

## Current phase

**Phase 1: working `local-loopback` scanner**

The rule engine, the eight M1 rules, the loopback transport, both reporters,
the three CLI commands, and the fixture Worker all exist and are tested.
`pnpm check` exits 0 with 1,949 tests passing: 1,885 in the main suite and 64
in the fixture Worker under the Workers runtime.

A scan runs end to end. Against a loopback server serving the known-good base
origin, `check --profile full` reports all eight rules passing, 27 findings and
exit 0; against fixture `md-003`, it reports one normative failure with its
remediation, its pinned source and an evidence reference, and exits 1.

What still does not exist: public scanning, an npm package, a `bin`, a release,
a GitHub Action, a hosted service, the JUnit, SARIF and GitHub Job Summary
reporters, and a committed JSON Schema for the report. Every package is
`private` at version `0.0.0`.

## What is authoritative today

- The accepted decisions under `docs/decisions/`, which the precedence list
  below ranks second and which amend the documents around them.
- The scope and acceptance criteria in `docs/IMPLEMENTATION_SPEC.md`.
- The trust boundaries and non-negotiable controls in `docs/THREAT_MODEL.md`.
- The three registry authorities in `specs/`: the frozen external snapshot
  `checks.v0.yaml`, the source ledger `sources.v0.yaml`, and the executable
  ruleset `ruleset.standard.v0.yaml`, with `docs/STANDARDS_REGISTRY.md` as the
  human-readable audit guide.
- The milestone order in `docs/ROADMAP.md`.
- The working rules for Claude Code in `CLAUDE.md` and `.claude/rules/`.

If these documents conflict, use this precedence:

1. security requirements in `docs/THREAT_MODEL.md`;
2. accepted architecture decisions under `docs/decisions/`;
3. `docs/IMPLEMENTATION_SPEC.md`;
4. `docs/STANDARDS_REGISTRY.md` for source provenance;
5. roadmap and explanatory documentation.

Open an issue rather than silently resolving a material conflict in code.

The open questions in `docs/decisions/README.md` are recorded, not resolved.
Its "Reconciliation required before implementation" table is also still open:
several documents under `docs/` disagree with the accepted decisions, and the
decisions win.

## Component status

| Component | State | What that means |
| --- | --- | --- |
| `packages/core` | implemented | Engine, result model, canonical JSON, SHA-256, registry validation. |
| `packages/rules-standard` | implemented | Eight rules, all `supported`. The other 14 registry checks are `planned`. |
| `packages/transport-node` | implemented for `local-loopback` | One exact IP-literal origin. `ci-public` is refused before any connection; it is M3. |
| `packages/reporters` | implemented | Human and canonical JSON. JUnit, SARIF and GitHub Job Summary are M2 and do not exist. |
| `packages/cli` | implemented, not installable | `check`, `rules list`, `rules explain`. No `bin`, so there is no command to install. |
| `packages/testkit` | partial | In-memory transport, rule-contract harness, network sentinel. The ADR-0006 layer-B raw socket harness is not built. |
| `packages/github-action` | scaffold only | A version marker. No `action.yml`, no bundle behavior. M2. |
| `apps/fixtures-worker` | implemented | 49 protocol fixtures and a known-good base origin. Its handler runs under both Node and the Workers runtime. The two layer-B cases are not served by it. Not deployed. |
| `specs/` | implemented | Frozen snapshot, source ledger, executable ruleset, and their validator. |
| Config and report JSON Schemas | absent | An M0 deliverable. `packages/core` exports a Draft 2020-12 validator and only the `specs/` schemas use it; configuration is validated by hand-written code, and the report carries `schemaVersion` `1.0.0` with no committed schema. |
| npm package, release, hosted service | none | Nothing is published, tagged, or deployed. |

## Per-rule implementation status

This table is generated from `specs/ruleset.standard.v0.yaml`, which ADR-0008
section 3 makes the single machine-readable authority for per-rule status. This
document is the summary and never the source; `pnpm run status:check` fails
when the two disagree.

Eight rules read `supported` and execute; the other 14 read `planned` and are
not registered, so `rules list` shows eight and a selector naming one of the
other 14 is exit 2. The 14 are `planned` because their assertions have no
pinned citations yet, not because the code is written and switched off.

`Rule version` is the version this project's interpretation carries; for the
14 `planned` rules it is the version their interpretation would carry when they
ship, and is not a claim that anything shipped. `Source maturity` describes the
pinned source set and is a different vocabulary on a different subject: a rule
can rest on a `stable` RFC and still be `planned`.

<!-- BEGIN GENERATED: rule-implementation-status -->

<!-- Generated from specs/ruleset.standard.v0.yaml by scripts/status-table.ts.
     Do not edit by hand: `pnpm run status:check` fails when this differs
     from the ruleset, and `pnpm run status:write` regenerates it. -->

| Rule | Rule version | Implementation status | Source maturity |
| --- | --- | --- | --- |
| `web.discovery.robots` | 0.1.0 | supported | stable |
| `web.discovery.sitemap` | 0.1.0 | supported | stable |
| `web.discovery.link` | 0.1.0 | supported | mixed |
| `dns.discovery.dns-aid` | 0.1.0 | planned | draft |
| `web.content.markdown-negotiation` | 0.1.0 | supported | convention |
| `web.policy.ai-crawler` | 0.2.0 | supported | mixed |
| `web.policy.content-signals` | 0.2.0 | supported | experimental |
| `web.identity.web-bot-auth` | 0.1.0 | planned | draft |
| `agent.discovery.mcp-server-card` | 0.1.0 | planned | experimental |
| `agent.discovery.a2a-agent-card` | 0.1.0 | planned | stable |
| `agent.discovery.skills` | 0.1.0 | supported | draft |
| `agent.browser.webmcp` | 0.1.0 | planned | experimental |
| `web.discovery.api-catalog` | 0.1.0 | supported | stable |
| `auth.discovery.oauth-authorization-server` | 0.1.0 | planned | stable |
| `auth.discovery.oauth-protected-resource` | 0.1.0 | planned | stable |
| `auth.discovery.auth-md` | 0.1.0 | planned | experimental |
| `agent.discovery.ard` | 0.1.0 | planned | draft |
| `commerce.payment.x402` | 0.1.0 | planned | mixed |
| `commerce.payment.mpp` | 0.1.0 | planned | draft |
| `commerce.discovery.ucp` | 0.1.0 | planned | mixed |
| `commerce.discovery.acp` | 0.1.0 | planned | beta |
| `commerce.payment.ap2` | 0.1.0 | planned | experimental |

<!-- END GENERATED: rule-implementation-status -->


## Milestone state

M0's acceptance criteria are met. One M0 deliverable is not: the JSON Schema
source for configuration and for the canonical report.

M1 is substantially complete, and three of its thirteen acceptance criteria are
not fully met. `docs/ROADMAP.md` sections 3, 4 and 13 record which, and why. In
short: no report JSON Schema is committed, so the `0.1.0` release criteria in
`docs/IMPLEMENTATION_SPEC.md` section 24 are not satisfied; several assertion
outcome kinds are structurally unreachable at the current rule versions and so
have no negative test; and one security case, `sec-012`, is described in the
catalogue and named by no test, although the budget behavior it describes is
covered.

One M1 deliverable is also missing: the ADR-0006 layer-B raw socket harness.
Fixtures `lnk-001` and `lnk-002` need it, because a normalized `Response` folds
repeated `Link` field lines. Their rule contracts pass through the in-memory
transport, and neither case can be served over a socket.

## Next milestone

**M2: report and CI contracts**

Required outcome:

- JUnit, SARIF, and GitHub Job Summary reporters;
- a committed JSON Schema the canonical report validates against;
- a canonical report diff command;
- a thin GitHub Action with a reproducible committed bundle.

M2 is complete only after every acceptance criterion in `docs/ROADMAP.md` is
verified and this file is updated in the same pull request. The same rule
governs the remaining open M1 criteria: closing one means updating both files.

## Maintainer publication checklist

Before making the generated repository public:

- [ ] Choose and verify the final GitHub repository name.
- [ ] Perform package, domain, IPOS Singapore, and WIPO name searches.
- [ ] Confirm the Apache-2.0 license choice.
- [ ] Enable GitHub private vulnerability reporting.
- [x] Configure a real monitored private conduct-reporting contact, then add
      the current official Contributor Covenant as `CODE_OF_CONDUCT.md`.
      Contributor Covenant 3.0 is committed with a named private contact.
- [ ] Enable two-factor authentication on maintainer accounts.
- [ ] Configure a protected `main` branch or repository ruleset.
- [ ] Install and require an automated DCO check; the sign-off policy itself is
      already fixed in `CONTRIBUTING.md`.
- [ ] Replace any examples that refer to a domain the project does not own.
- [ ] Confirm every external source link and update the snapshot date if needed.
- [ ] Do not advertise an npm package, hosted demo, or working CLI until it exists.

## Status vocabulary

- **planned**: specified, not implemented;
- **experimental**: implemented but subject to incompatible change;
- **supported**: covered by compatibility and regression tests;
- **deprecated**: supported temporarily with a documented replacement;
- **removed**: no longer shipped.
