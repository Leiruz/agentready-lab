# ADR-0001: Local-first scope, interpretation modes, and no aggregate score

- Status: Accepted
- Decision date: 2026-08-28
- Owners: Initial maintainers
- Applies from: project foundation

## Context

Agent-facing web checks mix several different kinds of claim:

- mature RFC requirements;
- optional web conventions;
- changing draft specifications;
- interoperability recommendations;
- heuristics published by an external scanner;
- capabilities that apply only to an API, agent service, browser surface, or
  commerce site.

Treating these as one unqualified checklist would produce misleading failures.
Turning them into a percentage would imply that every feature is equally
applicable and that the project has authority to certify a site. Neither is
true.

The network profile also changes the product's risk. Testing an exact loopback preview
can be constrained to a developer-controlled origin. Scanning an arbitrary
public URL creates SSRF, DNS rebinding, redirect, decompression, resource-abuse,
privacy, and hosted-service concerns. Browser and commerce observations add
execution and state-change risks beyond static HTTP validation.

The project must choose a narrow, useful first product without preventing later
interoperability work.

## Decision

### 1. The project is local-first

The first working release tests an exact loopback preview supplied by the user.
The `local-loopback` transport:

- permits only the exact `127.0.0.1` or `[::1]` origin selected by the user;
- does not implicitly allow private LAN ranges;
- blocks redirects to a different scheme, host, or port;
- attaches no ambient credentials;
- enforces bounded requests, redirects, time, and response bytes.

The `ci-public` profile is a later milestone and remains unavailable until a
dedicated Node transport passes redirect-aware, DNS-rebinding-resistant address
pinning and resource-budget tests.

### 2. Arbitrary hosted scanning is a separate product decision

A Worker may serve fixed project-owned fixtures. It may not accept arbitrary
user URLs merely because the deterministic core can run in a Web-platform
runtime.

Arbitrary hosted scanning requires a later ADR covering egress guarantees,
authentication, rate limits, abuse controls, privacy, retention, deletion,
incident response, operational ownership, and cost. A DNS preflight followed by
an unpinned platform `fetch` is not treated as equivalent to the approved Node
transport boundary.

### 3. Rules expose three interpretation modes

#### `spec`

The default. Assertions derive from a pinned RFC, standards document, dated
draft, versioned specification, or published convention.

- Applicable normative violations may produce `fail`.
- Recommended/advisory violations produce `warning` by default.
- Draft status and exact source version remain visible.
- An optional mechanism can be `not-applicable`; absence is not automatically a
  universal web failure.

#### `compat`

An independently implemented, date-versioned compatibility observation based on
a published external scanner contract.

- It is not conformance or certification.
- External source code, UI, remediation prose, private weights, and hidden
  behavior are not copied or claimed.
- The external service is optional and is not called by default.
- Native verdicts remain independent from external results.

#### `interop`

An opt-in mode for safe, non-mutating interaction beyond static document shape,
such as fetching a declared same-origin artifact and verifying its digest.

- Every interaction has an explicit budget and security review.
- Downloaded content is never executed.
- MCP tools, A2A actions, APIs, scripts, registration, authentication, and
  payments are not invoked by this decision.

### 4. Profiles and modes remain separate

A mode selects the interpretation of an assertion. A versioned profile selects
which rule families apply to a declared target, for example `content`, `api`, or
`agent-service`.

Automatic inspection may suggest a profile later, but cannot silently change
applicability, failure policy, or scoring. CI pins profile, mode, and ruleset.

### 5. The MVP contains eight built-in rule families

The first rule set is limited to:

1. Robots Exclusion Protocol;
2. sitemap discovery;
3. HTTP Link discovery;
4. Markdown negotiation;
5. AI crawler policy;
6. Content Signals;
7. API Catalog;
8. Agent Skills Discovery v0.2.0.

Rules are compiled into the project. The MVP does not dynamically load
third-party executable rule plugins.

MCP Server Cards, A2A, OAuth, DNS-AID, Web Bot Auth, Auth.md, ARD, browser
observation, and commerce are later work with their own pinned sources and
fixtures.

### 6. There is no aggregate score or certification level

The MVP reports:

- status counts;
- rule-level applicability;
- requirement class;
- mode, profile, and ruleset versions;
- sanitized evidence;
- exact assertions and source references;
- configured CI gate outcome.

