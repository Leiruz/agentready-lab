# ADR-0006: Local fixture host model

- Status: Accepted
- Decision date: 2026-08-29
- Owners: Initial maintainers
- Applies from: M1

## Context

`docs/FIXTURE_CATALOG.md` section 2.2 gives fixture hostnames derived from the
fixture ID:

```text
md-003.fixture.test
api-004.fixture.test
```

No fixture can be reached at those names under the project's own network policy.

`docs/THREAT_MODEL.md` section 23 permits only the exact user-supplied loopback
origin, requires that every answer for a name such as `localhost` be loopback,
and permits only the exact origin and port. `.test` is an IANA special-use
top-level domain (RFC 6761 section 6.2) and has no answers at all, so a
`local-loopback` scan of `md-003.fixture.test` fails at resolution.

Section 11 separately rejects "IANA special-use domain names and their
subdomains in public profiles", so the same names could never be used by the
`ci-public` transport either.

Making the names resolve requires either a hosts-file entry or a resolver
override. Section 12.2 requires the name-resolution path to be explicit and
covered by tests "rather than inherited accidentally", which a machine-local
hosts entry is not: it is ambient host state, invisible to the test, and
different on every developer machine and CI runner.

The catalog does leave room to change this. Section 2.2 introduces the names
with "for example", section 2.3 says "The precise TypeScript helper can change
during M1", and `docs/ARCHITECTURE.md` section 13 says "Example names in
documents are illustrative and must not be deployed verbatim".

### The first accepted revision could not express its own mandatory fixtures

The first revision compiled every fixture to one pure
`(request: Request) => Response` handler, shared by a Node adapter and a Workers
adapter, and required the manifest validator to reject any `Location` value that
was not a compile-time constant resolving to a route in the same manifest.
Adversarial review on 2026-08-29 showed that those two rules together make three
mandatory M1 security fixtures and two mandatory M1 protocol fixtures
inexpressible. The review was correct on both counts.

**Redirect-policy cases cannot name their targets.** `FIXTURE_CATALOG.md`
section 13 requires `sec-003` to redirect a loopback target to another loopback
port, `sec-004` to redirect `127.0.0.1` to `localhost`, and `sec-005` to
redirect a local target to an RFC1918 LAN address. The first needs a port that
does not exist until the operating system assigns it, so it cannot be a
compile-time constant. All three deliberately must not resolve to a route the
same manifest defines, because the whole expectation is that the scanner blocks
the redirect before reaching anything. The validator rule forbids exactly the
`Location` values these cases exist to produce.

**A `Response` cannot carry two physical `Link` field lines.** Verified on
Node v24.18.0: two `Headers.append("Link", ...)` calls wrapped in a `Response`
produce exactly one `link` entry when the headers are iterated, whose value is
the two field values joined with `", "`. No standard accessor returns the two
values separately; `getSetCookie()` exists only for `Set-Cookie`. So a handler
that returns a normalized `Response` has no way to emit two field lines, and
ADR-0002's `ReadonlyMap<string, readonly string[]>` observation shape can never
receive two entries from one.

That matters for two mandatory cases. `lnk-001`'s stated purpose is "Preserve
and parse multiple fields" and requirement `links.parse` is normative about
"multiple field lines". If the fixture host collapses the two lines before the
scanner ever sees them, the case passes without exercising the behavior it
exists to test, and the general assertion in `FIXTURE_CATALOG.md` section 4 that
an override changes only its declared assertions cannot detect a vacuous pass.

The precision is worth keeping. For a well-formed value, joining with `", "` is
the RFC 9110 field-combining rule and a conformant RFC 8288 parser recovers both
links from the combined form, including `lnk-002`'s quoted title containing a
comma. The combining is not semantically lossy there; it is the wire condition
that is lost. Combining does destroy content once a field line is malformed,
which is the neighbouring case: appending `<https://e.test/a>; title="unclosed`
and `<https://e.test/b>; rel="service-desc"` yields one value in which the
unclosed quote swallows the second link, so `lnk-004`'s condition cannot be
composed with any other `Link` line at all.

## Decision

### 1. One ephemeral port per fixture on the literal `127.0.0.1`

