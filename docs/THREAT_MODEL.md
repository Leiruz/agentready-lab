# AgentReady Lab Threat Model

- Document status: Proposed
- Project phase: 0 — implementation blueprint
- Snapshot date: 2026-08-28
- Applies to: planned `0.1.x` implementation and later remote-scan work

## 1. Purpose

AgentReady Lab requests and parses content controlled by website operators. A
target can choose its URL syntax, DNS answers, redirects, response timing,
headers, compression, body bytes, discovery links, and protocol documents.
Every one of those inputs is hostile until it has passed the relevant boundary.

The primary security objective is:

> Scanning an attacker-controlled site must not give that attacker access to a
> network, credential, file, privilege, or amount of compute that the scanner
> would not otherwise expose.

This document defines release-blocking controls for local preview, the planned
public remote Node transport, CI, parsers, reporters, and the software supply
chain. It also records additional requirements that apply before a public
multi-user hosted scanner or browser observation can exist.

The words **must**, **must not**, **should**, and **may** describe project
requirements, not requirements copied from an external protocol.

## 2. Product boundary

AgentReady Lab evaluates protocol conformance and interoperability evidence. It
does not establish that a target is safe, honest, authorized, or suitable for
an agent to trust.

The MVP must not:

- execute an advertised Agent Skill, MCP tool, WebMCP operation, API method, or
  shell command;
- perform OAuth authorization, token exchange, registration, or login;
- initiate a purchase, payment, wallet, or other state-changing operation;
- submit forms or use HTTP methods other than `GET` and `HEAD`;
- authenticate to a target or accept target credentials;
- crawl an entire site or enumerate every sitemap entry;
- unpack a downloaded archive;
- load executable third-party rule plugins;
- run a headless browser;
- scan arbitrary private networks; or
- operate a public multi-user scanner.

Future work that changes one of these boundaries requires a security review and
an accepted architecture decision record before implementation.

## 3. Security goals

### 3.1 Network isolation

The `ci-public` and future `hosted-public` profiles can connect only to a
definitely public global-unicast destination. Validation, name resolution,
address selection, connection, and redirect handling form one security
operation.

### 3.2 Resource containment

No target can make a scan exceed fixed request, redirect, socket, elapsed-time,
header, compressed-byte, decompressed-byte, parser, evidence, or report limits.

### 3.3 Non-execution of target content

Target bytes remain data. They cannot become JavaScript, shell syntax, regular
expressions, JSON Schema code, XML entities, Claude Code instructions, GitHub
workflow commands, or browser-executed content.

### 3.4 Least privilege in CI

A scan triggered by an untrusted pull request has no secrets, no release
credentials, no OIDC capability, and no write-capable repository token.

### 3.5 Evidence minimization

Reports contain only bounded, sanitized evidence needed to explain a verdict.
Raw bodies, cookies, authorization material, and unredacted query values are
neither persisted nor emitted.

### 3.6 Supply-chain integrity

Published packages and Action bundles can be traced to reviewed source and a
protected build. Dependencies, workflow actions, generated bundles, schemas,
and releases are pinned and reviewable.

## 4. Assets at risk

- Workload and cloud-instance metadata credentials
- Localhost and private services reachable from a developer or runner
- Databases, control planes, internal dashboards, and service bindings
- GitHub `GITHUB_TOKEN`, repository secrets, and OIDC tokens
- npm publishing authority and GitHub release authority
- Developer files, environment variables, cookies, and credentials
- Hosted-service secrets, result storage, and tenant separation
- Scanner CPU, memory, sockets, file descriptors, and bandwidth
- A target site's availability and request budget
- Users who view terminal, Markdown, SARIF, JUnit, or future HTML reports
- The project's reputation and the reliability of its conformance claims

## 5. Adversary model

Assume an attacker can:

- supply an arbitrary target string to a CLI or future hosted API;
- control public DNS, return many answers, use CNAMEs, set a zero TTL, and
  change answers between lookups;
- use legacy, encoded, Unicode, mixed IPv4/IPv6, or ambiguous URL forms;
- return an arbitrary redirect chain, including relative and cross-origin
  redirects;
- return malformed or conflicting HTTP framing and oversized headers;
- delay DNS, connection, TLS, headers, or body bytes indefinitely;
- return compression bombs or nested content encodings;
- return hostile HTML, Markdown, JSON, XML, link headers, and text encodings;
- advertise arbitrary URLs from discovery documents;
- include secrets, terminal escapes, Markdown, HTML, and GitHub command syntax
  in any response field;
- open a pull request that changes source, configuration, fixtures, lockfiles,
  workflows, branch names, issue text, or report inputs;
- poison a shared cache or artifact used by a later privileged workflow;
- attempt to compromise or typo-squat a dependency; and
- cause a future browser check to execute hostile JavaScript and initiate
  subresource, WebSocket, WebRTC, service-worker, or download traffic.

The design does not assume that a syntactically valid standards document is
benign.

## 6. Trust boundaries

| Boundary | Untrusted input | Protected component |
| --- | --- | --- |
| CLI/configuration | URL, config file, environment | Schema validation and composition layer |
| URL/network | URL, DNS, redirect, peer | `packages/transport-node` |
| HTTP/parser | Headers, framing, encodings, body | Bounded response and pure parsers |
| Rule evaluation | Normalized observations | Deterministic core engine |
| Reporting | Evidence and target-controlled text | Pure reporters and output escaping |
| GitHub Actions | PR source and GitHub contexts | Minimal-permission workflow and Action |
| Release | Dependencies, workflow, generated bundle | Protected reproducible publication |
| Future hosted API | Anonymous requester and target | Authentication, quotas, egress, storage |
| Future browser | Hostile active page | Disposable sandbox and controlled egress |

