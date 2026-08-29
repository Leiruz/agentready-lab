# Standards Registry

- Status: Proposed source-of-truth audit
- Executable ruleset: `specs/ruleset.standard.v0.yaml`
- Source ledger: `specs/sources.v0.yaml`
- Frozen external snapshot: `specs/checks.v0.yaml`
- Registry schemas: `specs/ruleset.schema.json`, `specs/sources.schema.json`,
  `specs/rule.schema.json`
- Compatibility snapshot: 2026-08-28
- Snapshot source: <https://isitagentready.com/llms-full.txt>

## 1. What this registry means

AgentReady Lab tests observable web behavior. It does not define the protocols
it tests, certify implementations, or treat a commercial scanner's score as a
standard.

The registry is three files, not one (ADR-0008).
`specs/ruleset.standard.v0.yaml` is the executable ruleset a scan reads,
carrying each rule's `implementation_status`, its assertions' `source_refs` and
parameter schemas, and any `retired_requirements`. `specs/sources.v0.yaml` is
the independently versioned source ledger that every `source_refs` identifier
resolves against. `specs/checks.v0.yaml` is the frozen external compatibility
snapshot: it is never read at scan time, it is never edited, and its per-check
`rule_version` is snapshot metadata rather than this project's rule version.
`specs/README.md` carries the full contract and the joins between the three.

The frozen snapshot records the 22 checks described in IsItAgentReady's
published full documentation on 2026-08-28. That inventory is useful as a
compatibility target because Cloudflare exposes it publicly and uses related
checks in URL Scanner. Its pass criteria are still product heuristics. RFCs,
versioned specifications, schemas, and pinned drafts remain the authority for
specification mode.

Every result must name one of three modes:

| Mode | Question answered | Permitted result language |
| --- | --- | --- |
| `compat` | Would the dated public detector contract likely recognize this evidence? | “Passes the IsItAgentReady 2026-08-28 compatibility heuristic.” |
| `spec` | Does the evidence satisfy a pinned source's applicable requirements? | “Conforms to the tested requirements of RFC 9728.” |
| `interop` | Did a bounded, non-mutating interaction work? | “The declared digest matched the fetched fixture artifact.” |

These claims are deliberately independent. A target can pass compatibility and
fail a current schema, or pass a current schema and fail a stale compatibility
heuristic. Such disagreement is a valuable finding, not a condition to hide.

## 2. Published compatibility inventory

The following table transcribes the public inventory at the snapshot date in
independently written language. “Scored” describes the published compatibility
level, not a normative importance ranking. The `Check ID` column preserves the
external compatibility identifier. AgentReady Lab exposes a separate stable,
namespaced `rule_id` so a vendor contract does not become its native API:

| Compatibility ID | AgentReady Lab rule ID |
| --- | --- |
| `robotsTxt` | `web.discovery.robots` |
| `sitemap` | `web.discovery.sitemap` |
| `linkHeaders` | `web.discovery.link` |
| `dnsAid` | `dns.discovery.dns-aid` |
| `markdownNegotiation` | `web.content.markdown-negotiation` |
| `robotsTxtAiRules` | `web.policy.ai-crawler` |
| `contentSignals` | `web.policy.content-signals` |
| `webBotAuth` | `web.identity.web-bot-auth` |
| `mcpServerCard` | `agent.discovery.mcp-server-card` |
| `a2aAgentCard` | `agent.discovery.a2a-agent-card` |
| `agentSkills` | `agent.discovery.skills` |
| `webMcp` | `agent.browser.webmcp` |
| `apiCatalog` | `web.discovery.api-catalog` |
| `oauthDiscovery` | `auth.discovery.oauth-authorization-server` |
| `oauthProtectedResource` | `auth.discovery.oauth-protected-resource` |
| `authMd` | `auth.discovery.auth-md` |
| `ard` | `agent.discovery.ard` |
| `x402` | `commerce.payment.x402` |
| `mpp` | `commerce.payment.mpp` |
| `ucp` | `commerce.discovery.ucp` |
| `acp` | `commerce.discovery.acp` |
| `ap2` | `commerce.payment.ap2` |

