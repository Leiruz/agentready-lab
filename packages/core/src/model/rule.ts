import type { ObservationRequest, ProbeObservation } from "./observation.js";
import type {
  ImplementationStatus,
  InterpretationMode,
  NetworkScope,
  ObservableNetworkProfileId,
  ObservationRuntime,
  OutcomeKind,
  ProfileId,
  RequirementClass,
  ResultGate,
  RuleApplicability,
  RuleStatus,
} from "./status.js";

/**
 * ADR-0002 section 4. The rule-facing type system.
 *
 * There is no `Promise`, no `async`, no `AbortSignal`, no `URL` and no timer
 * anywhere below. That is not decoration: `AbortSignal` and `URL` do not exist
 * under `lib: ["ES2023"], types: []`, and a rule that could observe response
 * completion order would make `docs/ROADMAP.md` M1's determinism criterion
 * unreachable (ADR-0002 sections 2 and 3).
 */

export interface TargetDescriptor {
  readonly requestedUrl: string;
  readonly pageUrl: string;
  readonly origin: string;
  readonly scope: NetworkScope;
  readonly networkProfile: ObservableNetworkProfileId;
}

export interface PlanInput<Options> {
  readonly mode: InterpretationMode;
  readonly profile: Readonly<{ id: ProfileId; version: string }>;
  readonly target: TargetDescriptor;
  readonly options: Readonly<Options>;
}

export interface RoundContext<Options> extends PlanInput<Options> {
  /**
   * Resolves a rule-local request id from any completed round. An id the rule
   * did not request in a completed round is a contract violation.
   */
  observation(id: string): ProbeObservation;
  /** Deeply frozen shared parse result. The loader is synchronous. */
  memo<T>(namespacedKey: string, load: () => T): T;
}

export type FindingParam =
  | { readonly kind: "count"; readonly value: number }
  | { readonly kind: "http-status"; readonly value: number }
  | { readonly kind: "token"; readonly value: string }
  | { readonly kind: "header-name"; readonly value: string }
  | { readonly kind: "media-type"; readonly value: string }
  | { readonly kind: "origin-path"; readonly value: string }
  | { readonly kind: "json-pointer"; readonly value: string }
  | { readonly kind: "excerpt"; readonly value: string };

export type FindingParamKind = FindingParam["kind"];

export interface AssertionOutcome {
  /** A versioned assertion id declared by this rule for the active mode. */
  readonly assertion: string;
  readonly kind: OutcomeKind;
  /**
   * Bounded typed parameters for the static template. Never free prose, and
   * validated against the assertion's declared parameter schema.
   */
  readonly params: Readonly<Record<string, FindingParam>>;
  /** Rule-local observation ids. The core rewrites these to evidence ids. */
  readonly observationRefs: readonly string[];
}

export interface RequestBatch {
  readonly kind: "requests";
  readonly requests: readonly ObservationRequest[];
}

export interface AssertionOutcomes {
  readonly kind: "outcomes";
  readonly outcomes: readonly AssertionOutcome[];
}

export interface SourceRef {
  readonly sourceId: string;
  readonly section?: string;
}

export interface RuleSource {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly kind: string;
  readonly status: string;
  readonly version?: string;
  readonly verifiedAt: string;
}

export interface ParamSpec {
  readonly kind: FindingParamKind;
  /** A required parameter absent from an outcome is a contract violation. */
  readonly required: boolean;
  /**
   * Closed value set for this parameter. Absent means the kind's grammar is
   * the only constraint.
   */
  readonly allowedValues?: readonly string[];
}

export interface AssertionDeclaration {
  readonly id: string;
  readonly mode: InterpretationMode;
  readonly requirementClass: RequirementClass;
  /** The only sources a finding for this assertion may cite. */
  readonly sourceRefs: readonly Readonly<SourceRef>[];
  /** Every parameter this assertion's templates may reference. */
  readonly params: Readonly<Record<string, ParamSpec>>;
  /** True only where the ruleset explicitly authorizes a bounded excerpt. */
  readonly excerptAuthorized: boolean;
}

export interface RuleMetadata {
  readonly id: string;
  /** null for a native rule with no external counterpart (ADR-0008). */
  readonly externalCompatibilityId: string | null;
  readonly ruleVersion: string;
  readonly ruleset: Readonly<{ id: string; version: string }>;
  readonly title: string;
  readonly category: string;
  readonly profiles: readonly ProfileId[];
  readonly applicability: RuleApplicability;
  readonly modes: readonly InterpretationMode[];
  readonly observationRuntime: readonly ObservationRuntime[];
  readonly sourceMaturity: string;
  readonly implementationStatus: ImplementationStatus;
  readonly sources: readonly RuleSource[];
  /** Every assertion the rule may report, with its mode and class. */
  readonly assertions: readonly AssertionDeclaration[];
  /** Maximum round-two requests. Reserved before round one (ADR-0005). */
  readonly roundTwoBudget: number;
}

/** ADR-0007 section 2. Present on every `fail` and `warning`, absent otherwise. */
export type RemediationClass =
  "required-correction" | "recommended-hardening" | "compatibility-workaround";

export interface FindingRemediation {
  readonly class: RemediationClass;
  readonly summary: string;
}

/** Constructed by the core. A rule never builds one. */
export interface RuleFinding {
  readonly code: string;
  readonly mode: InterpretationMode;
  readonly requirementClass: RequirementClass;
  readonly status: RuleStatus;
  readonly message: string;
  readonly remediation?: FindingRemediation;
  readonly sourceRefs: readonly Readonly<SourceRef>[];
  readonly evidenceRefs: readonly string[];
}

export interface RuleResult {
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly status: RuleStatus;
  readonly gate: ResultGate;
  readonly findings: readonly RuleFinding[];
}

export interface RuleDefinition<Options = unknown> {
  readonly apiVersion: 1;
  readonly metadata: RuleMetadata;
  readonly defaultOptions: Readonly<Options>;
  plan(input: PlanInput<Options>): readonly ObservationRequest[];
  step(context: RoundContext<Options>): RequestBatch | AssertionOutcomes;
  finish(context: RoundContext<Options>): AssertionOutcomes;
}

/**
 * A registry entry the engine can hold without knowing the rule's option type.
 *
 * The engine genuinely does not know the shape: it validates option keys
 * against `defaultOptions` and passes the merged object straight back to the
 * rule that declared it. This is assignable from any concrete
 * `RuleDefinition<Options>` because `plan`, `step` and `finish` are declared
 * with method syntax, which TypeScript relates bivariantly.
 */
export type AnyRuleDefinition = RuleDefinition;
