import type {
  AnyRuleDefinition,
  AssertionDeclaration,
  AssertionDeferral,
  AssertionOutcome,
  AssertionOutcomes,
  DnsTransportQuery,
  DnsTransportResult,
  FindingRemediation,
  HttpTransportRequest,
  HttpTransportResult,
  InterpretationMode,
  MessageTemplates,
  ObservationRequest,
  ObservationRuntime,
  OutcomeKind,
  PlanInput,
  ProfileId,
  ReportSource,
  RequestBatch,
  RequirementClass,
  RoundContext,
  RuleApplicability,
  RulesetAssertion,
  ScanInput,
  TargetDescriptor,
  Transport,
} from "../../src/index.js";
import { DEFAULT_NETWORK_BUDGET, sha256Hex } from "../../src/index.js";

/**
 * Shared fixtures for the core engine tests.
 *
 * Everything here is deterministic and offline: no clock, no randomness, no
 * socket, and no wall-clock timers. "Latency" below is a count of microtask
 * ticks, which is what lets a test permute completion latency without making
 * the suite slow or flaky.
 */

export const TARGET: TargetDescriptor = {
  requestedUrl: "http://127.0.0.1:8787/",
  pageUrl: "http://127.0.0.1:8787/",
  origin: "http://127.0.0.1:8787",
  scope: "local",
  networkProfile: "local-loopback",
};

export const SOURCE: ReportSource = {
  id: "rfc9309",
  title: "Robots Exclusion Protocol",
  url: "https://www.rfc-editor.org/rfc/rfc9309",
  kind: "ietf-rfc",
  status: "proposed-standard",
  version: "RFC 9309",
  verifiedAt: "2026-08-28",
};

export const OTHER_SOURCE: ReportSource = {
  ...SOURCE,
  id: "rfc9110",
  title: "HTTP Semantics",
};

export interface AssertionOptions {
  readonly id: string;
  readonly ruleId: string;
  readonly mode?: InterpretationMode;
  readonly requirementClass?: RequirementClass;
  readonly sourceIds?: readonly string[];
  readonly params?: AssertionDeclaration["params"];
  readonly excerptAuthorized?: boolean;
  /** ADR-0010 section 4. A deferred assertion carries no sources. */
  readonly deferred?: AssertionDeferral;
}

export function assertion(options: AssertionOptions): RulesetAssertion {
  return {
    ruleId: options.ruleId,
    id: options.id,
    mode: options.mode ?? "spec",
    requirementClass: options.requirementClass ?? "normative",
    sourceRefs:
      options.deferred === undefined
        ? (options.sourceIds ?? ["rfc9309"]).map((sourceId) => ({ sourceId }))
        : [],
    params: options.params ?? {},
    excerptAuthorized: options.excerptAuthorized ?? false,
    ...(options.deferred === undefined ? {} : { deferred: options.deferred }),
  };
}

/** The shape `specs/ruleset.standard.v0.yaml` gives `skills.archive-safety`. */
export const DEFERRAL: AssertionDeferral = {
  adr: "ADR-0010",
  reason: "the MVP does not unpack an archive, so nothing observes it",
  until:
    "an accepted decision permits unpacking under the section 19.6 controls",
};

export interface RuleOptions {
  readonly id: string;
  readonly assertions: readonly RulesetAssertion[];
  readonly plan?: (input: PlanInput<unknown>) => readonly ObservationRequest[];
  readonly step?: (
    context: RoundContext<unknown>,
  ) => RequestBatch | AssertionOutcomes;
  readonly finish?: (context: RoundContext<unknown>) => AssertionOutcomes;
  readonly profiles?: readonly ProfileId[];
  readonly category?: string;
  readonly applicability?: RuleApplicability;
  readonly runtime?: readonly ObservationRuntime[];
  readonly roundTwoBudget?: number;
  readonly defaultOptions?: Readonly<Record<string, unknown>>;
  readonly implementationStatus?: "planned" | "supported";
  readonly declaredAssertions?: readonly AssertionDeclaration[];
}

export function rule(options: RuleOptions): AnyRuleDefinition {
  return {
    apiVersion: 1,
    metadata: {
      id: options.id,
      externalCompatibilityId: null,
      ruleVersion: "0.1.0",
      ruleset: { id: "standard", version: "0.2.0" },
      title: options.id,
      category: options.category ?? "discoverability",
      profiles: options.profiles ?? ["content", "full"],
      applicability: options.applicability ?? "applicable",
      modes: ["spec"],
      observationRuntime: options.runtime ?? ["http"],
      sourceMaturity: "stable",
      implementationStatus: options.implementationStatus ?? "supported",
      sources: [],
      assertions: options.declaredAssertions ?? options.assertions,
      roundTwoBudget: options.roundTwoBudget ?? 0,
    },
    defaultOptions: options.defaultOptions ?? {},
    plan: options.plan ?? ((): readonly ObservationRequest[] => []),
    step:
      options.step ??
      ((): AssertionOutcomes => ({
        kind: "outcomes",
        outcomes: options.assertions.map((declaration) =>
          outcome(declaration.id, "satisfied"),
        ),
      })),
    finish:
      options.finish ??
      ((): AssertionOutcomes => ({ kind: "outcomes", outcomes: [] })),
  };
}

