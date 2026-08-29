import {
  DEFAULT_NETWORK_BUDGET,
  canonicalRequestKey,
  createRuleState,
  resolveObservationRequest,
  sha256Hex,
} from "@agentready-lab/core";
import type {
  DnsTransportQuery,
  DnsTransportResult,
  HttpTransportRequest,
  HttpTransportResult,
  NetworkProfileId,
  NetworkScope,
  ObservationRequest,
  PlanningContext,
  Transport,
  TransportFailure,
} from "@agentready-lab/core";

import { ticks } from "../determinism/ticks.js";
import type { CannedDnsResult, CannedHttpResult } from "./responses.js";
import { failWith } from "./responses.js";

/**
 * The in-memory transport of `docs/TEST_STRATEGY.md` section 3.
 *
 * Three properties are the reason this exists rather than an ad-hoc stub per
 * test file.
 *
 * It never throws. ADR-0003 and `docs/THREAT_MODEL.md` section 26 make that
 * the transport contract, and it is not optional for a test double: core's
 * `callTransport` catches whatever escapes and converts it to
 * `connection-failed`, so an exception thrown here would not fail a test, it
 * would quietly become a different observation. Everything this transport
 * wants to complain about is therefore recorded and asserted afterwards.
 *
 * It records every request it was asked to issue, so "no unexpected request"
 * and "expected request representation, including `Accept`"
 * (`docs/TEST_STRATEGY.md` section 6) are assertable.
 *
 * Its routes are keyed by `canonicalRequestKey`, the engine's own key, called
 * here rather than reimplemented. Two probes differing only by `Accept`,
 * redirect policy, redirect count, `maxEncodedBytes`, `maxDecodedBytes` or
 * network scope are different routes here for exactly the reason they are two
 * dispatches there (ADR-0005 section 3). A URL-keyed table would answer both
 * `Accept` variants with one body, and the test would pass while the
 * deduplication contract was broken.
 */

export interface HttpRouteSpec {
  /** The canonical effective URL, as the engine computes it. */
  readonly url: string;
  readonly method?: "GET" | "HEAD";
  readonly accept?: string;
  readonly redirects?: "follow-same-origin" | "reject";
  readonly maxRedirects?: number;
  readonly maxEncodedBytes?: number;
  readonly maxDecodedBytes?: number;
}

export interface DnsRouteSpec {
  readonly name: string;
  readonly recordType: string;
}

/**
 * What an unspecified `HttpRouteSpec` field means.
 *
 * The byte caps default to the whole-scan ceilings because that is what a rule
 * asking for no cap of its own gets (`effectiveLimit` in
 * `plan-observations.ts`). A rule that lowers a cap changes its dedup key, so
 * a route for it has to say so; `routeObservation` derives that from the
 * rule's own request rather than asking the test author to restate it.
 */
export interface RouteDefaults {
  readonly method: "GET" | "HEAD";
  readonly accept: string;
  readonly redirects: "follow-same-origin" | "reject";
  readonly maxRedirects: number;
  readonly maxEncodedBytes: number;
  readonly maxDecodedBytes: number;
}

export const DEFAULT_ROUTE_DEFAULTS: RouteDefaults = {
  method: "GET",
  accept: "*/*",
  redirects: "follow-same-origin",
  maxRedirects: DEFAULT_NETWORK_BUDGET.maxRedirects,
  maxEncodedBytes: DEFAULT_NETWORK_BUDGET.maxEncodedResponseBytes,
  maxDecodedBytes: DEFAULT_NETWORK_BUDGET.maxDecodedResponseBytes,
};

export interface InMemoryTransportOptions {
  /** Must match the scan target's scope, or no route key can ever match. */
  readonly scope?: NetworkScope;
  readonly networkProfile?: NetworkProfileId;
  readonly defaults?: Partial<RouteDefaults>;
  /**
   * Whether this transport serves the `dns` runtime. Absent by default:
   * `transportCapabilities` derives capability from the presence of the
   * method, and M1 ships no DNS rule, so a rule declaring `dns` must resolve
   * to `unsupported-runtime` against the default transport.
   */
  readonly dns?: boolean;
}

