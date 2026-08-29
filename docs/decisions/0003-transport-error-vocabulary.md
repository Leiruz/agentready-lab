# ADR-0003: Unified transport error vocabulary

- Status: Accepted
- Decision date: 2026-08-29
- Owners: Initial maintainers
- Applies from: M1

## Context

Three incompatible error enumerations exist in the blueprint.

1. `docs/THREAT_MODEL.md` section 26 lists transport reason codes, from
   `invalid-url` to `budget-exceeded`. These are the security boundary's own
   vocabulary and name the exact condition that stopped the request.
2. `docs/ARCHITECTURE.md` section 8 declares a 10-member `TransportErrorCode`
   union: `dns`, `blocked-destination`, `timeout`, `tls`, `connection`,
   `response-too-large`, `redirect-limit`, `invalid-response`,
   `budget-exhausted`, `aborted`.
3. `docs/ARCHITECTURE.md` section 9 and `docs/IMPLEMENTATION_SPEC.md` section 13
   both declare a 14-member `PublicObservationError.code`, the shape the
   canonical report actually carries.

No mapping between them exists. Two of the security boundary's most important
distinctions, `peer-address-mismatch` and `mixed-address-scope`, have no public
representation at all, so a DNS-rebinding block and an ordinary connection
failure would be indistinguishable in a report. Section 13 also requires that
"contract tests must cover every error code", which cannot be written against
three enums with no defined relationship.

### The first accepted revision of this decision was wrong in three ways

The first revision froze the internal vocabulary at exactly the 18 codes printed
in `THREAT_MODEL.md` section 26 and declared the set complete. It is not
complete, and the threat model does not claim it is: it introduces the block
with "Example transport reason codes include", so those 18 are illustrative.
Treating an example list as a closed enum was a misreading, and it produced
three concrete defects.

**Ordinary connection failure had no reason code.** Connection refused,
connection reset, unreachable host, and generic socket errors are the most
common real failures against a local preview, and none of them appeared. The
only reason mapped to the public `connection-failed` code was
`peer-address-mismatch`, so the one condition that code named was a DNS
rebinding block, and every genuine connection failure had nowhere to go.

**Every budget collapsed into one reason.** A single `budget-exceeded` reason
mapped unconditionally to `request-budget-exhausted`, although the repository
has request-slot, per-response byte, whole-scan byte, parser, and elapsed
budgets, and `THREAT_MODEL.md` section 16 lists them separately. A user whose
scan stopped could not tell which limit stopped it.

**Parse failures were declared transport-owned.** The first revision put the
whole internal union in `packages/transport-node`. Parsers live in
`packages/rules-standard` (`docs/ARCHITECTURE.md` section 4), which does not
depend on the transport and must not, so the transport could not have produced a
`parse-failure` and the rule package could not have imported the type that
described one.

### The second revision deferred a correction that costs nothing to make

The second revision separated the four resource budgets and then claimed, in
its consequences, that they are "distinguishable from the report alone". Two of
them were not. `parse-failure` and `parser-budget-exceeded` are distinct
internal reasons but both project to exactly `parse-failed` at phase `parse`,
so a document this project refused to finish parsing was indistinguishable from
a document it parsed and found broken.

The second revision also argued, under "Add public codes for the whole-scan byte
budget and the deadline", that growing the public enum "is a schema change that
should happen once, with the report-schema work". Adversarial review on
2026-08-29 rejected that reasoning for this case and is right: no report has
shipped, `schemaVersion` `1.0.0` has not been cut, and there is therefore no
compatibility to preserve. Deferring bought nothing and left the ADR asserting a
distinguishability property it did not have. Section 3 adds the code now.

## Decision

### 1. Two enumerations exist, and the internal one has three owners

**Public**: 15 `PublicObservationError.code` members, the 14 declared in
`ARCHITECTURE.md` section 9 and `IMPLEMENTATION_SPEC.md` section 13 plus
`resource-budget-exhausted`, which section 4 adds. They are the only error
vocabulary in the canonical report and in every reporter.

