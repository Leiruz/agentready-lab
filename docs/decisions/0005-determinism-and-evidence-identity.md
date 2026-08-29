# ADR-0005: Determinism and evidence identity

- Status: Accepted
- Decision date: 2026-08-29
- Owners: Initial maintainers
- Applies from: M1

## Context

Two defects make the canonical report nondeterministic as specified.

**Budget allocation races completion order.** `docs/ARCHITECTURE.md` section 5
says "Version 1 uses serial rule evaluation", but the configuration example in
section 10 sets `"maxConcurrency": 2`, and `docs/ROADMAP.md` M1 requires that
"Reordering promise completion does not change canonical JSON". These cannot all
hold. With a 24-request budget consumed on a first-come-first-served basis, the
observation that receives a budget error is whichever one asked for the last
slot, which depends on how fast each response arrived. The affected rule's
status, and therefore the exit code, becomes a property of the network rather
than of the target.

**Evidence identity is unspecified and unstable.** `docs/ARCHITECTURE.md`
section 9 says evidence IDs "should be hashes of canonical sanitized observation
metadata and, for a response, the body digest", and that "evidence sorts by ID".
No canonicalization algorithm is given, so two independent implementations
produce different IDs for identical scans, which defeats G-4's reusable upstream
evidence. Worse, because the ID includes the body digest and the array is sorted
by ID, changing one byte of one response reshuffles the entire evidence array.
That is hostile to FR-8 differential reporting, which is one of the reasons the
project exists.

### The first accepted revision fixed half of the first defect

The first revision reserved request **counts** at plan time and concluded that
concurrency then affected only wall-clock time. That conclusion was wrong, and
adversarial review on 2026-08-29 was right to reject it.

Requests are not the only shared budget. `docs/THREAT_MODEL.md` section 16 also
imposes whole-scan budgets of 4 MiB encoded and 8 MiB decompressed, and section
27.4 requires that "Total request, concurrency, time, and decoded-byte budgets
cannot be exceeded". Those are consumed by bytes arriving on sockets, not by
slots handed out at plan time. With two bodies streaming at once, whichever one
delivers the chunk that crosses the whole-scan threshold is the one that
receives the error, and which one that is depends on interleaving. The affected
rule's status, the canonical bytes, and the exit code therefore still moved with
the network, which is precisely the property the revision claimed to have
removed.

The same revision also assigned evidence IDs "in planning order before sockets
open" while reserving only anonymous capacity for round-two requests. Round-two
URLs do not exist at planning time, so there was nothing to assign an ID to, and
the ADR defined neither duplicate-ID handling nor cross-rule aliasing, which
`TEST_STRATEGY.md` section 6 requires because identical probes must deduplicate
across rules.

## Decision

### 1. M1 executes observations serially, in stable plan order

`network.maxConcurrency` is fixed at `1` for M1. A configuration or flag that
sets it higher exits 2 rather than being silently ignored, because a user who
configured concurrency and did not get it should be told.

Serial execution in a fixed order makes every shared budget deterministic for
free. Bytes are consumed in one total order that is a function of the plan and
of the target's own bytes, so the observation that crosses a whole-scan encoded
or decoded threshold is the same observation on every run. No per-observation
byte reservation is needed, and no unused quota has to be reclaimed.

The cost is small because the M1 scan is small. A `full`-profile M1 run plans at
most nine requests against a 24-request budget:

| Round | Canonical request | Rules sharing it |
| ---: | --- | --- |
| 1 | `GET /robots.txt` | robots, AI crawler, Content Signals |
| 1 | `GET /sitemap.xml` | sitemap |
| 1 | `GET /` with `Accept: text/html` | link |
| 1 | `GET /` with `Accept: text/markdown` | Markdown negotiation |
| 1 | `GET /.well-known/api-catalog` | API Catalog |
| 1 | `GET /.well-known/agent-skills/index.json` | Agent Skills |
| 2 | the sitemap named by a robots `Sitemap` record | sitemap |
| 2 | one service-description link | API Catalog |
| 2 | one declared skill artifact | Agent Skills |

Against a loopback preview, which is the only network profile M1 ships
(ADR-0001), nine serial requests complete in single-digit milliseconds.
Concurrency two would save nothing measurable and would cost a whole class of
nondeterminism.

