import type {
  DnsRecordFact,
  DnsTransportAnswer,
  DnssecState,
  ObservationFailure,
  PublicErrorCode,
  RedirectFact,
  TransportFailure,
} from "@agentready-lab/core";

/**
 * The canned results an in-memory transport can be asked to return.
 *
 * A canned response is a description rather than an `HttpTransportResponse`,
 * for two reasons. The digest is `sha256Hex`, which is asynchronous because
 * core computes it with WebCrypto, and route registration has to stay
 * synchronous. And the delivered bytes are not known until dispatch: the
 * request carries the effective caps and the remaining whole-scan budget, and
 * ADR-0003 section 4 makes the transport stop at whichever bound it reaches
 * first.
 */
export interface CannedResponse {
  readonly kind: "response";
  readonly status: number;
  readonly headers: ReadonlyMap<string, readonly string[]>;
  /** Concatenated, these are the decoded bytes. Delivered in this order. */
  readonly chunks: readonly Uint8Array[];
  /** Defaults to the decoded length: an in-memory body is not compressed. */
  readonly encodedBytes?: number;
  readonly truncated: boolean;
  /** Defaults to the requested URL. */
  readonly effectiveUrl?: string;
  readonly redirects: readonly RedirectFact[];
  /** Microtask ticks awaited before the first chunk. */
  readonly latencyTicks: number;
}

export type CannedHttpResult = CannedResponse | TransportFailure;
export type CannedDnsResult = DnsTransportAnswer | TransportFailure;

export interface RespondInit {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string | readonly string[]>>;
  readonly body?: string | Uint8Array | readonly Uint8Array[];
  readonly encodedBytes?: number;
  readonly truncated?: boolean;
  readonly effectiveUrl?: string;
  readonly redirects?: readonly RedirectFact[];
  readonly latencyTicks?: number;
}

function toChunks(
  body: string | Uint8Array | readonly Uint8Array[] | undefined,
): readonly Uint8Array[] {
  if (body === undefined) return [new Uint8Array(0)];
  if (typeof body === "string") return [new TextEncoder().encode(body)];
  if (body instanceof Uint8Array) return [body];
  return body.length === 0 ? [new Uint8Array(0)] : body;
}

/**
 * Header field names are lowercased here, not at delivery.
 *
 * `buildEvidence` looks its allowlist up by lowercase name and
 * `canonicalRequestKey` lowercases too, so a canned `Content-Type` that stayed
 * capitalized would silently vanish from evidence.
 */
function toHeaderMap(
  headers: Readonly<Record<string, string | readonly string[]>> | undefined,
): ReadonlyMap<string, readonly string[]> {
  const map = new Map<string, readonly string[]>();
  for (const [name, value] of Object.entries(headers ?? {})) {
    const lower = name.toLowerCase();
    const values = typeof value === "string" ? [value] : [...value];
    map.set(lower, [...(map.get(lower) ?? []), ...values]);
  }
  return map;
}

export function respond(init: RespondInit = {}): CannedResponse {
  return {
    kind: "response",
    status: init.status ?? 200,
    headers: toHeaderMap(init.headers),
    chunks: toChunks(init.body),
    ...(init.encodedBytes === undefined
      ? {}
      : { encodedBytes: init.encodedBytes }),
    truncated: init.truncated ?? false,
    ...(init.effectiveUrl === undefined
      ? {}
      : { effectiveUrl: init.effectiveUrl }),
    redirects: init.redirects ?? [],
    latencyTicks: init.latencyTicks ?? 0,
  };
}

export interface DnsAnswerInit {
  readonly rcode?: string;
  readonly records?: readonly DnsRecordFact[];
  readonly dnssec?: DnssecState;
}

export function dnsAnswer(init: DnsAnswerInit = {}): DnsTransportAnswer {
  return {
    kind: "answer",
    rcode: init.rcode ?? "NOERROR",
    records: init.records ?? [],
    dnssec: init.dnssec ?? "insecure",
  };
}

/** Any internal reason, for a test that needs one core does not raise here. */
export function failWith(reason: ObservationFailure): TransportFailure {
  return { kind: "failure", reason };
}

/**
 * One internal reason per public error code of ADR-0003 section 3.
 *
 * `docs/TEST_STRATEGY.md` section 2.3 requires a case per finding code, and a
 * rule that has to behave differently on `tls-failed` and `connect-timeout`
 * needs a way to reach each of them. The projection is many-to-one, so this
 * table is one arbitrary preimage per code and nothing more; a test asserts
 * that `toPublicError` sends each entry back to the code it is filed under,
 * which is what stops the table drifting from `toPublicError` in silence.
 *
 * Four of the fifteen are not transport conditions at all. `parse-failed` and
 * `resource-budget-exhausted` belong to a parser, and `request-budget-
 * exhausted` and `aborted` to the engine. They are here because
 * `TransportFailure.reason` is the whole `ObservationFailure` union and a rule
 * contract test needs to see the rule's behaviour on every public code, not
 * only on the ones a socket can produce.
 */
export const PUBLIC_ERROR_REASONS: Readonly<
  Record<PublicErrorCode, ObservationFailure>
> = {
  "url-policy-blocked": { code: "prohibited-scheme", phase: "policy" },
  "dns-resolution-failed": { code: "dns-failure", phase: "dns" },
  "dns-answer-blocked": { code: "unsafe-address", phase: "dns" },
  "connect-timeout": { code: "timeout", phase: "connect" },
  "connection-failed": { code: "connection-failed", phase: "connect" },
  "tls-failed": { code: "tls-failure", phase: "tls" },
  "request-timeout": { code: "timeout", phase: "request" },
  "redirect-limit": { code: "redirect-limit", phase: "redirect" },
  "request-budget-exhausted": {
    code: "scan-byte-budget-exceeded",
    phase: "body",
  },
  "resource-budget-exhausted": {
    code: "parser-budget-exceeded",
    phase: "parse",
  },
  "response-limit": { code: "response-too-large", phase: "body" },
  "decode-failed": { code: "decompression-failure", phase: "decode" },
  "parse-failed": { code: "parse-failure", phase: "parse" },
  aborted: { code: "caller-cancelled", phase: "runtime" },
  "unsupported-runtime": { code: "runtime-unsupported", phase: "runtime" },
};

/**
 * The same fifteen codes as a list, sorted, for a test that has to iterate
 * them.
 *
 * `satisfies` proves every member is a real code; a test proves the list and
 * the table above have the same members, which is the direction `satisfies`
 * cannot check.
 */
export const REACHABLE_PUBLIC_ERROR_CODES = [
  "aborted",
  "connect-timeout",
  "connection-failed",
  "decode-failed",
  "dns-answer-blocked",
  "dns-resolution-failed",
  "parse-failed",
  "redirect-limit",
  "request-budget-exhausted",
  "request-timeout",
  "resource-budget-exhausted",
  "response-limit",
  "tls-failed",
  "unsupported-runtime",
  "url-policy-blocked",
] as const satisfies readonly PublicErrorCode[];

/** A transport failure that reaches the rule as exactly `code`. */
export function failure(code: PublicErrorCode): TransportFailure {
  return { kind: "failure", reason: PUBLIC_ERROR_REASONS[code] };
}