**Internal**: a single `ObservationFailure` union declared in `packages/core`,
built from three owner-specific unions. It never appears in a report.

| Owner | Union | What it can raise |
| --- | --- | --- |
| `packages/transport-node` | `TransportReason` | URL policy, DNS, address policy, connect, TLS, redirect, framing, byte limits |
| `packages/rules-standard` | `ParserReason` | a parse the bounded harness refused or aborted |
| `packages/core` | `EngineReason` | request-slot reservation, whole-scan deadline, caller cancellation, unsupported runtime |

Declaring the union in core is what makes the dependency graph work.
`rules-standard` and `transport-node` both depend on core and neither depends on
the other, so core is the only package both can import a shared failure type
from. The projection to the public code lives there too.

`ARCHITECTURE.md` section 8's 10-member `TransportErrorCode` is an orphan. It
matches neither the boundary it claims to describe nor the report it feeds. It
is retired, and the section must be replaced by a reference to this ADR.

### 2. A malformed document is not an observation failure

This distinction was blurred in the first revision and is load-bearing.

`ParserReason` covers a parse the harness **refused or aborted**: an XML
`DOCTYPE` with an external entity (`sec-008`), JSON nested past depth 64,
excessive nodes or strings, or a parse stopped by its own budget. The observation
has no usable value and the rule normally reports `indeterminate`.

A document the target served that is simply **wrong** is a conformance question,
not a transport or parser failure. `map-004`'s unclosed XML element and
`api-004`'s malformed JSON both expect `spec: fail`, and they get it as an
assertion outcome of `violated` (ADR-0002 section 5), never as `parse-failed`.
The rule parsed the bytes successfully enough to know they were invalid, which
is the finding.

### 3. Types

```ts
export type TransportPhase =
  | "policy"
  | "dns"
  | "connect"
  | "tls"
  | "request"
  | "redirect"
  | "body"
  | "decode"
  | "parse"
  | "runtime";

export type PublicErrorCode =
  | "url-policy-blocked"
  | "dns-resolution-failed"
  | "dns-answer-blocked"
  | "connect-timeout"
  | "connection-failed"
  | "tls-failed"
  | "request-timeout"
  | "redirect-limit"
  | "request-budget-exhausted"
  | "resource-budget-exhausted"
  | "response-limit"
  | "decode-failed"
  | "parse-failed"
  | "aborted"
  | "unsupported-runtime";

export interface PublicObservationError {
  readonly code: PublicErrorCode;
  readonly phase: TransportPhase;
  readonly message: string;
  readonly retryable: boolean;
}

/** Raised only by `packages/transport-node`. */
export type TransportReason =
  | { readonly code: "invalid-url"; readonly phase: "policy" }
  | { readonly code: "prohibited-scheme"; readonly phase: "policy" }
  | { readonly code: "credentials-in-url"; readonly phase: "policy" }
  | { readonly code: "unsafe-port"; readonly phase: "policy" }
  | { readonly code: "dns-failure"; readonly phase: "dns" }
  | { readonly code: "dns-timeout"; readonly phase: "dns" }
  | { readonly code: "unsafe-address"; readonly phase: "dns" }
  | { readonly code: "mixed-address-scope"; readonly phase: "dns" }
  | { readonly code: "peer-address-mismatch"; readonly phase: "connect" }
  | { readonly code: "connection-failed"; readonly phase: "connect" }
  | { readonly code: "tls-failure"; readonly phase: "tls" }
  | { readonly code: "redirect-blocked"; readonly phase: "redirect" }
  | { readonly code: "redirect-limit"; readonly phase: "redirect" }
  | {
      readonly code: "timeout";
      readonly phase: "connect" | "request" | "body" | "decode";
    }
  | { readonly code: "malformed-http"; readonly phase: "body" }
  | { readonly code: "response-too-large"; readonly phase: "body" }
  | { readonly code: "decompression-failure"; readonly phase: "decode" }
  | {
      readonly code: "scan-byte-budget-exceeded";
      readonly phase: "body" | "decode";
    };

/** Raised only by a parser in `packages/rules-standard`. */
export type ParserReason =
  | { readonly code: "parse-failure"; readonly phase: "parse" }
  | { readonly code: "parser-budget-exceeded"; readonly phase: "parse" };

/** Raised only by the engine in `packages/core`. */
export type EngineReason =
  | { readonly code: "request-slot-budget-exceeded"; readonly phase: "policy" }
  | { readonly code: "scan-deadline-exceeded"; readonly phase: "runtime" }
  | { readonly code: "caller-cancelled"; readonly phase: "runtime" }
  | { readonly code: "runtime-unsupported"; readonly phase: "runtime" };

export type ObservationFailure = TransportReason | ParserReason | EngineReason;
```

