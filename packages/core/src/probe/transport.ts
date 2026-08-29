import type { ObservationFailure } from "../model/observation-error.js";
import type {
  DnsRecordFact,
  DnssecState,
  RedirectFact,
} from "../model/observation.js";
import type { ObservationRuntime } from "../model/status.js";

/**
 * The transport interface. Core declares it; core implements none of it.
 *
 * `docs/ARCHITECTURE.md` section 4 makes `packages/transport-node` the only
 * package allowed to make target requests, and core the package that must not
 * import it. So the direction is inverted here: core owns the shape, and the
 * implementation depends on core.
 *
 * **A transport must never throw.** Every failure is a typed result carrying
 * an `ObservationFailure` (ADR-0003). `docs/THREAT_MODEL.md` section 26 states
 * that raw exceptions do not cross the transport boundary; a result type is
 * what makes that structural instead of a review item. The engine treats an
 * exception that escapes anyway as a transport defect and converts it to a
 * typed failure, but the contract is that it cannot happen.
 */

export interface HttpTransportRequest {
  readonly method: "GET" | "HEAD";
  /** The canonical absolute URL. Already fragment-free and origin-checked. */
  readonly url: string;
  readonly headers: ReadonlyMap<string, readonly string[]>;
  readonly redirects: "follow-same-origin" | "reject";
  readonly maxRedirects: number;
  /**
   * This response's own byte caps, already reduced to the minimum across
   * configuration, policy and rule request (ADR-0004 section 9).
   */
  readonly maxEncodedBytes: number;
  readonly maxDecodedBytes: number;
  /**
   * What is left of the whole-scan budgets at dispatch time. ADR-0003
   * section 4: the transport stops at whichever of the two bounds it reaches
   * first and reports `response-too-large` or `scan-byte-budget-exceeded`
   * accordingly. ADR-0005 section 1's serial execution is what makes these
   * well-defined numbers at dispatch time.
   */
  readonly scanRemainingEncodedBytes: number;
  readonly scanRemainingDecodedBytes: number;
  readonly connectTimeoutMs: number;
  readonly requestTimeoutMs: number;
}

export interface HttpTransportResponse {
  readonly kind: "response";
  readonly status: number;
  readonly effectiveUrl: string;
  readonly headers: ReadonlyMap<string, readonly string[]>;
  readonly body: Uint8Array;
  readonly truncated: boolean;
  readonly encodedBytes: number;
  readonly decodedBytes: number;
  readonly bodySha256: string;
  readonly redirects: readonly RedirectFact[];
}

export interface TransportFailure {
  readonly kind: "failure";
  readonly reason: ObservationFailure;
}

export type HttpTransportResult = HttpTransportResponse | TransportFailure;

export interface DnsTransportQuery {
  readonly name: string;
  readonly recordType: string;
  readonly timeoutMs: number;
}

export interface DnsTransportAnswer {
  readonly kind: "answer";
  readonly rcode: string;
  readonly records: readonly DnsRecordFact[];
  readonly dnssec: DnssecState;
}

export type DnsTransportResult = DnsTransportAnswer | TransportFailure;

export interface Transport {
  http(request: HttpTransportRequest): Promise<HttpTransportResult>;
  /**
   * Absent until `dns.discovery.dns-aid` ships at M4. A rule whose declared
   * `observationRuntime` includes `dns` against a transport without this
   * method resolves to `unsupported-runtime` before `plan()` is called, and
   * never to `fail` (ADR-0002 section 4).
   */
  dns?(query: DnsTransportQuery): Promise<DnsTransportResult>;
}

/**
 * The runtimes a transport can serve, derived from which methods it has.
 *
 * Deliberately derived rather than declared. A separate `capabilities` field
 * would be a second statement of the same fact, free to disagree with the
 * first, and the engine would have no way to tell which one was wrong.
 */
export function transportCapabilities(
  transport: Transport,
): readonly ObservationRuntime[] {
  return transport.dns === undefined ? ["http"] : ["http", "dns"];
}
