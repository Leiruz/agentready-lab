import { toPublicError } from "../model/observation-error.js";
import type { ObservationFailure } from "../model/observation-error.js";
import type { ProbeObservation } from "../model/observation.js";
import type { DnsTransportResult, Transport } from "../probe/transport.js";
import type { PlannedObservation, ResolvedRequest } from "./admission.js";
import type { NetworkBudget, ScanByteLedger } from "./scan-budget.js";

/**
 * ADR-0005 section 1. Observations execute serially, in stable plan order.
 *
 * The `for ... await` below is the whole mechanism, and it is load-bearing
 * rather than incidental. Serial execution in a fixed order makes every shared
 * budget deterministic for free: bytes are consumed in one total order that is
 * a function of the plan and of the target's own bytes, so the observation
 * that crosses a whole-scan threshold is the same observation on every run. A
 * `Promise.all` here would not be an optimization, it would put the exit code
 * back under the network's control.
 *
 * `network.maxConcurrency` above 1 is refused at configuration time
 * (`assertSupportedConcurrency`) rather than clamped here, so this file has no
 * concurrency setting to read.
 */

function errorObservation(
  evidenceId: string,
  request: ResolvedRequest,
  failure: ObservationFailure,
): ProbeObservation {
  const error = toPublicError(failure);
  if (request.kind === "dns") {
    return {
      kind: "dns",
      id: evidenceId,
      query: { name: request.name, recordType: request.recordType },
      outcome: { kind: "error", error },
    };
  }
  return {
    kind: "http",
    id: evidenceId,
    request: {
      method: request.kind === "http" ? request.method : "GET",
      url: request.kind === "http" ? request.url : request.raw,
      headers: request.kind === "http" ? request.headers : new Map(),
    },
    outcome: { kind: "error", error },
  };
}

/**
 * Freezes the observation graph handed to rules.
 *
 * Two things are deliberately not frozen, and naming them is more useful than
 * implying a guarantee that does not hold. `Object.freeze` on a non-empty
 * `Uint8Array` throws, and freezing a `Map` does not stop `Map.prototype.set`,
 * so the body bytes and the header maps stay mutable by a rule that casts away
 * `readonly`. ADR-0002 section 11 restricts *memo* values to shapes a freeze
 * can immobilize for exactly this reason; `HttpObservation` is required by
 * ADR-0002 section 4 to carry both, so the same guarantee is not available
 * here. What this does buy is that the outcome discriminant, the status, the
 * digest, the byte counts and the redirect facts cannot be rewritten.
 */
function freezeObservation(observation: ProbeObservation): ProbeObservation {
  Object.freeze(observation);
  Object.freeze(observation.outcome);
  if (observation.kind === "http") {
    Object.freeze(observation.request);
    if (observation.outcome.kind === "response") {
      Object.freeze(observation.outcome.redirects);
      for (const redirect of observation.outcome.redirects) {
        Object.freeze(redirect);
      }
    } else {
      Object.freeze(observation.outcome.error);
    }
    return observation;
  }
  Object.freeze(observation.query);
  if (observation.outcome.kind === "answer") {
    Object.freeze(observation.outcome.records);
    for (const record of observation.outcome.records) Object.freeze(record);
  } else {
    Object.freeze(observation.outcome.error);
  }
  return observation;
}

export interface DispatchInput {
  readonly transport: Transport;
  readonly plan: readonly PlannedObservation[];
  readonly budget: NetworkBudget;
  readonly byteLedger: ScanByteLedger;
}

export async function dispatchRound(
  input: DispatchInput,
): Promise<ReadonlyMap<string, ProbeObservation>> {
  const observations = new Map<string, ProbeObservation>();

  for (const entry of input.plan) {
    // Request N+1 is not started until request N has settled, for every
    // settlement kind: a response, a transport failure, a denied reservation
    // and a refused discovered URL all land here before the loop continues.
    const observation = await dispatchOne(input, entry);
    observations.set(entry.evidenceId, freezeObservation(observation));
  }

  return observations;
}

async function dispatchOne(
  input: DispatchInput,
  entry: PlannedObservation,
): Promise<ProbeObservation> {
  if (entry.failure !== null) {
    // A denied reservation and a refused discovered URL open no socket.
    return errorObservation(entry.evidenceId, entry.request, entry.failure);
  }

  const request = entry.request;
  if (request.kind === "refused") {
    // Unreachable: a refused request always carries its failure. Kept as a
    // total branch rather than a cast, because the alternative is a non-null
    // assertion on `entry.failure`.
    return errorObservation(entry.evidenceId, request, {
      code: "invalid-url",
      phase: "policy",
    });
  }

  if (request.kind === "dns") {
    const query = {
      name: request.name,
      recordType: request.recordType,
      timeoutMs: input.budget.dnsTimeoutMs,
    };
    // `?.()` rather than a saved method reference: it keeps `this` bound to
    // the transport, and a transport without `dns` is the M4 case, where the
    // observation is `unsupported-runtime` and never `fail` (ADR-0002
    // section 4).
    const result = await callTransport(
      async (): Promise<DnsTransportResult> =>
        (await input.transport.dns?.(query)) ?? {
          kind: "failure",
          reason: { code: "runtime-unsupported", phase: "runtime" },
        },
    );
    if (result.kind === "failure") {
      return errorObservation(entry.evidenceId, request, result.reason);
    }
    return {
      kind: "dns",
      id: entry.evidenceId,
      query: { name: request.name, recordType: request.recordType },
      outcome: {
        kind: "answer",
        rcode: result.rcode,
        records: result.records,
        dnssec: result.dnssec,
      },
    };
  }

  const result = await callTransport(() =>
    input.transport.http({
      method: request.method,
      url: request.url,
      headers: request.headers,
      redirects: request.redirects,
      maxRedirects: request.maxRedirects,
      maxEncodedBytes: request.maxEncodedBytes,
      maxDecodedBytes: request.maxDecodedBytes,
      scanRemainingEncodedBytes: input.byteLedger.remainingEncoded,
      scanRemainingDecodedBytes: input.byteLedger.remainingDecoded,
      connectTimeoutMs: input.budget.connectTimeoutMs,
      requestTimeoutMs: input.budget.perRequestTimeoutMs,
    }),
  );

  if (result.kind === "failure") {
    return errorObservation(entry.evidenceId, request, result.reason);
  }

  input.byteLedger.consume(result.encodedBytes, result.decodedBytes);
  return {
    kind: "http",
    id: entry.evidenceId,
    request: {
      method: request.method,
      url: request.url,
      headers: request.headers,
    },
    outcome: {
      kind: "response",
      status: result.status,
      effectiveUrl: result.effectiveUrl,
      headers: result.headers,
      body: result.body,
      truncated: result.truncated,
      encodedBytes: result.encodedBytes,
      decodedBytes: result.decodedBytes,
      bodySha256: result.bodySha256,
      redirects: result.redirects,
    },
  };
}

/**
 * The second line of defence behind "a transport must never throw".
 *
 * ADR-0003 section 3 requires the transport's own classifier to have a total
 * default branch producing `connection-failed`, so nothing should arrive here.
 * If something does, the exception is discarded rather than described: the
 * public message comes from the constant table, so no library exception text,
 * hostname or resolved address can reach the report through this path.
 */
async function callTransport<T extends { readonly kind: string }>(
  call: () => Promise<T>,
): Promise<
  T | { readonly kind: "failure"; readonly reason: ObservationFailure }
> {
  try {
    return await call();
  } catch {
    return {
      kind: "failure",
      reason: { code: "connection-failed", phase: "connect" },
    };
  }
}
