# Fixture Catalog

- Status: Proposed
- Snapshot date: 2026-08-28
- MVP inventory: 49 deterministic protocol cases plus 24 security cases

> [!IMPORTANT]
> This is the required fixture inventory, not evidence that fixtures already
> exist. A case is implemented only when its manifest entry, HTTP behavior,
> rule contract test, and expected report are present and passing.

## 1. Purpose

Fixtures are AgentReady Lab's executable evidence. They prevent rule semantics
from being inferred from one live site, one scanner response, or one happy-path
example. Each case isolates a protocol behavior and records the expected result
under a pinned mode and ruleset.

The MVP must implement the 49 protocol cases in sections 5–12 before version
`0.1.0`. The security cases in section 13 are mandatory for the milestone named
in their `Gate` column. Security cases use controlled resolvers and local
servers; most must never be deployed publicly.

## 2. Fixture design

### 2.1 Known-good base

Protocol cases inherit a complete known-good base origin and override the
smallest possible behavior. The base provides:

- a valid homepage HTML representation;
- a distinct valid Markdown representation with `Vary: Accept`;
- a valid `robots.txt` with a deterministic crawler policy and Content Signals;
- a valid root sitemap;
- valid useful Link discovery;
- a valid API Catalog;
- a valid Agent Skills Discovery v0.2.0 index and fixed artifact bytes.

An override must declare every assertion it expects to change. Contract tests
fail when an unrelated assertion changes relative to the base.

### 2.2 Host model

The harness starts one server per fixture case, binds it to `127.0.0.1:0`, reads
the port the operating system assigned, and hands the scanner
`http://127.0.0.1:<port>`. An IPv4 literal is not resolved at all, so this needs
no resolver override, no hosts file, and no special-use domain, and the
requirement that every resolved answer be loopback is satisfied trivially.
`[::1]` gets the same treatment on its own ephemeral port for the IPv6 security
case. Binding to `0.0.0.0` or `::` is forbidden: it would expose fixture cases,
including deliberately malformed responses and redirect chains, to the local
network and to any other tenant on a shared CI runner.

This section once gave the scanner a hostname derived from the fixture ID.
ADR-0006 retains that name as a manifest label only, `manifestHost`:

```text
md-003.fixture.test
api-004.fixture.test
```

It is used for uniqueness checking across cases and for routing if the optional
Workers deployment is ever configured under a domain the maintainer owns. It is
never given to a transport, never used to construct a scan target, and never
appears in a canonical report. A test that passes `manifestHost` to the scanner
is a bug, and the harness asserts that the value it hands the scanner parses as
an IP-literal origin.

An ephemeral port appears in `target.requestedUrl`, `target.origin`,
`policy.allowedPorts`, and every evidence request URL, so two runs of one case
produce different canonical bytes. This is handled by injection, not by
normalizing the origin away: the harness builds the expected report from the
manifest and the origin it just bound, then compares byte for byte. Everything
except the port stays an exact comparison and no regular expression is applied
to the report.

If public fixtures are later deployed, the maintainer replaces illustrative
domains with a domain they control and may route
`https://*.fixtures.<owned-domain>/*` to one fixed Worker. Root resources must
remain real root paths such as `/robots.txt` and
`/.well-known/agent-skills/index.json`.

### 2.3 Declarative representation

The intended manifest shape is data-only:

```ts
defineFixture({
  id: "md-003",
  title: "Markdown request returns HTML",
  base: "valid-agent-site-v1",
  expected: {
    mode: "spec",
    rule: "web.content.markdown-negotiation",
    status: "fail",
    assertions: ["markdown.media-type"],
  },
  overrides: {
    "/": representation({
      when: { accept: "text/markdown" },
      response: {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: "<h1>Not Markdown</h1>",
      },
    }),
  },
});
```

The precise TypeScript helper can change during M1. These properties cannot:

- compile-time finite cases;
- no arbitrary upstream URL;
- no query-controlled response status/body/redirect;
- no secrets;
- stable bytes and headers;
- explicit expected rule, mode, status, and assertion IDs.

## 3. Status notation

| Notation | Meaning |
| --- | --- |
| `pass` | Applicable assertion is satisfied. |
| `fail` | Applicable normative assertion is violated. |
| `warning` | Recommended/advisory or risky interoperability behavior. |
| `not-applicable` | Optional mechanism is not declared or selected. |
| `unable-to-check` | Evidence could not be safely or completely evaluated. |
| `unsupported-runtime` | Runner lacks the required observation capability. |

