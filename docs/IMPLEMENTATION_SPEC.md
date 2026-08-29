# AgentReady Lab Implementation Specification

- Document status: Proposed
- Project phase: 0 — implementation blueprint
- Snapshot date: 2026-08-28
- Intended first package version: `0.1.0`
- Intended first report schema: `1.0.0`
- Intended first ruleset version: `0.1.0`

## 1. Purpose

This document is the implementation contract for AgentReady Lab. It defines the
product boundary, terminology, observable behavior, security assumptions, data
model, command-line contract, rule lifecycle, testing expectations, milestones,
and definition of done.

It deliberately does not claim that the planned features already exist. Until a
requirement has code, tests, and an entry in `PROJECT_STATUS.md`, it remains
planned.

## 2. Product definition

AgentReady Lab is an independent, deterministic conformance and interoperability
test system for agent-facing web mechanisms. Its primary use is to test local
previews and controlled fixtures during development. Secure scanning of arbitrary
public URLs is a later capability with a separate trust boundary.

The project is differentiated by four things:

1. versioned rules tied to exact source material;
2. positive and negative protocol fixtures;
3. transparent evidence and reproducible verdicts;
4. comparison between specification conformance and deployed-tool compatibility.

It is not a generic AI-repository readiness scanner. It does not determine
whether a codebase is well prepared for Claude Code, Codex, or another coding
agent.

## 3. Goals

### G-1: Find agent-web regressions before deployment

A developer can run the same deterministic checks against a local preview and
in CI. A change to headers, routing, caching, or metadata should fail a test
before it reaches production.

### G-2: Explain every verdict

Every result identifies:

- the rule and ruleset version;
- the selected interpretation mode;
- the applicability decision;
- the source specification and pinned version/date;
- the request that was made, excluding sensitive data;
- the sanitized evidence that was observed;
- the exact assertion that passed or failed;
- an independently written remediation summary.

### G-3: Make draft drift visible

The system can represent multiple versions of a draft without silently changing
old results. A ruleset upgrade may change a verdict, but a pinned ruleset must
remain reproducible.

### G-4: Produce reusable upstream evidence

A failing case can be reduced to a fixture, expected result, source citation,
and machine-readable report suitable for an upstream issue or test vector.

### G-5: Remain safe by construction

Network access is treated as hostile. The project must not market remote
scanning as safe until redirect-aware, DNS-rebinding-resistant address pinning
and resource budgets have adversarial tests and review.

## 4. Non-goals

The MVP will not:

- copy or reverse-engineer a proprietary scanner;
- reproduce another service's private score or call its output canonical;
- provide an official certification;
- use an LLM to decide conformance;
- automatically modify a target website;
- execute discovered skills, scripts, MCP tools, WebMCP tools, or API operations;
- crawl an entire site;
- authenticate as a user or collect credentials;
- scan arbitrary private networks;
- support third-party executable rule plugins;
- gate CI on live third-party websites;
- implement commerce protocols in the first release;
- operate a public multi-user hosted scanner.

## 5. Users and primary workflows

### 5.1 Website developer

The developer tests `http://127.0.0.1:<port>` during local development, fixes a
specific failure, and reruns the scan without sending project data to a hosted
service.

### 5.2 Repository maintainer

The maintainer pins a profile and ruleset in CI. Pull requests receive a stable
summary of new failures and resolved failures.

### 5.3 Standards implementer

The implementer selects a precise specification version, runs conformance
fixtures, and exports a report that distinguishes normative requirements from
advisory interoperability checks.

### 5.4 Tool author

The tool author runs the compatibility profile to understand whether a public
scanner recognizes an implementation, without confusing recognition with full
specification conformance.

## 6. Interpretation modes

Mode and profile are separate concepts. A mode answers **which interpretation
is being tested**. A profile answers **which families of rules apply to this
target**.

### 6.1 `spec`

The default mode. Rules implement requirements from a pinned RFC, dated draft,
versioned specification, or published convention. Assertions are classified as:

- `normative`: derived from MUST/SHALL or an equivalent schema constraint;
- `recommended`: derived from SHOULD/RECOMMENDED;
- `advisory`: project guidance that improves interoperability but is not required
  by the source.

Only violated applicable `normative` requirements yield `fail` by default.
Recommended and advisory requirements yield `warning` unless the user opts into
a stricter policy.

### 6.2 `compat`