This is a real trade and the losing side should be stated. Against a
pathologically slow target, serial execution reaches fewer observations before
the 30-second whole-scan deadline: with a 10-second per-request elapsed timeout,
serial completes three requests where concurrency two completes six. Both abort
with exit code 3. That difference matters for a hostile remote target and is one
of the questions the `ci-public` milestone must answer; it does not matter for a
developer's own preview server, where a 10-second response is already the defect
under test.

`ARCHITECTURE.md` section 5's serial-evaluation claim is therefore correct and
its section 10 example is wrong. The example changes from `2` to `1`.
`THREAT_MODEL.md` section 16's "Concurrent requests: 2" stays as the ceiling;
ADR-0004 section 9 makes the effective value the minimum across sources, so
pinning 1 is permitted without a threat-model change.

### 2. Request slots are reserved at plan time, in stable registry order

Serial execution removes the byte race. It does not by itself decide which
requests get to run when the plan exceeds the request budget, so slots are still
reserved before the first socket opens.

After configuration validation and rule selection, and before any socket opens:

1. walk the selected rules in stable registry order;
2. for each rule, call `plan()` (ADR-0002) and walk the returned requests in
   declaration order;
3. canonicalize each request into the key defined in section 3;
4. if the key is already planned, attach to the existing reservation and reserve
   nothing, which is why the shared robots observation costs one slot and not
   three;
5. otherwise reserve one slot from `network.maxRequests`;
6. reserve `RuleMetadata.roundTwoBudget` further anonymous slots for that rule,
   from the same total, in the same walk.

When the plan exceeds the budget, the requests later in that stable order are
denied a reservation. A denied request is materialized immediately as an error
observation with internal reason `request-slot-budget-exceeded` and public code
`request-budget-exhausted` at phase `policy` (ADR-0003). No socket is opened for
it.

Round-two capacity is per rule and reserved up front, so one rule's discovery
activity can never consume another rule's capacity. A round-two batch larger
than `roundTwoBudget` is a contract violation and exits 4 (ADR-0002 section 5);
it is not silently truncated.

### 3. The canonical request key is defined here, in full

Step 3 of section 2, and the per-round deduplication in section 4, both
canonicalize a request. The previous revision delegated the algorithm to
`ARCHITECTURE.md` section 7, and that delegation is withdrawn. Adversarial
review on 2026-08-29 pointed out that section 7's key names a singular
"body limit" while `HttpObservationRequest` carries `maxEncodedBytes` **and**
`maxDecodedBytes` (ADR-0002 section 4), so two requests differing only in one of
the two safety limits would canonicalize onto the same key and alias. The rule
that lowered a limit would then be handed the other rule's larger, or truncated,
response. A deduplication key that can merge
two different safety postures is a security defect, not a tidiness one, so the
key belongs where the limits are decided.

The complete key is:

```text
canonical-request-key =
    method                  ; "GET" or "HEAD", uppercase
  + effective URL           ; scheme and host lowercased, default port for the
                            ;   scheme removed, empty path normalized to "/",
                            ;   percent-encoding normalized to uppercase hex,
                            ;   query preserved byte for byte, fragment removed
  + representation headers  ; every representation-affecting request header:
                            ;   field name lowercased, entries sorted by name
                            ;   then by value, optional whitespace trimmed,
                            ;   repeated fields kept as an ordered value list
  + redirect policy         ; "follow-same-origin" or "reject"
  + max redirects           ; the effective integer after ADR-0004 section 9
  + maxEncodedBytes         ; the effective integer after ADR-0004 section 9
  + maxDecodedBytes         ; the effective integer after ADR-0004 section 9
  + network scope           ; "local" or "remote", and the network profile id
```

For M1 the representation-header set is exactly `accept`, because `accept` is
the only header a rule can set (`HttpObservationRequest`). The component is
still modeled as a sorted multi-valued set so that adding a second
representation-affecting header later cannot create a silent collision, which is
the same reason `ARCHITECTURE.md` section 7 modeled a request-body digest for
methods M1 does not permit.

Both byte limits are in the key as **effective** values, after the section 9
minimum-across-sources rule in ADR-0004. That is what makes them deterministic
inputs rather than a race between whichever rule was asked first.

Deliberately not in the key: the rule id, the round number, the rule-local
request id, the evidence id, and the rule's declaration order. None of them
describes the request, and including any of them would defeat the cross-rule
deduplication that `TEST_STRATEGY.md` section 6 requires for the shared robots
observation.

`ARCHITECTURE.md` section 7 must be replaced by a reference to this section.