export interface RecordedHttpRequest {
  readonly kind: "http";
  readonly key: string;
  readonly method: "GET" | "HEAD";
  readonly url: string;
  readonly headers: ReadonlyMap<string, readonly string[]>;
  /** The `Accept` field values, which are the M1 representation headers. */
  readonly accept: readonly string[];
  readonly redirects: "follow-same-origin" | "reject";
  readonly maxRedirects: number;
  readonly maxEncodedBytes: number;
  readonly maxDecodedBytes: number;
  readonly scanRemainingEncodedBytes: number;
  readonly scanRemainingDecodedBytes: number;
  readonly matched: boolean;
}

export interface RecordedDnsRequest {
  readonly kind: "dns";
  readonly key: string;
  readonly name: string;
  readonly recordType: string;
  readonly timeoutMs: number;
  readonly matched: boolean;
}

export type RecordedRequest = RecordedHttpRequest | RecordedDnsRequest;

export interface DispatchEvent {
  readonly event: "dispatched" | "settled";
  readonly key: string;
  readonly label: string;
}

export class InMemoryTransport implements Transport {
  readonly #scope: NetworkScope;
  readonly #networkProfile: NetworkProfileId;
  readonly #defaults: RouteDefaults;
  readonly #httpRoutes = new Map<string, CannedHttpResult>();
  readonly #dnsRoutes = new Map<string, CannedDnsResult>();
  readonly #requests: RecordedRequest[] = [];
  readonly #sequence: DispatchEvent[] = [];
  readonly #violations: string[] = [];
  #inFlight = false;

  /**
   * Present only when the transport was built with `dns: true`.
   *
   * `transportCapabilities` reads the presence of this method and nothing
   * else, so this is how a test chooses between a transport that serves the
   * `dns` runtime and one that does not.
   */
  dns?: (query: DnsTransportQuery) => Promise<DnsTransportResult>;

  constructor(options: InMemoryTransportOptions = {}) {
    this.#scope = options.scope ?? "local";
    this.#networkProfile = options.networkProfile ?? "local-loopback";
    this.#defaults = { ...DEFAULT_ROUTE_DEFAULTS, ...options.defaults };
    if (options.dns === true) {
      this.dns = (query: DnsTransportQuery): Promise<DnsTransportResult> =>
        this.#dns(query);
    }
  }

  /** Every request the engine asked for, in dispatch order. */
  get requests(): readonly RecordedRequest[] {
    return [...this.#requests];
  }

  get httpRequests(): readonly RecordedHttpRequest[] {
    return this.#requests.filter(
      (request): request is RecordedHttpRequest => request.kind === "http",
    );
  }

  /** Requested URLs in dispatch order, including repeats. */
  get urls(): readonly string[] {
    return this.httpRequests.map((request) => request.url);
  }

  /** Requests for which no route was registered, in dispatch order. */
  get unmatched(): readonly RecordedRequest[] {
    return this.#requests.filter((request) => !request.matched);
  }