`connection-failed` covers connection refused, connection reset by peer, host
unreachable, network unreachable, and any other socket-level failure that is not
one of the typed policy, DNS, TLS, or timeout conditions above. It is the
default branch of the transport's own error classifier, and the classifier
having a default branch is what stops an unclassified socket error from
escaping as a raw exception.

### 4. The complete mapping

| Internal reason | Owner | Phase | Public code | Retryable |
| --- | --- | --- | --- | ---: |
| `invalid-url` | transport | `policy` | `url-policy-blocked` | no |
| `prohibited-scheme` | transport | `policy` | `url-policy-blocked` | no |
| `credentials-in-url` | transport | `policy` | `url-policy-blocked` | no |
| `unsafe-port` | transport | `policy` | `url-policy-blocked` | no |
| `redirect-blocked` | transport | `redirect` | `url-policy-blocked` | no |
| `dns-failure` | transport | `dns` | `dns-resolution-failed` | yes |
| `dns-timeout` | transport | `dns` | `dns-resolution-failed` | yes |
| `unsafe-address` | transport | `dns` | `dns-answer-blocked` | no |
| `mixed-address-scope` | transport | `dns` | `dns-answer-blocked` | no |
| `peer-address-mismatch` | transport | `connect` | `dns-answer-blocked` | no |
| `connection-failed` | transport | `connect` | `connection-failed` | yes |
| `timeout` | transport | `connect` | `connect-timeout` | yes |
| `timeout` | transport | `request`, `body`, `decode` | `request-timeout` | yes |
| `tls-failure` | transport | `tls` | `tls-failed` | no |
| `redirect-limit` | transport | `redirect` | `redirect-limit` | no |
| `malformed-http` | transport | `body` | `decode-failed` | no |
| `response-too-large` | transport | `body` | `response-limit` | no |
| `decompression-failure` | transport | `decode` | `decode-failed` | no |
| `scan-byte-budget-exceeded` | transport | `body`, `decode` | `request-budget-exhausted` | no |
| `parse-failure` | rules | `parse` | `parse-failed` | no |
| `parser-budget-exceeded` | rules | `parse` | `resource-budget-exhausted` | no |
| `request-slot-budget-exceeded` | core | `policy` | `request-budget-exhausted` | no |
| `scan-deadline-exceeded` | core | `runtime` | `aborted` | no |
| `caller-cancelled` | core | `runtime` | `aborted` | no |
| `runtime-unsupported` | core | `runtime` | `unsupported-runtime` | no |

`peer-address-mismatch` moves from `connection-failed` to `dns-answer-blocked`.
It belongs with `unsafe-address` and `mixed-address-scope` because all three are
the same decision, that the address this connection would use is not authorized,
and `phase: "connect"` keeps it distinct from the two answers rejected during
resolution. That vacates `connection-failed` for the condition its name
describes, which is the point of the change.

The four budgets are now separable from the report alone:

| Exhausted budget | Public code | Phase |
| --- | --- | --- |
| request slots for the scan | `request-budget-exhausted` | `policy` |
| whole-scan encoded or decoded bytes | `request-budget-exhausted` | `body` or `decode` |
| this response's byte cap | `response-limit` | `body` |
| parser depth, nodes, or time | `resource-budget-exhausted` | `parse` |
| per-request elapsed deadline | `request-timeout` | `request`, `body`, `decode` |
| whole-scan elapsed deadline | `aborted` | `runtime` |

