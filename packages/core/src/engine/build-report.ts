import type { ProbeObservation } from "../model/observation.js";
import type {
  CanonicalScanReportV1,
  EffectiveRuleOptions,
  ExternalSnapshotRef,
  PublicEvidence,
  PublicNetworkPolicy,
  ReportSource,
  ScanSummary,
} from "../model/report.js";
import type {
  AssertionOutcome,
  FindingRemediation,
  RuleFinding,
  RuleResult,
  SourceRef,
} from "../model/rule.js";
import type {
  InterpretationMode,
  NetworkProfileId,
  NetworkScope,
  ProfileId,
  ResultGate,
  RuleStatus,
} from "../model/status.js";
import type { PlannedObservation } from "./admission.js";
import { deriveRuleStatus, findingStatus } from "./derive-status.js";
import { deepFreeze } from "./memo.js";
import type { MessageTemplates } from "./render-message.js";
import { renderMessage, sanitizeEvidenceText } from "./render-message.js";
import type { RulesetAssertion } from "./validate-outcomes.js";

/**
 * `docs/ARCHITECTURE.md` section 9, ADR-0005 section 5 and ADR-0007 section 1.
 *
 * The report is canonically ordered and then frozen. Results follow registry
 * order, findings sort by code, evidence sorts by id (which is plan order),
 * and cited sources sort by id. Nothing here reads a clock, a random source,
 * or a URL.
 */

/**
 * `docs/THREAT_MODEL.md` section 20.1 permits "safe allowlisted request-header
 * names and values". For M1 `accept` is the only header a rule can set
 * (`HttpObservationRequest`), so it is the only one that can appear.
 */
export const EVIDENCE_REQUEST_HEADERS: readonly string[] = ["accept"];

/**
 * `docs/THREAT_MODEL.md` section 20.1 names "allowlisted response headers such
 * as `Content-Type`, `Vary`, and `Link`" and gives no closed list.
 *
 * These three are what that sentence names, and the set is deliberately not an
 * input: a caller able to widen it could put an arbitrary target-controlled
 * header into a report, which is the control this list exists to be. Adding a
 * header here is a visible security change, and it is the change a rule that
 * needs a fourth header has to make.
 */
export const EVIDENCE_RESPONSE_HEADERS: readonly string[] = [
  "content-type",
  "link",
  "vary",
];

/** `docs/THREAT_MODEL.md` section 16: the raw target URL bound. */
const MAX_EVIDENCE_URL_LENGTH = 2048;

function projectHeaders(
  headers: ReadonlyMap<string, readonly string[]>,
  allowlist: readonly string[],
): Readonly<Record<string, readonly string[]>> {
  const projected: Record<string, readonly string[]> = {};
  for (const name of [...allowlist].sort()) {
    const values = headers.get(name);
    if (values === undefined || values.length === 0) continue;
    projected[name] = values.map((value) =>
      sanitizeEvidenceText(value, MAX_EVIDENCE_URL_LENGTH),
    );
  }
  return projected;
}

export function buildEvidence(
  plan: readonly PlannedObservation[],
  observations: ReadonlyMap<string, ProbeObservation>,
): readonly PublicEvidence[] {
  const evidence: PublicEvidence[] = [];
  for (const entry of plan) {
    const observation = observations.get(entry.evidenceId);
    if (observation === undefined) continue;
    evidence.push(projectObservation(observation));
  }
  return evidence;
}