An independently implemented compatibility profile based on a dated, published
external scanner contract. Initial compatibility metadata may describe the
published IsItAgentReady heuristics, but:

- the external service remains optional;
- the implementation must not copy its source, UI, prompts, or hidden weights;
- every result says `compatibility observation`, not `conformance`;
- inventory and behavior are snapshot-dated;
- UI, API, documentation, and other product surfaces may disagree;
- the external service is never called by default or required in CI.

### 6.3 `interop`

An opt-in mode that goes beyond static document shape to perform safe,
non-mutating interactions such as dereferencing a declared artifact and
verifying its digest. Each interop action needs an explicit request budget and
security review. Tool execution, payment, registration, and authenticated
operations remain out of scope unless approved by a future ADR.

## 7. Profiles

The initial profiles are:

| Profile | Intended target | Rule families |
| --- | --- | --- |
| `content` | Documentation, publication, marketing site | robots, sitemap, links, Markdown, crawler policy, Content Signals |
| `api` | Public API or developer service | content baseline plus API Catalog and OAuth metadata |
| `agent-service` | MCP/A2A/skill-publishing service | API profile plus agent discovery rules |
| `commerce` | Explicitly agent-enabled commerce surface | selected discovery rules plus opt-in commerce rules |
| `full` | Diagnostic exploration | every rule that can be evaluated safely |

Profiles must be versioned. CI configuration must pin an exact profile and
ruleset version. Automatic target classification may suggest a profile, but it
must not silently select scoring or failure semantics.

## 8. Status model

AgentReady Lab uses a richer status vocabulary than any external compatibility
profile:

| Status | Meaning |
| --- | --- |
| `pass` | An applicable assertion was evaluated and satisfied. |
| `fail` | An applicable normative assertion was evaluated and violated. |
| `warning` | A recommendation/advisory failed, or the evidence is risky but not non-conformant. |
| `not-applicable` | The rule does not apply to the declared target/profile. |
| `unable-to-check` | The rule applies but a network, parser, or environmental condition prevented a verdict. |
| `unsupported-runtime` | The selected runner cannot observe the required surface, such as WebMCP without a browser. |

Absence of an experimental capability is not automatically a failure. A
commerce mechanism is `not-applicable` unless the user explicitly selects a
commerce profile or provides a known payable endpoint.

## 9. Functional requirements

### FR-1: Target handling

The CLI accepts exactly one target URL in the MVP.

- Only `http:` and `https:` are supported.
- User information in URLs is rejected.
- URL fragments are removed and reported as ignored.
- `local-loopback` permits only loopback addresses and the exact requested port.
- `ci-public` permits only definitely public addresses on standard web ports.
- A network profile is explicit; it is never inferred solely from the address.

Batch scanning belongs to a later milestone because it changes resource and
abuse controls.

### FR-2: Rule selection

Rule selection is the intersection of:

1. profile;
2. interpretation mode;
3. pinned ruleset;
4. explicit `--include` and `--exclude` selectors;
5. runtime capability.

Unknown rule IDs or versions are configuration errors, not silently ignored.

### FR-3: Fetch planning

Rules declare observations; they do not call global `fetch` directly. The scan
planner deduplicates identical observations while keeping representations
distinct. The cache key must include at least:

- normalized URL;
- method;
- representation-affecting request headers, including `Accept`;
- redirect policy;
- transport scope;
- body limit.

An HTML request and a Markdown-negotiation request must never share the same
cached response.

### FR-4: Determinism

Given the same fixture, ruleset, profile, mode, clock, and tool version, the
ordered result must be byte-for-byte stable except for fields explicitly marked
volatile. Rule output order follows the registry, never task completion order.

Normal CI tests must not depend on public DNS, live websites, external scanners,
or the current date.

### FR-5: Evidence

Evidence records may contain:

- URL origin and normalized path;
- method;
- selected request header names and safe values;
- response status;
- redirect chain;
- selected response headers;
- body digest, size, and a bounded sanitized excerpt when permitted;
- parser and schema outcomes;
- DNS record facts where relevant;
- deterministic budget counters and limit outcomes.

Evidence must not contain cookies, authorization headers, credentials, complete
query secrets, or unbounded bodies. Reporters may further reduce evidence but
must not manufacture it.

### FR-6: Remediation

Remediation text must be written independently and grounded in the cited source.
It distinguishes:

