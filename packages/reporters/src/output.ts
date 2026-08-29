import type { CanonicalScanReportV1 } from "@agentready-lab/core";

import { TEXT_LIMITS, sanitize } from "./sanitize.js";

/**
 * What every reporter returns.
 *
 * Two strings rather than a stream pair, because a reporter is a pure
 * transform (`docs/ARCHITECTURE.md` section 4 and section 14) and a function
 * that held a writable stream would not be one. Splitting the two here rather
 * than at the call site is what makes "stdout contains JSON only" a property
 * of this package: there is no code path by which a diagnostic can reach
 * `stdout`, so the CLI cannot get it wrong by writing them in the wrong order.
 */
export interface ReporterOutput {
  /** The product. For the JSON reporter, exactly the canonical bytes. */
  readonly stdout: string;
  /** Diagnostics, each already terminated. Empty when there are none. */
  readonly stderr: string;
}

/**
 * Resolves whether colour may be used.
 *
 * `NO_COLOR` (no-color.org) disables colour whenever it is present and not
 * empty, whatever the caller asked for. The environment is a parameter rather
 * than a read of `process.env`, which this package could not do anyway: its
 * tsconfig pins `"types": []`, so `process` is not a declared identifier here.
 */
export function colorEnabled(
  env: Readonly<Record<string, string | undefined>>,
  requested: boolean,
): boolean {
  const noColor = env["NO_COLOR"];
  if (noColor !== undefined && noColor !== "") return false;
  return requested;
}

/**
 * Integrity problems a reporter can see but must not repair.
 *
 * ADR-0007 section 1 forbids "a reporter adding, removing, or rewriting a
 * source entry", so an unresolvable citation is reported rather than dropped
 * or invented. The same holds for an evidence reference: a finding that points
 * at evidence the report does not carry is a defect in whatever produced the
 * report, and hiding it would make the report look self-contained when it is
 * not.
 *
 * Deterministic: results, findings and references are all walked in report
 * order, and the report's own order is canonical.
 */
export function reportDiagnostics(
  report: CanonicalScanReportV1,
): readonly string[] {
  const sources = new Set(report.sources.map((source) => source.id));
  const evidence = new Set(report.evidence.map((entry) => entry.id));
  const diagnostics: string[] = [];

  for (const result of report.results) {
    const rule = sanitize(result.ruleId, TEXT_LIMITS.label);
    for (const finding of result.findings) {
      const code = sanitize(finding.code, TEXT_LIMITS.label);
      const at = `finding ${code} of rule ${rule}`;
      if (finding.sourceRefs.length === 0) {
        diagnostics.push(`${at} cites no source`);
      }
      for (const ref of finding.sourceRefs) {
        if (sources.has(ref.sourceId)) continue;
        const id = sanitize(ref.sourceId, TEXT_LIMITS.label);
        diagnostics.push(
          `${at} cites source ${id}, which this report does not list`,
        );
      }
      for (const ref of finding.evidenceRefs) {
        if (evidence.has(ref)) continue;
        const id = sanitize(ref, TEXT_LIMITS.label);
        diagnostics.push(
          `${at} cites evidence ${id}, which this report does not contain`,
        );
      }
    }
  }
  return diagnostics;
}

/** One diagnostic per line, each already terminated. */
export function formatDiagnostics(diagnostics: readonly string[]): string {
  return diagnostics
    .map((diagnostic) => `agentready-lab: ${diagnostic}\n`)
    .join("");
}
