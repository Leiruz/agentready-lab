# Contributing to AgentReady Lab

Thank you for helping improve AgentReady Lab. The project welcomes focused,
well-supported changes that make agent-facing web standards easier to test and
debug.

AgentReady Lab is currently a design-stage project. The repository describes a
planned implementation; it does not yet ship a working scanner, hosted service,
GitHub Action, or npm package. Check [PROJECT_STATUS.md](PROJECT_STATUS.md)
before assuming that an interface or command exists.

## Project principles

Contributions should follow these principles:

1. **Correctness before score maximization.** The goal is to report defensible
   protocol observations, not to make websites produce a higher score.
2. **Primary sources before scanner parity.** Published RFCs, dated drafts, and
   versioned specifications take precedence over another scanner's behavior.
3. **Evidence before conclusions.** Every verdict must identify the evidence
   and assertion that produced it.
4. **Deterministic tests before live-site observations.** Normal CI must use
   controlled local fixtures, not depend on third-party websites.
5. **Network input is hostile.** Do not weaken the transport controls described
   in the threat model for convenience.
6. **Independent implementation.** Do not copy another service's source, UI,
   prompts, explanations, hidden weights, or branding.

## Before contributing

Read the documents relevant to your change:

- [PROJECT_STATUS.md](PROJECT_STATUS.md) for what exists today;
- [docs/IMPLEMENTATION_SPEC.md](docs/IMPLEMENTATION_SPEC.md) for product and
  compatibility contracts;
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for package boundaries;
- `docs/THREAT_MODEL.md` before changing network behavior;
- `docs/STANDARDS_REGISTRY.md` and `specs/checks.v0.yaml` before changing a
  check or interpreting a standard;
- accepted records under `docs/decisions/` before revisiting an architectural
  decision.

Some of those paths are planned deliverables. If a referenced authoritative
document is absent, open an issue instead of inventing its contents in code.

## Start with an issue when judgment is required

Open an issue and wait for maintainer agreement before doing substantial work
on:

- a new standard, protocol family, profile, or check;
- anything that changes a pass, fail, warning, or applicability decision;
- CLI flags, exit codes, configuration, report schemas, or stable rule IDs;
- network access, redirect handling, address classification, storage,
  telemetry, authentication, or other security boundaries;
- a new runtime dependency or major architectural change;
- scoring or compatibility behavior.

An issue is normally unnecessary for an obvious documentation correction or a
narrow test improvement that does not change documented behavior. If you are
unsure, open the issue first. Maintainer discussion is not a guarantee that a
particular implementation will be merged.

Security vulnerabilities must not be discussed in a public issue. Follow
[SECURITY.md](SECURITY.md).

## What a standards or rule change requires

A new or changed rule must include all of the following:

1. A stable rule ID that follows the repository naming convention.
2. A primary source URL.
3. The exact RFC number, specification release, dated draft, or source commit.
4. The relevant section or schema location.
5. A classification of each assertion as `normative`, `recommended`, or
   `advisory`.
6. The source's maturity, such as `draft`, `provisional`, or `stable`.
7. At least one positive fixture.
8. At least one negative fixture that fails for the intended reason.
9. Fixtures for meaningful ambiguous or unreachable states where applicable.
10. Expected sanitized evidence and an independently written diagnostic.
11. An explanation of security, privacy, request-budget, and compatibility
    effects.

Do not cite only a blog post when a normative specification exists. Do not turn
a project's interoperability preference into a universal standards failure.
Quote only the minimum text needed for analysis; link to the primary source and
write the rule and explanation independently.

When an upstream draft changes, add or revise an explicitly versioned ruleset.
Do not silently change the meaning of an existing pinned ruleset.

## Fixture requirements

Fixtures are part of the conformance contract, not illustrative examples. They
must be:

- deterministic and self-contained;
- safe to run repeatedly;
- free of credentials and personal data;
- small enough to make the relevant behavior obvious;
- explicit about which rule and assertion they exercise;
- served locally or from infrastructure controlled by the project;
- unable to execute discovered scripts, tools, skills, payments, or
  authenticated operations.