function projectObservation(observation: ProbeObservation): PublicEvidence {
  if (observation.kind === "dns") {
    return {
      id: observation.id,
      kind: "dns",
      query: {
        name: sanitizeEvidenceText(
          observation.query.name,
          MAX_EVIDENCE_URL_LENGTH,
        ),
        recordType: observation.query.recordType,
      },
      outcome:
        observation.outcome.kind === "answer"
          ? {
              kind: "answer",
              rcode: observation.outcome.rcode,
              records: observation.outcome.records.map((record) => ({
                type: record.type,
                value: sanitizeEvidenceText(
                  record.value,
                  MAX_EVIDENCE_URL_LENGTH,
                ),
              })),
              dnssec: observation.outcome.dnssec,
            }
          : { kind: "error", error: observation.outcome.error },
    };
  }

  const request = {
    method: observation.request.method,
    url: sanitizeEvidenceText(observation.request.url, MAX_EVIDENCE_URL_LENGTH),
    headers: projectHeaders(
      observation.request.headers,
      EVIDENCE_REQUEST_HEADERS,
    ),
  };

  if (observation.outcome.kind === "error") {
    return {
      id: observation.id,
      kind: "http",
      request,
      outcome: { kind: "error", error: observation.outcome.error },
    };
  }

  // The body is deliberately absent: `ProbeObservation` carries the bounded
  // decoded body and `PublicEvidence` does not. The rule sees bytes, the
  // report sees a digest and a length.
  return {
    id: observation.id,
    kind: "http",
    request,
    outcome: {
      kind: "response",
      status: observation.outcome.status,
      headers: projectHeaders(
        observation.outcome.headers,
        EVIDENCE_RESPONSE_HEADERS,
      ),
      encodedBytes: observation.outcome.encodedBytes,
      decodedBytes: observation.outcome.decodedBytes,
      bodySha256: observation.outcome.bodySha256,
      truncated: observation.outcome.truncated,
      redirects: observation.outcome.redirects.map((redirect) => ({
        status: redirect.status,
        location: sanitizeEvidenceText(
          redirect.location,
          MAX_EVIDENCE_URL_LENGTH,
        ),
        decision: redirect.decision,
      })),
    },
  };
}

export type RemediationTable = ReadonlyMap<string, FindingRemediation>;

export interface FindingBuildInput {
  readonly ruleId: string;
  readonly mode: InterpretationMode;
  readonly outcomes: readonly AssertionOutcome[];
  readonly declarations: ReadonlyMap<string, RulesetAssertion>;
  /** Rule-local request id to evidence id. */
  readonly aliases: ReadonlyMap<string, string>;
  readonly templates: MessageTemplates;
  readonly remediation: RemediationTable;
  /** Called when an `observationRefs` entry names no completed request. */
  readonly rejectUnknownRef: (ruleId: string, localId: string) => never;
}

/**
 * ADR-0002 sections 5, 6 and 8. A rule supplies an outcome kind, typed
 * parameters and rule-local observation ids. Everything else is derived.
 *
 * The rule cannot choose the status, the requirement class, the message or the
 * citation, and it cannot supply an evidence id. Two rules citing the same
 * observation cite the same evidence id, because the rewrite goes through the
 * alias map rather than through anything either rule wrote.
 */
export function buildFindings(
  input: FindingBuildInput,
): readonly RuleFinding[] {
  const findings = input.outcomes.map((outcome): RuleFinding => {
    const declaration = input.declarations.get(outcome.assertion);
    if (declaration === undefined) {
      return input.rejectUnknownRef(input.ruleId, outcome.assertion);
    }
    const status = findingStatus(outcome.kind, declaration.requirementClass);
    const evidenceRefs = [
      ...new Set(
        outcome.observationRefs.map((localId) => {
          const evidenceId = input.aliases.get(localId);
          if (evidenceId === undefined) {
            return input.rejectUnknownRef(input.ruleId, localId);
          }
          return evidenceId;
        }),
      ),
    ].sort();

    const remediation =
      status === "fail" || status === "warning"
        ? input.remediation.get(declaration.id)
        : undefined;

    const base = {
      code: declaration.id,
      mode: input.mode,
      requirementClass: declaration.requirementClass,
      status,
      message: renderMessage(
        input.templates,
        declaration.id,
        outcome.kind,
        outcome.params,
      ),
      // Citations are derived, never supplied: `AssertionOutcome` carries no
      // `sourceRefs`, so a rule cannot cite a source at all.
      sourceRefs: declaration.sourceRefs.map((ref): SourceRef =>
        ref.section === undefined
          ? { sourceId: ref.sourceId }
          : { sourceId: ref.sourceId, section: ref.section },
      ),
      evidenceRefs,
    };
    return remediation === undefined ? base : { ...base, remediation };
  });

  return [...findings].sort((left, right) =>
    left.code < right.code ? -1 : left.code > right.code ? 1 : 0,
  );
}