## 7. Non-negotiable invariants

| ID | Requirement |
| --- | --- |
| SEC-ARCH-01 | Rules and core code never call global `fetch`, DNS, or sockets. |
| SEC-ARCH-02 | `transport-node` is the only public-target network boundary. |
| SEC-NET-01 | Public profiles allow only definitely public global-unicast destinations. |
| SEC-NET-02 | Resolve, classify, pin, connect, and verify the peer as one operation. |
| SEC-NET-03 | Every redirect and discovered URL repeats the full policy. |
| SEC-NET-04 | Ambient proxy variables cannot alter target traffic. |
| SEC-HTTP-01 | The MVP emits only fixed, non-mutating `GET` and `HEAD` requests. |
| SEC-HTTP-02 | No cookies, user authorization, proxy authorization, or client certificate is attached. |
| SEC-BUDGET-01 | Every scan has hard time, request, redirect, byte, and concurrency limits. |
| SEC-PARSE-01 | Parsers cannot execute code or resolve external resources. |
| SEC-OUTPUT-01 | Raw bodies and sensitive headers never enter persistent logs or reports. |
| SEC-CI-01 | Untrusted PR jobs receive no secrets and use read-only permissions. |
| SEC-LOCAL-01 | `local-loopback` is exact-loopback and same-origin. |
| SEC-BROWSER-01 | Browser observation stays disabled until an equivalent egress boundary is reviewed. |

These controls are release blockers, not optional hardening ideas.

## 8. Architectural enforcement

The dependency rules in [ARCHITECTURE.md](ARCHITECTURE.md) are security
boundaries:

- `packages/core` remains runtime-neutral and imports no Node network,
  filesystem, environment, process, or subprocess APIs.
- `packages/rules-standard` receives observations through injected interfaces.
  It cannot fetch, resolve, read files, inspect environment variables, execute
  commands, or create randomness.
- `packages/transport-node` owns URL policy, resolution, address
  classification, connection pinning, redirect handling, and response budgets.
- `packages/reporters` performs pure transforms of a frozen normalized report.
- `packages/cli` and `packages/github-action` compose packages but contain no
  protocol assertions or alternate fetch implementation.
- `apps/fixtures-worker` serves only manifest-defined cases and never proxies a
  query-supplied destination.

The planned transport modules are:

```text
packages/transport-node/src/
├── safe-fetcher.ts
├── resolver.ts
├── url-policy.ts
├── ip-policy.ts
├── network-policy.ts
├── redirects.ts
├── bounded-body.ts
└── budget.ts
```

The repository must enforce restricted imports so a new rule cannot bypass the
transport. All discovered URLs must re-enter the same `SafeFetcher` path.

A Web `fetch()` preceded by a separate DNS check is not an acceptable remote
transport. The HTTP implementation can perform another lookup after validation,
which creates a time-of-check/time-of-use DNS-rebinding vulnerability.

## 9. Network policy profiles

These transport policies are separate from rule profiles such as `content` or
`agent-service`.

| Transport policy | Permitted destination | Link policy |
| --- | --- | --- |
| `local-loopback` | Exact user-supplied loopback origin and port | Redirects and discoveries remain same-origin |
| `ci-public` | HTTP(S), public global-unicast, ports 80 and 443 | Every hop is revalidated; discovery remains bounded |
| Future `hosted-public` | HTTP(S), public global-unicast, scheme-default port only | Every hop is revalidated; anonymous quotas also apply |
| Future `private-explicit` | Exact locally approved host/IP and port | Exact allowlist only; unavailable to hosted callers |

There must be no general `--disable-ssrf` or `--allow-all-private` switch.

`private-explicit`, if later approved, must still reject link-local, metadata,
multicast, broadcast, unspecified, and reserved destinations. It must be a local
CLI capability, never a remotely selectable hosted option.

## 10. SafeFetcher state machine

`SafeFetcher` must implement the following operation:

1. Reserve one request from the whole-scan budget.
2. Parse and canonicalize the input with the WHATWG URL model.
3. Apply scheme, authority, hostname, port, and network-profile policy.
4. Resolve all A and AAAA addresses through the selected resolver.
5. Classify every answer under the active network policy.
6. Reject the hostname if any answer is outside the permitted class.
7. Select an address only from the validated result set.
8. Connect directly to that address without another name lookup.
9. Preserve the canonical hostname for HTTP `Host`, TLS SNI, and certificate
   hostname validation.
10. Confirm the connected peer equals the selected canonical address.
11. Send a fixed `GET` or `HEAD` with automatic redirects disabled.
12. Enforce header, elapsed-time, compressed-byte, and decompressed-byte limits
    while streaming.
13. If the response redirects, discard its body/connection, resolve `Location`
    against the current canonical URL, and restart at step 2.
14. Return a bounded observation containing safe metadata and bytes.

Connection pools must not be shared across tenants or unrelated scans. The MVP
may use HTTP/1.1 only, avoiding HTTP/2 connection coalescing and server-push
complexity until those behaviors receive tests.

## 11. URL policy

Use one WHATWG-compatible parser and canonical URL representation for both the
policy decision and structured connection request. Never validate with a regex
or RFC parser and then send the original string to a differently behaving
client.

The policy must:

