import type { PublicObservationError } from "./observation-error.js";
import type {
  RedirectFact,
  DnsRecordFact,
  DnssecState,
} from "./observation.js";
import type { RuleResult } from "./rule.js";
import type {
  InterpretationMode,
  NetworkProfileId,
  NetworkScope,
  ProfileId,
} from "./status.js";

/**
 * `docs/ARCHITECTURE.md` section 9, as amended by ADR-0004 section 8 and
 * ADR-0007 section 1.
 *
 * The canonical report omits wall-clock timestamps, random ids and durations.
 * Operational metadata belongs in `ReportEnvelopeV1`, which core never builds.
 */

/** ADR-0007 section 1. Projected from the source ledger, cited entries only. */
export interface ReportSource {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly kind: string;
  readonly status: string;
  readonly version?: string;
  readonly verifiedAt: string;
}

export interface ExternalSnapshotRef {
  /** `snapshot.captured_at` of `specs/checks.v0.yaml`. */
  readonly capturedAt: string;
  /** `schema_version` of that file. */
  readonly schemaVersion: string;
}

/** ADR-0004 section 8. Four kinds plus `redacted`, and no free-form blob. */
export type EffectiveOptionValue =
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "integer"; readonly value: number }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "string-list"; readonly value: readonly string[] }
  | { readonly kind: "redacted" };

export interface EffectiveRuleOptions {
  readonly ruleId: string;
  /** Every validated option key for this rule, sorted by key. */
  readonly options: Readonly<Record<string, EffectiveOptionValue>>;
}

/**
 * The half of the network policy that is not a `docs/THREAT_MODEL.md`
 * section 16 budget.
 *
 * Split out because the numeric half is the budget, and a caller that could
 * pass both would be able to write a `maxRequests` into the report that the
 * planner never used. The engine composes the two.
 */
export interface NetworkPolicyIdentity {
  readonly id: NetworkProfileId;
  readonly version: string;
  readonly allowedSchemes: readonly ("http" | "https")[];
  readonly allowedPorts: readonly number[];
  readonly sameOriginDiscovery: boolean;
}

export interface PublicNetworkPolicy extends NetworkPolicyIdentity {
  readonly maxRequests: number;
  readonly maxRedirectsPerObservation: number;
  readonly maxEncodedResponseBytes: number;
  readonly maxDecodedResponseBytes: number;
}

export interface ScanSummary {
  readonly pass: number;
  readonly fail: number;
  readonly warning: number;
  readonly notApplicable: number;
  readonly unableToCheck: number;
  readonly unsupportedRuntime: number;
}

export interface PublicHttpEvidence {
  readonly id: string;
  readonly kind: "http";
  readonly request: {
    readonly method: "GET" | "HEAD";
    readonly url: string;
    readonly headers: Readonly<Record<string, readonly string[]>>;
  };
  readonly outcome:
    | {
        readonly kind: "response";
        readonly status: number;
        readonly headers: Readonly<Record<string, readonly string[]>>;
        readonly encodedBytes: number;
        readonly decodedBytes: number;
        readonly bodySha256: string;
        readonly truncated: boolean;
        readonly redirects: readonly RedirectFact[];
      }
    | { readonly kind: "error"; readonly error: PublicObservationError };
}

export interface PublicDnsEvidence {
  readonly id: string;
  readonly kind: "dns";
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

export interface PublicBrowserEvidence {
  readonly id: string;
  readonly kind: "browser";
  readonly action: { readonly url: string; readonly capability: string };
  readonly outcome:
    | {
        readonly kind: "observation";
        readonly facts: readonly {
          readonly key: string;
          readonly value: string | number | boolean | null;
        }[];
      }
    | { readonly kind: "error"; readonly error: PublicObservationError };
}

export type PublicEvidence =
  PublicHttpEvidence | PublicDnsEvidence | PublicBrowserEvidence;

export interface CanonicalScanReportV1 {
  readonly schemaVersion: "1.0.0";
  readonly tool: { readonly name: "agentready-lab"; readonly version: string };
  readonly ruleset: {
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  /** `source_ledger_version` of `specs/sources.v0.yaml`. */
  readonly sourceLedgerVersion: string;
  /** Present in `compat` mode and absent in every other mode. */
  readonly externalSnapshot?: ExternalSnapshotRef;
  readonly profile: { readonly id: ProfileId; readonly version: string };
  readonly mode: InterpretationMode;
  readonly target: {
    readonly requestedUrl: string;
    readonly resolvedPageUrl: string;
    readonly origin: string;
    readonly scope: NetworkScope;
    readonly networkProfile: NetworkProfileId;
  };
  readonly policy: PublicNetworkPolicy;
  readonly summary: ScanSummary;
  readonly results: readonly RuleResult[];
  /** Every selected rule's validated options, sorted by `ruleId`. */
  readonly effectiveOptions: readonly EffectiveRuleOptions[];
  readonly evidence: readonly PublicEvidence[];
  /** The pinned sources a finding in this report cites, sorted by `id`. */
  readonly sources: readonly ReportSource[];
}
