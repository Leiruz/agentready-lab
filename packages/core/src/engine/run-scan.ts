import {
  ConfigurationError,
  RuleContractViolation,
} from "../model/contract-violation.js";
import type { ProbeObservation } from "../model/observation.js";
import type {
  CanonicalScanReportV1,
  EffectiveRuleOptions,
  ExternalSnapshotRef,
  NetworkPolicyIdentity,
  PublicEvidence,
  ReportSource,
} from "../model/report.js";
import type {
  AnyRuleDefinition,
  AssertionOutcome,
  PlanInput,
  RoundContext,
  RuleResult,
  TargetDescriptor,
} from "../model/rule.js";
import type { InterpretationMode, ProfileId } from "../model/status.js";
import type { Transport } from "../probe/transport.js";
import { transportCapabilities } from "../probe/transport.js";
import type { PlannedObservation } from "./admission.js";
import { ObservationPlanner, RequestSlotPool } from "./admission.js";
import {
  buildEvidence,
  buildFindings,
  buildReport,
  buildRuleResult,
  buildUninvokedResult,
} from "./build-report.js";
import type { RemediationTable } from "./build-report.js";
import { dispatchRound } from "./dispatch.js";
import { MemoStore } from "./memo.js";
import type {
  PlannableRule,
  PlanningContext,
  RuleRuntimeState,
} from "./plan-observations.js";
import {
  createRuleState,
  planRoundOne,
  planRoundTwo,
} from "./plan-observations.js";
import { projectEffectiveOptions, resolveRuleOptions } from "./rule-options.js";
import type { MessageTemplates } from "./render-message.js";
import type { NetworkBudget } from "./scan-budget.js";
import {
  MAX_EVIDENCE_ENTRIES,
  ScanByteLedger,
  assertSupportedConcurrency,
} from "./scan-budget.js";
import type { RulesetAssertion } from "./validate-outcomes.js";
import {
  RulesetAssertionIndex,
  validateRuleAssertions,
  validateRuleOutcomes,
} from "./validate-outcomes.js";
import { selectRules } from "./select-rules.js";
import type { SelectedRule } from "./select-rules.js";

/**
 * `docs/ARCHITECTURE.md` section 5. The scan lifecycle, in one place.
 *
 * The ordering below is the product contract, not a convenience. Everything
 * that can be decided from configuration is decided before the transport is
 * touched at all, which is what makes the M0 criterion "invalid sample
 * configuration validates as invalid without a transport call" true by
 * construction rather than by review.
 */