### 4. Reserved slots are not evidence identities

These are separate numbering schemes and conflating them was the second defect.

A reservation is an anonymous unit of capacity, held before any URL for round
two exists. An evidence ID names a concrete observation that has a canonical
request. The two cannot share a numbering because one is known earlier than the
other.

Per round, after every selected rule has returned that round's batch and the
batch has been canonicalized and deduplicated in registry order:

1. the round's plan is stable;
2. evidence IDs are assigned to that round's canonical requests in that order,
   continuing the sequence from the previous round.

So round one's canonical requests take `ev-001` upward, and round two's
continue from wherever round one stopped. Nothing is renumbered, because a
round's plan is frozen before the next round's rules run.

Identity, deduplication, and aliasing follow ADR-0002 section 8 and section 3
above, and are restated here because the first revision of this ADR omitted
them:

- `ObservationRequest.id` is rule-local and unique within one rule for the
  entire scan, across both rounds. A duplicate anywhere in that rule's scan is a
  contract violation and exits 4. The first revision of ADR-0002 scoped
  uniqueness to one round and keyed ids by `(ruleId, round, id)`, which left a
  bare id in `context.observation(id)` and in `AssertionOutcome.observationRefs`
  with two possible answers. That is corrected in ADR-0002 section 8.
- Two rules may use the same rule-local id for different requests. Ids are
  keyed by `(ruleId, id)` and never collide across rules.
- Every rule-local id that canonicalizes onto a shared request becomes an alias
  for it. `context.observation(id)` resolves through the alias and hands both
  rules the same frozen observation.
- `AssertionOutcome.observationRefs` carries rule-local ids. The core rewrites
  them to canonical evidence IDs when it builds `RuleFinding.evidenceRefs`,
  deduplicating and sorting. Two rules citing one observation cite one ID.
- A rule-local id naming no request in a completed round exits 4.

### 5. Evidence IDs are sequential, in plan order

Evidence IDs are `ev-` followed by a three-digit zero-padded decimal:
`ev-001`, `ev-002`, and so on. The planner rejects a configuration whose
reservation count would exceed 999 with exit code 2, which keeps the format
fixed-width and the lexical sort equal to the numeric sort.

The content digest keeps living in the existing `bodySha256` field of
`PublicHttpEvidence`, where it can change without moving anything.

Sorting evidence by ID is therefore sorting by plan order, which is stable for a
given ruleset, profile, mode, and options. Adding a rule shifts the IDs of
everything planned after it, which is correct and visible: the plan changed.

Because IDs shift, `report diff` compares evidence through the findings that
reference it, keyed by `(ruleId, findingCode)`, never by raw evidence ID. An ID
shift with identical content is not a change and must not be reported as one.

`docs/TEST_STRATEGY.md` section 7 currently asserts that "evidence IDs are
stable for the same sanitized observation". Under this decision they are stable
for the same plan, which is the property determinism actually requires. That
test's wording must be updated with the implementation.

### 6. Exit code 3 is deterministic as a consequence