Where `spec` and `compat` differ, both expectations are listed. Compatibility
expectations must be tied to a dated published snapshot before implementation.
The fixture never treats an external service as the conformance oracle.

## 4. General assertions for every protocol fixture

Every case must also prove:

- only declared routes were requested;
- request method and representation headers are exact;
- response bodies never enter the report in full;
- query values, credentials, cookies, and unsafe headers are absent;
- result and evidence ordering is stable;
- repeated canonical JSON is byte-for-byte identical;
- the case behaves identically through the in-memory adapter and Worker handler
  for the HTTP facts both runtimes can represent.

## 5. Robots Exclusion Protocol — 6 cases

Primary rule: `web.discovery.robots`

| ID | Behavior | Expected result | Primary purpose |
| --- | --- | --- | --- |
| `rob-001` | `GET /robots.txt` returns bounded UTF-8 plain text with a valid `User-agent` group and rules. | `spec: pass`, `compat: pass` | Baseline retrieval and parsing |
| `rob-002` | `/robots.txt` returns an actual 404. | `spec: not-applicable`, `compat: fail` | Distinguish an optional REP deployment from a readiness heuristic |
| `rob-003` | Returns `200 text/html` containing the site's generic not-found page. | `spec: fail`, `compat: fail` | Detect soft 404 and wrong representation |
| `rob-004` | One same-origin redirect leads to a valid `/robots-final.txt`. | `spec: pass`; redirect evidence retained | Prove controlled redirect handling |
| `rob-005` | Redirect loop exceeds the per-observation redirect budget. | `spec: unable-to-check` | Keep a transport limit from becoming a false syntax failure |
| `rob-006` | Valid group is surrounded by comments, blank lines, and unknown fields. | `spec: pass` with bounded note for ignored fields | Prove tolerant parsing without inventing semantics |

Notes:

- `robots.txt` is crawler guidance, not authorization or access control.
- The `rob-002` spec result must follow the pinned RFC retrieval semantics and
  selected profile; its compatibility result represents an external readiness
  convention, not an RFC violation.

## 6. Sitemap discovery — 6 cases

Primary rule: `web.discovery.sitemap`

| ID | Behavior | Expected result | Primary purpose |
| --- | --- | --- | --- |
| `map-001` | `/sitemap.xml` returns a valid bounded `urlset` document. | `spec: pass`, `compat: pass` | Conventional root sitemap |
| `map-002` | `robots.txt` declares an absolute same-origin sitemap URL that returns a valid `urlset`. | `spec: pass`, `compat: pass` | Sitemap-field discovery |
| `map-003` | Root sitemap is a valid `sitemapindex` referring to a bounded same-origin child sitemap. | `spec: pass` | Index parsing without crawling the site |
| `map-004` | Endpoint returns malformed XML with an unclosed element. | `spec: fail` | Safe deterministic XML failure |
| `map-005` | Endpoint returns `200 text/html` with a generic not-found page. | `spec: fail`, `compat: fail` | Wrong media/soft-404 detection |
| `map-006` | `robots.txt` contains a relative `Sitemap: /nested.xml` value. | `spec: fail` with syntax assertion | Require the source-defined absolute sitemap URL form |

The MVP does not recursively crawl every sitemap URL. It validates the bounded
discovery document and only follows explicitly approved same-origin fixture
references within the request budget.

## 7. HTTP Link discovery — 6 cases

Primary rule: `web.discovery.link`

| ID | Behavior | Expected result | Primary purpose |
| --- | --- | --- | --- |
| `lnk-001` | Homepage has multiple Link field lines containing a valid agent-useful relation. | `spec: pass`, `compat: pass` | Preserve and parse multiple fields |
| `lnk-002` | Link parameters contain a quoted title with a comma. | `spec: pass` | Prevent naive comma splitting |
| `lnk-003` | A valid relative target is resolved against the effective redirected page URL. | `spec: pass` | RFC-aware target resolution |
| `lnk-004` | Field value contains an unclosed quoted parameter. | `spec: fail` | Deterministic malformed-field handling |
| `lnk-005` | Header is valid RFC 8288 syntax but exposes only `rel="stylesheet"`. | `spec: pass` for syntax plus `warning` for no selected discovery relation; `compat: fail` | Separate web-link conformance from project-defined usefulness |
| `lnk-006` | Homepage contains no Link field. | `spec: not-applicable`, `compat: fail` | Distinguish optional syntax from readiness policy |

## 8. Markdown negotiation — 6 cases

Primary rule: `web.content.markdown-negotiation`