Whole-scan byte exhaustion is detected by the transport, not by the engine,
because the abort has to happen mid-stream. The engine passes each observation
an allowance equal to the smaller of the per-response cap and the scan's
remaining bytes, and the transport reports `response-too-large` or
`scan-byte-budget-exceeded` according to which of the two bound. ADR-0005's
serial execution is what makes "the scan's remaining bytes" a well-defined
number at dispatch time.

`resource-budget-exhausted` is the fifteenth public code and the only addition
this decision makes to the published enum. It means: a bounded internal
processing budget stopped this observation, and the target's bytes are not
implicated. Its only producer today is `parser-budget-exceeded` at phase
`parse`, which is what makes parser exhaustion distinguishable from
`parse-failed`, an ordinary broken document at the same phase.

The name is general rather than `parser-budget-exhausted` on purpose. The
`1.0.0` cut still has to decide whether the whole-scan byte budget and the
whole-scan deadline deserve their own codes, and this is where they land if it
does, without a sixteenth and seventeenth member. Until then the honest
statement is that one budget uses it, `phase` identifies which, and the two
`request-budget-exhausted` rows keep a code whose name says "request" while its
`body` and `decode` phases mean bytes. That inaccuracy is now visible next to a
better-named neighbour, which is a fair description of an enum caught mid-fix
rather than a defence of it.

`timeout` remains the one internal code whose projection depends on its phase.
That is why `phase` is mandatory on every variant and why the projection is a
function of the pair, not of the code alone.

`malformed-http` to `decode-failed` is the one lossy row. HTTP framing errors
such as `Transfer-Encoding` with `Content-Length` are wire-level, not content
decoding, and the public enum has no better member. The `phase: "body"` value
preserves the distinction from `decompression-failure`, which carries
`phase: "decode"`.

### 5. A new internal code cannot be added silently

The projection is a single exhaustive `switch` with a `never`-typed default.
`blocked` and `transient` build a `PublicObservationError` from the constant
message table with `retryable` set to `false` and `true` respectively.

```ts
declare const MESSAGES: Readonly<Record<PublicErrorCode, string>>;

function blocked(
  code: PublicErrorCode,
  phase: TransportPhase,
): PublicObservationError {
  return { code, phase, message: MESSAGES[code], retryable: false };
}

function transient(
  code: PublicErrorCode,
  phase: TransportPhase,
): PublicObservationError {
  return { code, phase, message: MESSAGES[code], retryable: true };
}

export function toPublicError(
  reason: ObservationFailure,
): PublicObservationError {
  switch (reason.code) {
    case "invalid-url":
    case "prohibited-scheme":
    case "credentials-in-url":
    case "unsafe-port":
      return blocked("url-policy-blocked", "policy");
    case "redirect-blocked":
      return blocked("url-policy-blocked", "redirect");
    case "dns-failure":
    case "dns-timeout":
      return transient("dns-resolution-failed", "dns");
    case "unsafe-address":
    case "mixed-address-scope":
      return blocked("dns-answer-blocked", "dns");
    case "peer-address-mismatch":
      return blocked("dns-answer-blocked", "connect");
    case "connection-failed":
      return transient("connection-failed", "connect");
    case "timeout":
      return reason.phase === "connect"
        ? transient("connect-timeout", "connect")
        : transient("request-timeout", reason.phase);
    case "tls-failure":
      return blocked("tls-failed", "tls");
    case "redirect-limit":
      return blocked("redirect-limit", "redirect");
    case "malformed-http":
      return blocked("decode-failed", "body");
    case "response-too-large":
      return blocked("response-limit", "body");
    case "decompression-failure":
      return blocked("decode-failed", "decode");
    case "scan-byte-budget-exceeded":
      return blocked("request-budget-exhausted", reason.phase);
    case "parse-failure":
      return blocked("parse-failed", "parse");
    case "parser-budget-exceeded":
      return blocked("resource-budget-exhausted", "parse");
    case "request-slot-budget-exceeded":
      return blocked("request-budget-exhausted", "policy");
    case "scan-deadline-exceeded":
    case "caller-cancelled":
      return blocked("aborted", "runtime");
    case "runtime-unsupported":
      return blocked("unsupported-runtime", "runtime");
    default: {
      const unreachable: never = reason;
      throw new Error(
        `unmapped observation failure: ${JSON.stringify(unreachable)}`,
      );
    }
  }
}
```

