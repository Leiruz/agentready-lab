# Maintainer Checklist

- Status: Proposed operating checklist
- Snapshot date: 2026-08-28

This document is a practical release and review aid. Checked boxes in a local
copy are not evidence by themselves; completion evidence belongs in pull
requests, CI, release notes, security records, and `PROJECT_STATUS.md`.

## 1. Before making the blueprint repository public

### Identity and legal

- [ ] Confirm the final repository, package, binary, organization, and domain
      names are available and have received the planned name-clearance search.
- [ ] Keep `AgentReady Lab` independent; do not put Cloudflare or
      IsItAgentReady in the product/package name or imply endorsement.
- [ ] Include the exact approved open-source license and matching package
      metadata.
- [ ] Install and require an automated DCO check before accepting contributions;
      `CONTRIBUTING.md` already requires sign-off on every commit.
- [ ] Include only third-party text, schemas, test data, and code whose license
      and provenance have been verified.
- [ ] Add third-party notices only where genuinely required.
- [ ] Verify that remediation prose is independently written rather than copied
      from another scanner.
- [ ] Keep the responsible-use and no-certification notices visible.

### Security and repository settings

- [ ] Enable two-factor authentication for maintainer accounts.
- [ ] Enable private vulnerability reporting and publish `SECURITY.md`.
- [ ] Configure a real monitored private conduct-reporting contact, then add
      the current official Contributor Covenant as `CODE_OF_CONDUCT.md`.
- [ ] Protect `main` with required review and required deterministic CI checks.
- [ ] Prevent force pushes and branch deletion for protected release branches.
- [ ] Configure least-privilege workflow permissions as the repository default.
- [ ] Confirm no workflow uses `pull_request_target` to execute untrusted branch
      code.
- [ ] Configure dependency and secret scanning available to the repository.
- [ ] Search the full history and working tree for secrets before publication.
- [ ] Confirm illustrative domains are clearly examples and not deployed unless
      owned by the maintainer.

### Accuracy

- [ ] `PROJECT_STATUS.md` says the repository is a blueprint with no working
      scanner, package, Action, Worker deployment, or hosted service.
- [ ] README commands that do not work are visibly labeled as intended/planned.
- [ ] Every time-sensitive standards claim has a snapshot date and source.
- [ ] `docs/STANDARDS_REGISTRY.md` and machine-readable rule metadata agree.
- [ ] `docs/ROADMAP.md` uses the authoritative milestone order: M0 foundation,
      M1 local lab, M2 reports/CI, M3 secure `ci-public` transport.
- [ ] No page advertises an aggregate score, certification, or official
      Cloudflare result.

## 2. Issue intake

For a new issue:

- [ ] Classify it as implementation, bug, rule semantics, security, standards
      drift, documentation, dependency, or feature proposal.
- [ ] Ask for a minimal controlled reproduction instead of authorizing scans of
      an unrelated third party.
- [ ] Remove or redact credentials, cookies, private URLs, and complete response
      bodies.
- [ ] For a standards claim, request the exact primary source, version/commit,
      section, and requirement class.
- [ ] For a verdict change, require valid and invalid fixture proposals before
      code begins.
- [ ] For a draft update, identify whether a new pinned ruleset is required.
- [ ] For security reports, move sensitive details to the private reporting
      channel and follow `SECURITY.md`.
- [ ] Reject requests to invoke discovered tools, APIs, payments, authentication,
      or downloaded scripts under the guise of validation.
- [ ] Put work in the correct roadmap milestone; do not smuggle M3/M6 scope into
      an M0/M1 issue.
- [ ] Mark one bounded acceptance slice suitable for a single pull request.

## 3. Every pull request

### Scope and authorship

- [ ] The pull request links an issue or states a narrow purpose and non-goals.
- [ ] Changed files match the approved package boundary and issue scope.
- [ ] The contributor has reviewed all AI-assisted changes and remains
      responsible for correctness, provenance, tests, and license compliance.
- [ ] No proprietary prompt, private repository content, credential, or copied
      third-party implementation was submitted.
- [ ] Required DCO sign-offs and the automated DCO check pass.

### Architecture

- [ ] `core` adds no Node, filesystem, process, CLI, reporter, Wrangler, or
      Cloudflare-specific dependency.
