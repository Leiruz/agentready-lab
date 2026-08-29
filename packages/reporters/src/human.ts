import type {
  CanonicalScanReportV1,
  PublicEvidence,
  PublicObservationError,
  ReportSource,
  RequirementClass,
  RuleFinding,
  RuleResult,
  RuleStatus,
  SourceRef,
} from "@agentready-lab/core";

import type { ReporterOutput } from "./output.js";
import { formatDiagnostics, reportDiagnostics } from "./output.js";
import {
  TEXT_LIMITS,
  neutralizeWorkflowCommands,
  sanitize,
} from "./sanitize.js";

/**
 * The human reporter. `docs/ARCHITECTURE.md` section 14.
 *
 * Four properties it has to have, and how each is obtained rather than
 * asserted:
 *
 * - *deterministic rule order*. The order in the report is already canonical
 *   (results in registry order, findings sorted by code, evidence in plan
 *   order), so this walks it and never re-sorts. A reporter that sorted
 *   differently would be a second ordering that must agree with the JSON one
 *   and could only disagree with it;
 * - *required failures separated from recommendations*. The split is a section
 *   boundary, not a colour, so it survives a pipe, a log file and a screen
 *   reader. A compat finding gets its own section because CLAUDE.md forbids
 *   presenting a compatibility observation as conformance, and folding it into
 *   the required section would do exactly that;
 * - *readable without colour*. Every status carries an ASCII marker and its
 *   own spelled-out name, and colour is opt-in on top. Colour is applied only
 *   to section titles and status markers, never to target text, so the
 *   coloured and uncoloured documents differ by SGR sequences alone;
 * - *a citation under every verdict*. Each finding prints the pinned sources
 *   it cites, resolved out of the report's own sources array (ADR-0007
 *   section 1). A citation that does not resolve is printed as unresolved and
 *   reported on stderr, never silently dropped.
 */

export interface HumanReporterOptions {
  /**
   * Colour is opt-in. Pass the result of `colorEnabled(env, wanted)` rather
   * than a bare `true`, so that NO_COLOR wins.
   */
  readonly color?: boolean;
}

const SGR = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
} as const;

const STATUS_STYLE: Readonly<Record<RuleStatus, keyof typeof SGR>> = {
  pass: "green",
  fail: "red",
  warning: "yellow",
  "not-applicable": "dim",
  "unable-to-check": "yellow",
  "unsupported-runtime": "dim",
};

/**
 * The colour-free half of the status signal.
 *
 * `docs/ARCHITECTURE.md` section 14 requires the reporter to work without
 * colour, so the marker and the spelled-out status carry the meaning and
 * colour only reinforces it.
 */
const STATUS_MARKER: Readonly<Record<RuleStatus, string>> = {
  pass: "[+]",
  fail: "[x]",
  warning: "[!]",
  "not-applicable": "[-]",
  "unable-to-check": "[?]",
  "unsupported-runtime": "[~]",
};

type SectionKey =
  "required" | "recommended" | "compatibility" | "incomplete" | "settled";

interface Section {
  readonly key: SectionKey;
  readonly title: string;
  readonly blurb: string;
}

const SECTIONS: readonly Section[] = [
  {
    key: "required",
    title: "REQUIRED FAILURES",
    blurb: "Violated normative requirements. These are conformance defects.",
  },
  {
    key: "recommended",
    title: "RECOMMENDATIONS",
    blurb: "Failed recommendations and advisory checks. Not defects.",
  },
  {
    key: "compatibility",
    title: "COMPATIBILITY OBSERVATIONS",
    blurb: "Dated observations of one external tool. Never conformance.",
  },
  {
    key: "incomplete",
    title: "NOT COMPLETED",
    blurb: "No verdict was reached. Neither a pass nor a failure.",
  },
  {
    key: "settled",
    title: "PASSED AND NOT APPLICABLE",
    blurb: "Nothing to act on.",
  },
];

const FIELD = 12;
const DETAIL = 10;
const DETAIL_INDENT = " ".repeat(6 + DETAIL);
const EVIDENCE_INDENT = " ".repeat(2 + DETAIL + 1);

type Paint = (text: string) => string;

function painter(color: boolean, style: keyof typeof SGR): Paint {
  if (!color) return (text) => text;
  return (text) => `${SGR[style]}${text}${SGR.reset}`;
}