Both identifiers are immutable within a published registry generation. The
compatibility adapter uses `id`; native reports, CLI selectors, fixtures, and
finding codes use `rule_id`.

### Discoverability

| # | Check ID | Published compatibility pass | Authority and maturity | Critical spec delta |
| ---: | --- | --- | --- | --- |
| 1 | `robotsTxt` | `/robots.txt` returns exactly 200, is `text/plain`, and contains at least one `User-agent`. | [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309), IETF Proposed Standard. | RFC 9309 has response-class, redirect, encoding, group-selection, and precedence semantics beyond this presence test. REP is not authorization. |
| 2 | `sitemap` | `/sitemap.xml` parses as XML, or robots contains a `Sitemap` record. | [Sitemaps protocol](https://www.sitemaps.org/protocol.html), established industry protocol rather than IETF/W3C standard. | A robots pointer or generic XML parse does not prove namespace, URL scope, size, sitemap-index, or referenced-document conformance. |
| 3 | `linkHeaders` | The homepage has a `Link` field with a detector-recognized relation such as `service-desc`, `describedby`, or `api-catalog`. | [RFC 8288](https://www.rfc-editor.org/rfc/rfc8288), IETF Proposed Standard; API Catalog relation in [RFC 9727](https://www.rfc-editor.org/rfc/rfc9727). | RFC 8288 defines link syntax and context, not a universal list of “agent-useful” relations. The allowlist is compatibility policy. |
| 4 | `dnsAid` | A DoH lookup finds a DNSSEC-validated ServiceMode SVCB or HTTPS record beneath `_agents`. | [DNS-AID draft-02](https://datatracker.ietf.org/doc/draft-mozleywilliams-dnsop-dnsaid/), active individual Internet-Draft expiring 2026-11-28; record substrate [RFC 9460](https://www.rfc-editor.org/rfc/rfc9460). | DNS-AID is work in progress and not IETF consensus. Pin draft-02 owner names and parameter rules; do not silently follow later drafts. |

### Content accessibility

| # | Check ID | Published compatibility pass | Authority and maturity | Critical spec delta |
| ---: | --- | --- | --- | --- |
| 5 | `markdownNegotiation` | A homepage request with `Accept: text/markdown` receives a `text/markdown` response. | [Cloudflare Markdown for Agents](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/), vendor convention; media type in informational [RFC 7763](https://www.rfc-editor.org/rfc/rfc7763); `Vary` semantics in [RFC 9110 §12.5.5](https://www.rfc-editor.org/rfc/rfc9110#section-12.5.5). | The detector does not prove semantic fidelity, cache correctness, or representation quality. `Vary: Accept` is a useful profile requirement but not part of the published pass. |

### Bot access control

| # | Check ID | Published compatibility pass | Authority and maturity | Critical spec delta |
| ---: | --- | --- | --- | --- |
| 6 | `robotsTxtAiRules` | robots contains a known AI crawler group or a wildcard group. | REP syntax is stable [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309); crawler names are a mutable vendor/ecosystem list. | Rule presence is not permission. `User-agent: *` plus `Disallow: /` passes the presence heuristic while blocking all crawling. |
| 7 | `contentSignals` | robots contains `Content-Signal` preferences for one or more of `ai-train`, `search`, or `ai-input`. | [Content Signals](https://contentsignals.org/) community framework; linked [draft-00](https://datatracker.ietf.org/doc/draft-romm-aipref-contentsignals/) is an expired individual draft. | A parser can validate syntax and group context only. It cannot prove legal effect, consent, prohibition, or crawler compliance. |
| 8 | `webBotAuth` | `/.well-known/http-message-signatures-directory` exists with the expected valid key-directory/JWKS shape. Failures are neutral and unscored. | Active [IETF WG](https://datatracker.ietf.org/wg/webbotauth/about/); protocol [draft-02](https://datatracker.ietf.org/doc/draft-meunier-webbotauth-httpsig-protocol/) expires 2027-02-19; underlying signatures [RFC 9421](https://www.rfc-editor.org/rfc/rfc9421). | Key-directory presence does not demonstrate creation or verification of a signed request. |

### Protocol discovery

| # | Check ID | Published compatibility pass | Authority and maturity | Critical spec delta |
| ---: | --- | --- | --- | --- |
| 9 | `mcpServerCard` | One of three accepted paths returns JSON with `serverInfo.name` or a top-level `name`. | [MCP SEP-2127 PR](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127), open proposal. | The documentation calls it SEP-1649 but links PR 2127. Paths and schema have changed during review. Name presence is not Server Card or MCP conformance. |
| 10 | `a2aAgentCard` | `/.well-known/agent-card.json` contains `name`, `version`, and `supportedInterfaces`. | [A2A v1.0 specification](https://a2a-protocol.org/latest/specification/) and [definitions](https://a2a-protocol.org/latest/definitions/), Linux Foundation project specification. | A v1.0 card also requires description, capabilities, default modes, skills, and complete interface objects. A three-field card can pass compatibility and fail v1.0. |
| 11 | `agentSkills` | The v0.2 path, or a legacy path, contains a valid `skills` array. | [Cloudflare Agent Skills Discovery v0.2.0](https://github.com/cloudflare/agent-skills-discovery-rfc), draft. | Current conformance uses `/.well-known/agent-skills/index.json` and validates every entry and digest. The legacy path is compatibility only. |
| 12 | `webMcp` | A rendered page exposes tools through the WebMCP JavaScript API. | [W3C Community Group report](https://webmachinelearning.github.io/webmcp/), explicitly not a W3C Standard or Standards Track document. | Static HTTP cannot conclusively fail this rule. A compatible browser is required; other runners return `unsupported-runtime`. |
| 13 | `apiCatalog` | `/.well-known/api-catalog` is `application/linkset+json` and has a `linkset` array with API entries. | [RFC 9727](https://www.rfc-editor.org/rfc/rfc9727), [RFC 9264](https://www.rfc-editor.org/rfc/rfc9264), and [RFC 8288](https://www.rfc-editor.org/rfc/rfc8288), IETF Proposed Standards. | Array presence is weaker than validating anchors, target attributes, relation semantics, catalog links, and the RFC 9727 profile. |
| 14 | `oauthDiscovery` | OIDC or OAuth well-known metadata exists and passes the detector's metadata test. | [RFC 8414](https://www.rfc-editor.org/rfc/rfc8414), IETF Proposed Standard; [OpenID Connect Discovery 1.0](https://openid.net/specs/openid-connect-discovery-1_0.html), final OpenID specification. | Required fields are conditional on the selected profile and advertised features. A blanket issuer/auth/token/grants checklist is not a correct conformance algorithm. |
| 15 | `oauthProtectedResource` | `/.well-known/oauth-protected-resource` contains both `resource` and `authorization_servers`. | [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728), IETF Proposed Standard. | RFC 9728 requires `resource` but makes `authorization_servers` optional. A conformant document can intentionally fail compatibility. Path-bearing resource identifiers also change well-known URI construction. |
| 16 | `authMd` | `/auth.md` exists, protected-resource metadata is discoverable, and authorization-server metadata has `agent_auth` registration methods. | [auth.md repository](https://github.com/workos/auth.md) and [WorkOS site](https://workos.com/auth-md), open vendor-led profile. | `agent_auth` is not standardized by RFC 8414 or RFC 9728. Presence of instructions and metadata does not prove registration works. |
| 17 | `ard` | A manifest found by one of the documented mechanisms has `specVersion` and at least one valid entry; fix text recommends `/.well-known/ai-catalog.json` and `host`. | [ARD v0.91](https://agenticresourcediscovery.org/spec/), proposal dated 2026-08-26; [repository](https://github.com/ards-project/ard-spec). | Current v0.91 uses `/.well-known/ard.json` and `rel=ard`; it does not require top-level `specVersion` or `host`. Entries require a `urn:air` identifier, `displayName`, IANA media type, and exactly one of `url`/`data`. ARD already ships a schema and conformance CLI. |

### Commerce

Commerce requires special handling. The live full documentation says these
checks are evaluated for detected ecommerce sites and neutral otherwise. The
[Cloudflare launch article](https://blog.cloudflare.com/agent-readiness/) says
commerce does not count toward the readiness score. AgentReady Lab records that
surface disagreement and never lets heuristic classification silently select a
normative profile. A user must opt into the commerce profile and supply a known
endpoint where the protocol needs one.

| # | Check ID | Published compatibility pass | Authority and maturity | Critical spec delta |
| ---: | --- | --- | --- | --- |
| 18 | `x402` | An API route returns 402 with detector-recognized x402 payment headers. | [x402 v2 docs](https://docs.x402.org/) and [x402 Foundation repository](https://github.com/x402-foundation/x402), living ecosystem protocol. | A scanner must know a payable route. Homepage absence is inconclusive, and raw HTTP 402 is insufficient. Normal scans stop after validating a challenge and never pay. |
| 19 | `mpp` | `/openapi.json` has `x-payment-info` on payable operations. | [Payment Discovery draft-00](https://paymentauth.org/draft-payment-discovery-00.txt), individual work in progress dated 2026-08-24 and expiring 2027-02-25; [MPP](https://mpp.dev/) is a separate runtime protocol. | Validate HTTPS discovery, OpenAPI 3.x, 402 responses, and the supplied extension schema. Do not label this static check full MPP conformance. |
| 20 | `ucp` | `/.well-known/ucp` contains top-level `protocol_version` and `services`. | [UCP 2026-08-25](https://ucp.dev/specification/overview/), date-versioned ecosystem specification. | Current UCP uses a top-level `ucp` wrapper with `version`, `services`, `capabilities`, and `payment_handlers`. The published heuristic is stale. |
| 21 | `acp` | `/.well-known/acp.json` has protocol name/version, API base URL, transports, and capability services. | [ACP repository](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol), explicitly beta, stable date version 2026-04-17. | Discovery shape does not prove services work. Public-card absence also does not rule out a private/onboarded integration. |
| 22 | `ap2` | An A2A Agent Card carries a legacy AP2 extension with role information. | [AP2 v0.2](https://ap2-protocol.org/ap2/specification/) and [repository](https://github.com/google-agentic-commerce/AP2), current ecosystem protocol. | AP2 v0.2 dropped the v0.1 Agent Card extension. Current implementations can pass v0.2 and fail this historical detector. MVP spec mode therefore makes no AP2 v0.2 conformance claim. |

## 3. Published level algorithm

The level is a compatibility policy layered over selected checks:

| Level | Published requirement |
| ---: | --- |
| 0 — Not Ready | Does not meet Level 1. |
| 1 — Basic Web Presence | Pass at least two of robots, sitemap, and Link headers. |
| 2 — Bot-Aware | Level 1 plus both AI bot rules and Content Signals. |
| 3 — Agent-Readable | Level 2 plus Markdown negotiation. |
| 4 — Agent-Integrated | Level 3 plus at least one of MCP Server Card, A2A Agent Card, Agent Skills, and API Catalog. |
| 5 — Agent-Native | Level 4 plus two of three published bundles: Web Bot Auth; all four Level 4 integrations; authentication metadata through OAuth discovery, protected-resource metadata, or Auth.md. |

The phrase “two of three” combines individual checks and bundles of checks. It
must be implemented only in the snapshot-pinned compatibility reporter. It must
not influence spec-mode failures or severity.

The external response vocabulary is `pass`, `fail`, `neutral`, and
`unableToCheck`. AgentReady Lab maps external results into raw compatibility
evidence and retains its richer canonical statuses:

| AgentReady Lab status | Use |
| --- | --- |
| `pass` | Applicable assertion evaluated and satisfied. |
| `fail` | Applicable normative assertion evaluated and violated. |
| `warning` | Recommendation/advisory failed or non-normative risk observed. |
| `not-applicable` | Rule does not apply to the selected target/profile. |
| `unable-to-check` | Required evidence could not be obtained or parsed safely. |
| `unsupported-runtime` | Runner lacks the required surface, notably browser WebMCP. |

Never map external `neutral` blindly. Depending on the rule it may mean
informational, non-commerce, opt-out, unknown, or unavailable.

## 4. Source maturity rules

### Stable standards

RFC 9309, RFC 8288, RFC 9727, RFC 9264, RFC 9460, RFC 9421, RFC 8414, and RFC
9728 are IETF Proposed Standards. “Proposed Standard” is the formal maturity
label; “RFC” alone does not imply Internet Standard maturity. RFC 7763 is an
Informational RFC defining the `text/markdown` media type.

OpenID Connect Discovery 1.0 is a final OpenID Foundation specification. The
Sitemaps protocol is established but is not an IETF RFC or W3C Recommendation.
A2A v1.0 is an ecosystem specification hosted by a Linux Foundation project.

### Moving or experimental sources

- DNS-AID and Web Bot Auth are active Internet-Drafts. A draft is a work in
  progress and may change or expire; it does not represent IETF consensus.
- The Content Signals Internet-Draft is expired. The community site may still
  define a useful convention, but it must not be called an IETF standard.
- MCP Server Card is an open proposal/PR. Pin a commit; never validate against a
  moving PR head in CI.
- Agent Skills Discovery v0.2.0 is a Cloudflare-authored draft.
- WebMCP is a W3C Community Group report that expressly disclaims W3C Standard
  and Standards Track status.
- Auth.md is a WorkOS-led profile; `agent_auth` extends OAuth metadata.
- ARD v0.91 is a proposal. Preserve its official schema and CLI as an upstream
  differential oracle, not a runtime dependency.
- x402, UCP, ACP, and AP2 are ecosystem protocols. UCP and ACP are date-versioned;
  ACP is beta. Payment Discovery is an individual draft, distinct from MPP.

## 5. Testable verdict semantics

### 5.1 Applicability first

The evaluator determines applicability before requesting evidence:

1. Select the pinned ruleset and mode.
2. Apply the explicit user profile.
3. Check runtime capabilities.
4. Require explicit endpoints for route-dependent mechanisms.
5. Return `not-applicable` or `unsupported-runtime` where appropriate.
6. Only then schedule a bounded observation.

Absence of an opt-in experimental feature is not protocol nonconformance. A
commerce rule is not applicable merely because a classifier thinks a site is a
shop. WebMCP is not failed merely because the Node HTTP runner cannot see it.

### 5.2 Evidence before assertions

Rules evaluate normalized evidence and do not call global network APIs. Every
HTTP observation distinguishes:

- target and final URL;
- method and representation-affecting headers;
- redirect chain;
- status and media type;
- bounded byte length and digest;
- parser/schema outcome;
- safe, bounded excerpts when needed.

An HTTP 200 soft-404 HTML page at a `.well-known` JSON route fails the applicable
content and schema assertions. It is not a discovery pass. An HTML request and
`Accept: text/markdown` request have different cache keys.

### 5.3 Network uncertainty

Timeouts, blocked redirects, DNS failure, excessive bodies, unsupported content
encoding, and parser resource limits normally yield `unable-to-check`. They do
not prove target nonconformance. Every redirect hop is revalidated against the
network policy; redirects never bypass private-address, port, protocol, or DNS
rebinding defenses.

### 5.4 Assertion strength

- Violation of an applicable MUST/SHALL or exact required schema constraint can
  yield `fail`.
- Violation of SHOULD/RECOMMENDED normally yields `warning`.
- AgentReady Lab advice, including selected quality checks, is `advisory` and
  cannot be marketed as source-specification conformance.
- A detector-only rule can report syntax or presence but cannot claim full
  protocol conformance.

## 6. Required differential fixtures

The initial fixture corpus should make the important disagreements executable:

| Fixture | Expected result |
| --- | --- |
| Wildcard robots group with `Disallow: /` | AI-rule presence passes compat; effective policy reports blocked. |
| RFC 9728 metadata with `resource` and no `authorization_servers` | Passes RFC spec; fails the 2026-08-28 compat heuristic. |
| Three-field A2A card | Passes compat; fails A2A v1.0 required-field validation. |
| Full A2A v1.0 card | Passes spec; interop remains unproven. |
| MCP card at each accepted legacy/community path | Compat behavior is path-specific; no unpinned spec claim. |
| Agent Skills legacy index | Compat can pass; v0.2 spec path fails. |
| Agent Skills artifact with wrong digest | Index schema can pass; digest interop fails. |
| WebMCP page under Node-only runner | `unsupported-runtime`, never `fail`. |
| API Catalog with an empty/unrelated `linkset` | Presence detector may recognize shape; RFC assertions fail. |
| RFC-valid path-bearing OAuth issuer/resource | Correct well-known construction passes spec. |
| RFC 9728 `resource` mismatch | Normative spec failure. |
| Current ARD v0.91 manifest | Passes ARD spec; can fail stale compat behavior. |
| Predecessor AI Catalog manifest | Can pass compat; fails current ARD v0.91 discovery/schema. |
| x402 challenge at an explicitly known route | Challenge validation can pass; payment interop remains untested. |
| Current UCP wrapper document | Passes 2026-08-25 spec; fails `protocol_version` compat shape. |
| ACP discovery card with unreachable services | Static spec assertions may pass; no service interop claim. |
| Current AP2 v0.2 data without legacy Agent Card extension | Current spec fixture can be valid; legacy compat detector fails. |
| `.well-known` route returning a branded HTML soft 404 | Fails expected media/parser assertions despite HTTP 200. |
| Redirect from public host to loopback/private address | Transport blocks it and rule returns `unable-to-check`. |

## 7. Known external-surface drift

The compatibility snapshot itself is internally and externally versioned:

- The live full document says 22 checks and includes ARD and AP2.
- Its example response omits ARD from the discovery object even though the check
  appears later in the same document.
- The visible custom-check list observed on 2026-08-28 appeared to omit AP2.
- Generated Cloudflare TypeScript URL Scanner types observed on that date did
  not expose ARD or AP2 fields.
- The April launch article describes an earlier set and says commerce does not
  count toward the score.

Therefore a parity test must identify its surface: `llms-full contract`, direct
scan API, site UI, or Cloudflare URL Scanner API. “Matches IsItAgentReady” without
a surface and date is not an acceptable claim.

A community report also alleges that Cloudflare-to-Cloudflare requests can lose
the Markdown `Accept` value and produce a false negative. This has not been
independently reproduced by this project. If retained as a test hypothesis, cite
<https://github.com/cloudflare/agents/issues/1449> and label it unverified.

## 8. Maintenance and review

For each change:

1. identify the exact RFC section, schema release, draft number, dated version,
   or repository commit;
2. record source kind and formal maturity accurately;
3. update fixtures before changing expected results;
4. state whether the change affects `compat`, `spec`, `interop`, or more than one;
5. preserve the previous ruleset when published results need reproducibility;
6. review network and parser safety for every new observation;
7. never fetch moving standards sources during ordinary unit or CI tests;
8. obtain independent review for normative assertion changes.

`specs/ruleset.standard.v0.yaml` and `specs/sources.v0.yaml` are authoritative
for implementation metadata. This document explains their rationale. If they
disagree, block release until both are reviewed and corrected; do not silently
choose whichever produces a higher score.