The fixture harness starts one server per fixture case, binds it to
`127.0.0.1:0`, reads the port the operating system assigned, and hands the
scanner `http://127.0.0.1:<port>`.

This needs no resolver override, no hosts file, and no special-use domain. An
IPv4 literal is not resolved at all, so section 12.2's `dns.lookup()` versus
`dns.resolve()` ambiguity never arises, and section 23's requirement that every
answer be loopback is satisfied trivially.

The server binds to `127.0.0.1` explicitly. Binding to `0.0.0.0` or `::` is
forbidden: it would expose fixture cases, including deliberately malformed
responses and redirect chains, to the local network and to any other tenant on a
shared CI runner.

`[::1]` gets the same treatment for the IPv6 security fixture (`sec-002`), on a
separately bound ephemeral port.

### 2. `<id>.fixture.test` survives only as a manifest label

The name is retained in the manifest as `manifestHost`, used for two things:
uniqueness checking across cases, and routing if the optional Workers deployment
is ever configured under a domain the maintainer owns.

It is never given to a transport, never used to construct a scan target, and
never appears in a canonical report. A test that passes `manifestHost` to the
scanner is a bug, and the harness asserts that the value it hands the scanner
parses as an IP-literal origin.

### 3. Ephemeral ports and byte-identical reports

An ephemeral port appears in `target.requestedUrl`, `target.origin`,
`policy.allowedPorts`, and every evidence request URL, so two runs of the same
fixture produce different canonical bytes. This is not a determinism failure,
but it must be handled deliberately.

The origin is injected, not normalized away. The harness builds the expected
report from the manifest and the actual origin it just bound, then compares
byte for byte. Everything except the port is still an exact comparison, and no
regular expression is applied to the report.

`docs/TEST_STRATEGY.md` section 2.1 already names "random ports chosen without
injection" as the thing to avoid. Injection is the sanctioned route, and this is
it.

### 4. Two fixture layers, with an explicit boundary between them

#### Layer A: the shared `Response` handler

Ordinary protocol cases compile to a single pure function:

```ts
export type FixtureHandler = (request: Request) => Response;

export declare function createFixtureHandler(
  manifest: CompiledFixtureManifest,
): FixtureHandler;
```

It imports nothing runtime-specific: no `node:*`, no `cloudflare:*`, no Workers
globals beyond the WHATWG Fetch API types. It is synchronous, has no shared
mutable state between calls, and reads only from the compiled manifest.

Two thin adapters wrap it:

- a Node adapter that converts `IncomingMessage` to `Request` and writes
  `Response` back to `ServerResponse`. It lives in `packages/testkit`, which may
  import `node:*`, and **not** in `apps/fixtures-worker`, which
  `docs/ARCHITECTURE.md` section 4 forbids from importing a Node-only package;
- a Workers adapter that is `export default { fetch: handler }`.

Neither adapter contains fixture behavior. The general assertion in
`FIXTURE_CATALOG.md` section 4, that a case behaves identically through the
in-memory adapter and the Worker handler, is then a property of the shared
function rather than of two implementations kept in sync by review.

This is the default layer. A case belongs here unless it needs something on the
list below.

#### Layer B: the raw transport harness

A separate, deliberately non-deployable harness in `packages/testkit` writes
response bytes directly to a socket instead of building a `Response`. It serves
exactly the cases that a normalized `Response` cannot express:

| Category | M1 cases | Why layer A cannot serve it |
| --- | --- | --- |
| Redirect policy | `sec-003`, `sec-004`, `sec-005` | The `Location` target needs a runtime-injected port or a name, and must not resolve to a same-manifest route |
| Repeated header field lines | `lnk-001`, `lnk-002` | `Headers` combines repeated names into one entry |
| Malformed framing | `THREAT_MODEL.md` section 27.4 cases | `Transfer-Encoding` with `Content-Length`, conflicting `Content-Length`, and invalid chunk framing are unrepresentable in a `Response` |
| Timeouts | `sec-023` (M3) | Stalled headers and stalled body bytes are a write schedule, not a value |
| Byte-stream security | `sec-022` (M3) | A decompression bomb is a byte stream chosen to defeat the decoder |

`sec-007`, one decoded byte over the rule's cap, stays in layer A: a `Response`
with a body of exactly cap plus one byte expresses the condition, and the
streaming abort under test is the scanner's behavior, not the fixture's.