| ID | Behavior | Expected result | Primary purpose |
| --- | --- | --- | --- |
| `md-001` | Default request returns HTML; `Accept: text/markdown` returns `200 text/markdown; charset=utf-8` and `Vary: Accept`. | `spec: pass`, `compat: pass` | Correct representation negotiation |
| `md-002` | Markdown representation is valid but `Vary` omits `Accept`. | `spec: warning`; main media assertion passes | Keep cache correctness separate from representation support |
| `md-003` | Markdown request returns `200 text/html`. | `spec: fail`, `compat: fail` | Media-type mismatch |
| `md-004` | Markdown request returns `406 Not Acceptable`. | `spec: fail` for selected capability profile | Explicit lack of Markdown representation |
| `md-005` | Markdown bytes are returned as `text/plain`. | `spec: fail`, `compat: fail` | Require the advertised media type rather than guessing from bytes |
| `md-006` | A same-origin redirect ends at a valid Markdown representation and retains correct `Vary`. | `spec: pass` | Evaluate the effective response URL and final headers |

`Accept: text/html` and `Accept: text/markdown` observations must never share a
deduplication key.

## 9. AI crawler policy — 6 cases

Primary rule: `web.policy.ai-crawler`

Tests pin a small crawler-name dataset with its source date. They do not claim
that a crawler will obey the published policy.

| ID | Behavior | Expected result | Primary purpose |
| --- | --- | --- | --- |
| `bot-001` | Explicit configured AI crawler group allows the tested path. | `spec: pass`, `compat: pass` | Resolve an explicit applicable group |
| `bot-002` | Explicit configured AI crawler group disallows the tested path. | `spec: warning` with access decision `disallowed`; `compat: pass` because the dated presence heuristic recognizes an explicit policy | Do not confuse declared policy with permitted access |
| `bot-003` | Wildcard group allows the tested path and no more-specific group exists. | `spec: pass`; source group recorded | Wildcard applicability |
| `bot-004` | Wildcard disallows, but a more-specific configured bot group allows. | `spec: pass`; specific group wins | Longest matching user-agent behavior |
| `bot-005` | Two matching groups for the same product token contribute rules; the tested path matches a longer `Allow` record from the second group. | `spec: pass`; effective access is allowed after combining both groups | Prevent first-group-only parsing |
| `bot-006` | Neither a matching group nor wildcard group exists. | `spec: pass` with default access decision recorded; `compat: fail` if the dated heuristic requires a declared AI policy | Separate effective REP behavior from explicit-agent-policy presence |

## 10. Content Signals — 6 cases

Primary rule: `web.policy.content-signals`

No grammar is invented for this rule. This section previously said the exact
grammar and token set would be pinned in the standards registry before
implementation; ADR-0009 establishes that no pinned source defines either. The
three recognized tokens, `ai-train`, `search`, and `ai-input`, come from a dated
external pass heuristic, so they are the vocabulary of the `compat` assertion
and of nothing else. Results describe publisher declarations, not legal
enforceability.

No case here expects `spec: fail`, because there is no normative requirement
left to violate. RFC 9309 section 2.2.4 defines no syntax for an extension
record, explicitly permits a crawler to be lenient with one, and addresses its
only `MUST` to the crawler rather than to the publisher.
`content-signals.syntax` is therefore retired outright rather than demoted or
renamed, and the non-interference obligation it seemed to carry is this
project's own: the robots parser must produce identical group selection and
allow/disallow results with extension records present and stripped, proven by a
parser unit test rather than reported as a verdict about a target.

| ID | Behavior | Expected result | Primary purpose |
| --- | --- | --- | --- |
| `sig-001` | A valid directive declares recognized values for `search`, `ai-input`, and `ai-train`. | `spec: pass`, `compat: pass` | Complete valid declaration |
| `sig-002` | A syntactically valid directive declares only one recognized token permitted by the dated snapshot. | `spec: pass` with the undeclared dimensions reported, `compat: pass` | Partial declaration semantics |
| `sig-003` | A syntactically valid RFC 9309 record declares only tokens outside the dated compatibility set, with no recognized token present. | `spec: warning` on `content-signals.unrecognized-vocabulary`, `compat: fail` | The compatibility heuristic decides a compatibility verdict and nothing else |
| `sig-004` | The same token is declared twice with conflicting values and the pinned source does not define conflict resolution. | `spec: warning` with `content-signals.conflicting-declaration` | Report ambiguity without inventing a normative failure |
| `sig-005` | A valid known token appears beside an unknown extension token. | `spec: warning` on `content-signals.unrecognized-vocabulary`, `compat: pass`; the known declaration remains usable | Forward-compatible parsing without inventing extension semantics |
| `sig-006` | No Content Signals declaration exists. | `spec: not-applicable`, `compat: fail` where the dated readiness profile requires one | Optional deployment versus compatibility heuristic |