- accept only absolute `http:` and `https:` URLs;
- reject empty hosts;
- reject URL username and password fields, including encoded forms;
- reject raw NUL, CR, LF, C0/C1 controls, and invalid Unicode;
- impose a raw-input length limit, initially 2,048 UTF-8 bytes;
- remove fragments and report that they were ignored;
- canonicalize domains to lowercase ASCII/IDNA form;
- normalize a trailing DNS root dot for security comparisons;
- reject IPv6 zone identifiers;
- reject IANA special-use domain names and their subdomains in public profiles;
- reject single-label names in public profiles;
- permit only ports 80 and 443 in `ci-public`;
- require the scheme's standard port in future anonymous hosted scans;
- derive `Host` from the canonical URL rather than caller input;
- resolve relative redirect and discovery references with the same URL parser;
  and
- keep decoded path data out of request headers and authority components.

The WHATWG URL model accepts legacy IPv4 spellings. IP classification must occur
after canonical parsing so none of these bypass the address policy:

```text
127.1
2130706433
0x7f000001
0177.0.0.1
%31%32%37.0.0.1
127。0。0。1
[::ffff:127.0.0.1]
```

Percent-encoded CR or LF in a path must remain path data. It must never be
decoded and interpolated into a raw HTTP request.

## 12. DNS and IP policy

### 12.1 Source of truth

The IP classifier should use a reviewed, generated snapshot of the IANA IPv4
and IPv6 special-purpose registries. A scheduled check may report registry
changes, but it must not silently change production behavior without review.

Public profiles permit an address only if it is definitely public global unicast.
Conservative over-blocking is preferable to treating an unknown range as
public.

The classifier must deny:

- IPv4 and IPv6 loopback;
- RFC 1918 private IPv4;
- IPv6 unique-local addresses;
- IPv4 and IPv6 link-local ranges;
- carrier-grade NAT shared address space;
- unspecified and "this network" addresses;
- multicast and limited/global broadcast ranges;
- documentation and benchmarking ranges;
- reserved and IANA special-purpose ranges;
- IPv4-mapped or compatible IPv6 that contains a denied IPv4;
- NAT64 or transition forms that can represent a denied IPv4;
- IPv6 zone-scoped addresses; and
- any value the classifier cannot parse unambiguously.

### 12.2 Resolution

- Resolve A and AAAA.
- Reject the entire hostname if any answer is unsafe. Do not choose a public
  answer from a mixed public/private set.
- Limit a hostname to 16 total returned addresses.
- Apply a DNS deadline of two seconds.
- Bound explicit CNAME traversal to eight links.
- In a hosted environment, use an intentional resolver outside internal
  split-horizon DNS.
- Treat NXDOMAIN, timeout, malformed replies, excessive answers, and ambiguous
  scope as typed failures.

Node's `dns.lookup()` can use `/etc/hosts`, NSS, and other operating-system name
services. `dns.resolve*()` performs DNS queries. The selected behavior must be
explicit and covered by tests rather than inherited accidentally.

### 12.3 Connection pinning

The validated address set must be supplied directly to the connector. Calling a
normal hostname-based `fetch()` after validation is prohibited.

For HTTPS:

- connect to the selected validated IP;
- send SNI for the original canonical hostname;
- validate the certificate against that hostname; and
- retain the original hostname in `Host`.

After connection, compare the peer address to the selected canonical IP. A
mismatch fails closed before response processing.

Every new connection, redirect target, and discovered resource repeats the
policy. A DNS result may be reused only within its TTL and only when all cached
addresses were already classified as safe.

### 12.4 Network defence in depth

A future hosted remote scanner must run with:

- no route to production private networks;
- no access to instance or workload metadata;
- no cloud or deployment credentials in the scan process;
- egress firewall denial of special-purpose ranges;
- DNS access only to the chosen resolver;
- no Docker or Unix-domain-socket mount;
- a non-root user and minimal filesystem; and
- per-process socket and file-descriptor limits.

Application validation and infrastructure isolation are both required.

## 13. Redirect policy

Automatic redirects must be disabled.

For each redirect:

- permit at most five hops per observation;
- resolve `Location` relative to the current canonical URL;
- repeat URL, scheme, port, DNS, IP, and scope checks;
- reject non-HTTP(S) locations;
- reject credentials in the new URL;
- require exact same-origin in local-loopback scope;
- reject HTTPS-to-HTTP downgrade by default and record a safe diagnostic;
- never carry authorization, proxy authorization, cookies, or client
  certificates;
- discard rather than fully read an unneeded redirect body;
- detect loops using canonical URLs;
- ignore `Refresh` and HTML meta-refresh as navigation;
- ignore links in `103 Early Hints`; and
- reject `101 Switching Protocols`, CONNECT tunnels, and WebSocket upgrades.

A cross-origin public redirect, if allowed by the selected observation, receives
only the fixed anonymous scanner headers and is fully revalidated.

## 14. Proxy and ambient-environment policy

The transport must not silently honor:

```text
HTTP_PROXY
HTTPS_PROXY
ALL_PROXY
NO_PROXY
```

A proxy can resolve a hostname independently and invalidate address pinning.
Target requests must use an explicit connector/dispatcher.

Proxy support is outside the MVP. A future enterprise proxy mode must identify
the proxy as a trusted enforcement boundary and document that peer-IP checks
occur there.

Hosted and CI environments must also prevent ambient TLS settings from
weakening verification. `NODE_TLS_REJECT_UNAUTHORIZED=0` must not be honored,
and a hosted process must not inherit an unexpected custom CA bundle.

## 15. TLS requirements

