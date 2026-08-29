import type { RequirementClass, RuleStatus } from "@agentready-lab/core";

import type { ConnectionCanary } from "../determinism/canary.js";
import type { InMemoryTransport } from "../transport/in-memory.js";
import type { RuleContractRun } from "./rule-contract.js";

/**
 * The assertions `docs/TEST_STRATEGY.md` section 6 requires of every rule
 * contract test, written once.
 *
 * They throw plain `Error`s rather than calling a test framework, so this
 * package depends on no runner and the same helpers work from a script. The
 * message is the whole value: `expect(a).toEqual(b)` on two finding-code
 * arrays says which arrays differed, and these say which rule, which run and
 * which contract clause.
 */
export class ContractAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractAssertionError";
  }
}

function fail(message: string): never {
  throw new ContractAssertionError(message);
}

function list(values: readonly string[]): string {
  return values.length === 0 ? "(none)" : values.join(", ");
}

/** The rule's derived status. Never one a rule chose (ADR-0002 section 5). */
export function expectStatus(run: RuleContractRun, status: RuleStatus): void {
  if (run.status !== status) {
    fail(
      `${run.ruleId} is ${run.status}, expected ${status}. Findings: ${list(
        run.findings.map((finding) => `${finding.code}=${finding.status}`),
      )}`,
    );
  }
}

export function expectGate(
  run: RuleContractRun,
  gate: "enforced" | "informational",
): void {
  if (run.result.gate !== gate) {
    fail(`${run.ruleId} is gated ${run.result.gate}, expected ${gate}`);
  }
}

/** The exact finding codes, in report order, and none beyond them. */
export function expectFindingCodes(
  run: RuleContractRun,
  codes: readonly string[],
): void {
  const actual = run.findingCodes;
  const same =
    actual.length === codes.length &&
    actual.every((code, index) => code === codes[index]);
  if (!same) {
    fail(
      `${run.ruleId} reported findings [${list(actual)}], expected [${list(codes)}]`,
    );
  }
}

/**
 * The requirement class of each named finding.
 *
 * ADR-0002 section 5 loads the class from the pinned ruleset and never from
 * the rule, so this is the assertion that a rule cannot quietly promote its
 * own recommendation to a normative failure.
 */
export function expectRequirementClasses(
  run: RuleContractRun,
  expected: Readonly<Record<string, RequirementClass>>,
): void {
  for (const [code, requirementClass] of Object.entries(expected)) {
    const finding = run.findings.find((entry) => entry.code === code);
    if (finding === undefined) {
      fail(
        `${run.ruleId} reported no finding ${code}; it reported [${list(run.findingCodes)}]`,
      );
    }
    if (finding.requirementClass !== requirementClass) {
      fail(
        `${run.ruleId} finding ${code} is ${finding.requirementClass}, expected ${requirementClass}`,
      );
    }
  }
}

/**
 * Every `evidenceRefs` entry names an evidence entry in the same report.
 *
 * ADR-0002 section 8 keeps request identity, evidence identity and the rule's
 * own ids apart, and the rewrite from one to the other is engine code. A
 * dangling reference is a report that cites something a reader cannot open.
 */
export function expectEvidenceResolves(
  run: RuleContractRun,
): readonly string[] {
  const available = new Set(run.evidence.map((entry) => entry.id));
  const cited: string[] = [];
  for (const finding of run.findings) {
    for (const ref of finding.evidenceRefs) {
      if (!available.has(ref)) {
        fail(
          `${run.ruleId} finding ${finding.code} cites evidence ${ref}, which the report does not contain (it has ${list([...available])})`,
        );
      }
      cited.push(ref);
    }
    const sorted = [...finding.evidenceRefs].sort();
    if (finding.evidenceRefs.some((ref, index) => ref !== sorted[index])) {
      fail(
        `${run.ruleId} finding ${finding.code} cites evidence out of order: ${list(finding.evidenceRefs)}`,
      );
    }
  }
  return cited;
}