Adding a twenty-fifth internal reason without deciding its public projection is
a compile error. That is the point of the construct.

### 6. The public message is a constant

`message` is read from a fixed table indexed by `PublicErrorCode`. It is never
built from an exception, a `Node` error code, a header, a body byte, a hostname,
or a resolved address. `docs/THREAT_MODEL.md` section 26 already states that raw
exceptions do not cross the transport boundary; a constant table makes that
unbypassable rather than a review item.

The internal reason symbol, and nothing else from the internal error, may be
written to stderr under `--debug`. It never enters the canonical report, any
file written by `--output`, or any reporter.

### 7. Invariants restated

A transport error is never a protocol `fail`. A rule that applies but has no
usable observation reports `indeterminate`, which the core derives to
`unable-to-check` (ADR-0002 section 5). Only an evaluated, applicable normative
assertion produces `fail`.

`retryable` is descriptive metadata for a human reading the report. The MVP
performs no automatic retry, consistent with `docs/THREAT_MODEL.md` section 18.

## Rationale

Two public and internal enumerations is the smallest number that keeps two
audiences honest. The security boundary must distinguish `mixed-address-scope`
from `unsafe-address` because they are different attacks; a report consumer needs
a small stable vocabulary that does not churn every time the classifier gains a
case.

Splitting the internal union by owner rather than declaring it all
transport-owned follows the dependency graph instead of fighting it. A parser in
`rules-standard` that must construct a failure value needs the type, and the
only package it and the transport can both import is core.

Making the projection a total function with a `never` default converts a
documentation obligation into a build failure. A lookup table plus a review
checklist is exactly the kind of gap a schema cannot catch.

Retiring the 10-member enum rather than reconciling it is correct because it has
no consumer: it is neither the boundary vocabulary nor the report vocabulary.

## Consequences

### Positive

- One mapping table, testable in one place, with a case per internal reason.
- `peer-address-mismatch` and `mixed-address-scope` gain public meaning, and an
  ordinary connection failure no longer masquerades as a rebinding block.
- The four resource budgets are distinguishable from the report alone.
- Parsers can raise a typed failure without `rules-standard` importing
  `transport-node`.
- The section 13 contract-test requirement becomes writable: 15 public codes,
  25 mapping rows including the `timeout` split.
- A parser that ran out of budget is distinguishable from a parser that read a
  broken document, which is what the second revision claimed and did not have.
- Reporters render errors without knowing anything about the transport.

### Costs

- The report loses the four-way distinction inside `url-policy-blocked`. A bad
  port and credentials in the URL produce the same code, separable only with
  `--debug`.
- `malformed-http` and `decompression-failure` collapse into `decode-failed`,
  separated only by `phase`.
- `request-budget-exhausted` still carries two different budgets, separated by
  `phase`. The code name says "request" while the `body` and `decode` phases
  mean bytes. The second revision accepted that inaccuracy in order to leave the
  published enum alone; that argument no longer holds now that the enum has
  grown by one, and the inaccuracy is retained only because moving those two
  rows is a separate decision the `1.0.0` cut should make once.
- The public enum is 15 members, so `ARCHITECTURE.md` section 9 and
  `IMPLEMENTATION_SPEC.md` section 13 both declare a stale 14-member list until
  they are reconciled.
- `caller-cancelled` and `scan-deadline-exceeded` are both `aborted`. A reader
  cannot tell a user's Ctrl+C from a 30-second deadline without `--debug`. The
  distinction `TEST_STRATEGY.md` section 7 actually requires, cancellation
  versus a target timeout, is preserved because a target timeout is
  `request-timeout`.
- A constant message table means error text cannot name the header or hostname
  that caused the failure. That is the intended trade: no target-controlled
  bytes in the report.

### Implementation constraints