export function outcome(
  assertionId: string,
  kind: OutcomeKind,
  observationRefs: readonly string[] = [],
): AssertionOutcome {
  return { assertion: assertionId, kind, params: {}, observationRefs };
}

export function httpRequest(
  id: string,
  path: string,
  overrides: Partial<{
    accept: string;
    maxEncodedBytes: number;
    maxDecodedBytes: number;
    method: "GET" | "HEAD";
    redirects: "follow-same-origin" | "reject";
  }> = {},
): ObservationRequest {
  return {
    kind: "http",
    id,
    method: overrides.method ?? "GET",
    target: { kind: "origin-path", path },
    accept: overrides.accept ?? "text/html",
    redirects: overrides.redirects ?? "follow-same-origin",
    maxEncodedBytes: overrides.maxEncodedBytes ?? 65536,
    maxDecodedBytes: overrides.maxDecodedBytes ?? 131072,
  };
}

/** Every outcome kind gets a template, so a finding is always renderable. */
export function templatesFor(
  assertions: readonly RulesetAssertion[],
): MessageTemplates {
  const kinds: readonly OutcomeKind[] = [
    "satisfied",
    "violated",
    "not-present",
    "indeterminate",
  ];
  return new Map(
    assertions.map((declaration) => [
      declaration.id,
      Object.fromEntries(
        kinds.map((kind) => [kind, `${declaration.id} is ${kind}`]),
      ) as Readonly<Partial<Record<OutcomeKind, string>>>,
    ]),
  );
}

export function remediationFor(
  assertions: readonly RulesetAssertion[],
): ReadonlyMap<string, FindingRemediation> {
  return new Map(
    assertions.map((declaration) => [
      declaration.id,
      {
        class:
          declaration.requirementClass === "normative"
            ? ("required-correction" as const)
            : ("recommended-hardening" as const),
        summary: `Fix ${declaration.id}.`,
      },
    ]),
  );
}

export interface ScriptedResponse {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, readonly string[]>>;
  /** Body segmentation. Concatenated, these are the decoded bytes. */
  readonly chunks: readonly Uint8Array[];
  /** Microtask ticks awaited before the transport answers. */
  readonly latency?: number;
}

export type TransportScript = ReadonlyMap<
  string,
  ScriptedResponse | { readonly failure: HttpTransportResult }
>;

export function body(text: string, segments = 1): readonly Uint8Array[] {
  const bytes = new TextEncoder().encode(text);
  const chunks: Uint8Array[] = [];
  const size = Math.max(1, Math.ceil(bytes.length / segments));
  for (let at = 0; at < bytes.length; at += size) {
    chunks.push(bytes.slice(at, at + size));
  }
  return chunks.length === 0 ? [new Uint8Array(0)] : chunks;
}

export interface DispatchRecord {
  readonly event: "dispatched" | "settled";
  readonly url: string;
}

/**
 * The determinism harness of ADR-0005 section 7, tests 1 and 2.
 *
 * It **records** a second dispatch that begins before the previous observation
 * has completed, into `concurrencyViolations`, and a test asserts that the
 * list is empty after the scan.
 *
 * Recording rather than throwing is the whole point, and the earlier revision
 * had it backwards. `dispatchOne` wraps every transport call in
 * `callTransport`, which is required to convert any exception into a
 * `connection-failed` observation so that a hostile transport cannot put a
 * library message into a report. That is correct there and it is fatal here: a
 * transport that enforced serial dispatch by throwing had its complaint caught
 * by the engine and turned into an ordinary error observation, so the guard
 * could not fail. It read like a guard and was not one.
 *
 * `#inFlight` therefore only ever writes to a field the engine cannot see, and
 * the request is served normally afterwards so the rest of the scan still
 * happens and the recorded sequence stays readable.
 */
export class RecordingTransport implements Transport {
  readonly sequence: DispatchRecord[] = [];
  readonly urls: string[] = [];
  /** ADR-0005 section 7 test 1. Empty on every conforming run. */
  readonly concurrencyViolations: string[] = [];
  readonly script: TransportScript;
  readonly onCall: ((request: HttpTransportRequest) => void) | undefined;
  #inFlight = false;

  // Field assignment rather than a parameter property: the repository compiles
  // with `erasableSyntaxOnly`, which forbids the shorthand.
  constructor(
    script: TransportScript = new Map(),
    onCall?: (request: HttpTransportRequest) => void,
  ) {
    this.script = script;
    this.onCall = onCall;
  }

  get callCount(): number {
    return this.urls.length;
  }

