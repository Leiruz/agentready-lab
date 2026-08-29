import type {
  CanonicalScanReportV1,
  EffectiveRuleOptions,
  ExternalSnapshotRef,
  FindingRemediation,
  InterpretationMode,
  PublicEvidence,
  PublicNetworkPolicy,
  ReportSource,
  RequirementClass,
  RuleFinding,
  RuleResult,
  RuleStatus,
  SourceRef,
} from "@agentready-lab/core";
import {
  buildReport,
  buildRuleResult,
  buildUninvokedResult,
} from "@agentready-lab/core";

/**
 * The reporter-only datasets of `docs/FIXTURE_CATALOG.md` section 14, plus the
 * two security cases the reporters own: `sec-010` (terminal and workflow
 * control text) and `sec-009` (a token-shaped value that redaction removed).
 *
 * Reports are built through core's own `buildReport`, not assembled as object
 * literals. That is deliberate: the fixtures are then canonically ordered and
 * deep-frozen by the same code that produces a real report, so a test that
 * passes here is a test against the artifact a scan actually emits, and a
 * reporter that mutated its input would fail on every fixture rather than on a
 * remembered one.
 *
 * The datasets from section 14 that are *not* here belong to reporters M1 does
 * not ship: the source-map cases and the "no source map for a remote finding"
 * case are SARIF, and the two-report regression/improvement pairs are the
 * GitHub Summary diff. Building fixtures for them would imply those reporters
 * exist.
 */

/**
 * Control characters are written as code points so that this source file stays
 * printable and reviewable, and so no editor or tool can silently normalize
 * the payload the tests depend on.
 */
const ch = (code: number): string => String.fromCodePoint(code);

export const NUL = ch(0x00);
export const BEL = ch(0x07);
export const LF = ch(0x0a);
export const CR = ch(0x0d);
export const ESC = ch(0x1b);
export const DEL = ch(0x7f);
/** C1 CSI: the single-byte form of the control sequence introducer. */
export const C1_CSI = ch(0x9b);
/** C1 OSC. */
export const C1_OSC = ch(0x9d);
/** RIGHT-TO-LEFT OVERRIDE and POP DIRECTIONAL FORMATTING. */
export const RLO = ch(0x202e);
export const PDF = ch(0x202c);
/** FIRST STRONG ISOLATE and POP DIRECTIONAL ISOLATE. */
export const FSI = ch(0x2068);
export const PDI = ch(0x2069);
/** LINE SEPARATOR. */
export const LSEP = ch(0x2028);
/** An astral character, for the surrogate-pair boundary case. */
export const ASTRAL = String.fromCodePoint(0x1f600);

/** An SGR sequence that paints the rest of the line red. */
export const ANSI_RED = `${ESC}[31m`;
export const ANSI_RESET = `${ESC}[0m`;

/** An OSC 8 hyperlink whose visible label lies about its target. */
export const OSC8_LINK = `${ESC}]8;;https://attacker.example/steal${BEL}your bank${ESC}]8;;${BEL}`;

/** A GitHub Actions workflow command. */
export const WORKFLOW_COMMAND = "::error title=pwned::injected annotation";

/**
 * `sec-010`. Every payload class in one string, so a single grep over the
 * rendered output answers whether any of them survived.
 */
export const HOSTILE = [
  `${ANSI_RED}painted${ANSI_RESET}`,
  OSC8_LINK,
  `head${NUL}${CR}${LF}tail`,
  `${C1_CSI}2J`,
  `${C1_OSC}0;retitled${BEL}`,
  `${RLO}gpj.exe${PDF}`,
  `${FSI}isolated${PDI}`,
  `split${LSEP}here`,
  WORKFLOW_COMMAND,
  `del${DEL}`,
].join(" ");

/**
 * `sec-009`. A value with no legitimate reason to appear anywhere: if a grep
 * finds it, something printed a value that redaction had already removed.
 */
export const SECRET_MARKER = "zq7marker4secret";

/**
 * The control for the same test. A marker that *should* appear, so a zero
 * count for `SECRET_MARKER` means the reporter withheld it rather than that
 * the grep cannot find anything.
 */
export const VISIBLE_MARKER = "zq7marker4visible";

const POLICY: PublicNetworkPolicy = {
  id: "local-loopback",
  version: "0.1.0",
  allowedSchemes: ["http"],
  allowedPorts: [8787],
  sameOriginDiscovery: true,
  maxRequests: 24,
  maxRedirectsPerObservation: 5,
  maxEncodedResponseBytes: 1048576,
  maxDecodedResponseBytes: 2097152,
};

export const ROBOTS_SOURCE: ReportSource = {
  id: "rfc9309",
  title: "Robots Exclusion Protocol",
  url: "https://www.rfc-editor.org/rfc/rfc9309.html",
  kind: "rfc",
  status: "proposed-standard",
  version: "2022-09",
  verifiedAt: "2026-08-01",
};