Layer B is never deployed and never reachable from the Worker.
`apps/fixtures-worker` imports the layer-A handler only, and a boundary test
asserts the raw harness module is not reachable from the Worker entry point.
Layer B binds `127.0.0.1` or `[::1]` on an ephemeral port under the same rules
as layer A, and is torn down with the case.

### 5. Symbolic redirect targets, compiled after binding

A `Location` value is declared symbolically in the manifest and resolved to a
concrete string by the harness only after the ephemeral ports for that case are
bound.

```ts
export type RedirectTarget =
  | { readonly kind: "route"; readonly path: string }
  | {
      readonly kind: "peer-server";
      readonly server: string;
      readonly path: string;
    }
  | {
      readonly kind: "loopback-name";
      readonly host: "localhost";
      readonly path: string;
    }
  | {
      readonly kind: "address-literal";
      readonly address: string;
      readonly path: string;
    };
```

The manifest validator enforces:

- a layer-A case may use `route` only, and the path must resolve to a route the
  same manifest defines. This is the original rule, unchanged, and it is what
  keeps ordinary fixtures free of open redirects;
- `peer-server` names another server the same case declares, and the harness
  substitutes the port that server actually bound;
- `loopback-name` and `address-literal` are permitted only in a layer-B case;
- any case using a non-`route` target must declare an expected result of
  blocked. A layer-B case whose expectation is that the scanner follows the
  redirect is rejected, so the harness cannot construct an open redirect that a
  scan actually traverses;
- `address-literal` values are restricted to the RFC1918 and link-local ranges
  the security catalog names, so the harness cannot be pointed at a real host.

### 6. Fixture invariants restated

These hold in both layers and are asserted by the manifest validator:

- compile-time finite cases only;
- no query-controlled response status, body, headers, or redirect destination;
- no open redirect: every redirect target is a compile-time symbolic value
  resolved under section 5, and a followed redirect resolves to a route the same
  manifest defines;
- no proxy behavior and no arbitrary upstream URL;
- unique manifest IDs and unique host labels;
- caching headers only in cases that exist to test caching;
- no secrets and no live credentials;
- a metadata endpoint may expose the fixture ID and source commit, nothing else;
- servers bind `127.0.0.1` or `[::1]` only, on an ephemeral port.

## Rationale

The fixture hostnames were a presentational convenience that quietly required
either a policy exception or ambient machine state. Removing the name removes
the exception. A loopback IP literal is the narrowest thing that can be reached
under the project's own `local-loopback` policy, and it is the same thing a real
user of the MVP will type.

Two layers rather than one is the honest shape of the problem. The cases that
need layer B are precisely the cases whose subject is the wire: a header field
line, a framing error, a redirect to somewhere the scanner must refuse to go.
A `Response` is an abstraction over the wire, so it cannot express a test whose
subject is the wire, and pretending otherwise produced two vacuous protocol
tests and three unimplementable security tests.

Keeping layer A as the default and layer B as an enumerated exception preserves
what the single-handler decision was actually for. "Local and deployed behavior
share the same handler" (`ARCHITECTURE.md` section 13) remains mechanically true
for every case that is deployable, and the cases in layer B are exactly the ones
that must never be deployed anyway.

## Consequences

### Positive

- Every fixture is reachable under the shipped `local-loopback` policy with no
  exception, resolver override, or hosts file.
- The redirect-policy fixtures `sec-003`, `sec-004`, and `sec-005` become
  implementable, and they test the real policy rather than a test-only
  relaxation.
- `lnk-001` and `lnk-002` test the wire condition they name instead of passing
  vacuously.
- CI runners and developer machines behave identically: no host state involved.
- The Workers deployment stays optional, as `ROADMAP.md` M1 already says, and
  its attack surface shrinks: layer B is structurally undeployable.

### Costs

- Two fixture-serving code paths exist, and a reviewer must know which layer a
  case belongs to. The table in section 4 is the whole answer, and the validator
  enforces it, but it is still a second thing to learn.
- Layer B cases have no Workers equivalent, so the "same handler in both
  runtimes" property covers layer A only. For layer B the property is replaced
  by a narrower one: those cases never run in a deployed context at all.