export interface ScanInput {
  readonly toolVersion: string;
  /** The pinned registry, in stable registry order (ADR-0005 section 2). */
  readonly registry: readonly AnyRuleDefinition[];
  readonly ruleset: {
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  /** Every assertion the pinned ruleset declares, with its owning rule. */
  readonly rulesetAssertions: readonly RulesetAssertion[];
  readonly sourceLedgerVersion: string;
  readonly sourceLedger: ReadonlyMap<string, ReportSource>;
  /** ADR-0007 section 1: required in `compat` mode, refused in every other. */
  readonly externalSnapshot?: ExternalSnapshotRef;
  readonly templates: MessageTemplates;
  readonly remediation: RemediationTable;
  readonly profile: { readonly id: ProfileId; readonly version: string };
  readonly mode: InterpretationMode;
  readonly target: TargetDescriptor;
  readonly networkPolicy: NetworkPolicyIdentity;
  readonly budget: NetworkBudget;
  readonly transport: Transport;
  readonly include?: string;
  readonly exclude?: string;
  readonly ruleOptions?: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
  readonly commerceEndpointConfigured?: boolean;
}

interface InvokedRule extends PlannableRule {
  readonly declarations: readonly RulesetAssertion[];
  /** ADR-0010 section 4: declared for this mode, never evaluated. */
  readonly deferred: ReadonlySet<string>;
  readonly planInput: PlanInput<unknown>;
  readonly gate: SelectedRule["gate"];
}

export async function runScan(
  input: ScanInput,
): Promise<Readonly<CanonicalScanReportV1>> {
  assertSupportedConcurrency(input.budget.maxConcurrency);
  if (input.budget.maxRequests > MAX_EVIDENCE_ENTRIES) {
    throw new ConfigurationError(
      "evidence-ceiling-exceeded",
      `network.maxRequests is ${String(input.budget.maxRequests)}; ADR-0005 section 5 caps the plan at ${String(MAX_EVIDENCE_ENTRIES)} evidence entries`,
    );
  }
  if ((input.mode === "compat") !== (input.externalSnapshot !== undefined)) {
    throw new ConfigurationError(
      "external-snapshot-mode-mismatch",
      `ADR-0007 section 1: externalSnapshot is present in compat mode and absent in every other mode; mode is ${input.mode} and externalSnapshot is ${input.externalSnapshot === undefined ? "absent" : "present"}`,
    );
  }

  const index = new RulesetAssertionIndex(input.rulesetAssertions);
  const selected = selectRules({
    registry: input.registry,
    profile: input.profile.id,
    ...(input.include === undefined ? {} : { include: input.include }),
    ...(input.exclude === undefined ? {} : { exclude: input.exclude }),
    availableRuntimes: transportCapabilities(input.transport),
    commerceEndpointConfigured: input.commerceEndpointConfigured ?? false,
  });

  const effectiveOptions: EffectiveRuleOptions[] = [];
  const invoked: InvokedRule[] = [];
  const uninvoked: RuleResult[] = [];

  for (const entry of selected) {
    const metadata = entry.rule.metadata;
    const options = resolveRuleOptions(
      metadata.id,
      entry.rule.defaultOptions,
      input.ruleOptions?.[metadata.id],
    );
    effectiveOptions.push(projectEffectiveOptions(metadata.id, options));

    if (entry.resolution !== "invoke") {
      uninvoked.push(
        buildUninvokedResult(
          metadata.id,
          metadata.ruleVersion,
          entry.gate,
          entry.resolution === "unsupported-runtime"
            ? "unsupported-runtime"
            : "not-applicable",
        ),
      );
      continue;
    }

    const declarations = validateRuleAssertions(metadata, index, input.mode);
    for (const declaration of declarations) {
      for (const ref of declaration.sourceRefs) {
        if (!input.sourceLedger.has(ref.sourceId)) {
          throw new ConfigurationError(
            "unresolved-source-ref",
            `assertion ${declaration.id} cites source ${ref.sourceId}, which the pinned source ledger does not resolve (ADR-0007 section 1)`,
          );
        }
      }
      // ADR-0007 section 3. Every class can derive `fail` or `warning`, so
      // every active assertion needs an entry. Checked here rather than when
      // a finding is built, so that a missing entry cannot depend on what the
      // target happened to serve.
      if (!input.remediation.has(declaration.id)) {
        throw new ConfigurationError(
          "remediation-missing",
          `assertion ${declaration.id} has no entry in the pinned remediation table (ADR-0007 section 3)`,
        );
      }
    }

    invoked.push({
      definition: entry.rule,
      state: createRuleState(metadata.id),
      requests: [],
      declarations,
      deferred: new Set(
        index
          .deferredForRule(metadata.id, input.mode)
          .map((declaration) => declaration.id),
      ),
      gate: entry.gate,
      planInput: {
        mode: input.mode,
        profile: input.profile,
        target: input.target,
        options,
      },
    });
  }

  const context: PlanningContext = {
    target: input.target,
    budget: input.budget,
    networkProfile: input.networkPolicy.id,
  };
  const planner = new ObservationPlanner();
  const pool = new RequestSlotPool(input.budget.maxRequests);
  const byteLedger = new ScanByteLedger(input.budget);
  const memo = new MemoStore();
  const observations = new Map<string, ProbeObservation>();
  const plan: PlannedObservation[] = [];

  const provenanceResolver = (
    state: RuleRuntimeState,
    provenance: { readonly fromObservation: string },
  ): boolean => {
    const evidenceId = state.aliases.get(provenance.fromObservation);
    if (evidenceId === undefined) return false;
    const observation = observations.get(evidenceId);
    return observation !== undefined && observation.outcome.kind !== "error";
  };

  const roundOne = invoked.map((rule): InvokedRule => ({
    ...rule,
    requests: rule.definition.plan(rule.planInput),
  }));
  const roundOnePlan = planRoundOne(
    roundOne,
    context,
    planner,
    pool,
    provenanceResolver,
  );
  plan.push(...roundOnePlan);
  for (const [id, observation] of await dispatchRound({
    transport: input.transport,
    plan: roundOnePlan,
    budget: input.budget,
    byteLedger,
  })) {
    observations.set(id, observation);
  }

  const roundContextFor = (rule: InvokedRule): RoundContext<unknown> => ({
    ...rule.planInput,
    observation: (id: string): ProbeObservation => {
      const evidenceId = rule.state.aliases.get(id);
      const observation =
        evidenceId === undefined ? undefined : observations.get(evidenceId);
      if (observation === undefined) {
        throw new RuleContractViolation(
          "unknown-observation-ref",
          `${rule.state.ruleId} asked for observation ${id}, which names no request in a completed round`,
        );
      }
      return observation;
    },
    memo: <T>(namespacedKey: string, load: () => T): T =>
      memo.get(namespacedKey, load),
  });

  const finished = new Map<string, readonly AssertionOutcome[]>();
  const continuing: InvokedRule[] = [];
  for (const rule of roundOne) {
    const stepped = rule.definition.step(roundContextFor(rule));
    if (stepped.kind === "outcomes") {
      finished.set(rule.state.ruleId, stepped.outcomes);
      continue;
    }
    continuing.push({ ...rule, requests: stepped.requests });
  }

  if (continuing.length > 0) {
    const roundTwoPlan = planRoundTwo(
      continuing,
      context,
      planner,
      provenanceResolver,
    );
    plan.push(...roundTwoPlan);
    for (const [id, observation] of await dispatchRound({
      transport: input.transport,
      plan: roundTwoPlan,
      budget: input.budget,
      byteLedger,
    })) {
      observations.set(id, observation);
    }
    for (const rule of continuing) {
      finished.set(
        rule.state.ruleId,
        rule.definition.finish(roundContextFor(rule)).outcomes,
      );
    }
  }

  const results: RuleResult[] = [];
  for (const rule of roundOne) {
    const outcomes = finished.get(rule.state.ruleId) ?? [];
    const declarations = validateRuleOutcomes({
      ruleId: rule.state.ruleId,
      mode: input.mode,
      declarations: rule.declarations,
      outcomes,
      deferred: rule.deferred,
    });
    const findings = buildFindings({
      ruleId: rule.state.ruleId,
      mode: input.mode,
      outcomes,
      declarations,
      aliases: rule.state.aliases,
      templates: input.templates,
      remediation: input.remediation,
      rejectUnknownRef: (ruleId, localId): never => {
        throw new RuleContractViolation(
          "unknown-observation-ref",
          `${ruleId} cited ${localId}, which names no request in a completed round`,
        );
      },
    });
    results.push(
      buildRuleResult(
        rule.state.ruleId,
        rule.definition.metadata.ruleVersion,
        rule.gate,
        findings,
      ),
    );
  }

  // Registry order, which `selected` already follows.
  const order = new Map(
    selected.map((entry, position) => [entry.rule.metadata.id, position]),
  );
  const ordered = [...results, ...uninvoked].sort(
    (left, right) =>
      (order.get(left.ruleId) ?? 0) - (order.get(right.ruleId) ?? 0),
  );

  const evidence: readonly PublicEvidence[] = buildEvidence(plan, observations);

  return buildReport({
    toolVersion: input.toolVersion,
    ruleset: input.ruleset,
    sourceLedgerVersion: input.sourceLedgerVersion,
    ...(input.externalSnapshot === undefined
      ? {}
      : { externalSnapshot: input.externalSnapshot }),
    profile: input.profile,
    mode: input.mode,
    target: {
      requestedUrl: input.target.requestedUrl,
      resolvedPageUrl: input.target.pageUrl,
      origin: input.target.origin,
      scope: input.target.scope,
      networkProfile: input.networkPolicy.id,
    },
    policy: {
      ...input.networkPolicy,
      maxRequests: input.budget.maxRequests,
      maxRedirectsPerObservation: input.budget.maxRedirects,
      maxEncodedResponseBytes: input.budget.maxEncodedResponseBytes,
      maxDecodedResponseBytes: input.budget.maxDecodedResponseBytes,
    },
    results: ordered,
    effectiveOptions,
    evidence,
    sourceLedger: input.sourceLedger,
  });
}
