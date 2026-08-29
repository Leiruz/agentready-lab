# Project Status

Last updated: 2026-08-29

## Current phase

**Phase 0 — reviewed implementation blueprint**

This repository pack currently contains project requirements, architecture,
security constraints, a standards snapshot, planned fixtures, contributor
guidance, and Claude Code instructions. It does not yet contain a working CLI,
rule engine, fixture Worker, GitHub Action, npm package, hosted service, or
published release.

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

## Per-rule implementation status

This table is generated from `specs/ruleset.standard.v0.yaml`, which ADR-0008
section 3 makes the single machine-readable authority for per-rule status. This
document is the summary and never the source; `pnpm run status:check` fails
when the two disagree.

Every rule reads `planned`, and that is accurate. What exists today is the pnpm
workspace, the canonical JSON and SHA-256 primitives in `packages/core`, the
three-file registry validator, and the package-boundary tests. There is no rule,
no engine, no transport, no reporter and no CLI, so no rule in this table
executes anything.

`Rule version` is the version this project's interpretation would carry when it
ships; it is not a claim that anything shipped. `Source maturity` describes the
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


## Next milestone

**M0 — repository foundation**

Required outcome:

- pnpm workspace using Node.js 24 LTS, as pinned by the architecture snapshot;
- strict TypeScript configuration;
- package boundaries matching `docs/ARCHITECTURE.md`;
- lint, format, typecheck, unit-test, and build commands;
- a minimal result-model package with tests;
- no real network scanning yet;
- CI that runs entirely on deterministic local inputs.

M0 is complete only after every acceptance criterion in
`docs/ROADMAP.md` is verified and this file is updated in the same pull request.

## Maintainer publication checklist

Before making the generated repository public:

- [ ] Choose and verify the final GitHub repository name.
- [ ] Perform package, domain, IPOS Singapore, and WIPO name searches.
- [ ] Confirm the Apache-2.0 license choice.
- [ ] Enable GitHub private vulnerability reporting.
- [ ] Configure a real monitored private conduct-reporting contact, then add
      the current official Contributor Covenant as `CODE_OF_CONDUCT.md`.
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