- [ ] `rules-standard` adds no direct network, DNS, socket, filesystem,
      environment, clock, or randomness access.
- [ ] `ci-public` target I/O remains inside `transport-node`.
- [ ] Reporters consume the immutable canonical result and do not rescan or
      change verdicts.
- [ ] Fixture behavior remains declarative and cannot become a proxy, open
      redirect, or query-controlled response service.
- [ ] A changed package direction is backed by an accepted ADR.
- [ ] Dynamic executable plugins were not introduced during the MVP.

### Tests

- [ ] A bug fix contains a regression test that fails without the fix.
- [ ] New assertion/finding codes have satisfying and violating cases.
- [ ] Tests are deterministic and ordinary CI uses no public network.
- [ ] Golden changes are explained semantically, not accepted as a bulk refresh.
- [ ] Hostile inputs are bounded and include malformed/unavailable behavior.
- [ ] Evidence redaction tests cover every newly retained field.
- [ ] The relevant protocol and security fixture ledger is updated honestly.
- [ ] No required test is skipped or weakened without a linked decision.
- [ ] Format, lint, typecheck, test, and build checks pass on Node.js 24 with the
      frozen lockfile.

### Documentation and status

- [ ] Public APIs, config, CLI, status, and source changes update their docs in
      the same pull request.
- [ ] Unimplemented behavior is not presented as shipped.
- [ ] `PROJECT_STATUS.md` changes only when acceptance evidence exists.
- [ ] Changelog entry uses the correct package/schema/ruleset version axis.
- [ ] Links point to canonical primary sources where possible.

## 4. Rule or verdict change

Do not merge a rule-semantic change until all boxes are checked:

- [ ] Stable rule ID and assertion/finding IDs are selected.
- [ ] Existing retired IDs are not reused.
- [ ] Exact source title, URL, version/commit, section, kind, and verification
      date are recorded.
- [ ] Requirement is classified as normative, recommended, advisory, or
      compatibility-only.
- [ ] Mode (`spec`, `compat`, `interop`) and applicable profiles are explicit.
- [ ] Draft/provisional maturity is visible in the report.
- [ ] Applicability and absence behavior are explicit; optional absence is not
      automatically a universal failure.
- [ ] `spec` behavior is not inferred only from an external scanner.
- [ ] `compat` behavior is snapshot-dated and independently implemented.
- [ ] `interop` performs only an approved bounded, non-mutating interaction.
- [ ] Valid, invalid, malformed, absent/ambiguous, media-type, redirect, and
      version-drift cases exist where relevant.
- [ ] Parser and response limits are explicit.
- [ ] Sanitized evidence is sufficient to reproduce the verdict.
- [ ] Remediation distinguishes required correction, recommended hardening, and
      compatibility workaround.
- [ ] Rule version and ruleset version are incremented when semantics change.
- [ ] Prior pinned rulesets retain their previous golden outputs.
- [ ] No percentage score or certification implication was introduced.

## 5. Fixture change

- [ ] Fixture ID is unique, lowercase, stable, and a valid deployable DNS label
      when public parity is intended.
- [ ] It inherits the known-good base and overrides the smallest behavior.
- [ ] Intended changed assertions are declared.
- [ ] Contract tests fail on any unintended rule change.
- [ ] Routes, responses, redirects, and bytes are finite compile-time data.
- [ ] There is no arbitrary URL, proxy, open redirect, credential, or user-chosen
      response behavior.
- [ ] Caching headers are intentional.
- [ ] In-memory and Worker-runtime facts match where both can represent them.
- [ ] A public deployment targets only a maintainer-owned domain.
- [ ] The fixture count ledger in `FIXTURE_CATALOG.md` is updated only after the
      case passes.

## 6. Dependency change

- [ ] The dependency solves a documented requirement that is not reasonably met
      by the platform or a small maintained helper.
- [ ] Package ownership, maintenance activity, release history, license, and
      security history were reviewed.
- [ ] Transitive dependencies and install scripts were inspected.
- [ ] The dependency is added only to the package that needs it.
- [ ] Runtime compatibility matches Node.js 24 or the Workers runtime as
      applicable.
- [ ] Network, XML, decompression, archive, cryptography, or Action dependencies
      receive extra security review.