- A bare domain defaults to HTTPS.
- A TLS failure must not trigger silent HTTP fallback.
- Certificate-chain, expiration, and hostname verification remain enabled.
- The minimum supported TLS version is 1.2.
- SNI and hostname verification use the canonical hostname, not the pinned IP.
- `ci-public` and `hosted-public` scans accept no client certificate or custom
  trust configuration.
- Invalid TLS produces a typed network observation and normally an
  `unable-to-check` rule result; it is not retried insecurely.
- Local preview should use HTTP or an explicit local CA file.
- A future skip-verification option, if accepted at all, is interactive and
  local-only, prominently warns the user, and is unavailable to CI remote or
  hosted callers.

HTTP remains usable when explicitly requested because the scanner must diagnose
plain-HTTP development origins. No credentials are ever sent over it.

## 16. Resource budgets

The initial defaults are defined by the implementation specification:

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

Supporting limits should include:

| Budget | Initial bound |
| --- | ---: |
| Raw target URL | 2,048 UTF-8 bytes |
| DNS answers per host | 16 |
| CNAME links | 8 |
| Response header block | 32 KiB |
| Response header count | 100 |
| Content-encoding layers | 2 |
| Final machine report | 1 MiB |

Rules may lower a limit. A rule that needs a larger limit must explain the need
and opt in explicitly. Increasing a hosted-service limit requires security
review.

Implementation requirements:

- Apply an abort signal to the whole scan and each request.
- Enforce absolute elapsed deadlines, not only socket inactivity.
- Destroy a socket after timeout, abort, malformed framing, or truncated
  decompression.
- Check `Content-Length` early but do not trust it as the only byte control.
- Count compressed and decompressed bytes while streaming.
- Never call an unlimited `arrayBuffer()`, `text()`, or parser first.
- Bound global sockets and file descriptors in addition to per-scan
  concurrency.
- Deduplicate requests only with the full representation-aware observation
  key. HTML and Markdown-negotiation requests remain distinct.
- Stop reading once sufficient evidence exists when the check permits it.
- Do not recursively follow all sitemap entries or normal page links.

When a required observation exceeds a local limit, the applicable rule returns
`unable-to-check` with a typed `budget-exceeded` reason. If the whole-scan budget
or security policy aborts the scan, the CLI uses the documented network/security
exit behavior. A truncated observation must never be interpreted as a pass or
fail.

## 17. HTTP framing and decompression

Send `Accept-Encoding: identity` by default. A malicious server can ignore that
preference, so compressed responses still require protection.

The transport must:

- use a strict HTTP parser and never enable Node's `insecureHTTPParser`;
- expose/count wire bytes rather than relying solely on an auto-decompressing
  Fetch implementation;
- support only explicitly reviewed encodings, initially `gzip`, `deflate`, and
  `br` if compression is implemented;
- reject more than two content-encoding layers;
- enforce compressed and decompressed limits simultaneously;
- stop decompression immediately at the byte or time limit;
- create a fresh decompressor per response; and
- treat invalid or truncated compressed data as malformed, not partial valid
  content.

Reject responses with:

- both `Transfer-Encoding` and `Content-Length`;
- conflicting multiple `Content-Length` values;
- invalid chunk framing;
- unsupported transfer codings;
- a header block or header count above its limit;
- prohibited header controls or obsolete folding accepted only by a lenient
  parser; or
- upgrade or tunnel semantics.

RFC 9112 warns that `Transfer-Encoding` together with `Content-Length` can
indicate request smuggling or response splitting. AgentReady Lab fails closed on
that ambiguity.

## 18. Request construction

The MVP request surface is intentionally small:

- methods are fixed to `GET` and `HEAD`;
- `Host` is derived from the canonical URL;
- `User-Agent` is fixed and identifies AgentReady Lab plus a project contact;
- `Accept` is selected from rule-owned constants;
- `Accept-Encoding` defaults to `identity`;
- no caller-supplied arbitrary headers are accepted in public profiles;
- no request body is sent;
- no cookie jar exists;
- `Set-Cookie` is never replayed;
- no authorization, proxy authorization, client certificate, or wallet is
  present; and
- no retry changes method, scheme, destination, or security policy.

The scanner observes discovery metadata. It does not invoke the operation that
the metadata advertises.

## 19. Parser safety

### 19.1 General rules

Every parser is a pure, size-bounded function over normalized bytes and
metadata.

- Parser selection follows the observation and declared media type; target
  bytes are not sniffed into an executable format.
- Parsers cannot call the network or filesystem.
- No `eval`, `Function`, dynamic import, template execution, or subprocess is
  allowed.
- HTML and Markdown scripts are never executed.
- Images, styles, fonts, scripts, embeds, and ordinary hyperlinks are never
  fetched.
- A specifically required discovered URL goes back through `SafeFetcher`.
- Attacker-controlled regular expressions are prohibited.
- Regex input is bounded and patterns over hostile text require review for
  pathological backtracking.
- Potentially expensive synchronous parsing should run in a terminable worker
  if size/depth limits cannot bound it adequately.
- Parse errors become typed observations. Raw parser exceptions and bodies do
  not enter reports.

### 19.2 JSON and JSON Schema

Initial defensive limits should include:

- maximum nesting depth of 64;
- maximum 10,000 object/array nodes;
- maximum 64 KiB for an individual key or string;
- explicit handling or rejection of duplicate security-relevant keys; and
- no unbounded recursive traversal.

Untrusted objects must not be merged into ordinary prototypes. Any merge path
must reject or neutralize `__proto__`, `constructor`, and `prototype` keys.