`sig-003` and `sig-005` report the same `spec` assertion, which is weaker
discrimination than a per-case assertion and is stated here rather than hidden.
They stay distinct cases: their `compat` verdicts are opposite, and the
finding's recognized-token-count parameter is zero in one and non-zero in the
other. Whether any part of the declaration is usable is exactly what that
parameter carries.

No assertion in this rule produces a verdict about a token's value. Declared
values are recorded verbatim as bounded sanitized evidence and reported as
unspecified by the pinned source. A future contributor may not add an allowed
value set because the community site's examples happen to use one; that requires
a pinned source and a new decision.

`sig-004` records an interoperability warning unless a later pinned source
defines normative conflict handling, and its assertion is created by ADR-0008. A
later normative change requires a new ruleset rather than silently changing this
fixture.

## 11. API Catalog — 6 cases

Primary rule: `web.discovery.api-catalog`

| ID | Behavior | Expected result | Primary purpose |
| --- | --- | --- | --- |
| `api-001` | `/.well-known/api-catalog` returns `application/linkset+json` with a valid non-empty API entry, anchor, and service-description relation. | `spec: pass`, `compat: pass` | RFC 9727/RFC 9264 baseline |
| `api-002` | Valid catalog contains two independent API contexts and correctly resolved link targets. | `spec: pass` | Multiple-entry semantics and stable ordering |
| `api-003` | Valid-looking JSON is returned as `text/html`. | `spec: fail`, `compat: fail` | Media-type validation |
| `api-004` | Correct media type contains malformed JSON. | `spec: fail` | Bounded parse failure |
| `api-005` | Document contains an empty `linkset` array. | `spec: fail` on `api-catalog.relations`; the catalog has no required hyperlink to an API endpoint | Enforce RFC 9727 Section 4.1 beyond array presence |
| `api-006` | Entry omits its context/anchor or contains no hyperlink relation to an API endpoint or nested catalog. | `spec: fail` with precise JSON Pointer | Semantic validation beyond schema presence |

## 12. Agent Skills Discovery v0.2.0 — 7 cases

Primary rule: `agent.discovery.skills`

| ID | Behavior | Expected result | Primary purpose |
| --- | --- | --- | --- |
| `skl-001` | `/.well-known/agent-skills/index.json` contains the pinned `$schema`, one valid entry, absolute artifact URL, and syntactically valid SHA-256 digest. | `spec: pass`, `compat: pass` | v0.2.0 baseline |
| `skl-002` | Index omits the `$schema` required by the pinned ruleset. | `spec: fail` | Version identification |
| `skl-003` | Entry digest uses an invalid algorithm/length/encoding. | `spec: fail` | Digest syntax validation |
| `skl-004` | Only legacy `/.well-known/skills/index.json` exists and is otherwise valid. | `spec: fail` on `skills.path-schema`; `compat: pass` under the dated heuristic | Keep legacy compatibility out of v0.2 conformance |
| `skl-005` | Entry URL is not a valid RFC 3986 URI-reference. | `spec: fail` with JSON Pointer | URL validation without fetching |
| `skl-006` | v0.2 discovery endpoint is absent. | `spec: not-applicable`, `compat: fail` for an agent-service profile that requires discovery | Profile applicability |
| `skl-007` | Static metadata is valid, but the fixed artifact bytes do not match the declared digest. | `spec: pass` in static mode; `interop: fail` after a bounded same-origin fetch | Separate shape validation from opt-in dereference |

The artifact in `skl-007` is hashed as bytes and never unpacked or executed.

## 13. Security and boundary fixtures — 24 cases

These are deterministic harness cases, not public Worker endpoints. `M1` cases
protect the `local-loopback`-only release; `M3` cases gate the `ci-public`
network profile.