export const HTTP_SOURCE: ReportSource = {
  id: "rfc9110",
  title: "HTTP Semantics",
  url: "https://www.rfc-editor.org/rfc/rfc9110.html",
  kind: "rfc",
  status: "internet-standard",
  verifiedAt: "2026-08-01",
};

const LEDGER = new Map<string, ReportSource>([
  [ROBOTS_SOURCE.id, ROBOTS_SOURCE],
  [HTTP_SOURCE.id, HTTP_SOURCE],
]);

export interface FindingSpec {
  readonly code: string;
  readonly status: RuleStatus;
  readonly message: string;
  readonly mode?: InterpretationMode;
  readonly requirementClass?: RequirementClass;
  readonly remediation?: FindingRemediation;
  readonly sourceRefs?: readonly SourceRef[];
  readonly evidenceRefs?: readonly string[];
}

export function finding(spec: FindingSpec): RuleFinding {
  const base = {
    code: spec.code,
    mode: spec.mode ?? "spec",
    requirementClass: spec.requirementClass ?? "normative",
    status: spec.status,
    message: spec.message,
    sourceRefs: spec.sourceRefs ?? [{ sourceId: "rfc9309", section: "2.3" }],
    evidenceRefs: spec.evidenceRefs ?? [],
  } as const satisfies Omit<RuleFinding, "remediation">;
  return spec.remediation === undefined
    ? base
    : { ...base, remediation: spec.remediation };
}

export const REQUIRED_FIX: FindingRemediation = {
  class: "required-correction",
  summary: "Serve a robots.txt at the origin root over HTTP.",
};

export const RECOMMENDED_FIX: FindingRemediation = {
  class: "recommended-hardening",
  summary: "Name Accept in the Vary response header.",
};

export interface ReportSpec {
  readonly results: readonly RuleResult[];
  readonly evidence?: readonly PublicEvidence[];
  readonly mode?: InterpretationMode;
  readonly externalSnapshot?: ExternalSnapshotRef;
  readonly effectiveOptions?: readonly EffectiveRuleOptions[];
  readonly requestedUrl?: string;
}

