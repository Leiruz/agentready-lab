# AgentReady Lab

Independent conformance tests for agent-facing web standards.

> [!IMPORTANT]
> **Early working scanner, not a released package.** The eight Milestone 1
> rules run, and they run only against a loopback origin you supply. There is
> no npm package, no installable command, no release, and no public scanning:
> every package is `private` at version `0.0.0`, the CLI declares no `bin`, and
> `--network-profile ci-public` is refused before any connection is opened. See
> [PROJECT_STATUS.md](PROJECT_STATUS.md) for what exists.

> [!IMPORTANT]
> **Independent project.** AgentReady Lab is not affiliated with, sponsored by,
> or endorsed by Cloudflare, Inc. It independently tests published web standards
> and may optionally compare its observations with the public
> [IsItAgentReady](https://isitagentready.com/) service.

## What this project is

AgentReady Lab is a deterministic, local-first test suite for websites that
want to work well with AI agents. Today it inspects published HTTP discovery,
content-negotiation, and bot-policy metadata on a loopback origin, and explains
exactly why each check passed, failed, was not applicable, or could not be
completed. The DNS, authentication, and agent-interface families are specified
in `specs/` and are not implemented.

The simplest mental model is **Lighthouse-style testing for agent-facing web
protocols, designed for development and continuous integration**.

A completed version should let a developer:

1. test a local preview before deployment (this works today);
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

## What works today

Milestone 1, the deterministic local CLI, is built and substantially complete:

- Eight rules, all `supported`: robots, sitemap discovery, HTTP Link discovery,
  Markdown negotiation, AI crawler policy, Content Signals, API Catalog, and
  Agent Skills Discovery.
- Human-readable and canonical JSON output.
- No LLM in the verdict path.
- `check`, `rules list`, and `rules explain`, with exit codes 0, 1, 2, and 4.
- A `local-loopback` transport that accepts one exact IP-literal origin.
- 49 protocol fixtures, a known-good base origin, and the M1 security and
  boundary cases. `docs/ROADMAP.md` names the one security case that no test
  reaches by name.

Two things are unfinished. The raw-socket fixture harness that ADR-0006
requires for the two repeated-`Link`-header cases does not exist, so those two
cases are exercised through the in-memory transport only. And no JSON Schema is
committed for the configuration or for the report, which is a Milestone 0
deliverable that the `0.1.0` release criteria also need. `docs/ROADMAP.md`
records both.

Fourteen of the 22 checks in the registry are `planned` and cannot be selected,
because their assertions have no pinned citations yet. Three declared
behaviors are unreachable at the current rule versions and are left declared
rather than removed: exit code 3, `--mode compat`, and `--mode interop`.

## Planned capabilities

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

## Repository layout

```text
apps/
  fixtures-worker/      Local and Workers-runtime protocol fixtures
packages/
  core/                 Runtime-neutral scan orchestration and result model
  rules-standard/       Built-in, versioned rule implementations
  transport-node/       Security boundary for network access
  reporters/            Human and canonical JSON output
  cli/                  Command-line interface
  github-action/        Scaffold only; the Action is an M2 deliverable
  testkit/              Fixture and rule-author testing utilities
specs/                  Machine-readable rule metadata and schemas
docs/                   Product, architecture, security, and test documentation
```

The JUnit and SARIF reporters, the `apps/demo` hosted demonstration, and the
Action itself do not exist. `packages/github-action` currently holds a version
marker and no `action.yml`.

The authoritative design is in
[docs/IMPLEMENTATION_SPEC.md](docs/IMPLEMENTATION_SPEC.md) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Running it from a clone

There is no installable command. `packages/cli` declares no `bin`, every
package is `private` at version `0.0.0`, and nothing is published, so the CLI
is reached as a library. From a clone, on Node.js 24:

```bash
pnpm install --frozen-lockfile
pnpm build

RUNNER="
import { runCli, nodeEnvironment } from './packages/cli/dist/index.js';
const result = await runCli(nodeEnvironment({
  argv: process.argv.slice(1),
  env: process.env,
  cwd: process.cwd(),
}));
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
"

node --input-type=module -e "$RUNNER" check http://127.0.0.1:3000
node --input-type=module -e "$RUNNER" rules list
```

These three commands are implemented and tested. No other command exists.

```text
check <url>            Scan one exact loopback origin.
rules list             List the rules in the pinned ruleset.
rules explain <id>     Print one rule's pinned metadata and assertions.
```

`check` takes `--mode`, `--profile`, `--ruleset`, `--include`, `--exclude`,
`--format`, `--source-map`, `--strict-warnings`, `--strict-unable`, and
`--color`. Run it with `--help` for the full text.

Not implemented, and refused rather than silently ignored:

- `--network-profile ci-public` exits 2 and opens no connection. It is an M3
  deliverable, and this build carries no policy object that could reach a
  public destination.
- `--mode compat` and `--mode interop` exit 2. No rule declares an assertion
  for either mode at its current version.
- There is no `--output` flag, and no JUnit, SARIF, or GitHub Job Summary
  reporter. Redirect stdout to write a report to a file.

The target must be an IP literal. `http://localhost:3000` is refused with exit
2 on purpose: resolving a name would put the hosts file, NSS, and a DNS answer
inside the trust boundary of a profile whose whole guarantee is that the scan
cannot leave the machine. Write `http://127.0.0.1:3000` or `http://[::1]:3000`.

### A real example

Scanning a preview server that answers a `text/markdown` request with HTML.
This is fixture `md-003`, served on `127.0.0.1:3000`:

```text
$ node --input-type=module -e "$RUNNER" check http://127.0.0.1:3000
AgentReady Lab scan report
...
  summary     pass 5  fail 1  warning 0
...
REQUIRED FAILURES (1)
  Violated normative requirements. These are conformance defects.

  [x] fail  markdown.media-type  (normative, spec mode)
      rule      web.content.markdown-negotiation 0.1.0  (status fail, gate enforced)
      message   The request that accepted text/markdown did not return a successful response labelled text/markdown. A representation is what its Content-Type says it is, so Markdown bytes under another label are not a Markdown representation.
      fix       required-correction: Label the Markdown representation Content-Type: text/markdown, the media type RFC 7763 registers. text/plain, text/x-markdown and application/octet-stream each tell a client something different.
      source    rfc7763  RFC 7763: The text/markdown Media Type
                https://www.rfc-editor.org/rfc/rfc7763  section 2
                ietf-rfc, informational-rfc, version RFC 7763, verified 2026-08-28
      evidence  ev-004

$ echo $?
1
```

Each `...` marks omitted lines; everything else is verbatim. The report header,
the five passing rules, and the evidence table were cut for length. Every
failure carries the defect, the correction, the pinned source with its section
and verification date, and a reference into the evidence table, which records
the request, the status, the media type, the byte counts, and a SHA-256 of the
body rather than the body itself.

Exit codes are `0` no failures, `1` a selected rule failed, `2` invalid
argument or unsupported combination, `4` an internal invariant was violated.
Exit code `3` is declared by the contract and is unreachable: nothing in this
build aborts a whole scan.

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

## Before publishing this repository

Complete [docs/MAINTAINER_CHECKLIST.md](docs/MAINTAINER_CHECKLIST.md). In
particular, clear the working name and enable private vulnerability reporting.
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) is Contributor Covenant 3.0 with a
real monitored private conduct contact, so that item is done.

## Contributing

The project should welcome narrowly scoped, test-backed improvements. Changes to
rule semantics require a primary source, a pinned source version or observation
date, positive and negative fixtures, and maintainer agreement before code is
written. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Responsible use

AgentReady Lab makes HTTP requests to the origin you give it. Today that origin
can only be a loopback address on your own machine, and public scanning arrives
with M3. Use it only on systems you own or are authorized to test, and comply
with applicable law, target-site terms, and published crawler policies. Results
are best-effort technical observations,
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