- [ ] Lockfile changes contain no unrelated update.
- [ ] CI pins external Actions by full commit SHA in maintained workflows.
- [ ] A removal/replacement path is documented for critical security-boundary
      dependencies.

## 7. M0 completion review

- [ ] pnpm workspace and frozen lockfile work on a clean Node.js 24 environment.
- [ ] Strict TypeScript, ESM, format, lint, typecheck, tests, and build exist.
- [ ] Package dependency directions are mechanically enforced.
- [ ] Canonical status/result types and committed schemas exist.
- [ ] In-memory transport and deterministic serialization tests pass.
- [ ] Invalid config performs no network request.
- [ ] No command can make a real target request.
- [ ] CI is deterministic and offline.
- [ ] Package metadata does not publish a nonexistent CLI.
- [ ] Roadmap/status/changelog reflect M0 accurately.

## 8. M1 / experimental `0.1.0` review

- [ ] The `local-loopback` transport allows only the supplied origin and blocks origin
      changes.
- [ ] All eight MVP rule families are implemented with pinned sources.
- [ ] All 49 protocol fixtures and M1 security fixtures pass.
- [ ] Every assertion code is tested in both directions.
- [ ] Human and canonical JSON reporters pass compatibility tests.
- [ ] CLI help, output streams, cancellation, and exit codes have golden tests.
- [ ] Canonical report is byte-identical for fixed input.
- [ ] No complete bodies, credentials, cookies, raw stacks, or query secrets are
      present in reports.
- [ ] The `ci-public` profile remains unavailable and fail-closed.
- [ ] Clean package installation and package-content inspection pass.
- [ ] README and release notes say “experimental `local-loopback`-only” prominently.
- [ ] No hosted arbitrary-URL scanner is advertised.

## 9. M2 GitHub Action review

- [ ] `action.yml` uses `runs.using: node24`.
- [ ] The Action calls project libraries directly.
- [ ] `dist/index.js` is committed and `action:verify` produces no diff.
- [ ] Default token permissions are read-only and documented.
- [ ] Forked pull requests receive no secrets.
- [ ] No default PR comment/write permission exists.
- [ ] Job Summary and bounded annotations show every result category.
- [ ] JSON/JUnit/SARIF output paths are exposed without silently uploading them.
- [ ] SARIF uses only explicit safe repository source maps.
- [ ] Unmapped remote URLs are not fake source locations.
- [ ] Example workflows use `pull_request`, not unsafe untrusted
      `pull_request_target` execution.

## 10. M3 `ci-public` transport review

The `ci-public` network profile must remain unadvertised until every item passes:

- [ ] All A/AAAA answers are resolved and checked against maintained IANA
      special-use classifications.
- [ ] Mixed public/private results are rejected.
- [ ] IPv4-mapped IPv6 and alternate address forms are tested.
- [ ] The actual socket is pinned to an approved address while Host and TLS SNI
      remain correct.
- [ ] Every redirect repeats parsing, resolution, classification, and policy.
- [ ] Unsafe schemes, credentials, ports, and redirect targets are rejected.
- [ ] Ambient proxy settings, cookies, and authorization are ignored.
- [ ] Compressed and decompressed bytes are limited while streaming.
- [ ] Request, redirect, byte, connect, elapsed, and whole-scan budgets work.
- [ ] Block/error evidence is typed and sanitized.
- [ ] All M3 fixtures plus table-driven special-use address cases pass.
- [ ] A reviewer independent from the implementation author examines the
      transport and tests.
- [ ] Threat model, support statement, README, and project status are updated in
      the enabling pull request.

## 11. Release checklist

### Prepare

- [ ] Confirm the intended tool, schema, ruleset, and profile versions.
- [ ] Confirm every shipped feature is listed accurately in
      `PROJECT_STATUS.md`.
- [ ] Resolve all release-blocking bugs and security reports.
- [ ] Run the full frozen-lockfile CI suite from a clean checkout.
- [ ] Inspect npm package contents; exclude fixtures with secrets, test output,
      local caches, and unnecessary source material.
- [ ] Verify license files and third-party notices in every published package.
- [ ] Generate changelog and migration notes from reviewed changes.
- [ ] Validate all source links and snapshot dates touched by the release.
- [ ] Confirm old pinned report/ruleset compatibility fixtures still pass.