- `ARCHITECTURE.md` section 8 must be rewritten to reference this ADR.
- `ARCHITECTURE.md` section 9 and `IMPLEMENTATION_SPEC.md` section 13 must both
  grow `PublicObservationError.code` from 14 members to 15.
- `THREAT_MODEL.md` section 26 keeps its example list, and a note must record
  that the executable enumeration is this ADR's, not that block's.
- Every `TransportReason`, `ParserReason`, and `EngineReason` variant carries
  `phase`, not only `timeout`.
- A contract test asserts every internal reason appears in exactly one mapping
  row and every public code is reachable from at least one.
- A test asserts the transport's socket-error classifier has a total default
  branch producing `connection-failed`, so no raw exception escapes.
- A reporter test asserts no message string contains target-derived text.

## Alternatives considered

### Keep the 18 reasons frozen as published

Rejected, and this is the first revision's error. `THREAT_MODEL.md` section 26
introduces the block with "Example transport reason codes include", so it never
claimed to be exhaustive, and freezing it left ordinary connection failure with
no code at all.

### One enum for both layers

Rejected. Publishing every internal reason makes classifier internals a public
contract, so a change to address classification becomes a breaking report-schema
change.

### Add public codes for the whole-scan byte budget and the deadline

Still deferred, and the reasoning given by the second revision is corrected
here. That revision rejected all enum growth for M1 because "the 14-member
public enum is declared in two documents and carried in the report schema", and
called growing it "a schema change that should happen once". No report has
shipped and `schemaVersion` `1.0.0` has not been cut, so there was no
compatibility to protect and that argument was wrong. Section 4 therefore adds
`resource-budget-exhausted` now.

These two budgets stay deferred on a different ground. Unlike parser
exhaustion, neither is currently ambiguous: the whole-scan byte budget is
`request-budget-exhausted` at phase `body` or `decode`, the whole-scan deadline
is `aborted` at phase `runtime`, and no other condition produces either pair. A
reader can already tell them apart. The remaining question is naming accuracy,
not distinguishability, and `resource-budget-exhausted` now exists as the
landing place if the `1.0.0` cut decides to move them.

### Name the new code `parser-budget-exhausted`

Rejected. It is more precise about today's single producer and it forecloses
nothing except the `1.0.0` remapping that section 4 describes, which is exactly
what it would foreclose: a second budget moving onto it would then carry a
misleading name, which is the defect `request-budget-exhausted` already has. One
generically named code plus a mandatory `phase` is the shape that survives the
remapping.

### Reconcile the 10-member enum into the public one

Rejected. It has no consumer, and a third live vocabulary guarantees drift.

### Declare the whole internal union in `transport-node`

Rejected, and this is the first revision's second error. `rules-standard` cannot
import `transport-node`, so a parser could not have constructed the failure type
that describes its own refusal.

### Carry the internal code as an optional public field

Rejected. A field present in local runs and absent in hosted runs is a worse
contract than no field, and it reintroduces the leakage the constant message
table removes.

### Derive `retryable` at render time

Rejected. It is a property of the failure, not of the renderer, and computing it
twice invites the two answers to diverge.

## Revisit conditions

- The report schema is cut at `1.0.0`, which is the moment to decide whether
  the whole-scan byte budget and the whole-scan deadline move onto
  `resource-budget-exhausted`, keep `request-budget-exhausted` and `aborted`, or
  earn codes of their own. Whatever it decides, it should also decide whether
  `request-budget-exhausted` keeps a name that means bytes at two phases.
- A hosted profile needs a coarser public vocabulary for anonymous callers.
- The classifier gains a block reason a user cannot act on without more detail.
- Retries are introduced, giving `retryable` behavioral meaning.
- An `http` observation gains a body-integrity failure distinct from decoding.

## Related documents

- [ADR-0002: Rule execution model and observation types](0002-rule-execution-model.md)
- [ADR-0005: Determinism and evidence identity](0005-determinism-and-evidence-identity.md)
- [Threat model](../THREAT_MODEL.md)
- [Architecture](../ARCHITECTURE.md)
- [Implementation specification](../IMPLEMENTATION_SPEC.md)