  /** A `(dispatched, settled)` trace, for ADR-0005 section 7 test 2. */
  get sequence(): readonly DispatchEvent[] {
    return [...this.#sequence];
  }

  /**
   * Serial-dispatch violations, recorded rather than thrown.
   *
   * ADR-0005 section 1 makes serial dispatch the mechanism the whole
   * determinism argument rests on, and section 7 test 1 requires it to be
   * enforced rather than intended.
   */
  get violations(): readonly string[] {
    return [...this.#violations];
  }

  get callCount(): number {
    return this.#requests.length;
  }

  /** The canonical key an HTTP route spec resolves to. */
  httpRouteKey(spec: HttpRouteSpec): string {
    const merged = { ...this.#defaults, ...spec };
    return canonicalRequestKey({
      kind: "http",
      method: merged.method,
      url: merged.url,
      representationHeaders: new Map([["accept", [merged.accept]]]),
      redirects: merged.redirects,
      maxRedirects: merged.maxRedirects,
      maxEncodedBytes: merged.maxEncodedBytes,
      maxDecodedBytes: merged.maxDecodedBytes,
      scope: this.#scope,
      networkProfile: this.#networkProfile,
    });
  }

  dnsRouteKey(spec: DnsRouteSpec): string {
    return canonicalRequestKey({
      kind: "dns",
      name: spec.name,
      recordType: spec.recordType,
      scope: this.#scope,
      networkProfile: this.#networkProfile,
    });
  }

  route(spec: HttpRouteSpec, result: CannedHttpResult): this {
    this.#httpRoutes.set(this.httpRouteKey(spec), result);
    return this;
  }

  routeDns(spec: DnsRouteSpec, result: CannedDnsResult): this {
    this.#dnsRoutes.set(this.dnsRouteKey(spec), result);
    return this;
  }

  /**
   * Registers a route under the key the engine will actually produce for one
   * of a rule's own `ObservationRequest`s.
   *
   * This calls `resolveObservationRequest`, the engine's own resolution, so a
   * rule that lowers `maxDecodedBytes` or asks for a discovered URL cannot end
   * up with a route the engine will never look up. A route spec restated by
   * hand can drift from the rule; this cannot.
   */
  routeObservation(
    request: ObservationRequest,
    context: PlanningContext,
    result: CannedHttpResult | CannedDnsResult,
  ): this {
    const resolution = resolveObservationRequest(
      request,
      context,
      createRuleState("@agentready-lab/testkit"),
      () => true,
    );
    if (resolution.refusal !== null) {
      throw new Error(
        `the engine refuses request ${request.id} (${resolution.refusal.code}), so no route can ever match it`,
      );
    }
    if (resolution.request.kind === "dns") {
      this.#dnsRoutes.set(resolution.key, asDnsResult(request.id, result));
    } else {
      this.#httpRoutes.set(resolution.key, asHttpResult(request.id, result));
    }
    return this;
  }

  async http(request: HttpTransportRequest): Promise<HttpTransportResult> {
    const key = canonicalRequestKey({
      kind: "http",
      method: request.method,
      url: request.url,
      representationHeaders: request.headers,
      redirects: request.redirects,
      maxRedirects: request.maxRedirects,
      maxEncodedBytes: request.maxEncodedBytes,
      maxDecodedBytes: request.maxDecodedBytes,
      scope: this.#scope,
      networkProfile: this.#networkProfile,
    });
    const route = this.#httpRoutes.get(key);
    this.#requests.push({
      kind: "http",
      key,
      method: request.method,
      url: request.url,
      headers: request.headers,
      accept: request.headers.get("accept") ?? [],
      redirects: request.redirects,
      maxRedirects: request.maxRedirects,
      maxEncodedBytes: request.maxEncodedBytes,
      maxDecodedBytes: request.maxDecodedBytes,
      scanRemainingEncodedBytes: request.scanRemainingEncodedBytes,
      scanRemainingDecodedBytes: request.scanRemainingDecodedBytes,
      matched: route !== undefined,
    });

    return await this.#settle(
      key,
      `${request.method} ${request.url}`,
      async (): Promise<HttpTransportResult> =>
        route === undefined ? unroutedFailure() : this.#deliver(request, route),
    );
  }