| ID | Gate | Controlled condition | Expected result |
| --- | --- | --- | --- |
| `sec-001` | M1 | Exact `127.0.0.1` target and exact port | Local observation allowed |
| `sec-002` | M1 | Exact `[::1]` target and exact port | Local observation allowed |
| `sec-003` | M1 | Loopback target redirects to another loopback port | Blocked; exact origin cannot change |
| `sec-004` | M1 | `127.0.0.1` redirects to `localhost` on the same port | Blocked; hostname/origin cannot silently change |
| `sec-005` | M1 | Local target redirects to RFC1918 LAN address | Blocked before connection |
| `sec-006` | M1 | HTML and Markdown requests share URL but differ in `Accept` | Two observations; no incorrect deduplication |
| `sec-007` | M1 | Response exceeds rule body cap by one decoded byte | Stream aborted; result `unable-to-check`, no oversized evidence |
| `sec-008` | M1 | XML includes `DOCTYPE` and an external entity | Rejected without entity resolution or outbound request |
| `sec-009` | M1 | Response/query contains token-like values | Canonical report redacts values |
| `sec-010` | M1 | Header/body contains terminal and workflow-command control text | Human and GitHub outputs escape/bound it |
| `sec-011` | M1 | Source map is absolute or contains `..` | Configuration rejected before scanning |
| `sec-012` | M1 | Request budget is exhausted during rule planning | No request beyond budget; typed whole-scan policy result |
| `sec-013` | M3 | Remote hostname resolves to `127.0.0.1` | Public policy rejects all loopback destinations |
| `sec-014` | M3 | Remote hostname resolves to `::1` or IPv4-mapped loopback | Public policy rejects both forms |
| `sec-015` | M3 | Remote hostname resolves to link-local or cloud metadata address | Public policy rejects before connection |
| `sec-016` | M3 | Resolver returns one public and one private answer | Entire mixed set rejected |
| `sec-017` | M3 | First resolution is public; a later redirect resolution is private | Redirect blocked after fresh resolution |
| `sec-018` | M3 | Authorized hostname attempts DNS rebinding between validation and connect | Pinned connection uses only the authorized address or aborts |
| `sec-019` | M3 | Public response redirects directly to private IP literal | Redirect rejected before connection |
| `sec-020` | M3 | URL contains user information or a non-HTTP scheme | Configuration/request rejected before DNS |
| `sec-021` | M3 | Redirect loop or chain exceeds five hops | Typed redirect-limit result; no sixth follow |
| `sec-022` | M3 | Small compressed body expands beyond decoded limit | Streaming abort at decoded cap |
| `sec-023` | M3 | Server stalls headers/body past configured deadlines | Typed timeout; all resources released |
| `sec-024` | M3 | Environment defines HTTP proxy and cookie/auth variables | Target request ignores ambient proxy credentials and sends no ambient secrets |

M3 must add individual special-use ranges from the IANA registries to the
IP-classification table. The table above names behavior families; the test
implementation should use table-driven address cases for IPv4, IPv6, mapped
addresses, unspecified, multicast, documentation, benchmarking, and reserved
ranges.

## 14. Reporter-only fixtures

Reporter test data may reuse protocol reports but must include these synthetic
cases:

- all six statuses in one report;
- multiple findings under one rule;
- non-ASCII text and XML/Markdown metacharacters;
- maximum accepted message length and truncation marker;
- safe source map and each rejected path form;
- no source map for a remote finding;
- two reports with a regression, improvement, evidence-only change, and
  incompatible ruleset version;
- fixed volatile metadata envelope and canonical report without it.

Reporter fixtures never need a server.

## 15. Manifest validation rules

The fixture build fails unless:

- every ID is lowercase ASCII, stable, and unique;
- every deployable ID is a valid DNS label no longer than 63 characters;
- every route path is absolute and contains no uncontrolled wildcard;
- redirect targets are literal manifest values and pass an allowlist;
- expected rule, mode, profile, assertion, and status are known;
- body bytes are bounded at build time;
- each protocol rule has valid, invalid, absent/ambiguous, and media/version
  cases where applicable;
- each override declares its intended changed assertions;
- fixture metadata contains no credentials or real third-party endpoint;
- the generated manifest is stable across two builds.

## 16. Completion ledger

When implementation begins, maintain this table in the same pull request as
fixture additions:

| Family | Planned | Implemented locally | Worker parity | Contract passing |
| --- | ---: | ---: | ---: | ---: |
| Robots | 6 | 0 | 0 | 0 |
| Sitemap | 6 | 0 | 0 | 0 |
| Link | 6 | 0 | 0 | 0 |
| Markdown | 6 | 0 | 0 | 0 |
| AI crawler | 6 | 0 | 0 | 0 |
| Content Signals | 6 | 0 | 0 | 0 |
| API Catalog | 6 | 0 | 0 | 0 |
| Agent Skills | 7 | 0 | 0 | 0 |
| **Protocol total** | **49** | **0** | **0** | **0** |
| Security/boundary | 24 | 0 | not deployable | 0 |

Do not update a zero until the named case exists and its expected assertions
pass. `PROJECT_STATUS.md` remains the public source of shipped capability.