- Raw byte-level responses are written by hand, so a layer-B case is easier to
  get subtly wrong than a declarative `Response` and needs its own assertion
  that the bytes on the wire are what the case intended.
- Per-case servers cost a bind and a teardown. With 49 protocol cases plus the
  M1 security cases this is small, and cases may share a server where their
  routes do not collide.
- The expected report is constructed at test time rather than committed as a
  fully static golden file, because it contains the port.
- Readability from the fixture ID in scan output is lost. A failing case reports
  `http://127.0.0.1:53411`, so the harness must name the fixture in the
  assertion message.
- A future public deployment needs the `manifestHost` routing path, untested
  until it exists.

### Implementation constraints

- The harness asserts the scanner target is an IP-literal origin.
- The manifest validator implements section 5 in full, including the rule that a
  non-`route` target may only appear in a layer-B case expecting a block.
- A boundary test asserts `apps/fixtures-worker` cannot reach the layer-B
  module.
- A layer-B test asserts that two physical `Link` field lines arrive at the
  scanner as two entries in the observation's header map, which is the
  regression guard for the defect this revision fixes.
- `FIXTURE_CATALOG.md` section 2.2 must be rewritten to describe the loopback
  model, demote `<id>.fixture.test` to a label, and record which cases are
  layer B.
- Servers bind to `127.0.0.1` or `[::1]` only; a wildcard bind fails the suite.

## Alternatives considered

### One `Response` handler for every case

Rejected, and this was the first revision's position. The reasons are in
`## Context`: three mandatory security fixtures cannot name their redirect
targets under the validator's own rule, and two mandatory protocol fixtures
cannot produce two physical `Link` field lines through a `Headers` object.

### Relax the validator to allow arbitrary `Location` strings

Rejected. The rule that a followed redirect must resolve to a same-manifest
route is what keeps the deployable fixtures free of open redirects, and
weakening it for every case in order to serve three is the wrong direction. The
symbolic targets in section 5 give the three cases what they need while making
the constraint stronger for the rest, because a symbolic target cannot be an
arbitrary string at all.

### Represent repeated header lines as a single pre-joined value

Rejected. It is what the `Headers` object already does, and it makes `lnk-001`
assert nothing. A test that cannot fail for the reason it exists is worse than
no test, because it is counted as coverage.

### An injected resolver mapping `*.fixture.test` to `127.0.0.1`

Rejected for the local integration layer. It requires the scanner to accept a
test-only resolver on the path `local-loopback` is supposed to make
unbypassable, and would leave `sec-004`, where a redirect from `127.0.0.1` to
`localhost` must be blocked, testing a relaxed policy. A resolver injection
point still exists for the M3 adversarial suite, where controlling resolution is
the point.

### A hosts-file entry documented in CONTRIBUTING

Rejected. It is ambient machine state, differs per developer, needs elevated
privileges on most systems, and `THREAT_MODEL.md` section 12.2 asks for the
opposite.

### A single server with virtual hosts keyed by the `Host` header

Rejected. The scanner derives `Host` from the canonical URL, so selecting a
fixture by `Host` still requires a name that resolves.

### Fixed per-fixture ports assigned in the manifest

Rejected. It removes the port from the report but collides with whatever else is
listening on a shared runner, trading a handled variation for an unhandled
flake.

## Revisit conditions

- The maintainer acquires a domain and deploys the optional public fixtures,
  activating the `manifestHost` routing path.
- Per-case server startup becomes a measurable share of test time.
- A case currently in layer A needs wire-level control, which is a signal that
  the layer boundary in section 4 needs restating rather than a one-off
  exception.
- A runtime appears whose `Response` equivalent preserves repeated field lines,
  which would let `lnk-001` return to layer A.
- M3 introduces the controlled-resolver suite, whose relationship to this
  decision must be stated so the two do not converge by accident.

## Related documents

- [ADR-0001: Scope, modes, and no aggregate score](0001-scope-modes-and-scoring.md)
- [ADR-0002: Rule execution model and observation types](0002-rule-execution-model.md)
- [Fixture catalog](../FIXTURE_CATALOG.md)
- [Threat model](../THREAT_MODEL.md)
- [Test strategy](../TEST_STRATEGY.md)
- [Architecture](../ARCHITECTURE.md)