export interface ExpectedRequest {
  readonly url: string;
  readonly method?: "GET" | "HEAD";
  /** The single `Accept` field value the engine sends for this observation. */
  readonly accept?: string;
}

function describeRequests(run: RuleContractRun): string {
  return run.transport.httpRequests
    .map(
      (request) =>
        `${request.method} ${request.url} (accept: ${list(request.accept)})`,
    )
    .join("\n  ");
}

/**
 * The exact HTTP requests issued, in dispatch order, and none beyond them.
 *
 * `docs/TEST_STRATEGY.md` section 6 asks for both halves separately: "no
 * unexpected request" and "expected request representation, including
 * `Accept`". A count check alone would pass a rule that fetched the right
 * number of wrong representations.
 */
export function expectRequests(
  run: RuleContractRun,
  expected: readonly ExpectedRequest[],
): void {
  const actual = run.transport.httpRequests;
  if (actual.length !== expected.length) {
    fail(
      `${run.ruleId} issued ${String(actual.length)} HTTP requests, expected ${String(expected.length)}:\n  ${describeRequests(run)}`,
    );
  }
  expected.forEach((want, index) => {
    const got = actual[index];
    if (got === undefined) return;
    const method = want.method ?? "GET";
    if (got.url !== want.url || got.method !== method) {
      fail(
        `${run.ruleId} request ${String(index + 1)} is ${got.method} ${got.url}, expected ${method} ${want.url}`,
      );
    }
    if (want.accept !== undefined && !got.accept.includes(want.accept)) {
      fail(
        `${run.ruleId} request ${String(index + 1)} sent accept [${list(got.accept)}], expected ${want.accept}`,
      );
    }
  });
  expectAllRoutesMatched(run.transport);
}

export function expectNoRequests(run: RuleContractRun): void {
  if (run.transport.callCount !== 0) {
    fail(
      `${run.ruleId} was expected to issue no request, but issued:\n  ${describeRequests(run)}`,
    );
  }
}

/**
 * Every request found a route.
 *
 * An unrouted request settles as `connection-failed`, which a rule may well
 * turn into a plausible `unable-to-check`. Without this the test passes and
 * proves nothing.
 */
export function expectAllRoutesMatched(transport: InMemoryTransport): void {
  if (transport.unmatched.length > 0) {
    fail(
      `no route answered ${String(transport.unmatched.length)} request(s). Register:\n${transport.describeUnmatched()}`,
    );
  }
}

/**
 * ADR-0005 section 1 and section 7 test 1: request N+1 is not dispatched
 * before request N settles, for every settlement kind.
 */
export function expectSerialDispatch(transport: InMemoryTransport): void {
  if (transport.violations.length > 0) {
    fail(`serial dispatch was violated: ${list(transport.violations)}`);
  }
  transport.sequence.forEach((event, index) => {
    const expected = index % 2 === 0 ? "dispatched" : "settled";
    if (event.event !== expected) {
      fail(
        `dispatch trace entry ${String(index)} is ${event.event} for ${event.label}, expected ${expected}`,
      );
    }
  });
}

/**
 * ADR-0005 section 7 tests 2 and 3: byte-identical canonical JSON across
 * latency profiles and body segmentations.
 */
export function expectDeterministic(
  runs: readonly RuleContractRun[],
  labels: readonly string[] = [],
): void {
  const first = runs[0];
  if (first === undefined) {
    fail("expectDeterministic needs at least one run");
  }
  runs.forEach((run, index) => {
    if (run.canonicalJson !== first.canonicalJson) {
      fail(
        `run ${labels[index] ?? String(index)} produced different canonical JSON from run ${labels[0] ?? "0"}`,
      );
    }
  });
}

/** Nothing opened a socket to the canary. */
export function expectNoConnections(canary: ConnectionCanary): void {
  if (canary.connections !== 0) {
    fail(
      `${String(canary.connections)} connection(s) reached the canary at ${canary.origin}: ${list(canary.peers)}`,
    );
  }
}
