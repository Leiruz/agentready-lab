import type { PublicObservationError } from "./observation-error.js";

/**
 * ADR-0002 section 4. What a rule asks for, and what it is handed back.
 *
 * `ProbeObservation` carries the bounded decoded body; `PublicEvidence` does
 * not. The rule sees bytes, the report sees a digest and a length.
 */

/** Where a discovered URL was read from. Required, and checked by the engine. */
export interface DiscoveredProvenance {
  /** A rule-local observation id from a completed round. */
  readonly fromObservation: string;
  /** JSON Pointer, header field name, or `robots.txt` line number. */
  readonly locator: string;
}

export type ObservationTarget =
  | { readonly kind: "page" }
  | { readonly kind: "origin-path"; readonly path: string }
  | {
      readonly kind: "discovered";
      readonly url: string;
      readonly provenance: DiscoveredProvenance;
    };

export interface HttpObservationRequest {
  readonly kind: "http";
  /** Unique within one rule for the whole scan. Never an evidence id. */
  readonly id: string;
  readonly method: "GET" | "HEAD";
  readonly target: ObservationTarget;
  readonly accept: string;
  readonly redirects: "follow-same-origin" | "reject";
  readonly maxEncodedBytes: number;
  readonly maxDecodedBytes: number;
}

export type DnsQueryName =
  | { readonly kind: "target-host" }
  | { readonly kind: "target-host-prefixed"; readonly prefix: string }
  | {
      readonly kind: "discovered";
      readonly name: string;
      readonly provenance: DiscoveredProvenance;
    };

export interface DnsObservationRequest {
  readonly kind: "dns";
  readonly id: string;
  readonly name: DnsQueryName;
  readonly recordType: "A" | "AAAA" | "TXT" | "SVCB" | "URI";
}

export type ObservationRequest = HttpObservationRequest | DnsObservationRequest;

export interface RedirectFact {
  readonly status: number;
  readonly location: string;
  readonly decision: "followed" | "blocked";
}

export interface HttpObservation {
  readonly kind: "http";
  readonly id: string;
  readonly request: {
    readonly method: "GET" | "HEAD";
    readonly url: string;
    readonly headers: ReadonlyMap<string, readonly string[]>;
  };
  readonly outcome:
    | {
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
    | { readonly kind: "error"; readonly error: PublicObservationError };
}

export interface DnsRecordFact {
  readonly type: string;
  readonly value: string;
}

export type DnssecState = "secure" | "insecure" | "bogus" | "indeterminate";

export interface DnsObservation {
  readonly kind: "dns";
  readonly id: string;
  readonly query: { readonly name: string; readonly recordType: string };
  readonly outcome:
    | {
        readonly kind: "answer";
        readonly rcode: string;
        readonly records: readonly DnsRecordFact[];
        readonly dnssec: DnssecState;
      }
    | { readonly kind: "error"; readonly error: PublicObservationError };
}

export type ProbeObservation = HttpObservation | DnsObservation;

/**
 * ADR-0002 section 7. The rule says where a discovered URL came from; the
 * engine decides whether it may be requested.
 */
export type DiscoveredRejection =
  | "malformed"
  | "userinfo"
  | "fragment"
  | "forbidden-scheme"
  | "forbidden-port"
  | "cross-origin"
  | "unsafe-query"
  | "unknown-provenance";

export type DiscoveredDecision =
  | { readonly kind: "authorized"; readonly url: string }
  | { readonly kind: "rejected"; readonly reason: DiscoveredRejection };