export function summarize(results: readonly RuleResult[]): ScanSummary {
  const count = (status: RuleStatus): number =>
    results.filter((result) => result.status === status).length;
  // ADR-0004 section 4: an informational result still counts here. A reader
  // who sees `fail: 1` beside exit code 0 needs the `gate` field to explain
  // it, and a summary that quietly omitted the result would remove that.
  return {
    pass: count("pass"),
    fail: count("fail"),
    warning: count("warning"),
    notApplicable: count("not-applicable"),
    unableToCheck: count("unable-to-check"),
    unsupportedRuntime: count("unsupported-runtime"),
  };
}

export function buildRuleResult(
  ruleId: string,
  ruleVersion: string,
  gate: ResultGate,
  findings: readonly RuleFinding[],
): RuleResult {
  return {
    ruleId,
    ruleVersion,
    status: deriveRuleStatus(findings.map((finding) => finding.status)),
    gate,
    findings,
  };
}

/**
 * A rule the core resolved before `plan()`.
 *
 * ADR-0002 section 5: such a rule never reaches `deriveRuleStatus` and is not
 * covered by the zero-outcome violation, which is why the status is passed in
 * rather than derived from an empty finding list.
 */
export function buildUninvokedResult(
  ruleId: string,
  ruleVersion: string,
  gate: ResultGate,
  status: RuleStatus,
): RuleResult {
  return { ruleId, ruleVersion, status, gate, findings: [] };
}

export interface ReportBuildInput {
  readonly toolVersion: string;
  readonly ruleset: {
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly sourceLedgerVersion: string;
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
  readonly results: readonly RuleResult[];
  readonly effectiveOptions: readonly EffectiveRuleOptions[];
  readonly evidence: readonly PublicEvidence[];
  /** The whole source ledger, keyed by id. Filtered to citations here. */
  readonly sourceLedger: ReadonlyMap<string, ReportSource>;
}

/**
 * ADR-0007 section 1: `sources` is projected from the source ledger and
 * filtered to the sources actually cited by a finding in this report.
 *
 * Embedding all thirty ledger entries would put the same unchanging block in
 * every diff and would grow with the registry rather than with the scan.
 */
function citedSources(
  results: readonly RuleResult[],
  ledger: ReadonlyMap<string, ReportSource>,
): readonly ReportSource[] {
  const cited = new Set<string>();
  for (const result of results) {
    for (const finding of result.findings) {
      for (const ref of finding.sourceRefs) cited.add(ref.sourceId);
    }
  }
  return [...cited]
    .sort()
    .map((id) => ledger.get(id))
    .filter((source): source is ReportSource => source !== undefined);
}

/**
 * Builds and freezes the canonical report.
 *
 * `docs/THREAT_MODEL.md` section 20.3: "The canonical normalized report is
 * frozen before reporters receive it. A reporter cannot rescan, mutate
 * evidence, or alter a verdict." `deepFreeze` is what makes that true rather
 * than documented, and it is safe to use here because every value in the
 * report is plain JSON data: the `Map`s and `Uint8Array`s of the rule-facing
 * observation types are projected away by `buildEvidence`.
 */
export function buildReport(
  input: ReportBuildInput,
): Readonly<CanonicalScanReportV1> {
  const base = {
    schemaVersion: "1.0.0",
    tool: { name: "agentready-lab", version: input.toolVersion },
    ruleset: input.ruleset,
    sourceLedgerVersion: input.sourceLedgerVersion,
    profile: input.profile,
    mode: input.mode,
    target: input.target,
    policy: input.policy,
    summary: summarize(input.results),
    results: input.results,
    effectiveOptions: [...input.effectiveOptions].sort((left, right) =>
      left.ruleId < right.ruleId ? -1 : left.ruleId > right.ruleId ? 1 : 0,
    ),
    evidence: input.evidence,
    sources: citedSources(input.results, input.sourceLedger),
  } as const satisfies Omit<CanonicalScanReportV1, "externalSnapshot">;

  // ADR-0007 section 1: present in `compat` mode and absent in every other
  // mode, because a compatibility verdict is a claim about a dated external
  // inventory and a `spec` verdict is not.
  const report: CanonicalScanReportV1 =
    input.externalSnapshot === undefined
      ? base
      : { ...base, externalSnapshot: input.externalSnapshot };

  return deepFreeze(report);
}
