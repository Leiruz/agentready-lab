import type {
  AnyRuleDefinition,
  AssertionDeclaration,
  AssertionOutcome,
  AssertionOutcomes,
  InterpretationMode,
  ObservationRequest,
  ObservationRuntime,
  OutcomeKind,
  ParamSpec,
  ProfileId,
  RequestBatch,
  RequirementClass,
  RoundContext,
  RuleApplicability,
} from "@agentready-lab/core";

/**
 * Throwaway rules for the testkit's own suite.
 *
 * Deliberately not exported from the package. A rule contract test in
 * `packages/rules-standard` supplies the real rule; these exist only so this
 * package can test its harness against something, and a published builder for
 * fake rules would invite tests that assert nothing about a real one.
 */

export interface TestAssertionOptions {
  readonly id: string;
  readonly mode?: InterpretationMode;
  readonly requirementClass?: RequirementClass;
  readonly sourceIds?: readonly string[];
  readonly params?: Readonly<Record<string, ParamSpec>>;
  readonly excerptAuthorized?: boolean;
}

export function testAssertion(
  options: TestAssertionOptions,
): AssertionDeclaration {
  return {
    id: options.id,
    mode: options.mode ?? "spec",
    requirementClass: options.requirementClass ?? "normative",
    sourceRefs: (options.sourceIds ?? ["rfc9309"]).map((sourceId) => ({
      sourceId,
    })),
    params: options.params ?? {},
    excerptAuthorized: options.excerptAuthorized ?? false,
  };
}

export interface TestRuleOptions {
  readonly id: string;
  readonly assertions: readonly AssertionDeclaration[];
  readonly plan?: (
    input: Readonly<{ mode: InterpretationMode }>,
  ) => readonly ObservationRequest[];
  readonly step?: (
    context: RoundContext<unknown>,
  ) => RequestBatch | AssertionOutcomes;
  readonly finish?: (context: RoundContext<unknown>) => AssertionOutcomes;
  readonly profiles?: readonly ProfileId[];
  readonly modes?: readonly InterpretationMode[];
  readonly applicability?: RuleApplicability;
  readonly runtime?: readonly ObservationRuntime[];
  readonly roundTwoBudget?: number;
  readonly defaultOptions?: Readonly<Record<string, unknown>>;
}

/** Every assertion of the active mode reports `kind`, citing every request. */
export function outcomesFor(
  assertions: readonly AssertionDeclaration[],
  mode: InterpretationMode,
  kind: OutcomeKind,
  observationRefs: readonly string[] = [],
): AssertionOutcomes {
  return {
    kind: "outcomes",
    outcomes: assertions
      .filter((declaration) => declaration.mode === mode)
      .map((declaration): AssertionOutcome => ({
        assertion: declaration.id,
        kind,
        params: {},
        observationRefs,
      })),
  };
}

export function testRule(options: TestRuleOptions): AnyRuleDefinition {
  const requests = options.plan;
  return {
    apiVersion: 1,
    metadata: {
      id: options.id,
      externalCompatibilityId: null,
      ruleVersion: "0.1.0",
      ruleset: { id: "standard", version: "0.0.0" },
      title: options.id,
      category: "discoverability",
      profiles: options.profiles ?? ["content", "full"],
      applicability: options.applicability ?? "applicable",
      modes: options.modes ?? ["spec"],
      observationRuntime: options.runtime ?? ["http"],
      sourceMaturity: "stable",
      implementationStatus: "supported",
      sources: [],
      assertions: options.assertions,
      roundTwoBudget: options.roundTwoBudget ?? 0,
    },
    defaultOptions: options.defaultOptions ?? {},
    plan: (input): readonly ObservationRequest[] =>
      requests === undefined ? [] : requests({ mode: input.mode }),
    step:
      options.step ??
      ((context): AssertionOutcomes =>
        outcomesFor(options.assertions, context.mode, "satisfied")),
    finish:
      options.finish ??
      ((context): AssertionOutcomes =>
        outcomesFor(options.assertions, context.mode, "satisfied")),
  };
}

export function httpRequest(
  id: string,
  path: string,
  overrides: Readonly<{
    accept?: string;
    method?: "GET" | "HEAD";
    redirects?: "follow-same-origin" | "reject";
    maxEncodedBytes?: number;
    maxDecodedBytes?: number;
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
