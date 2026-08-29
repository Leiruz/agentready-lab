import {
  DEFAULT_NETWORK_BUDGET,
  canonicalizeJson,
  runScan,
} from "@agentready-lab/core";
import type {
  AnyRuleDefinition,
  CanonicalScanReportV1,
  ExternalSnapshotRef,
  FindingRemediation,
  InterpretationMode,
  MessageTemplates,
  NetworkBudget,
  NetworkPolicyIdentity,
  PlanningContext,
  ProfileId,
  PublicEvidence,
  ReportSource,
  RuleFinding,
  RuleResult,
  RuleStatus,
  RulesetAssertion,
  ScanInput,
  TargetDescriptor,
} from "@agentready-lab/core";

import type { InMemoryTransport, RecordedRequest } from "../transport/index.js";
import {
  DEFAULT_NETWORK_POLICY,
  DEFAULT_TARGET,
  assertionsOf,
  remediationFor,
  sourceLedgerFor,
  templatesFor,
} from "./defaults.js";

/**
 * The rule contract harness of `docs/TEST_STRATEGY.md` section 6.
 *
 * It drives `runScan`, the real engine, and not a reimplementation of it. That
 * is the whole design constraint: the properties a contract test asserts are
 * derived properties, and every one of them is derived by code in
 * `packages/core`. A harness that computed the status from the outcome kind
 * itself would agree with `findingStatus` on the day it was written and would
 * stop being evidence the day one of them changed.
 *
 * `docs/TEST_STRATEGY.md` section 2.3 requires a satisfying case, a violating
 * case, an unavailable or malformed case, and a version or mode distinction
 * for every assertion and finding code. For the eight M1 rules that is roughly
 * 110 cases against 49 protocol fixtures, so most of them have to be reachable
 * without a fixture, a server or a socket. Constructing the observations
 * directly is what makes them reachable.
 */

