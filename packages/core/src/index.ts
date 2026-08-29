/**
 * `@agentready-lab/core`: the runtime-neutral engine, model, probe and schema
 * code of `docs/ARCHITECTURE.md` section 4.
 *
 * This package is compiled with `"lib": ["ES2023"]` and `"types": []`, which
 * makes `fetch`, `process`, `require`, `setTimeout`, `Buffer` and `window`
 * undeclared identifiers here. `URL`, `TextEncoder` and `crypto.subtle` are
 * the deliberate, justified additions in `types/runtime-neutral-globals.d.ts`.
 * Core imports no transport implementation: it declares the `Transport`
 * interface and `packages/transport-node` implements it.
 */
export const CORE_PACKAGE_VERSION = "0.0.0";

export {
  CanonicalJsonError,
  canonicalizeJson,
  encodeCanonicalJson,
} from "./schema/canonical-json.js";
export type { JsonValue } from "./schema/canonical-json.js";
export { formatDigest, sha256Hex, sha256HexOfUtf8 } from "./schema/sha256.js";
export { validateAgainstSchema } from "./schema/json-schema.js";
export type { SchemaViolation } from "./schema/json-schema.js";

export type {
  ImplementationStatus,
  InterpretationMode,
  NetworkProfileId,
  NetworkScope,
  ObservableNetworkProfileId,
  ObservationRuntime,
  OutcomeKind,
  ProfileId,
  RequirementClass,
  ResultGate,
  RuleApplicability,
  RuleStatus,
} from "./model/status.js";

export {
  ConfigurationError,
  RuleContractViolation,
} from "./model/contract-violation.js";
export type {
  ConfigurationErrorCode,
  ContractViolationCode,
} from "./model/contract-violation.js";

export { toPublicError } from "./model/observation-error.js";
export type {
  EngineReason,
  ObservationFailure,
  ParserReason,
  PublicErrorCode,
  PublicObservationError,
  TransportPhase,
  TransportReason,
} from "./model/observation-error.js";

export type {
  DiscoveredDecision,
  DiscoveredProvenance,
  DiscoveredRejection,
  DnsObservation,
  DnsObservationRequest,
  DnsQueryName,
  DnsRecordFact,
  DnssecState,
  HttpObservation,
  HttpObservationRequest,
  ObservationRequest,
  ObservationTarget,
  ProbeObservation,
  RedirectFact,
} from "./model/observation.js";

export type {
  AnyRuleDefinition,
  AssertionDeclaration,
  AssertionDeferral,
  AssertionOutcome,
  AssertionOutcomes,
  FindingParam,
  FindingParamKind,
  FindingRemediation,
  ParamSpec,
  PlanInput,
  RemediationClass,
  RequestBatch,
  RoundContext,
  RuleDefinition,
  RuleFinding,
  RuleMetadata,
  RuleResult,
  RuleSource,
  SourceRef,
  TargetDescriptor,
} from "./model/rule.js";

export type {
  CanonicalScanReportV1,
  EffectiveOptionValue,
  EffectiveRuleOptions,
  ExternalSnapshotRef,
  NetworkPolicyIdentity,
  PublicBrowserEvidence,
  PublicDnsEvidence,
  PublicEvidence,
  PublicHttpEvidence,
  PublicNetworkPolicy,
  ReportSource,
  ScanSummary,
} from "./model/report.js";

export { transportCapabilities } from "./probe/transport.js";
export type {
  DnsTransportAnswer,
  DnsTransportQuery,
  DnsTransportResult,
  HttpTransportRequest,
  HttpTransportResponse,
  HttpTransportResult,
  Transport,
  TransportFailure,
} from "./probe/transport.js";

export { ObservationPlanner, RequestSlotPool } from "./engine/admission.js";
export type {
  PlannedObservation,
  RefusedRequest,
  ResolvedDnsRequest,
  ResolvedHttpRequest,
  ResolvedRequest,
} from "./engine/admission.js";

export {
  CREDENTIAL_SHAPED_QUERY_PARAMS,
  MAX_URL_BYTES,
  authorizeDiscoveredUrl,
  canonicalUrl,
} from "./engine/canonical-url.js";
export type { DiscoveredUrlPolicy } from "./engine/canonical-url.js";

export { canonicalRequestKey } from "./engine/dedup-key.js";
export type {
  DnsRequestKeyInput,
  HttpRequestKeyInput,
  RejectedRequestKeyInput,
  RequestKeyInput,
} from "./engine/dedup-key.js";

export {
  RULE_STATUS_PRECEDENCE,
  deriveRuleStatus,
  findingStatus,
} from "./engine/derive-status.js";

export { dispatchRound } from "./engine/dispatch.js";
export type { DispatchInput } from "./engine/dispatch.js";

export { MemoStore, acceptMemoValue, deepFreeze } from "./engine/memo.js";
export { MEMO_KEYS, isMemoKey } from "./engine/memo-keys.js";
export type { MemoKey } from "./engine/memo-keys.js";

export {
  createRuleState,
  planRoundOne,
  planRoundTwo,
  resolveObservationRequest,
} from "./engine/plan-observations.js";
export type {
  PlannableRule,
  PlanningContext,
  ProvenanceResolver,
  RuleRuntimeState,
} from "./engine/plan-observations.js";

export {
  renderMessage,
  sanitizeEvidenceText,
  sanitizeParam,
  sanitizeText,
} from "./engine/render-message.js";
export type { MessageTemplates } from "./engine/render-message.js";

export {
  projectEffectiveOptions,
  resolveRuleOptions,
} from "./engine/rule-options.js";

export {
  DEFAULT_NETWORK_BUDGET,
  MAX_EVIDENCE_ENTRIES,
  ScanByteLedger,
  assertSupportedConcurrency,
  lowerBudget,
} from "./engine/scan-budget.js";
export type { NetworkBudget } from "./engine/scan-budget.js";

export { resolveSelectors, selectRules } from "./engine/select-rules.js";
export type {
  RuleResolution,
  SelectedRule,
  SelectionInput,
} from "./engine/select-rules.js";

export {
  RulesetAssertionIndex,
  claimRequestId,
  validateOutcomeParams,
  validateRuleAssertions,
  validateRuleOutcomes,
} from "./engine/validate-outcomes.js";
export type {
  OutcomeValidationInput,
  RulesetAssertion,
} from "./engine/validate-outcomes.js";

export {
  EVIDENCE_REQUEST_HEADERS,
  EVIDENCE_RESPONSE_HEADERS,
  buildEvidence,
  buildFindings,
  buildReport,
  buildRuleResult,
  buildUninvokedResult,
  summarize,
} from "./engine/build-report.js";
export type {
  FindingBuildInput,
  RemediationTable,
  ReportBuildInput,
} from "./engine/build-report.js";

export { runScan } from "./engine/run-scan.js";
export type { ScanInput } from "./engine/run-scan.js";
