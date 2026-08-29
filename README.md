# AgentReady Lab

Independent conformance tests for agent-facing web standards.

> [!IMPORTANT]
> **Design-stage project.** This repository pack is an implementation blueprint,
> not a working scanner yet. See [PROJECT_STATUS.md](PROJECT_STATUS.md) before
> following commands or opening implementation pull requests.

> [!IMPORTANT]
> **Independent project.** AgentReady Lab is not affiliated with, sponsored by,
> or endorsed by Cloudflare, Inc. It independently tests published web standards
> and may optionally compare its observations with the public
> [IsItAgentReady](https://isitagentready.com/) service.

## What this project is

AgentReady Lab is intended to be a deterministic, local-first test suite for
websites that want to work well with AI agents. It will inspect published HTTP,
DNS, discovery, authentication, and agent-interface metadata and explain exactly
why each check passed, failed, was not applicable, or could not be completed.

The simplest mental model is **Lighthouse-style testing for agent-facing web
protocols, designed for development and continuous integration**.

A completed version should let a developer:

1. test a local preview before deployment;
2. test the deployed origin and edge-visible result;
3. see the response evidence behind each verdict;
4. catch regressions on a pull request;
5. reproduce draft-standard interoperability problems with versioned fixtures;
6. export stable JSON, JUnit, and SARIF reports.

## Why it should exist

Cloudflare's public Agent Readiness documentation currently describes 22 checks
covering discoverability, agent-readable content, bot controls, protocol and
authentication discovery, and commerce. Many of the underlying mechanisms are
new drafts or proposals rather than settled standards. They change quickly, and
a superficially valid endpoint can still fail because of redirects, media
types, caching, relative URL resolution, schema versions, or edge behavior.

AgentReady Lab focuses on the missing developer workflow: **deterministic
pre-deployment conformance and regression testing**. It is not intended to copy
Cloudflare's UI, remediation text, private implementation, or scoring model.

Primary background sources:

- [Cloudflare's Agent Readiness announcement](https://blog.cloudflare.com/agent-readiness/)
- [Current IsItAgentReady check documentation](https://isitagentready.com/llms-full.txt)
- [Agent Skills Discovery draft](https://github.com/cloudflare/agent-skills-discovery-rfc)
- [API Catalog, RFC 9727](https://www.rfc-editor.org/rfc/rfc9727)
- [OAuth Protected Resource Metadata, RFC 9728](https://www.rfc-editor.org/rfc/rfc9728)

All source claims in this repository are snapshot-dated. See
[docs/STANDARDS_REGISTRY.md](docs/STANDARDS_REGISTRY.md) for maturity and source
details.

## Planned capabilities

### Milestone 1: deterministic local CLI

- Eight initial rules: robots, sitemap, Link discovery, Markdown negotiation,
  AI crawler policy, Content Signals, API Catalog, and Agent Skills Discovery.
- Human-readable and JSON output.
- No LLM in the verdict path.
- Local HTTP fixture suite with valid, invalid, ambiguous, and unreachable cases.

### Milestone 2: reporting and CI

- JUnit and SARIF reporters.
- Pull-request regression summaries.

### Milestone 3: secure public remote scanning

- A security-reviewed remote transport with redirect-by-redirect SSRF controls,
  address pinning, timeouts, and byte/request budgets.

### Milestones 4–5: broader interoperability

- MCP Server Cards, A2A Agent Cards, OAuth metadata, Auth.md, DNS-AID, Web Bot
  Auth, ARD, and opt-in browser checks for WebMCP.
- Optional, clearly labeled differential comparison with external scanners.
- Versioned compatibility matrices for evolving drafts.

### Later, not MVP

- Commerce protocols.
- Hosted multi-user scanning.
- Automatic remediation patches.
- Third-party rule plugins.

These features stay out of the MVP because they materially increase security,
maintenance, or specification-drift risk.

## Design principles

1. **Evidence before scores.** A verdict includes the request, sanitized response
   facts, specification version, and exact assertion that produced it.
2. **Normative text before scanner parity.** Published RFCs and versioned
   specifications outrank another scanner's observed behavior.
3. **Drafts are labeled as drafts.** A proposal failure is not presented as a
   universal web-compliance failure.
4. **Deterministic core.** LLMs may explain findings later, but never decide
   pass/fail status.
5. **Network input is hostile.** Remote scanning is disabled until the safe
   transport and its adversarial tests are complete.
6. **Local-first and privacy-preserving.** Local scans should not require an
   account, API key, telemetry, or hosted service.
7. **No false certification.** Results are technical observations, not an
   official certification, security audit, or legal determination.

## Proposed repository layout

```text
apps/
  fixtures-worker/      Public and local protocol fixtures
  demo/                 Optional hosted demonstration
packages/
  core/                 Runtime-neutral scan orchestration and result model
  rules-standard/       Built-in, versioned rule implementations
  transport-node/       Security boundary for remote network access
  reporters/            Human, JSON, JUnit, and SARIF output
  cli/                  Command-line interface
  github-action/         GitHub Action wrapper
  testkit/              Fixture and rule-author testing utilities
specs/                  Machine-readable rule metadata and schemas
docs/                   Product, architecture, security, and test documentation
```

The authoritative design is in
[docs/IMPLEMENTATION_SPEC.md](docs/IMPLEMENTATION_SPEC.md) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Intended command-line experience

The following is a **target interface**, not an implemented command:

```bash
agentready-lab check http://127.0.0.1:3000 --network-profile local-loopback
agentready-lab check "$AUTHORIZED_PUBLIC_URL" --network-profile ci-public --profile content
agentready-lab check "$AUTHORIZED_PUBLIC_URL" --network-profile ci-public --format json --output report.json
```

Exit-code and report contracts are defined in the implementation specification.
They must be tested before the CLI is published. The public examples apply only
after M3 and require an HTTP(S) origin you own or are authorized to test;
documentation-reserved and other special-use names are rejected by policy.

## Using Claude Code on this repository

Start Claude Code at the repository root so it loads [CLAUDE.md](CLAUDE.md).
Before asking it to implement a milestone, read:

1. [PROJECT_STATUS.md](PROJECT_STATUS.md)
2. [docs/IMPLEMENTATION_SPEC.md](docs/IMPLEMENTATION_SPEC.md)
3. [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)
4. [docs/ROADMAP.md](docs/ROADMAP.md)

The repository also contains scoped rules under `.claude/rules/` and a manual
workflow for adding checks under `.claude/skills/add-check/`.

Do not ask Claude Code to “build everything.” Give it one milestone or one
acceptance criterion at a time, require a plan before editing, and require the
relevant tests before accepting the change. See
[docs/CLAUDE_CODE_WORKFLOW.md](docs/CLAUDE_CODE_WORKFLOW.md).

## Before publishing this starter

Complete [docs/MAINTAINER_CHECKLIST.md](docs/MAINTAINER_CHECKLIST.md). In
particular, clear the working name, enable private vulnerability reporting, and
add the current Contributor Covenant with a real monitored private conduct
contact. This pack intentionally does not include a fake
`CODE_OF_CONDUCT.md` placeholder.

## Contributing

The project should welcome narrowly scoped, test-backed improvements. Changes to
rule semantics require a primary source, a pinned source version or observation
date, positive and negative fixtures, and maintainer agreement before code is
written. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Responsible use

AgentReady Lab makes outbound network requests. Use it only on systems you own
or are authorized to test, and comply with applicable law, target-site terms,
and published crawler policies. Results are best-effort technical observations,
not a security audit, legal opinion, compliance determination, or official
certification. Results can vary with network conditions, caching,
configuration, and specification versions.

## Project name and trademarks

`AgentReady Lab` is a working project name. Similar “AgentReady” names are
already used by unrelated software. Before purchasing a domain, publishing an
npm package, or creating branding, the maintainer must complete package,
domain, and trademark searches. Do not use Cloudflare in the project or package
name, copy Cloudflare branding, or imply that results are official.

Cloudflare and Cloudflare Workers are trademarks and/or registered trademarks
of Cloudflare, Inc. All other product names and marks belong to their respective
owners.

## License

Licensed under the [Apache License 2.0](LICENSE). Contributions must comply
with the Developer Certificate of Origin 1.1 as described in
[CONTRIBUTING.md](CONTRIBUTING.md).