  async http(request: HttpTransportRequest): Promise<HttpTransportResult> {
    if (this.#inFlight) {
      this.concurrencyViolations.push(request.url);
    }
    this.#inFlight = true;
    this.sequence.push({ event: "dispatched", url: request.url });
    this.urls.push(request.url);
    this.onCall?.(request);

    try {
      const scripted = this.script.get(request.url);
      if (scripted === undefined) {
        return {
          kind: "failure",
          reason: { code: "connection-failed", phase: "connect" },
        };
      }
      if ("failure" in scripted) {
        await ticks(1);
        return scripted.failure;
      }
      return await this.#deliver(request, scripted);
    } finally {
      this.sequence.push({ event: "settled", url: request.url });
      this.#inFlight = false;
    }
  }

  async #deliver(
    request: HttpTransportRequest,
    scripted: ScriptedResponse,
  ): Promise<HttpTransportResult> {
    await ticks(scripted.latency ?? 0);

    // ADR-0003 section 4: the transport stops at whichever of the two bounds
    // it reaches first and says which one bound.
    const allowance = Math.min(
      request.maxDecodedBytes,
      request.scanRemainingDecodedBytes,
    );
    const scanBinds =
      request.scanRemainingDecodedBytes < request.maxDecodedBytes;

    const kept: number[] = [];
    for (const chunk of scripted.chunks) {
      await ticks(1);
      for (const byte of chunk) {
        if (kept.length >= allowance) {
          return {
            kind: "failure",
            reason: scanBinds
              ? { code: "scan-byte-budget-exceeded", phase: "body" }
              : { code: "response-too-large", phase: "body" },
          };
        }
        kept.push(byte);
      }
    }

    const bytes = new Uint8Array(kept);
    return {
      kind: "response",
      status: scripted.status ?? 200,
      effectiveUrl: request.url,
      headers: new Map(Object.entries(scripted.headers ?? {})),
      body: bytes,
      truncated: false,
      encodedBytes: bytes.length,
      decodedBytes: bytes.length,
      bodySha256: await sha256Hex(bytes),
      redirects: [],
    };
  }
}

/** A transport whose only job is to prove it was never called. */
export class CountingTransport implements Transport {
  calls = 0;

  http(): Promise<HttpTransportResult> {
    this.calls += 1;
    return Promise.resolve({
      kind: "failure",
      reason: { code: "connection-failed", phase: "connect" },
    });
  }
}

export class DnsCapableTransport extends RecordingTransport {
  dns(query: DnsTransportQuery): Promise<DnsTransportResult> {
    return Promise.resolve({
      kind: "answer",
      rcode: "NOERROR",
      records: [{ type: query.recordType, value: "127.0.0.1" }],
      dnssec: "insecure",
    });
  }
}

export async function ticks(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

export interface ScanOptions {
  readonly rules: readonly AnyRuleDefinition[];
  readonly assertions: readonly RulesetAssertion[];
  readonly transport: Transport;
  readonly mode?: InterpretationMode;
  readonly profile?: ProfileId;
  readonly budget?: Partial<ScanInput["budget"]>;
  readonly include?: string;
  readonly exclude?: string;
  readonly ruleOptions?: ScanInput["ruleOptions"];
  readonly templates?: MessageTemplates;
  readonly remediation?: ReadonlyMap<string, FindingRemediation>;
  readonly sources?: readonly ReportSource[];
  readonly commerceEndpointConfigured?: boolean;
  /** ADR-0007 section 1: required in `compat` mode, refused in every other. */
  readonly externalSnapshot?: ScanInput["externalSnapshot"];
}

export function scanInput(options: ScanOptions): ScanInput {
  const sources = options.sources ?? [SOURCE, OTHER_SOURCE];
  return {
    toolVersion: "0.0.0",
    registry: options.rules,
    ruleset: { id: "standard", version: "0.2.0", digest: "sha256:test" },
    rulesetAssertions: options.assertions,
    sourceLedgerVersion: "0.2.0",
    sourceLedger: new Map(sources.map((source) => [source.id, source])),
    templates: options.templates ?? templatesFor(options.assertions),
    remediation: options.remediation ?? remediationFor(options.assertions),
    profile: { id: options.profile ?? "content", version: "0.1.0" },
    mode: options.mode ?? "spec",
    target: TARGET,
    networkPolicy: {
      id: "local-loopback",
      version: "0.1.0",
      allowedSchemes: ["http", "https"],
      allowedPorts: [8787],
      sameOriginDiscovery: true,
    },
    budget: { ...DEFAULT_NETWORK_BUDGET, ...options.budget },
    transport: options.transport,
    ...(options.externalSnapshot === undefined
      ? {}
      : { externalSnapshot: options.externalSnapshot }),
    ...(options.include === undefined ? {} : { include: options.include }),
    ...(options.exclude === undefined ? {} : { exclude: options.exclude }),
    ...(options.ruleOptions === undefined
      ? {}
      : { ruleOptions: options.ruleOptions }),
    commerceEndpointConfigured: options.commerceEndpointConfigured ?? false,
  };
}