JSON Schemas are trusted, versioned project inputs. They should be compiled at
build time. Remote `$ref` resolution and executable custom formats are disabled.
Vendored schemas record source URL, version, license, and checksum.

### 19.3 XML and sitemaps

Use a non-validating streaming XML parser with:

- DTD processing disabled;
- external entities disabled;
- XInclude disabled;
- all network access disabled;
- maximum depth 64;
- bounded nodes and attributes; and
- early termination once the required evidence is found.

Sitemap conformance does not justify loading every URL. A document larger than
the scan limit produces `unable-to-check` with `budget-exceeded` if the required
fact cannot be established safely.

### 19.4 HTML and Markdown

- Never execute JavaScript or event attributes.
- Never load subresources.
- Prefer streaming extraction for `<head>` metadata.
- If constructing a tree, bound nodes and depth in addition to bytes.
- Treat `<base href>` and every extracted reference as untrusted.
- Do not fetch Markdown links or image targets unless a rule explicitly
  identifies that URL as a required discovery artifact.
- Use one documented UTF-8 decoding policy and expose replacement/error state.

### 19.5 Link and media-type parsers

- Parse HTTP `Link` fields with an RFC-aware parser; splitting on commas is not
  correct for all valid quoted and parameterized values.
- Parse media types case-insensitively and handle parameters separately.
- Bound token, parameter, and quoted-string lengths.
- Never interpret a header value as shell, HTML, or regular-expression syntax.

### 19.6 Archives

Downloaded Agent Skills archives are not unpacked in the MVP. Interop mode may
stream and hash a bounded artifact.

Any future unpacking requires separate controls for:

- path traversal and absolute paths;
- symlinks and hard links;
- file count and per-file size;
- compressed and expanded total size;
- nested archives;
- device files and special entries;
- permissions; and
- extraction into a disposable directory.

## 20. Evidence, output, and logging

### 20.1 Evidence minimization

Reports may include only the evidence needed to explain the assertion:

- canonical origin and normalized path;
- method;
- safe allowlisted request-header names and values;
- status;
- bounded redirect facts;
- allowlisted response headers such as `Content-Type`, `Vary`, and `Link`;
- body byte count and digest;
- a sanitized excerpt of at most 256 characters when the rule requires it; and
- typed parser, network, and budget outcomes.

Complete bodies and arbitrary response headers must not enter a report.

### 20.2 Secret handling

- Reject URL userinfo.
- Redact query values by default.
- Do not create a cookie jar.
- Never log `Authorization`, `Proxy-Authorization`, `Cookie`, `Set-Cookie`, API
  keys, client certificates, or environment variables.
- Sanitize library exception text because it may contain a raw URL.
- Keep response bodies in bounded memory only and discard them after parsing.
- Local telemetry is off by default and requires explicit opt-in.
- Debug output prints an already redacted effective configuration.

### 20.3 Output injection

Target-controlled text can attack a terminal, Markdown renderer, SARIF viewer,
JUnit consumer, or future dashboard.

Reporters must:

- remove ANSI escapes, OSC hyperlinks, C0/C1 controls, and unsafe bidirectional
  controls;
- escape HTML, Markdown, XML, and terminal output for the exact sink;
- never insert target text through `innerHTML`;
- serialize JSON and XML using libraries rather than concatenation;
- cap every message, evidence value, annotation set, and final report;
- use stable internal error codes instead of nested raw exceptions;
- validate source-map paths and reject absolute paths and `..` traversal;
- never disguise a remote URL as a source-code location; and
- make untrusted links inert or apply safe escaping and
  `rel="noopener noreferrer"` in future HTML.

The canonical normalized report is frozen before reporters receive it. A
reporter cannot rescan, mutate evidence, or alter a verdict.

## 21. GitHub Actions

The maintained example should use `pull_request`, explicit permissions, and a
GitHub-hosted runner:

```yaml
on:
  pull_request:

permissions:
  contents: read

jobs:
  agentready:
    runs-on: ubuntu-latest
    timeout-minutes: 5
```

Action requirements:

- Do not use `pull_request_target` to check out or execute pull-request code.
- Do not use a privileged `workflow_run` job to consume executable artifacts or
  caches from an untrusted job.
- Public fork PRs must not run on persistent self-hosted runners.
- Set `permissions` explicitly; the default scan needs no repository write
  permission.
- Do not request `id-token: write` for scanning.
- Do not pass repository, environment, npm, or cloud secrets to a PR scan.
- Pin third-party actions to full commit SHAs.
- Set `persist-credentials: false` on checkout where feasible.
- Never interpolate branch names, PR titles, labels, URLs, or target output into
  shell source.
- When a process must be launched, use an argument array with shell execution
  disabled.
- AgentReady configuration must not support command hooks.
- The Action consumes an already running local server or trusted preview URL;
  it does not guess and execute a project's build command.
- A loopback preview uses `local-loopback`, so a hostile preview server cannot
  redirect or advertise the scanner away from its exact origin.
- Ambient proxy variables do not affect target traffic.
- The workflow and scanner both have elapsed and output limits.
- Job Summary text is escaped and capped.
- JSON/JUnit upload is an explicit workflow step.
- SARIF is emitted only with an explicit safe source map.
- Pull-request comments are not created by default.

If a later privileged reporting workflow consumes an artifact, it must verify
the source repository, workflow, run ID, commit, artifact name, and digest. It
must extract archives without path traversal and treat the content as data.

The JavaScript Action bundle in `dist` must be generated from reviewed source
and verified in CI. It must not download executable code at runtime.

## 22. Supply-chain controls