  async #dns(query: DnsTransportQuery): Promise<DnsTransportResult> {
    const key = this.dnsRouteKey({
      name: query.name,
      recordType: query.recordType,
    });
    const route = this.#dnsRoutes.get(key);
    this.#requests.push({
      kind: "dns",
      key,
      name: query.name,
      recordType: query.recordType,
      timeoutMs: query.timeoutMs,
      matched: route !== undefined,
    });

    return await this.#settle(
      key,
      `${query.recordType} ${query.name}`,
      async (): Promise<DnsTransportResult> => {
        await ticks(1);
        return route ?? unroutedFailure();
      },
    );
  }

  /**
   * Wraps one call with the dispatch trace and the serial-dispatch check.
   *
   * The check records instead of throwing, because a throw from here is caught
   * by the engine's `callTransport` and turned into a `connection-failed`
   * observation. A recorded violation survives to the assertion.
   */
  async #settle<T>(
    key: string,
    label: string,
    call: () => Promise<T>,
  ): Promise<T> {
    if (this.#inFlight) {
      this.#violations.push(
        `${label} was dispatched before the previous observation settled`,
      );
    }
    this.#inFlight = true;
    this.#sequence.push({ event: "dispatched", key, label });
    try {
      return await call();
    } finally {
      this.#sequence.push({ event: "settled", key, label });
      this.#inFlight = false;
    }
  }

  /**
   * ADR-0003 section 4: the transport stops at whichever of the per-response
   * cap and the whole-scan remainder it reaches first, and says which one
   * bound. The per-byte loop is what makes the answer independent of how the
   * body was segmented (ADR-0005 section 7 test 3).
   */
  async #deliver(
    request: HttpTransportRequest,
    response: CannedHttpResult,
  ): Promise<HttpTransportResult> {
    if (response.kind === "failure") {
      await ticks(1);
      return response;
    }

    await ticks(response.latencyTicks);

    const declaredEncoded =
      response.encodedBytes ??
      response.chunks.reduce((total, chunk) => total + chunk.length, 0);
    if (
      declaredEncoded >
      Math.min(request.maxEncodedBytes, request.scanRemainingEncodedBytes)
    ) {
      return overLimit(
        request.scanRemainingEncodedBytes < request.maxEncodedBytes,
      );
    }

    const allowance = Math.min(
      request.maxDecodedBytes,
      request.scanRemainingDecodedBytes,
    );
    const scanBinds =
      request.scanRemainingDecodedBytes < request.maxDecodedBytes;

    const kept: number[] = [];
    for (const chunk of response.chunks) {
      await ticks(1);
      for (const byte of chunk) {
        if (kept.length >= allowance) return overLimit(scanBinds);
        kept.push(byte);
      }
    }

    const body = Uint8Array.from(kept);
    return {
      kind: "response",
      status: response.status,
      effectiveUrl: response.effectiveUrl ?? request.url,
      headers: response.headers,
      body,
      truncated: response.truncated,
      encodedBytes: declaredEncoded,
      decodedBytes: body.length,
      bodySha256: await sha256Hex(body),
      redirects: response.redirects,
    };
  }

  /**
   * A ready-to-paste registration for every request no route answered.
   *
   * A test whose route key is one field off otherwise fails as
   * `connection-failed`, which reads as a rule bug and is a harness bug.
   */
  describeUnmatched(): string {
    return this.unmatched
      .map((request) =>
        request.kind === "http"
          ? `  transport.route({ url: ${JSON.stringify(request.url)}, method: ${JSON.stringify(request.method)}, accept: ${JSON.stringify(request.accept[0] ?? "")}, redirects: ${JSON.stringify(request.redirects)}, maxRedirects: ${String(request.maxRedirects)}, maxEncodedBytes: ${String(request.maxEncodedBytes)}, maxDecodedBytes: ${String(request.maxDecodedBytes)} }, respond())`
          : `  transport.routeDns({ name: ${JSON.stringify(request.name)}, recordType: ${JSON.stringify(request.recordType)} }, dnsAnswer())`,
      )
      .join("\n");
  }
}

function overLimit(scanBinds: boolean): TransportFailure {
  return failWith(
    scanBinds
      ? { code: "scan-byte-budget-exceeded", phase: "body" }
      : { code: "response-too-large", phase: "body" },
  );
}

/**
 * What an unrouted request settles as.
 *
 * `connection-failed`, and never a thrown error, because the transport
 * contract forbids throwing. It is the one failure a test should not rely on:
 * the `unmatched` list is how a missing route is meant to be discovered.
 */
function unroutedFailure(): TransportFailure {
  return failWith({ code: "connection-failed", phase: "connect" });
}

function asHttpResult(
  id: string,
  result: CannedHttpResult | CannedDnsResult,
): CannedHttpResult {
  if (result.kind === "answer") {
    throw new Error(
      `request ${id} is an HTTP request and needs an HTTP result`,
    );
  }
  return result;
}

function asDnsResult(
  id: string,
  result: CannedHttpResult | CannedDnsResult,
): CannedDnsResult {
  if (result.kind === "response") {
    throw new Error(`request ${id} is a DNS query and needs a DNS result`);
  }
  return result;
}