- required correction;
- recommended hardening;
- external-tool compatibility workaround.

The project must not copy remediation text from IsItAgentReady or another
scanner.

### FR-7: Report formats

The planned reporters are:

- `human`: terminal output with concise evidence and remediation;
- `json`: complete stable machine-readable report;
- `junit`: one test case per selected rule;
- `github-summary`: Markdown Job Summary plus workflow annotations;
- `sarif`: only when findings can be mapped to repository artifacts.

SARIF is not a natural format for arbitrary remote URLs. GitHub code scanning
expects repository artifact locations. A SARIF reporter must require a
`sourceMap` from web resource to repository file, such as `/robots.txt` to
`public/robots.txt`. Without a source map, the GitHub Action uses Job Summary
and annotations and must not pretend that a remote URL is a source-code
location.

### FR-8: Differential reporting

Differential mode compares two scan reports produced from explicit targets or
vantage points. It reports:

- unchanged statuses;
- regressions;
- improvements;
- evidence changes without status changes;
- rules that cannot be compared because versions differ.

It refuses semantic comparison when `schemaVersion`, profile, mode, or
`ruleset.version` is incompatible unless the user explicitly requests a raw
comparison.

### FR-9: Fixture system

Every rule must ship with:

- at least one valid fixture;
- at least one normative invalid fixture;
- one absence/not-applicable case where relevant;
- a soft-404 or wrong-media-type case for HTTP discovery documents;
- version-drift fixtures for draft specifications.

Fixtures must be deterministic, must not proxy arbitrary URLs, and must not
contain live credentials.

### FR-10: No execution of discovered capabilities

The scanner may parse metadata and, in approved interop tests, fetch a declared
artifact. It must never:

- invoke a discovered MCP, A2A, API, WebMCP, or skill action;
- run downloaded skill scripts;
- submit payment or registration requests;
- follow instructions found in remote content;
- treat remote text as trusted instructions for Claude Code.

## 10. Target CLI contract

The intended interface is:

```text
agentready-lab check <url>
  --network-profile <local-loopback|ci-public>
  --mode <spec|compat|interop>
  --profile <content|api|agent-service|commerce|full>
  --ruleset <version>
  --include <rule-selector>
  --exclude <rule-selector>
  --format <human|json|junit|github-summary|sarif>
  --output <path>
  --strict-warnings
  --strict-unable
  --source-map <path>
  --include-metadata
```

Planned support commands:

```text
agentready-lab rules list
agentready-lab rules explain <rule-id>
agentready-lab profiles list
agentready-lab report diff <before.json> <after.json>
agentready-lab doctor
```

No command is considered public until its help text and exit-code behavior have
golden tests.

### 10.1 Exit codes

| Code | Meaning |
| ---: | --- |
| `0` | Scan completed with no failure under the selected strictness policy. |
| `1` | Scan completed and at least one selected rule failed, or strict mode promoted warnings/unable results. |
| `2` | Invalid arguments, configuration, profile, rule selector, or unsupported combination. |
| `3` | Scan aborted by a network, security, or resource-budget condition. |
| `4` | Unexpected internal error or violated invariant. |

Individual `unable-to-check` findings do not automatically produce exit code 3;
code 3 means the scan as a whole could not safely continue.

## 11. Version axes

The project has three independent public version axes:

| Surface | Field | Policy |
| --- | --- | --- |
| CLI and packages | `toolVersion` | Semantic Versioning |
| JSON result shape | `schemaVersion` | Independent semantic version |
| Rule definitions and interpretations | `ruleset.version` | Pinned immutable release |

Reports also identify `profileVersion`, source snapshot dates, and selected
mode. A rule interpretation change requires a new ruleset version even if the
TypeScript API does not change.

Retired rule IDs are never reused.

## 12. Rule model

The conceptual TypeScript contract is:

```ts
type FindingStatus =
  | "pass"
  | "fail"
  | "warning"
  | "not-applicable"
  | "unable-to-check"
  | "unsupported-runtime";

type RequirementClass = "normative" | "recommended" | "advisory";
type SourceKind =
  | "compatibility-contract"
  | "ietf-rfc"
  | "ietf-draft"
  | "openid-specification"
  | "industry-protocol"
  | "standards-organization"
  | "w3c-community-report"
  | "ecosystem-specification"
  | "vendor-convention"
  | "open-source-profile"
  | "open-proposal";
type SourceStatus =
  | "compatibility-snapshot"
  | "internet-standard"
  | "proposed-standard"
  | "informational-rfc"
  | "final"
  | "active-draft"
  | "expired-draft"
  | "open-pr"
  | "proposal"
  | "beta"
  | "community-report"
  | "convention"
  | "living-specification";
type SourceMaturity =
  | "stable"
  | "mixed"
  | "draft"
  | "experimental"
  | "convention"
  | "beta";
type ObservationRuntime = "http" | "dns" | "browser";

interface SourceReference {
  id: string;
  title: string;
  url: string;
  kind: SourceKind;
  status: SourceStatus;
  version?: string;
  verifiedAt: string;
}

interface RuleFinding {
  code: string;
  status: FindingStatus;
  requirementClass?: RequirementClass;
  message: string;
  sourceRefs: Array<{ sourceId: string; section?: string }>;
  evidenceRefs: string[];
}

interface RuleEvaluation {
  findings: RuleFinding[];
}

interface RuleDefinition {
  id: string;
  externalCompatibilityId: string;
  title: string;
  category: string;
  ruleVersion: string;
  ruleset: { id: string; version: string };
  modes: Array<"spec" | "compat" | "interop">;
  observationRuntime: ObservationRuntime[];
  sourceMaturity: SourceMaturity;
  implementationStatus:
    | "planned"
    | "experimental"
    | "supported"
    | "deprecated"
    | "removed";
  sources: SourceReference[];
  observations: ObservationRequest[];
  evaluate(context: EvaluationContext): Promise<RuleEvaluation>;
}
```

Rules are built-in and compiled for the MVP. Dynamic JavaScript rule loading is
prohibited because it converts a data-validation tool into a code-execution
platform.

In `specs/checks.v0.yaml`, `rule_id` maps to native `id`; the separate camelCase
`id` maps to `externalCompatibilityId`; `rule_version` maps to `ruleVersion`;
the top-level `ruleset_id` and `ruleset_version` map to `ruleset`; `runtime`
maps to `observationRuntime`; and `maturity` maps to `sourceMaturity`.
Implementation status comes from project release metadata, never from source
maturity. The external compatibility key must not leak into native selectors or
reports.

A rule evaluator returns findings only. The core validates those findings,
derives the aggregate rule status using section 13's fixed precedence, and
constructs the public result. Rule code cannot return a contradictory overall
status.

### 12.1 Source reference requirements

Every assertion records:

- canonical source URL;
- document title;
- source kind;
- RFC number, release version, dated draft, or immutable commit where possible;
- section or schema pointer;
- requirement classification;
- last verification date;
- optional compatibility snapshot and observation date.

An undated `latest` URL may be a discovery link but is insufficient provenance
for a draft conformance assertion.

## 13. Report model

Illustrative shape:

```json
{
  "tool": { "name": "agentready-lab", "version": "0.1.0" },
  "schemaVersion": "1.0.0",
  "ruleset": {
    "id": "standard",
    "version": "0.1.0",
    "digest": "sha256:0000000000000000000000000000000000000000000000000000000000000000"
  },
  "profile": { "id": "content", "version": "0.1.0" },
  "mode": "spec",
  "target": {
    "requestedUrl": "http://127.0.0.1:3000",
    "resolvedPageUrl": "http://127.0.0.1:3000/",
    "origin": "http://127.0.0.1:3000",
    "scope": "local",
    "networkProfile": "local-loopback"
  },
  "policy": {
    "id": "local-loopback",
    "version": "1.0.0",
    "allowedSchemes": ["http", "https"],
    "allowedPorts": [3000],
    "maxRequests": 24,
    "maxRedirectsPerObservation": 5,
    "maxEncodedResponseBytes": 1048576,
    "maxDecodedResponseBytes": 2097152,
    "sameOriginDiscovery": true
  },
  "summary": {
    "pass": 0,
    "fail": 0,
    "warning": 1,
    "notApplicable": 0,
    "unableToCheck": 0,
    "unsupportedRuntime": 0
  },
  "results": [
    {
      "ruleId": "web.content.markdown-negotiation",
      "ruleVersion": "0.1.0",
      "status": "warning",
      "findings": [
        {
          "code": "markdown.media-type",
          "status": "pass",
          "requirementClass": "normative",
          "message": "The negotiated response uses text/markdown.",
          "sourceRefs": [{ "sourceId": "rfc7763", "section": "2" }],
          "evidenceRefs": ["sha256:0000000000000000000000000000000000000000000000000000000000000000"]
        },
        {
          "code": "markdown.vary",
          "status": "warning",
          "requirementClass": "recommended",
          "message": "The response varies by Accept but does not declare Vary: Accept.",
          "sourceRefs": [{ "sourceId": "rfc9110", "section": "12.5.5" }],
          "evidenceRefs": ["sha256:0000000000000000000000000000000000000000000000000000000000000000"]
        }
      ]
    }
  ],
  "evidence": [
    {
      "id": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      "kind": "http",
      "request": {
        "method": "GET",
        "url": "http://127.0.0.1:3000/",
        "headers": { "accept": "text/markdown" }
      },
      "outcome": {
        "kind": "response",
        "status": 200,
        "headers": { "content-type": "text/markdown; charset=utf-8" },
        "encodedBytes": 8,
        "decodedBytes": 8,
        "bodySha256": "90f8ec5669cd34183b9b0fdf8b94f5efb4c3672876330f4aa76088c2b4ad17be",
        "truncated": false,
        "redirects": []
      }
    }
  ]
}
```