- Commit the pnpm lockfile and use frozen-lockfile installation in CI.
- Minimize runtime dependencies, especially URL, DNS, HTTP, parser, archive,
  and report libraries.
- Disable install lifecycle scripts by default; document and allow only audited
  exceptions.
- Enable dependency review and automated dependency update proposals.
- Run CodeQL or equivalent static analysis, secret scanning, and license checks.
- Pin workflow actions to full commit SHAs.
- Protect `.github/workflows/**`, `packages/transport-node/**`, schemas,
  lockfiles, and release configuration with review.
- Vendor versioned protocol schemas; never download rule code or schemas at
  scan time.
- Disable executable third-party rule plugins in v1 and in untrusted Action
  runs.
- Verify that a clean `action:package` produces the committed Action bundle.
- Inspect `npm pack` contents and exclude fixtures, secrets, and unnecessary
  development files.
- Publish npm packages with npm trusted publishing/OIDC instead of a long-lived
  `NPM_TOKEN`.
- Generate package provenance and an SPDX or CycloneDX SBOM.
- Protect release tags and use a reviewed release environment.
- Require npm account 2FA for package and account changes.
- Publish a `SECURITY.md` with a private disclosure path and supported-version
  policy.
- Run scheduled URL/parser fuzzing and the adversarial network suite.

Provenance does not prove that source is safe, but it makes the source, workflow,
and build used for a release verifiable.

## 23. Local-preview safety

Local preview is the first product workflow and uses a deliberately narrower
network policy.

- The user must select `local-loopback` explicitly.
- The target resolves only to `127.0.0.0/8` or `::1`.
- Every answer for a name such as `localhost` must be loopback.
- The connection is pinned to the validated loopback address.
- Only the exact user-supplied origin and port are permitted.
- Redirects and discovered resources remain same-origin.
- Proxy environment variables are ignored.
- The scanner does not launch arbitrary repository commands.
- Configuration is declarative and schema-validated; JavaScript configuration
  is not loaded as code.
- HTTP is preferred for a development server; an explicit local CA is safer
  than globally disabling TLS validation.

A future named private development host requires a dedicated policy and tests.
It must use an exact host/IP and port allowlist. Link-local and metadata
destinations remain denied.

If a local dashboard is later added, it must bind only to loopback, validate
inbound `Host` and `Origin`, use a random per-session CSRF token, disable CORS,
and never expose a remote arbitrary-target control API.

## 24. Browser observation

Browser observation is outside the MVP. Browser APIs are not a convenient
exception to the network policy.

Before enabling a browser, the design must:

- run every scan in a disposable sandbox/container;
- run non-root with no capabilities, read-only filesystem, and temporary
  storage;
- enforce seccomp/AppArmor plus process, CPU, memory, and wall-time limits;
- keep Chromium's own sandbox enabled and fail if `--no-sandbox` is required;
- install no extensions and mount no credentials, host files, or Docker socket;
- use a fresh browser context with no cookies or prior state;
- disable downloads, popups, permissions, service workers, WebRTC,
  WebTransport, QUIC, and uncontrolled UDP;
- keep DevTools unreachable;
- route navigation, subresources, redirects, iframes, WebSockets, and all other
  browser traffic through an equivalent protected egress boundary;
- limit viewport, screenshot, trace, and artifact sizes; and
- destroy the complete environment after each scan.

Browser request interception alone is not a security boundary: name resolution
and alternate browser protocols can bypass application callbacks. Infrastructure
egress enforcement remains necessary.

## 25. Future hosted service

The implementation specification defers a public multi-user scanner. Serving
the project's own fixed fixtures from a Worker does not authorize accepting
arbitrary target URLs.

Before public scanning, the service needs:

- a separately reviewed `hosted-public` egress design;
- an authentication and authorization model;
- a privacy policy covering submitted URLs, requester data, storage, retention,
  deletion, subprocessors, and result visibility;
- per-requester, per-origin, and global rate limits;
- one active anonymous scan per requester;
- deduplication/single-flight for the same target;
- caching keyed by canonical URL, request variant, ruleset, and policy version;
- per-origin request-rate and concurrency limits;
- proof of target control for higher-frequency or deeper scans;
- fixed methods, headers, standard ports, and scan budgets;
- no custom request body, authorization, callback, or proxy option;
- an identifiable user agent and abuse contact;
- handling for `429`, `Retry-After`, and target opt-out;
- derived findings only, never a raw-body proxy;
- unguessable scan identifiers and authorization for private results;
- sanitized stored output and a restrictive dashboard CSP; and
- operational circuit breakers and an incident-response process.

Ownership proof may permit higher rate limits. It must never relax destination
address restrictions.

## 26. Failure semantics

Security failures must be typed and deterministic. Example transport reason
codes include:

```text
invalid-url
prohibited-scheme
credentials-in-url
unsafe-port
dns-failure
dns-timeout
unsafe-address
mixed-address-scope
peer-address-mismatch
tls-failure
redirect-blocked
redirect-limit
timeout
malformed-http
response-too-large
decompression-failure
parse-failure
budget-exceeded
```

The rule status remains the vocabulary defined by the implementation
specification:

- If a rule applies but a network, parser, environment, or local budget
  prevents a verdict, report `unable-to-check` with a typed reason such as
  `budget-exceeded`.
- Use `unsupported-runtime` when the selected runner cannot observe the surface
  at all, such as a browser-only mechanism while browsers are disabled.
- Use `not-applicable` only when the rule genuinely does not apply to the
  selected profile.
- Do not convert a blocked request, timeout, truncation, invalid TLS, or parser
  error into protocol `fail`.