Exit code 3 is reserved for a whole-scan abort: the scan-wide elapsed deadline,
or a security policy that stops the run. Denying an individual reservation
produces `unable-to-check` on the affected rules and exit code 0 or 1 under the
selected strictness policy. This is what
`docs/IMPLEMENTATION_SPEC.md` section 10.1 already says
("Individual `unable-to-check` findings do not automatically produce exit code
3"), and plan-time allocation is what makes it true.

The whole-scan elapsed deadline is the one genuinely wall-clock-dependent
condition that remains, and serial execution does not remove it. A run that
aborts on it reports internal reason `scan-deadline-exceeded`, public code
`aborted`, and exits 3, and `agentready-lab report diff` refuses to use an
aborted report as either side of a comparison. An aborted scan is not a
measurement.

### 7. The determinism tests

`ROADMAP.md` M1's criterion is written in terms of promise completion order.
That is necessary and not sufficient, because the byte budgets are crossed by
chunks, not by promises. The suite must contain all four of these:

Before them, a correction. The previous revision required, as test 2, that
"observations resolve in reverse plan order and the canonical JSON is
byte-identical", in the same section that mandated a strictly serial dispatcher.
Adversarial review on 2026-08-29 pointed out that those cannot both hold, and it
is right, twice over. A later observation cannot settle before it is dispatched,
and under section 1 it is not dispatched until the earlier one has settled, so
the required ordering is unreachable by construction. Rules are synchronous
under ADR-0002 as well, so there is no rule-facing promise to reorder either.
The requirement was contradictory and is withdrawn rather than weakened.

What it was reaching for survives in test 2 below. Completion **order** is fixed
by the dispatcher, so the free variable is completion **latency**, and permuting
that is a test that can actually be written and can actually fail. `ROADMAP.md`
M1's checkbox is therefore satisfied structurally by ADR-0002 section 3, which
makes response arrival order unobservable to rule code, and verified by the
latency permutations in test 2 and the segmentation permutations in test 3. The
checkbox's wording names a mechanism this design does not have and must be
reconciled with it.

1. **Serial execution is enforced, not intended.** A transport wrapper throws if
   a second dispatch begins before the previous observation has completed. This
   is what stops `maxConcurrency` from being reintroduced by accident.
2. **Dispatch order is plan order, and latency does not move it.** The transport
   wrapper records a `(dispatched, settled)` sequence, and the test asserts that
   request N+1 is not dispatched before request N settles, for settlements of
   every kind: a response, a transport error, a denied reservation, and a
   timeout. The same plan is then replayed with several per-response latency
   profiles, including one that is the reverse of another, and the canonical
   JSON is byte-identical across all of them.
3. **Reversed and re-segmented chunk arrival.** Each body is delivered in
   several segmentations, including one where the byte that crosses a whole-scan
   threshold arrives alone as the final chunk and one where it arrives inside
   the first chunk, and the canonical JSON is byte-identical across all of them.
   This is the test the first revision did not have, and it is the one that
   would have caught the byte-budget race.
4. **Mid-plan budget exhaustion.** A whole-scan byte budget small enough to be
   crossed partway through the plan, asserting that the same observation is the
   one that fails under every segmentation above, and that a denied reservation
   opens no socket.

## Rationale

A CI tool must give the same answer for the same input. Under first-come
first-served allocation the answer depends on which of two servers replied
first, and a flaky exit code is worse than a conservative one: it trains users
to re-run until green, which destroys the regression signal the tool exists to
provide.

Serial execution is chosen over per-observation byte reservations because it is
both simpler and less lossy. Reserving bytes means dividing 4 MiB encoded across
up to 24 slots, roughly 170 KiB each, which is well under the 1 MiB per-response
cap that `THREAT_MODEL.md` section 16 already sets, so most real responses would
be truncated by their reservation rather than by the budget the project actually
chose. Unused quota cannot be handed back mid-run without reintroducing the
completion-order dependency, so the waste is permanent. Serial execution spends
the whole budget in a fixed order instead, and costs concurrency the M1 profile
had no use for.

Plan-time slot allocation also makes the request budget explainable. A user who
exhausts 24 requests can read the plan order out of the report and see exactly
which observations were denied and why, rather than discovering that a different
rule lost the race this time.

Sequential IDs are chosen over content hashes because the two requirements
conflict. A content-addressed ID gives cheap cross-run identity; a sort by
content-addressed ID gives an evidence array whose order is a hash of the
target's bytes. The project needs stable ordering for diffing far more than it
needs cross-run identity, and cross-run identity is already available through
`bodySha256`, which is what a reader actually compares.

## Consequences

### Positive

- Neither response latency nor chunk arrival order can change the canonical
  report, and response arrival order is not a variable at all, which is the M1
  acceptance criterion and more.
- Every shared budget, request slots and both byte budgets, is deterministic
  without adding a per-request quota field.
- Exit code 3 has one meaning and is reproducible.
- A one-byte body change moves nothing in the evidence array.
- Evidence IDs are short, human-quotable, and identical across implementations
  given the same plan, with no canonicalization algorithm to agree on.
- The denied portion of the plan is visible in the report as typed errors.

### Costs

- Scans are slower against a slow target, and reach fewer observations before
  the whole-scan deadline than concurrency two would. For loopback previews the
  difference is unmeasurable; for a future `ci-public` profile it is not, and
  that milestone must revisit this.
- `maxConcurrency` becomes a value the configuration schema accepts only as
  `1`, which will read as a wart until the setting is either removed or
  reactivated.
- A rule that would have completed under budget can be denied because a rule
  earlier in registry order reserved capacity, even if that earlier rule ends up
  needing fewer requests than it reserved. Reserved-but-unused round-two
  capacity is not returned to the pool during the run, because returning it
  would make the outcome depend on when the earlier rule finished.
- Registry order therefore becomes a scarce-resource priority order. That is a
  real editorial responsibility on the registry, and it must be documented where
  the ordinals are defined.
- Evidence IDs are not stable across runs with different rule selections, so no
  external system may treat `ev-014` as a durable identifier.
- The 999-evidence ceiling is a hard limit, not a soft one.

### Implementation constraints

- `ARCHITECTURE.md` section 10's `"maxConcurrency": 2` example becomes `1`, and
  section 5's serial-evaluation statement is kept rather than removed.
- `ARCHITECTURE.md` section 7's request cache key is replaced by a reference to
  section 3 here, because its singular "body limit" component is the defect.
- `TEST_STRATEGY.md` section 7's "probes differing by `Accept`, redirect policy,
  body limit, or network profile do not deduplicate" gains the second byte
  limit, and its "result order is unchanged when observations resolve in a
  different order" is restated as the section 7 test 2 assertion.
- `ROADMAP.md` M1's "Reordering promise completion does not change canonical
  JSON" is restated so that it names a mechanism this design has.
- The configuration schema rejects `maxConcurrency` greater than 1 with exit 2
  and a message naming this ADR.
- The core engine test suite gains the four cases in section 7.
- `report diff` gains a test proving that an evidence-ID shift with unchanged
  content produces no diff entry.
- A test asserts that two rules requesting the identical canonical observation
  receive the same object and the same evidence ID, and that two requests
  differing only by `Accept` receive different ones.

## Alternatives considered

### Keep concurrency two and reserve per-observation byte quotas

Rejected, and this is the alternative the review offered alongside serial
execution. It requires adding encoded and decoded quota fields to every request,
dividing the whole-scan budget across reserved slots before any response size is
known, and never reclaiming an unused quota, since reclaiming it restores the
completion-order dependency. The result truncates ordinary responses far below
the project's own per-response cap in order to preserve a concurrency setting
that saves nothing on a loopback target. It becomes the right answer if
`ci-public` makes latency matter.

### Keep concurrency two and reserve only request counts

Rejected, and this was the first revision's position. It leaves the whole-scan
encoded and decoded byte budgets racing, so the report still moves with the
network.

### Drop `maxConcurrency` from the schema entirely

Rejected, narrowly. Removing a documented setting and adding it back at
`ci-public` is more churn than pinning it, and rejecting a value of 2 with a
message is more informative to a user than a schema error about an unknown key.

### Allocate request slots per rule as a fixed share of the total

Rejected. An equal split wastes capacity on rules that need one request and
starves rules that need four, and any unequal split is a weighting, which
ADR-0001 forbids.

### Return unused round-two reservations to the pool mid-run

Rejected. The moment a later rule's capacity depends on when an earlier rule
finished, completion order is back in the report.

### Content-hash evidence IDs with an explicit canonicalization algorithm

Rejected. It requires specifying and testing a canonical serialization purely to
generate an identifier, and it leaves the evidence array ordered by a hash. The
sort order was the more damaging half of the defect.

### Sort evidence by first reference instead of by ID

Rejected. It is the same order as plan order in the common case and ambiguous
when two findings reference the same evidence, which needs a tie-break rule that
plan order already provides.

## Revisit conditions

- M3 introduces `ci-public`, where request latency is real and the serial versus
  reserved-quota trade must be decided again with measurements.
- Batch scanning or multiple targets arrive, which changes what "the plan" means
  and may need a per-target evidence namespace.
- Measurement shows plan-time reservation routinely wastes a large share of the
  request budget, which would justify a planner that reserves round-two capacity
  only for rules whose round-one evidence proves they need it.
- The evidence count approaches 999 for a legitimate profile.
- An upstream consumer needs a durable cross-run evidence identifier, which
  would be a separate field, not a change to `id`.

## Related documents

- [ADR-0002: Rule execution model and observation types](0002-rule-execution-model.md)
- [ADR-0003: Unified transport error vocabulary](0003-transport-error-vocabulary.md)
- [ADR-0004: Rule selection, applicability, and opt-in](0004-rule-selection-and-applicability.md)
- [ADR-0007: Report self-containment](0007-report-self-containment.md)
- [Architecture](../ARCHITECTURE.md)
- [Roadmap](../ROADMAP.md)
- [Test strategy](../TEST_STRATEGY.md)
- [Threat model](../THREAT_MODEL.md)