The all-zero ruleset and evidence digests are illustrative placeholders in this
proposed shape. A real report contains the SHA-256 digest of the exact immutable
ruleset artifact and hashes each canonical sanitized observation.

Each result contains all assertion findings for one rule. The result status is
derived with fixed precedence: `fail`, `unable-to-check`,
`unsupported-runtime`, `warning`, `pass`, then `not-applicable`.
`not-applicable` cannot coexist with an evaluated finding. Summary counters count
derived rule-result statuses, not individual findings. Findings reference the
top-level, deduplicated `evidence` array by ID; evidence is never embedded in a
result. Results use registry order and rule ID, findings use stable assertion
code order, and evidence sorts by ID.

Evidence is a discriminated `http`, `dns`, or `browser` observation. Its
`outcome` is either the success shape for that observation kind or
`{ "kind": "error", "error": ... }`. The error has a stable `code`, processing
`phase`, bounded sanitized `message`, and `retryable` boolean. Version 1 error
codes are `url-policy-blocked`, `dns-resolution-failed`, `dns-answer-blocked`,
`connect-timeout`, `connection-failed`, `tls-failed`, `request-timeout`,
`redirect-limit`, `request-budget-exhausted`, `response-limit`,
`decode-failed`, `parse-failed`, `aborted`, and `unsupported-runtime`. A blocked
or failed observation never fabricates an HTTP response, DNS answer, or browser
fact. The report JSON Schema must encode these branches as mutually exclusive
discriminated unions and contract tests must cover every error code.

The canonical report omits timestamps, durations, random IDs, and other volatile
fields. With `--include-metadata`, an outer envelope may add `generatedAt` and
`durationMs`; rule order, IDs, statuses, assertion IDs, and sanitized evidence
structure remain stable within a schema/ruleset version.

## 14. Aggregate scoring policy

The MVP has **no percentage score and no certification level**. It reports
status counts and profile conformance.

Reasons:

- many capabilities are not applicable to every website;
- drafts have unequal maturity;
- a weighted number implies authority the project does not have;
- external scanner levels are product policy, not universal standards;
- transparent evidence is more useful in CI.

A future score requires an accepted ADR, versioned algorithm, public weights,
applicability rules, migration analysis, and tests demonstrating that it does
not reward meaningless feature accumulation.

## 15. Architecture requirements

The package boundaries in `docs/ARCHITECTURE.md` are mandatory:

- `core` remains runtime-neutral and uses Web-platform types;
- rule code depends on observation interfaces, never Node sockets or global
  network state;
- `transport-node` is the security boundary for public remote HTTP;
- browser observation cannot bypass the same egress policy;
- reporters are pure consumers of normalized reports;
- fixture definitions are test data, not special cases inside rules.

Cross-boundary imports require an ADR.

## 16. Security requirements

The controls in `docs/THREAT_MODEL.md` are release blockers. In particular:

1. an ordinary `fetch()` preceded by DNS lookup is not considered SSRF-safe;
2. every redirect target is parsed, resolved, classified, and authorized again;
3. the actual socket must be pinned to an authorized IP while preserving the
   original HTTP Host and TLS SNI;