- A global security or whole-scan budget condition may abort the scan using the
  documented CLI exit code.

Raw exceptions do not cross the transport boundary.

## 27. Adversarial test strategy

Tests use injected resolvers, connectors, clocks, byte streams, and local
canaries. They must never probe a real cloud metadata endpoint or an unowned
third-party system.

### 27.1 URL canonicalization tests

Each unsafe target must fail before a socket opens:

```text
http://127.0.0.1/
http://127.1/
http://2130706433/
http://0x7f000001/
http://0177.0.0.1/
http://%31%32%37.0.0.1/
http://[::1]/
http://[::ffff:127.0.0.1]/
http://[64:ff9b::7f00:1]/
http://[fe80::1%25eth0]/
http://169.254.169.254/
http://100.100.100.200/
http://metadata.google.internal/
http://user:pass@example.com/
http://example.com@127.0.0.1/
file:///etc/passwd
gopher://127.0.0.1/
ftp://127.0.0.1/
data:text/plain,hello
javascript:alert(1)
```

Also test:

- Unicode full stops and IDNA conversion;
- trailing DNS root dots;
- backslashes and ambiguous authority separators;
- raw NUL and control characters;
- oversized URLs;
- empty host and malformed port;
- private, documentation, benchmark, multicast, and reserved ranges;
- percent-encoded CR/LF remains path data and cannot inject a header; and
- one known public IPv4 and IPv6 fixture passes classification.

### 27.2 DNS and rebinding tests

- Public-only A/AAAA answers pass.
- Private-only answers fail.
- A mixed public/private result fails in full.
- A first lookup returns public and a hypothetical second returns private; the
  connector uses the pinned first set and performs no second lookup.
- A zero-TTL response remains pinned for its current connection.
- AAAA-only unsafe answers fail.
- IPv4-mapped IPv6 is classified by its embedded IPv4.
- More than 16 answers fails safely.
- Resolver timeout and malformed replies fail closed.
- CNAME loops and chains beyond the limit fail.
- A peer address different from the selected IP fails before processing.
- Loopback and private canaries observe zero connections in public-profile tests.

### 27.3 Redirect tests

- A relative same-origin redirect succeeds.
- A redirect to loopback, private, link-local, or metadata fails before a
  connection.
- A redirect hostname that rebinds fails.
- More than five redirects yields `redirect-limit`.
- Canonical loop detection terminates a cycle.
- HTTPS-to-HTTP downgrade is blocked.
- Userinfo and non-HTTP redirect schemes are blocked.
- A cross-origin redirect receives no cookie or authorization.
- A large redirect body is not consumed.
- `103 Early Hints`, `Refresh`, and meta-refresh do not cause requests.
- `101` and WebSocket upgrade fail safely.
- Local-loopback cannot redirect away from the exact origin.

### 27.4 HTTP and resource tests

- Oversized declared `Content-Length` aborts before reading the body.
- An endless chunked body stops at elapsed/byte limits.
- Slow headers hit the header/request deadline.
- Slow body bytes hit the request deadline.
- A gzip/Brotli bomb stops at the decompressed limit.
- Excessive nested encoding is rejected.
- Invalid compressed content yields a controlled failure.
- Header blocks over 32 KiB and more than 100 headers fail.
- `Transfer-Encoding` plus `Content-Length` fails.
- Conflicting `Content-Length` values fail.
- Invalid chunk framing destroys the connection.
- Cancellation closes sockets, streams, and parser workers.
- Total request, concurrency, time, and decoded-byte budgets cannot be
  exceeded.
- A local cap produces `unable-to-check` with `budget-exceeded`, never a false
  conformance verdict.

### 27.5 Parser tests

- JSON depth beyond 64 fails within budget.
- Excessive JSON nodes and strings fail within budget.
- `__proto__` input cannot pollute global objects.
- Duplicate security-relevant JSON keys are rejected or handled explicitly.
- A remote JSON Schema `$ref` creates no network request.
- XML external entities cannot read a file or open a socket.
- Billion Laughs and DTD payloads do not expand.
- Excessively deep XML, HTML, and Markdown remain within memory/time limits.
- `<base href>` pointing at a private address cannot bypass `SafeFetcher`.
- Markdown images and ordinary links are not fetched.
- Catastrophic-regex-shaped input completes within its budget.
- Invalid UTF-8 follows the documented controlled policy.
- Malformed Link and media-type headers do not crash the process.

### 27.6 Output and privacy tests

- ANSI and OSC sequences render inertly.
- HTML, Markdown, XML, and GitHub command payloads are escaped.
- A unique marker placed in `Set-Cookie`, a query, an authorization header, and
  the response body never appears in logs or reports.
- Evidence truncates at 256 characters and reports truncation state.
- Library errors containing a raw URL are sanitized.
- Source-map absolute paths and `..` are rejected.
- Reporters cannot mutate the frozen canonical report.
- Report serialization is stable and capped.

### 27.7 GitHub Actions tests

- A PR title such as `$(touch /tmp/pwned)` is never executed.
- PR-controlled configuration cannot reach a private canary.
- A hostile loopback preview cannot redirect outside its exact origin.
- The PR job has no secrets, OIDC permission, or write-capable token.
- No `pull_request_target` job checks out or executes PR content.
- Third-party actions in maintained workflows are pinned to full SHAs.
- Untrusted archive paths cannot escape an artifact extraction directory.
- Untrusted executable caches/artifacts are not consumed by release jobs.
- Public fork jobs are not assigned to persistent self-hosted runners.
- Committed Action `dist` matches a clean package build.