export interface RuleContractInput {
  readonly rule: AnyRuleDefinition;
  readonly transport: InMemoryTransport;
  /**
   * Further rules in the registry, in registry order after the rule under
   * test. The shared robots observation of `docs/TEST_STRATEGY.md` section 6
   * needs three rules in one scan to be provable at all.
   */
  readonly alsoRegister?: readonly AnyRuleDefinition[];
  /** Defaults to the rules' own metadata. See `assertionsOf`. */
  readonly assertions?: readonly RulesetAssertion[];
  /** Defaults to the rule's first declared mode, else `spec`. */
  readonly mode?: InterpretationMode;
  /** Defaults to the rule's first declared profile, else `content`. */
  readonly profile?: ProfileId;
  readonly profileVersion?: string;
  /** Options for the rule under test. Merged over its `defaultOptions`. */
  readonly options?: Readonly<Record<string, unknown>>;
  /** Options for any other rule in the registry. */
  readonly ruleOptions?: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
  readonly target?: TargetDescriptor;
  readonly budget?: Partial<NetworkBudget>;
  readonly networkPolicy?: NetworkPolicyIdentity;
  readonly templates?: MessageTemplates;
  readonly remediation?: ReadonlyMap<string, FindingRemediation>;
  readonly sourceLedger?: ReadonlyMap<string, ReportSource>;
  /** Supplied automatically in `compat` mode, where core requires one. */
  readonly externalSnapshot?: ExternalSnapshotRef;
  readonly commerceEndpointConfigured?: boolean;
  readonly include?: string;
  readonly exclude?: string;
  readonly toolVersion?: string;
  readonly ruleset?: {
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly sourceLedgerVersion?: string;
}

export interface RuleContractRun {
  readonly ruleId: string;
  readonly report: Readonly<CanonicalScanReportV1>;
  /** The result for the rule under test. */
  readonly result: RuleResult;
  readonly status: RuleStatus;
  readonly findings: readonly RuleFinding[];
  /** Finding codes in report order, which `buildFindings` sorts by code. */
  readonly findingCodes: readonly string[];
  readonly evidence: readonly PublicEvidence[];
  readonly requests: readonly RecordedRequest[];
  readonly transport: InMemoryTransport;
  /**
   * RFC 8785 canonical JSON of the whole report.
   *
   * The determinism properties of ADR-0005 section 7 are byte equality of this
   * string across latency profiles and body segmentations, so the harness
   * computes it once rather than leaving each test to serialize the report a
   * slightly different way.
   */
  readonly canonicalJson: string;
}

const DEFAULT_EXTERNAL_SNAPSHOT: ExternalSnapshotRef = {
  capturedAt: "2026-08-28",
  schemaVersion: "0.1.0",
};

function registryOf(input: RuleContractInput): readonly AnyRuleDefinition[] {
  return [input.rule, ...(input.alsoRegister ?? [])];
}

/**
 * The planning context the engine will use, so a test can register routes with
 * `transport.routeObservation` under the keys the engine will look up.
 */
export function planningContextOf(input: RuleContractInput): PlanningContext {
  const policy = input.networkPolicy ?? DEFAULT_NETWORK_POLICY;
  return {
    target: input.target ?? DEFAULT_TARGET,
    budget: { ...DEFAULT_NETWORK_BUDGET, ...input.budget },
    networkProfile: policy.id,
  };
}

/**
 * The `ScanInput` the harness would run, for a test that wants to call
 * `runScan` itself or to assert on the input rather than the report.
 */
export function buildScanInput(input: RuleContractInput): ScanInput {
  const registry = registryOf(input);
  const assertions = input.assertions ?? assertionsOf(registry);
  const metadata = input.rule.metadata;
  const mode = input.mode ?? metadata.modes[0] ?? "spec";
  const profile = input.profile ?? metadata.profiles[0] ?? "content";
  const policy = input.networkPolicy ?? DEFAULT_NETWORK_POLICY;
  const externalSnapshot =
    input.externalSnapshot ??
    (mode === "compat" ? DEFAULT_EXTERNAL_SNAPSHOT : undefined);
  const ruleOptions = {
    ...input.ruleOptions,
    ...(input.options === undefined ? {} : { [metadata.id]: input.options }),
  };

  return {
    toolVersion: input.toolVersion ?? "0.0.0",
    registry,
    ruleset: input.ruleset ?? {
      id: "standard",
      version: "0.0.0",
      digest: "sha256:testkit",
    },
    rulesetAssertions: assertions,
    sourceLedgerVersion: input.sourceLedgerVersion ?? "0.0.0",
    sourceLedger: input.sourceLedger ?? sourceLedgerFor(assertions),
    ...(externalSnapshot === undefined ? {} : { externalSnapshot }),
    templates: input.templates ?? templatesFor(assertions),
    remediation: input.remediation ?? remediationFor(assertions),
    profile: { id: profile, version: input.profileVersion ?? "0.1.0" },
    mode,
    target: input.target ?? DEFAULT_TARGET,
    networkPolicy: policy,
    budget: { ...DEFAULT_NETWORK_BUDGET, ...input.budget },
    transport: input.transport,
    ...(input.include === undefined ? {} : { include: input.include }),
    ...(input.exclude === undefined ? {} : { exclude: input.exclude }),
    ...(Object.keys(ruleOptions).length === 0 ? {} : { ruleOptions }),
    commerceEndpointConfigured: input.commerceEndpointConfigured ?? false,
  };
}

export async function runRuleContract(
  input: RuleContractInput,
): Promise<RuleContractRun> {
  const ruleId = input.rule.metadata.id;
  const report = await runScan(buildScanInput(input));
  const result = report.results.find((entry) => entry.ruleId === ruleId);
  if (result === undefined) {
    throw new Error(
      `${ruleId} produced no result. It was filtered out by --include/--exclude, or it is not in profile ${report.profile.id}`,
    );
  }

  return {
    ruleId,
    report,
    result,
    status: result.status,
    findings: result.findings,
    findingCodes: result.findings.map((finding) => finding.code),
    evidence: report.evidence,
    requests: input.transport.requests,
    transport: input.transport,
    canonicalJson: canonicalizeJson(report),
  };
}