4. compressed and decompressed byte limits are enforced while streaming;
5. `local-loopback` and public network profiles use different explicit policies;
6. no cookies, ambient proxy credentials, or user authorization headers are
   attached by default;
7. browser checks remain disabled until their traffic shares an equivalent
   egress control boundary;
8. GitHub Actions triggered by untrusted pull requests receive no secrets and
   use read-only permissions.

Secure remote scanning cannot be declared complete until the adversarial test
matrix passes.

## 17. Performance and resource budgets

Initial defaults, subject to measurement:

| Budget | Default |
| --- | ---: |
| Total requests per scan | 24 |
| Redirects per observation | 5 |
| Concurrent requests | 2 |
| DNS timeout | 2 seconds |
| Connect/TLS timeout | 3 seconds |
| Per-request elapsed timeout | 10 seconds |
| Whole-scan elapsed timeout | 30 seconds |
| Encoded bytes per response | 1 MiB |
| Decoded bytes per response | 2 MiB |
| Total encoded bytes per scan | 4 MiB |
| Total decompressed bytes per scan | 8 MiB |
| Bounded text evidence excerpt | 256 characters |

Rules that require a larger budget must opt in explicitly and explain why. A
configuration may reduce budgets. Increasing hosted-service budgets requires a
security review.

## 18. Privacy and observability

Local execution defaults to no telemetry. Logs are structured and opt-in at
debug level.

The scanner must not persist response bodies by default. Reports contain only
the bounded, sanitized evidence required to explain a verdict. Query values are
redacted unless explicitly classified safe. Header allowlists are used instead
of header denylists.

A future hosted service needs a separate privacy document stating:

- submitted data;
- requester metadata;
- storage and retention;
- deletion process;
- abuse controls;
- subprocessors;
- public/private visibility of results.

## 19. Test requirements

Every change must satisfy the relevant layers in `docs/TEST_STRATEGY.md`:

- parser and evaluator unit tests;
- rule contract tests;
- controlled fixture integration tests;
- reporter schema and golden tests;
- security adversarial tests for network changes;
- compatibility tests for CLI/config/report changes.

Live compatibility checks are scheduled, non-blocking, rate-limited, and only
target endpoints the project owns or has permission to test. They never decide
whether a pull request may merge.

## 20. GitHub Action behavior

The Action should run the pinned CLI package against a preview URL supplied by
the repository workflow. It must:

- default to read-only GitHub token permissions;
- avoid `pull_request_target` with untrusted code;
- never expose repository secrets to fork code;
- write a Job Summary with new/resolved findings;
- upload JSON/JUnit as artifacts when requested;
- emit SARIF only with an explicit source map;
- pin third-party actions by full commit SHA in the maintained workflow;
- treat a missing preview URL as configuration error, not scan failure.

The Action is a wrapper; rule logic stays in the CLI packages.

## 21. Standards update process

1. Open a rule proposal issue.
2. Identify the exact source version and section.
3. Classify normative, recommended, advisory, or compatibility behavior.
4. Record differences from existing rule versions.
5. Add valid, invalid, absent, and drift fixtures.
6. Implement the evaluator without live-network dependencies.
7. Update registry data and generated documentation.
8. Run rule contract and report compatibility tests.
9. Add a ruleset changelog entry.
10. Request review before merging any verdict-changing behavior.

External documentation may be stored as a URL plus content hash and observation
date. Do not redistribute a full source snapshot unless its license and terms
permit it.

## 22. Initial eight-rule acceptance criteria

### 22.1 Robots Exclusion Protocol

- Follows RFC 9309 retrieval and parsing semantics rather than treating exact
  `200 text/plain` as universal conformance.
- Separately reports published compatibility heuristics.
- Does not describe `robots.txt` as authorization or access control.

### 22.2 Sitemap discovery

- Parses `Sitemap` records independently from REP grammar.
- Resolves absolute sitemap URLs and rejects malformed values safely.
- Supports a conventional root sitemap in the selected compatibility profile.

### 22.3 HTTP Link discovery

- Parses multiple fields and comma-containing quoted parameters correctly.
- Resolves relative targets against the effective response URL.
- Distinguishes RFC 8288 syntax from project-defined “agent-useful” relations.

### 22.4 Markdown negotiation

- Issues a distinct `Accept: text/markdown` request.
- Validates the returned media type.
- Reports `Vary: Accept` and cache correctness as a separate recommendation.
- Detects a soft-404 HTML response.