export function report(spec: ReportSpec): CanonicalScanReportV1 {
  const url = spec.requestedUrl ?? "http://127.0.0.1:8787/";
  const base = {
    toolVersion: "0.0.0",
    ruleset: {
      id: "standard",
      version: "0.2.0",
      digest:
        "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    },
    sourceLedgerVersion: "0.1.0",
    profile: { id: "content", version: "0.1.0" },
    mode: spec.mode ?? "spec",
    target: {
      requestedUrl: url,
      resolvedPageUrl: url,
      origin: "http://127.0.0.1:8787",
      scope: "local",
      networkProfile: "local-loopback",
    },
    policy: POLICY,
    results: spec.results,
    effectiveOptions: spec.effectiveOptions ?? [],
    evidence: spec.evidence ?? [],
    sourceLedger: LEDGER,
  } as const satisfies Omit<
    Parameters<typeof buildReport>[0],
    "externalSnapshot"
  >;

  return spec.externalSnapshot === undefined
    ? buildReport(base)
    : buildReport({ ...base, externalSnapshot: spec.externalSnapshot });
}

export const HTTP_EVIDENCE: PublicEvidence = {
  id: "ev-0001",
  kind: "http",
  request: {
    method: "GET",
    url: "http://127.0.0.1:8787/robots.txt",
    headers: { accept: ["text/plain"] },
  },
  outcome: {
    kind: "response",
    status: 200,
    headers: { "content-type": ["text/plain; charset=utf-8"] },
    encodedBytes: 13,
    decodedBytes: 13,
    bodySha256:
      "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    truncated: false,
    redirects: [],
  },
};

/** `docs/FIXTURE_CATALOG.md` section 14: an error-outcome evidence entry. */
export const HTTP_ERROR_EVIDENCE: PublicEvidence = {
  id: "ev-0002",
  kind: "http",
  request: {
    method: "GET",
    url: "http://127.0.0.1:8787/blocked",
    headers: {},
  },
  outcome: {
    kind: "error",
    error: {
      code: "url-policy-blocked",
      phase: "policy",
      message: "The URL policy refused this request.",
      retryable: false,
    },
  },
};

export const DNS_ERROR_EVIDENCE: PublicEvidence = {
  id: "ev-0003",
  kind: "dns",
  query: { name: "example.test", recordType: "TXT" },
  outcome: {
    kind: "error",
    error: {
      code: "dns-resolution-failed",
      phase: "dns",
      message: "The host name could not be resolved.",
      retryable: true,
    },
  },
};

export const DNS_EVIDENCE: PublicEvidence = {
  id: "ev-0004",
  kind: "dns",
  query: { name: "example.test", recordType: "TXT" },
  outcome: {
    kind: "answer",
    rcode: "NOERROR",
    records: [{ type: "TXT", value: "v=spf1 -all" }],
    dnssec: "insecure",
  },
};

/**
 * The browser runtime is a later milestone, but `PublicBrowserEvidence` is in
 * the report model now, so the reporter has to render it. A fixture is how
 * that stays true rather than becoming an unreachable branch.
 */
export const BROWSER_EVIDENCE: PublicEvidence = {
  id: "ev-0005",
  kind: "browser",
  action: { url: "http://127.0.0.1:8787/", capability: "dom-snapshot" },
  outcome: {
    kind: "observation",
    facts: [
      { key: "title", value: "Example" },
      { key: "scripts", value: 3 },
      { key: "framed", value: false },
      { key: "canonical", value: null },
    ],
  },
};

/** Section 14: all six statuses in one report. */
export function allStatusesReport(): CanonicalScanReportV1 {
  return report({
    results: [
      buildRuleResult("web.discovery.robots", "0.1.0", "enforced", [
        finding({
          code: "robots.location",
          status: "fail",
          message: "No robots.txt was served at the origin root.",
          remediation: REQUIRED_FIX,
          evidenceRefs: ["ev-0001"],
        }),
        finding({
          code: "robots.compat",
          status: "fail",
          mode: "compat",
          requirementClass: "compatibility",
          message: "The dated external tool would not recognize this file.",
          remediation: {
            class: "compatibility-workaround",
            summary: "Place the file at the exact path the snapshot expects.",
          },
        }),
      ]),
      buildRuleResult("web.content.markdown", "0.2.0", "enforced", [
        finding({
          code: "markdown.vary",
          status: "warning",
          requirementClass: "recommended",
          message: "Vary did not name Accept.",
          remediation: RECOMMENDED_FIX,
          sourceRefs: [{ sourceId: "rfc9110" }],
        }),
      ]),
      buildRuleResult("web.discovery.sitemap", "0.1.0", "enforced", [
        finding({
          code: "sitemap.reachable",
          status: "pass",
          message: "A sitemap was served and parsed.",
          evidenceRefs: ["ev-0001"],
        }),
      ]),
      buildRuleResult("web.api.catalog", "0.1.0", "informational", [
        finding({
          code: "catalog.present",
          status: "not-applicable",
          message: "No API catalog is declared for this profile.",
        }),
      ]),
      buildRuleResult("web.signals.content", "0.1.0", "enforced", [
        finding({
          code: "signals.parse",
          status: "unable-to-check",
          message: "The document exceeded the parser budget.",
          evidenceRefs: ["ev-0002"],
        }),
      ]),
      buildUninvokedResult(
        "web.browser.render",
        "0.1.0",
        "informational",
        "unsupported-runtime",
      ),
    ],
    evidence: [HTTP_EVIDENCE, HTTP_ERROR_EVIDENCE],
  });
}

/** Section 14: multiple findings under one rule. */
export function multipleFindingsReport(): CanonicalScanReportV1 {
  return report({
    results: [
      buildRuleResult("web.discovery.robots", "0.1.0", "enforced", [
        finding({
          code: "robots.agent-rules",
          status: "warning",
          requirementClass: "advisory",
          message: "No agent-specific group was found.",
          remediation: RECOMMENDED_FIX,
        }),
        finding({
          code: "robots.location",
          status: "fail",
          message: "No robots.txt was served at the origin root.",
          remediation: REQUIRED_FIX,
        }),
        finding({
          code: "robots.syntax",
          status: "pass",
          message: "Every group parsed.",
        }),
      ]),
    ],
    evidence: [HTTP_EVIDENCE],
  });
}

/** Section 14: non-ASCII text and XML/Markdown metacharacters. */
export function markupReport(): CanonicalScanReportV1 {
  const markup = `<a href="x">&amp;</a> | *em* _under_ \`code\` [l](u) ${ASTRAL} nyanpasu`;
  return report({
    requestedUrl: `http://127.0.0.1:8787/${encodeURIComponent("café")}`,
    results: [
      buildRuleResult("web.discovery.robots", "0.1.0", "enforced", [
        finding({
          code: "robots.location",
          status: "fail",
          message: `Served ${markup}`,
          remediation: {
            class: "required-correction",
            summary: `Remove ${markup}`,
          },
        }),
      ]),
    ],
    evidence: [
      {
        id: "ev-0001",
        kind: "http",
        request: {
          method: "GET",
          url: "http://127.0.0.1:8787/robots.txt",
          headers: { accept: ["text/plain"] },
        },
        outcome: {
          kind: "response",
          status: 200,
          headers: { link: [`<${markup}>; rel="describedby"`] },
          encodedBytes: 1,
          decodedBytes: 1,
          bodySha256: "sha256:00",
          truncated: true,
          redirects: [
            {
              status: 301,
              location: `http://x/${markup}`,
              decision: "blocked",
            },
          ],
        },
      },
    ],
  });
}

/** Section 14: maximum accepted message length, and one character past it. */
export function messageCapReport(cap: number): CanonicalScanReportV1 {
  return report({
    results: [
      buildRuleResult("web.discovery.robots", "0.1.0", "enforced", [
        finding({
          code: "robots.at-cap",
          status: "fail",
          message: "a".repeat(cap),
          remediation: REQUIRED_FIX,
        }),
        finding({
          code: "robots.over-cap",
          status: "fail",
          message: "b".repeat(cap + 1),
          remediation: REQUIRED_FIX,
        }),
      ]),
    ],
  });
}

/** Section 14: a report with no evidence at all. */
export function noEvidenceReport(): CanonicalScanReportV1 {
  return report({
    results: [
      buildRuleResult("web.discovery.robots", "0.1.0", "enforced", [
        finding({
          code: "robots.location",
          status: "pass",
          message: "A robots.txt was served.",
        }),
      ]),
    ],
  });
}

/** Section 14: error-outcome evidence, one per observation runtime. */
export function errorEvidenceReport(): CanonicalScanReportV1 {
  return report({
    results: [
      buildRuleResult("web.discovery.robots", "0.1.0", "enforced", [
        finding({
          code: "robots.location",
          status: "unable-to-check",
          message: "The observation did not complete.",
          evidenceRefs: ["ev-0002", "ev-0003"],
        }),
      ]),
    ],
    evidence: [
      HTTP_ERROR_EVIDENCE,
      DNS_ERROR_EVIDENCE,
      DNS_EVIDENCE,
      BROWSER_EVIDENCE,
    ],
  });
}

/**
 * `sec-010`. The hostile payload in every target-influenced position a report
 * has: the requested URL, a request header value, a response header value, a
 * redirect location, a DNS record value, a finding message, and a remediation
 * summary.
 */
export function hostileReport(): CanonicalScanReportV1 {
  return report({
    requestedUrl: `http://127.0.0.1:8787/${HOSTILE}`,
    results: [
      buildRuleResult("web.discovery.robots", "0.1.0", "enforced", [
        finding({
          code: "robots.location",
          status: "fail",
          message: `The server said ${HOSTILE}`,
          remediation: {
            class: "required-correction",
            summary: `Stop serving ${HOSTILE}`,
          },
        }),
      ]),
    ],
    evidence: [
      {
        id: "ev-0001",
        kind: "http",
        request: {
          method: "GET",
          url: `http://127.0.0.1:8787/${HOSTILE}`,
          headers: { accept: [HOSTILE] },
        },
        outcome: {
          kind: "response",
          status: 200,
          headers: { "content-type": [HOSTILE], link: [HOSTILE] },
          encodedBytes: 4,
          decodedBytes: 4,
          bodySha256: "sha256:00",
          truncated: false,
          redirects: [{ status: 302, location: HOSTILE, decision: "followed" }],
        },
      },
      {
        id: "ev-0004",
        kind: "dns",
        query: { name: HOSTILE, recordType: "TXT" },
        outcome: {
          kind: "answer",
          rcode: "NOERROR",
          records: [{ type: "TXT", value: HOSTILE }],
          dnssec: "insecure",
        },
      },
    ],
  });
}

/**
 * `sec-009`. The report a scan produces when the target put a token-shaped
 * value in a query string: core's URL canonicalizer already replaced it, so
 * `SECRET_MARKER` is absent from the report and must be absent from every
 * output. `VISIBLE_MARKER` sits in a legitimately reported header value and
 * must be present, which is what makes a zero count for the other one mean
 * something.
 */
export function markerReport(): CanonicalScanReportV1 {
  const url = "http://127.0.0.1:8787/a?token=REDACTED";
  return report({
    requestedUrl: url,
    results: [
      buildRuleResult("web.discovery.robots", "0.1.0", "enforced", [
        finding({
          code: "robots.location",
          status: "fail",
          message: "The response advertised a credential-shaped parameter.",
          remediation: REQUIRED_FIX,
          evidenceRefs: ["ev-0001"],
        }),
      ]),
    ],
    evidence: [
      {
        id: "ev-0001",
        kind: "http",
        request: { method: "GET", url, headers: { accept: ["text/plain"] } },
        outcome: {
          kind: "response",
          status: 200,
          headers: { link: [`<http://x/${VISIBLE_MARKER}>; rel="self"`] },
          encodedBytes: 1,
          decodedBytes: 1,
          bodySha256: "sha256:00",
          truncated: false,
          redirects: [],
        },
      },
    ],
  });
}