It does not calculate a percentage, star rating, readiness level, badge implying
certification, or single ordinal rank.

A CI gate is not a score. It answers only whether the selected pinned policy
allows the run to pass.

### 7. External levels may only be represented as compatibility metadata

If a later adapter represents the published IsItAgentReady level algorithm, it
must be:

- explicitly named as an independent compatibility profile;
- snapshot-dated and versioned;
- transparent about mapped and unmapped rules;
- kept outside the core native verdict;
- accompanied by a non-affiliation/no-certification notice.

It must not be labeled an official Cloudflare score.

## Rationale

Local-first delivery allows useful pre-deployment regression testing before the
hardest network trust boundary is complete. It also gives contributors a finite
vertical slice: deterministic engine, eight rules, controlled fixtures, and
clear reports.

Modes prevent three different questions from being collapsed:

1. “Does this satisfy the pinned source?”
2. “Will a dated implementation recognize it?”
3. “Does the declared artifact work in a bounded interaction?”

Profiles prevent an ordinary documentation site from being penalized for not
publishing agent commerce or service metadata.

Avoiding a score makes uncertainty and applicability visible. It also prevents
the project from rewarding sites for adding irrelevant experimental endpoints.

## Consequences

### Positive

- A student-sized MVP can be completed and reviewed incrementally.
- Ordinary tests can be deterministic and offline.
- Security-critical `ci-public` code is isolated behind a later milestone.
- Draft changes can coexist as pinned rulesets.
- Results remain explainable and suitable for upstream regression reports.
- The project does not imply Cloudflare affiliation or universal certification.

### Costs

- The first release cannot scan arbitrary deployed websites.
- Users wanting a single shareable number will not receive one.
- The same observation can have different `spec` and `compat` results.
- Profile and applicability documentation require ongoing maintenance.
- A future `ci-public` or hosted service cannot be marketed until substantial
  security and operational work is complete.

### Implementation constraints

- CLI help must make the `local-loopback`/`ci-public` network profile explicit.
- The `ci-public` profile must fail closed before its milestone is complete.
- Canonical reports identify mode, profile, ruleset, and rule versions.
- Reporters cannot synthesize a score.
- Fixtures record mode-specific expectations.
- Commerce absence is not a failure outside an explicit commerce profile.
- Browser-only checks report `unsupported-runtime` when no approved browser
  runtime is available.

## Alternatives considered

### Start with a public hosted scanner

Rejected because it couples rule development to an unresolved arbitrary-egress,
abuse, privacy, retention, and operational boundary.

### Use ordinary `fetch` after a DNS allow/deny check

Rejected for secure `ci-public` scanning because the subsequent connection is not
proven to use the authorized address and redirects can introduce new targets.

### Clone the published IsItAgentReady checklist and level

Rejected because a published compatibility contract is not a universal
standard, draft mechanisms have different maturity, and hidden implementation
details cannot be claimed or reproduced accurately.

### Give every site a percentage

Rejected because applicability and severity differ by site profile and source
maturity. A percentage would hide more information than it communicates.

### Include MCP, browser checks, and commerce in the MVP

Rejected because this expands changing-spec maintenance, execution risk, and
fixture scope before the engine and test methodology have been proven.

### Permit third-party JavaScript plugins immediately

Rejected because a dynamically imported plugin is arbitrary trusted code in the
scanner process. A stable rule API and trust policy must come first.

## Revisit conditions

This decision can be amended only through a new ADR. Relevant triggers include:

- M3 produces independently reviewed `ci-public` transport evidence;
- a hosted egress design can demonstrate an equivalent connection-level policy;
- users provide evidence that a transparent aggregate is valuable across
  profiles;
- a recognized standards body publishes a normative conformance level;
- a stable plugin API and explicit trust model are ready;
- browser or commerce work receives a dedicated threat review.

Any proposal for an aggregate score must publish its weights, applicability,
versioning, migration effects, gaming analysis, and counterexamples. Until that
ADR is accepted, “no aggregate score” is a release invariant.

## Related documents

- [Implementation specification](../IMPLEMENTATION_SPEC.md)
- [Architecture](../ARCHITECTURE.md)
- [Roadmap](../ROADMAP.md)
- [Test strategy](../TEST_STRATEGY.md)
- [Fixture catalog](../FIXTURE_CATALOG.md)
- [Threat model](../THREAT_MODEL.md)