### Publish

- [ ] Use protected, human-approved release automation.
- [ ] Prefer trusted publishing/provenance rather than a long-lived npm token.
- [ ] Tag the exact reviewed commit; do not publish from a dirty tree.
- [ ] Publish prerelease versions for experimental public API changes.
- [ ] Verify package signature/provenance and install from the public registry in
      a clean temporary project.
- [ ] Verify CLI help/version and a local owned fixture; do not scan an unrelated
      site as a release test.
- [ ] Attach schemas, checksums, and release notes where planned.

### After publish

- [ ] Confirm the GitHub release and package point to the same commit/version.
- [ ] Update `PROJECT_STATUS.md` and documentation links.
- [ ] Monitor installation and Action failures without collecting target data by
      default.
- [ ] Keep a rollback/deprecation plan ready.
- [ ] Announce only capabilities that were verified.

## 12. Public fixture Worker deployment

- [ ] The domain and Cloudflare account are controlled by the maintainer.
- [ ] Wrangler compatibility date is pinned.
- [ ] Deployment contains no secrets or arbitrary upstream binding.
- [ ] Wildcard DNS/route scope is limited to the intended fixture subdomain.
- [ ] All routes originate from the reviewed finite manifest.
- [ ] `/_fixture` reveals only fixture ID, expected metadata, and source commit.
- [ ] Cache behavior is explicit per case.
- [ ] Post-deploy smoke tests compare expected response facts.
- [ ] Live checks are scheduled/non-blocking for ordinary PRs.
- [ ] A kill/rollback path is documented.

Serving fixed fixtures does not authorize accepting arbitrary scan URLs.

## 13. Hosted arbitrary-URL service gate

Do not begin implementation without a new accepted ADR and all of the following:

- [ ] Connection-level egress policy is demonstrated for the hosting runtime.
- [ ] DNS/connect time-of-check/time-of-use risk is closed or explicitly
      isolated by an approved network architecture.
- [ ] Authentication and per-user/per-target rate limits exist.
- [ ] Target authorization and abuse-reporting expectations are documented.
- [ ] Queues, concurrency, cost, and response budgets are enforced.
- [ ] Privacy notice lists submitted data, requester metadata, storage,
      retention, subprocessors, deletion, and result visibility.
- [ ] Incident response can disable scanning independently of fixture serving.
- [ ] Logging contains no response bodies or secrets by default.
- [ ] Legal/terms and operational ownership have been reviewed.
- [ ] Security tests run against the deployed architecture, not only a mock.

## 14. Security incident checklist

- [ ] Acknowledge the reporter through the private channel.
- [ ] Preserve only the minimum evidence needed; do not copy target secrets into
      public issues.
- [ ] Determine affected versions, rulesets, deployments, and report schemas.
- [ ] Disable the affected remote/hosted capability if exploitation is plausible.
- [ ] Rotate any exposed project credential and invalidate affected release
      automation tokens.
- [ ] Develop the fix with a non-public regression case.
- [ ] Request independent review of the fix and test.
- [ ] Publish an advisory with impact, versions, mitigation, and upgrade path.
- [ ] Backport or explicitly document unsupported versions.
- [ ] Add the lesson to the threat model/checklists without exposing exploit
      details prematurely.

## 15. Periodic maintenance

At least monthly while active:

- [ ] Review dependency and security alerts.
- [ ] Check Node.js, pnpm, GitHub Action runtime, and Workers support status.
- [ ] Review draft-source changes without silently updating pinned rulesets.
- [ ] Run scheduled project-owned fixture smoke tests and triage drift.
- [ ] Verify repository permissions, branch rules, and maintainer access.
- [ ] Triage issues and close stale claims that lack reproducible evidence.
- [ ] Keep roadmap and project status honest.

Before each semester/internship application cycle or public demonstration:

- [ ] Re-run source verification and link checks.
- [ ] Reproduce the demo from a clean clone.
- [ ] Confirm no slide, README, résumé bullet, or post overstates adoption,
      affiliation, security, protocol coverage, or hosted capability.
- [ ] Prefer measurable evidence: fixture count, tested assertions, accepted
      upstream reports, external contributors, and real authorized adopters.