### 22.5 AI crawler policy

- Reports the effective group for a configured, versioned crawler-name dataset.
- Does not claim that policy presence means a crawler complies.
- Does not treat a blanket disallow as agent accessibility.

### 22.6 Content Signals

- Pins the community specification snapshot.
- Parses declared tokens without asserting legal enforceability.
- Separates syntax validity from the policy value selected by the publisher.

### 22.7 API Catalog

- Validates RFC 9727 discovery and RFC 9264 linkset serialization requirements.
- Checks media type and required structure.
- Treats a merely present `linkset` array as insufficient for full conformance.

### 22.8 Agent Skills Discovery

- Implements the pinned Cloudflare draft v0.2.0.
- Validates `$schema`, entry names, types, URLs, and SHA-256 digest syntax.
- In interop mode only, fetches an artifact within budget and verifies its
  digest without executing it.
- Treats the legacy path as compatibility behavior, not v0.2 conformance.

## 23. Milestone definitions

### M0: repository foundation

Strict TypeScript workspace, package boundaries, result types, local CI, and no
network behavior.

### M1: local deterministic lab

Eight rules, fixture runner, human/JSON reports, local loopback transport, and
the 49 protocol fixtures defined in `docs/FIXTURE_CATALOG.md`.

### M2: report and CI contracts

JUnit, GitHub Summary, source-mapped SARIF, result diffing, schema validation,
and version pinning.

### M3: secure remote transport

Public-only Node transport, DNS/socket pinning, redirect revalidation, budgets,
and the complete adversarial suite.

### M4: protocol expansion

Pinned MCP Card, A2A, OAuth, DNS-AID, Web Bot Auth, Auth.md, and ARD profiles.
Where another project already ships conformance tooling, integrate or compare
with it instead of claiming to replace it.

### M5: controlled differential lab

Origin/edge comparisons, optional external-scanner observations, compatibility
matrices, and upstream-ready regression bundles.

### M6: optional browser and commerce experiments

Browser egress isolation for WebMCP, followed by separately reviewed commerce
rules. Neither is required for a useful 1.0 release.

## 24. Release definition of done

Version `0.1.0` may be called an experimental release only when:

- all M0 and M1 acceptance criteria pass;
- all 49 deterministic protocol fixtures exist and pass;
- JSON validates against a committed schema;
- no default test accesses the public Internet;
- `local-loopback` rejects non-loopback addresses;
- every rule has pinned sources and independent remediation text;
- the CLI help and exit codes have golden tests;
- package contents and licenses have been inspected;
- `PROJECT_STATUS.md`, README, changelog, and security documentation match the
  shipped state.

Remote-public scanning may not be advertised until M3 is complete.

## 25. Open decisions

The following require issues or ADRs before implementation:

- final project, repository, npm scope, and binary names;
- exact Node package chosen for socket pinning and IP classification;
- whether browser observation runs locally, in a container, or through a
  dedicated egress gateway;
- storage format for source snapshots and licenses;
- whether DCO enforcement is enabled at first public contribution;
- earliest point at which packages are published independently;
- whether a hosted demo scans only project-owned fixtures or accepts an
  allowlisted set of external targets.

## 26. Authoritative references

- [Published IsItAgentReady documentation snapshot](https://isitagentready.com/llms-full.txt)
- [Cloudflare Agent Readiness launch article](https://blog.cloudflare.com/agent-readiness/)
- [Robots Exclusion Protocol, RFC 9309](https://www.rfc-editor.org/rfc/rfc9309)
- [Web Linking, RFC 8288](https://www.rfc-editor.org/rfc/rfc8288)
- [API Catalog, RFC 9727](https://www.rfc-editor.org/rfc/rfc9727)
- [Linkset, RFC 9264](https://www.rfc-editor.org/rfc/rfc9264)
- [OAuth Authorization Server Metadata, RFC 8414](https://www.rfc-editor.org/rfc/rfc8414)
- [OAuth Protected Resource Metadata, RFC 9728](https://www.rfc-editor.org/rfc/rfc9728)
- [Agent Skills Discovery draft](https://github.com/cloudflare/agent-skills-discovery-rfc)
- [WebMCP Community Group report](https://webmachinelearning.github.io/webmcp/)
- [Standards registry and maturity notes](STANDARDS_REGISTRY.md)