Do not add a real third-party website as a required test target. A reduced local
fixture is preferred. If a live observation is useful for a compatibility
report, confirm that testing is authorized, record its date, sanitize it, and
keep it outside blocking CI.

## Development workflow

1. Fork the repository and create a focused branch.
2. Confirm the issue and intended behavior before implementing a material
   change.
3. Add the smallest complete implementation and its tests.
4. Run the repository's documented format, lint, typecheck, test, and build
   scripts once those scripts exist.
5. Update user documentation and `CHANGELOG.md` for user-visible behavior.
6. Open a pull request using the repository template.
7. Respond to review and keep the branch focused on one problem.

Do not claim that a command was run when it was not. If a check cannot run in
your environment, state that clearly in the pull request.

## Pull request expectations

A pull request should:

- link the issue or architecture decision it implements;
- explain the problem and observable behavior, not only the code changes;
- be small enough to review without unrelated cleanup;
- include tests that fail without the change and pass with it;
- update documentation and compatibility notes when necessary;
- disclose any material AI assistance;
- contain no secrets, private URLs, proprietary source, or copied third-party
  material;
- have a Developer Certificate of Origin sign-off on every commit.

The maintainer may ask that a large pull request be split, or close work that
was started without agreement when the direction does not fit the project.

## AI-assisted contributions

AI-assisted contributions are welcome. The human contributor remains
responsible for every submitted line, test, source citation, and claim.

If an AI tool materially assisted the contribution, disclose in the pull
request:

- the tool or tools used;
- what they helped produce;
- how you reviewed and verified the result.

Review all generated material, run the relevant tests, verify every
specification citation, and confirm that you have the right to submit it. Do not
submit secrets, proprietary code, hallucinated requirements, fabricated test
results, or material copied from third-party websites. AI assistance neither
improves nor harms a contribution's chance of acceptance; correctness,
security, and maintainability determine acceptance.

## Developer Certificate of Origin

This project uses the
[Developer Certificate of Origin, Version 1.1](https://developercertificate.org/)
and does not require a Contributor License Agreement.

By contributing, you certify that you have the right to submit the work under
the repository's Apache License 2.0. Sign off every commit with:

```bash
git commit -s -m "Describe the change"
```

This adds a line like:

```text
Signed-off-by: Your Name <your-email@example.com>
```

A DCO sign-off is not the same as a GPG or SSH cryptographic signature. The
name and email in the sign-off become part of the permanent public commit
history; you may use a GitHub-provided noreply email if appropriate. Pull
requests with unsigned commits will not be merged.

## Review and merge policy

All required status checks must pass. Rule semantics, public contracts, and
network-security changes receive additional review against their cited source
or threat-model requirement. The project normally uses squash merging, but the
maintainer may preserve commits when their history is useful.

Maintainer agreement, passing automation, or an AI-generated review is not a
guarantee of correctness. The maintainer retains responsibility for deciding
whether a change is ready to merge.

## Community conduct launch requirement

A public community needs an enforceable Code of Conduct and a genuine private
way to report conduct incidents. `CODE_OF_CONDUCT.md` is intentionally not
included in this starter pack because no private conduct contact has been
configured. Adding an official Contributor Covenant document with a working
private contact is a **pre-launch blocker**. Do not publish a placeholder or use
a public issue as the only reporting channel.

## Independence and trademarks

AgentReady Lab is independent and is not affiliated with, sponsored by,
endorsed by, or maintained by Cloudflare, Inc. References to Cloudflare or
isitagentready.com must be truthful, limited to technical context, and must not
suggest approval or certification. Do not add Cloudflare names to the project,
package, domain, cookie, or user-agent name, and do not copy third-party logos,
trade dress, UI, prompts, or report text.

## License

Unless explicitly stated otherwise, contributions accepted into this
repository are licensed under the [Apache License 2.0](LICENSE).