### 27.8 Future hosted-service tests

- Per-requester and per-origin rate limits hold under concurrency.
- Identical concurrent scans collapse into one bounded outbound scan.
- One scan never exceeds its request or concurrency budgets.
- Target `429` and `Retry-After` stop or delay further requests.
- Target opt-out stops the scan.
- Anonymous results reveal no raw body or fine-grained private-network timing.
- Query values are absent from logs and unsafe cache keys.
- Target-controlled XSS renders inertly in the dashboard.
- Ownership proof does not relax network restrictions.

### 27.9 Future browser tests

- Navigation, iframe, image, Fetch, WebSocket, service worker, WebRTC, and popup
  attempts cannot reach a private canary.
- Downloads and file navigation are blocked.
- Chromium refuses to run without its sandbox.
- The browser has no secrets, host mounts, or external DevTools endpoint.
- CPU, memory, process, and time exhaustion terminates only the disposable
  browser environment.
- All browser output remains within size limits.

## 28. Security release gates

### Local-preview release

Local scanning is ready only when:

- package-boundary and restricted-import tests pass;
- invalid configuration creates zero requests;
- exact-loopback resolution and socket pinning are tested;
- local redirects and discoveries cannot leave the exact origin;
- request/time/body limits pass integration tests;
- parser entity, external-reference, and prototype-pollution tests pass;
- report secret-marker and output-injection tests pass; and
- documentation does not claim public-target safety.

### Public-transport release

`ci-public` scanning is ready only when:

- all outbound call sites are forced through `transport-node`;
- mixed-address and DNS-rebinding tests pass;
- the actual connected peer is asserted;
- every redirect repeats URL, DNS, IP, and port policy;
- private and link-local canaries observe zero connections across the full
  suite;
- ambient proxy settings cannot bypass the connector;
- TLS verification cannot be disabled by environment;
- compressed and decompressed byte limits are independently tested;
- malformed HTTP framing fails closed;
- a focused security review covers `packages/transport-node`; and
- `PROJECT_STATUS.md` explicitly marks the capability implemented.

### GitHub Action release

The Action is ready only when:

- maintained workflows use explicit minimal permissions;
- untrusted PR jobs receive no secrets or OIDC permission;
- no unsafe `pull_request_target` pattern exists;
- workflow actions are SHA-pinned;
- Action `dist` reproducibility is checked;
- shell-injection and summary-escaping tests pass; and
- publication uses a protected, provenance-producing workflow.

### Browser or hosted release

Neither capability is ready merely because a prototype works. Each requires a
separate threat-model update, accepted ADR, adversarial test suite, security
review, abuse/privacy documentation, and explicit project-status change.

## 29. Operational security

- Enable and document a working private vulnerability-reporting channel in
  `SECURITY.md`.
- Do not ask reporters to open public issues containing an unredacted exploit or
  credential.
- Assign severity based on reachable asset and default configuration, not only
  on parser behavior.
- Revoke release credentials and pause publication after suspected supply-chain
  compromise.
- Preserve only sanitized logs needed for incident investigation.
- Add regression fixtures for every confirmed vulnerability.
- Review the IANA address registries, Node LTS security status, parser
  dependencies, GitHub Action guidance, and npm publishing guidance regularly.
- Update this document whenever a new transport, parser, executable file type,
  authentication mode, plugin model, browser, hosted surface, or state-changing
  check is proposed.

## 30. Residual risks

Even after these controls:

- a public site can consume the bounded request and parsing budget;
- DNS and routing infrastructure can fail in ways reported as
  `unable-to-check`;
- protocol conformance does not prove the advertised endpoint is honest;
- a developer who explicitly authorizes a future private target remains
  responsible for permission to scan it;
- supply-chain provenance identifies the build inputs but does not prove they
  are vulnerability-free; and
- browser sandbox escapes remain possible, which is why browser observation is
  deferred and requires layered containment.

The response to residual uncertainty is a bounded, explainable
`unable-to-check` result, not a guessed verdict or a weakened security policy.

## 31. Primary references

- [OWASP Server-Side Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [IANA IPv4 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv4-special-registry)
- [IANA IPv6 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv6-special-registry)
- [IANA Special-Use Domain Names Registry](https://www.iana.org/assignments/special-use-domain-names)
- [WHATWG URL Standard](https://url.spec.whatwg.org/)
- [RFC 3986: URI Generic Syntax](https://www.rfc-editor.org/rfc/rfc3986.html)
- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)
- [RFC 9112: HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9112.html)
- [Node.js DNS documentation](https://nodejs.org/api/dns.html)
- [Node.js HTTP documentation](https://nodejs.org/api/http.html)
- [Node.js zlib documentation](https://nodejs.org/api/zlib.html)
- [GitHub Actions secure-use reference](https://docs.github.com/en/actions/reference/security/secure-use)
- [GitHub guidance for `pull_request_target`](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)
- [GitHub self-hosted runner warning](https://docs.github.com/actions/hosting-your-own-runners/adding-self-hosted-runners)
- [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [SLSA build requirements](https://slsa.dev/spec/v1.2/build-requirements)
- [Chromium/Puppeteer sandbox guidance](https://developer.chrome.com/docs/puppeteer/troubleshooting)
- [Cloudflare Workers TCP socket restrictions](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)

## 32. Related project documents

- [Implementation specification](IMPLEMENTATION_SPEC.md)
- [Architecture](ARCHITECTURE.md)
- [Project status](../PROJECT_STATUS.md)
- [README](../README.md)