/**
 * Which section a finding belongs in.
 *
 * Total over both axes by construction, so no finding can fall out of the
 * report. The requirement class decides and the status does not: "required"
 * means a normative requirement was violated, which is a statement about the
 * requirement.
 */
function findingSection(finding: RuleFinding): SectionKey {
  switch (finding.status) {
    case "pass":
    case "not-applicable":
      return "settled";
    case "unable-to-check":
    case "unsupported-runtime":
      return "incomplete";
    case "fail":
    case "warning":
      return classSection(finding.requirementClass);
  }
}

function classSection(requirementClass: RequirementClass): SectionKey {
  switch (requirementClass) {
    case "normative":
      return "required";
    case "recommended":
    case "advisory":
      return "recommended";
    case "compatibility":
      return "compatibility";
  }
}

/**
 * Where a result with no findings goes.
 *
 * ADR-0002 section 5 makes a rule resolved before `plan()` the only way to get
 * one, and core builds those with a status and an empty finding list.
 */
function resultSection(status: RuleStatus): SectionKey {
  switch (status) {
    case "fail":
      return "required";
    case "warning":
      return "recommended";
    case "pass":
    case "not-applicable":
      return "settled";
    case "unable-to-check":
    case "unsupported-runtime":
      return "incomplete";
  }
}

function label(text: string): string {
  return sanitize(text, TEXT_LIMITS.label);
}

function field(name: string, value: string): string {
  return `  ${name.padEnd(FIELD)}${value}`;
}

function detail(name: string, value: string): string {
  return `      ${name.padEnd(DETAIL)}${value}`;
}

/**
 * The heading of one entry, and the rule line under it.
 *
 * The marker is the *finding's* status, not the rule's. `deriveRuleStatus`
 * folds a rule's findings into one verdict by precedence, so a rule with a
 * normative failure and a passing recommendation is `fail` as a whole. Heading
 * every one of its findings with that verdict would put `[x] fail` above a
 * passing finding, which is a plain misstatement of what was observed. The
 * rule's own status is on the next line, labelled, where it cannot be mistaken
 * for the finding's.
 */
function entryHeading(
  result: RuleResult,
  finding: RuleFinding | undefined,
  color: boolean,
): readonly string[] {
  const status = finding?.status ?? result.status;
  const paint = painter(color, STATUS_STYLE[status]);
  const subject =
    finding === undefined
      ? "(no finding reported)"
      : `${label(finding.code)}  (${finding.requirementClass}, ${finding.mode} mode)`;
  return [
    `  ${paint(`${STATUS_MARKER[status]} ${status}`)}  ${subject}`,
    detail(
      "rule",
      `${label(result.ruleId)} ${label(result.ruleVersion)}  (status ${result.status}, gate ${result.gate})`,
    ),
  ];
}

/**
 * The pinned source behind one citation.
 *
 * An unresolved id is printed rather than skipped. ADR-0007 section 1 makes a
 * finding that cites a source the report does not list a contract failure, and
 * a reporter that quietly rendered the finding without its citation would hide
 * exactly the thing the report exists to carry.
 */
function sourceLines(
  ref: SourceRef,
  sources: ReadonlyMap<string, ReportSource>,
): readonly string[] {
  const id = label(ref.sourceId);
  const section =
    ref.section === undefined ? "" : `  section ${label(ref.section)}`;
  const source = sources.get(ref.sourceId);
  if (source === undefined) {
    return [detail("source", `${id}${section}  (not listed in this report)`)];
  }
  const version =
    source.version === undefined ? "" : `version ${label(source.version)}, `;
  return [
    detail("source", `${id}  ${sanitize(source.title, TEXT_LIMITS.title)}`),
    `${DETAIL_INDENT}${sanitize(source.url, TEXT_LIMITS.value)}${section}`,
    `${DETAIL_INDENT}${label(source.kind)}, ${label(source.status)}, ${version}verified ${label(source.verifiedAt)}`,
  ];
}

function findingLines(
  finding: RuleFinding,
  sources: ReadonlyMap<string, ReportSource>,
): readonly string[] {
  const lines: string[] = [
    detail("message", sanitize(finding.message, TEXT_LIMITS.message)),
  ];

  if (finding.remediation !== undefined) {
    lines.push(
      detail(
        "fix",
        `${finding.remediation.class}: ${sanitize(finding.remediation.summary, TEXT_LIMITS.remediation)}`,
      ),
    );
  }

  if (finding.sourceRefs.length === 0) {
    lines.push(detail("source", "none cited"));
  }
  for (const ref of finding.sourceRefs) {
    lines.push(...sourceLines(ref, sources));
  }

  if (finding.evidenceRefs.length !== 0) {
    lines.push(detail("evidence", finding.evidenceRefs.map(label).join(", ")));
  }
  return lines;
}

