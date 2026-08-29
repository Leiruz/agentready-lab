# Project Status

Last updated: 2026-08-28

## Current phase

**Phase 0 — reviewed implementation blueprint**

This repository pack currently contains project requirements, architecture,
security constraints, a standards snapshot, planned fixtures, contributor
guidance, and Claude Code instructions. It does not yet contain a working CLI,
rule engine, fixture Worker, GitHub Action, npm package, hosted service, or
published release.

## What is authoritative today

- The scope and acceptance criteria in `docs/IMPLEMENTATION_SPEC.md`.
- The trust boundaries and non-negotiable controls in `docs/THREAT_MODEL.md`.
- The source snapshot in `docs/STANDARDS_REGISTRY.md` and `specs/checks.v0.yaml`.
- The milestone order in `docs/ROADMAP.md`.
- The working rules for Claude Code in `CLAUDE.md` and `.claude/rules/`.

If these documents conflict, use this precedence:

1. security requirements in `docs/THREAT_MODEL.md`;
2. accepted architecture decisions under `docs/decisions/`;
3. `docs/IMPLEMENTATION_SPEC.md`;
4. `docs/STANDARDS_REGISTRY.md` for source provenance;
5. roadmap and explanatory documentation.

Open an issue rather than silently resolving a material conflict in code.

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