interface Entry {
  readonly section: SectionKey;
  readonly lines: readonly string[];
}

function entries(
  report: CanonicalScanReportV1,
  color: boolean,
): readonly Entry[] {
  const sources = new Map(report.sources.map((source) => [source.id, source]));
  const collected: Entry[] = [];

  for (const result of report.results) {
    if (result.findings.length === 0) {
      collected.push({
        section: resultSection(result.status),
        lines: entryHeading(result, undefined, color),
      });
      continue;
    }
    for (const finding of result.findings) {
      collected.push({
        section: findingSection(finding),
        lines: [
          ...entryHeading(result, finding, color),
          ...findingLines(finding, sources),
        ],
      });
    }
  }
  return collected;
}

function errorLines(error: PublicObservationError): readonly string[] {
  const retry = error.retryable ? "retryable" : "not retryable";
  return [
    `${EVIDENCE_INDENT}error ${label(error.code)} at ${label(error.phase)} (${retry})`,
    `${EVIDENCE_INDENT}${sanitize(error.message, TEXT_LIMITS.message)}`,
  ];
}

function headerLines(
  headers: Readonly<Record<string, readonly string[]>>,
): readonly string[] {
  // Core emits these already sorted. Sorting again costs nothing and keeps
  // the output deterministic for a report this package did not produce.
  return Object.keys(headers)
    .sort()
    .flatMap((name) =>
      (headers[name] ?? []).map(
        (value) =>
          `${EVIDENCE_INDENT}${label(name)}: ${sanitize(value, TEXT_LIMITS.value)}`,
      ),
    );
}

function factValue(value: string | number | boolean | null): string {
  if (value === null) return "null";
  if (typeof value === "string") return sanitize(value, TEXT_LIMITS.value);
  return String(value);
}

function evidenceLines(entry: PublicEvidence): readonly string[] {
  const id = `  ${label(entry.id).padEnd(DETAIL)} `;
  switch (entry.kind) {
    case "http": {
      const head = `${id}http ${entry.request.method} ${sanitize(entry.request.url, TEXT_LIMITS.value)}`;
      const request = headerLines(entry.request.headers);
      if (entry.outcome.kind === "error") {
        return [head, ...request, ...errorLines(entry.outcome.error)];
      }
      const body = entry.outcome.truncated ? ", body truncated at the cap" : "";
      return [
        head,
        ...request,
        `${EVIDENCE_INDENT}status ${String(entry.outcome.status)}`,
        ...headerLines(entry.outcome.headers),
        `${EVIDENCE_INDENT}${String(entry.outcome.encodedBytes)} encoded and ${String(entry.outcome.decodedBytes)} decoded bytes${body}`,
        `${EVIDENCE_INDENT}body ${label(entry.outcome.bodySha256)}`,
        ...entry.outcome.redirects.map(
          (redirect) =>
            `${EVIDENCE_INDENT}redirect ${String(redirect.status)} ${redirect.decision} to ${sanitize(redirect.location, TEXT_LIMITS.value)}`,
        ),
      ];
    }
    case "dns": {
      const head = `${id}dns ${label(entry.query.recordType)} ${sanitize(entry.query.name, TEXT_LIMITS.value)}`;
      if (entry.outcome.kind === "error") {
        return [head, ...errorLines(entry.outcome.error)];
      }
      return [
        head,
        `${EVIDENCE_INDENT}${label(entry.outcome.rcode)}, dnssec ${entry.outcome.dnssec}`,
        ...entry.outcome.records.map(
          (record) =>
            `${EVIDENCE_INDENT}${label(record.type)} ${sanitize(record.value, TEXT_LIMITS.value)}`,
        ),
      ];
    }
    case "browser": {
      const head = `${id}browser ${label(entry.action.capability)} ${sanitize(entry.action.url, TEXT_LIMITS.value)}`;
      if (entry.outcome.kind === "error") {
        return [head, ...errorLines(entry.outcome.error)];
      }
      return [
        head,
        ...entry.outcome.facts.map(
          (fact) =>
            `${EVIDENCE_INDENT}${label(fact.key)} = ${factValue(fact.value)}`,
        ),
      ];
    }
  }
}

function summaryLines(report: CanonicalScanReportV1): readonly string[] {
  const counts = report.summary;
  return [
    field(
      "summary",
      `pass ${String(counts.pass)}  fail ${String(counts.fail)}  warning ${String(counts.warning)}`,
    ),
    `  ${" ".repeat(FIELD)}not-applicable ${String(counts.notApplicable)}  unable-to-check ${String(counts.unableToCheck)}  unsupported-runtime ${String(counts.unsupportedRuntime)}`,
  ];
}

function headLines(report: CanonicalScanReportV1): readonly string[] {
  const policy = report.policy;
  const lines = [
    field("target", sanitize(report.target.requestedUrl, TEXT_LIMITS.value)),
    field("page", sanitize(report.target.resolvedPageUrl, TEXT_LIMITS.value)),
    field("origin", sanitize(report.target.origin, TEXT_LIMITS.value)),
    field("scope", `${report.target.scope} on ${report.target.networkProfile}`),
    field("mode", report.mode),
    field("profile", `${report.profile.id} ${label(report.profile.version)}`),
    field(
      "ruleset",
      `${label(report.ruleset.id)} ${label(report.ruleset.version)}`,
    ),
    field("digest", label(report.ruleset.digest)),
    field("sources", `ledger ${label(report.sourceLedgerVersion)}`),
  ];

  if (report.externalSnapshot !== undefined) {
    lines.push(
      field(
        "snapshot",
        `captured ${label(report.externalSnapshot.capturedAt)}, schema ${label(report.externalSnapshot.schemaVersion)}`,
      ),
    );
  }

  lines.push(
    field("tool", `${report.tool.name} ${label(report.tool.version)}`),
    field(
      "policy",
      `${label(policy.id)} ${label(policy.version)}; schemes ${policy.allowedSchemes.join(", ")}; ports ${policy.allowedPorts.map(String).join(", ")}`,
    ),
    field(
      "budget",
      `${String(policy.maxRequests)} requests, ${String(policy.maxRedirectsPerObservation)} redirects per observation, ${String(policy.maxEncodedResponseBytes)} encoded and ${String(policy.maxDecodedResponseBytes)} decoded bytes`,
    ),
  );

  if (report.mode === "compat") {
    // CLAUDE.md: never present compat as conformance. The reader of a terminal
    // report is exactly the reader who would otherwise assume it.
    lines.push(
      field("note", "compat observes one dated external tool, not conformance"),
    );
  }
  return lines;
}

/**
 * Renders the report for a terminal.
 *
 * Pure: it reads the frozen report and returns two strings. No filesystem, no
 * network, no clock, no randomness, and no write to the input, which core has
 * deep-frozen in any case (`docs/THREAT_MODEL.md` section 20.3).
 */
export function renderHuman(
  report: CanonicalScanReportV1,
  options?: HumanReporterOptions,
): ReporterOutput {
  const color = options?.color ?? false;
  const heading = painter(color, "bold");
  const collected = entries(report, color);

  const lines: string[] = [
    heading("AgentReady Lab scan report"),
    "",
    ...headLines(report),
    ...summaryLines(report),
  ];

  for (const section of SECTIONS) {
    const matching = collected.filter((entry) => entry.section === section.key);
    lines.push(
      "",
      heading(`${section.title} (${String(matching.length)})`),
      `  ${section.blurb}`,
      "",
    );
    if (matching.length === 0) {
      lines.push("  none");
      continue;
    }
    for (const entry of matching) lines.push(...entry.lines, "");
    lines.pop();
  }

  lines.push("", heading(`EVIDENCE (${String(report.evidence.length)})`), "");
  if (report.evidence.length === 0) {
    lines.push("  none");
  } else {
    for (const entry of report.evidence)
      lines.push(...evidenceLines(entry), "");
    lines.pop();
  }

  // The last guard. Every field above is already sanitized, and no template
  // here puts a target string at column zero, so this should never change a
  // byte. It is here because "should never" is an argument about the current
  // layout, and a workflow command in someone else's CI log is not a thing to
  // leave resting on a layout argument.
  const document = neutralizeWorkflowCommands(`${lines.join("\n")}\n`);

  return {
    stdout: document,
    stderr: formatDiagnostics(reportDiagnostics(report)),
  };
}
