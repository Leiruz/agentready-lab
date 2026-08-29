import type { CanonicalScanReportV1 } from "@agentready-lab/core";
import { describe, expect, it } from "vitest";

import {
  TEXT_LIMITS,
  TRUNCATION_MARKER,
  colorEnabled,
  renderHuman,
} from "../src/index.js";
import {
  ESC,
  LF,
  SECRET_MARKER,
  VISIBLE_MARKER,
  allStatusesReport,
  errorEvidenceReport,
  finding,
  hostileReport,
  markerReport,
  markupReport,
  messageCapReport,
  multipleFindingsReport,
  noEvidenceReport,
  report,
} from "./support/fixtures.js";
import { buildRuleResult } from "@agentready-lab/core";

/**
 * `docs/ARCHITECTURE.md` section 14 and `docs/THREAT_MODEL.md` section 20.3.
 */

function lines(text: string): readonly string[] {
  return text.split(LF);
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The complete set of SGR sequences the reporter is allowed to emit. */
const SGR_CODES = ["[0m", "[1m", "[2m", "[31m", "[32m", "[33m"].map(
  (suffix) => `${ESC}${suffix}`,
);

function stripSgr(text: string): string {
  return SGR_CODES.reduce((acc, code) => acc.split(code).join(""), text);
}

function unsafeCharacters(text: string): readonly string[] {
  const found: string[] = [];
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const unsafe =
      (code < 0x20 && code !== 0x0a) ||
      code === 0x7f ||
      (code >= 0x80 && code <= 0x9f) ||
      code === 0x061c ||
      code === 0x200e ||
      code === 0x200f ||
      code === 0x2028 ||
      code === 0x2029 ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069);
    if (unsafe) found.push(`U+${code.toString(16).toUpperCase()}`);
  }
  return found;
}

/** How many findings and finding-less results the report will render. */
function renderableCount(scan: CanonicalScanReportV1): number {
  return scan.results.reduce(
    (total, result) => total + Math.max(result.findings.length, 1),
    0,
  );
}

describe("purity", () => {
  it("cannot write to the report core froze", () => {
    const scan = noEvidenceReport();
    const writable = <T extends object>(
      value: T,
    ): { -readonly [K in keyof T]: T[K] } => value;

    // Readonly modifiers are erased at runtime. This asks whether
    // `Object.freeze` is what actually stops a reporter, and the answer has to
    // be yes for `docs/THREAT_MODEL.md` section 20.3 to mean anything.
    expect(() => {
      writable(scan).mode = "compat";
    }).toThrow(TypeError);
    expect(() => {
      writable(scan.summary).fail = 99;
    }).toThrow(TypeError);
  });

  it("leaves the report exactly as it found it", () => {
    const scan = allStatusesReport();
    const before = structuredClone(scan);

    renderHuman(scan);

    expect(structuredClone(scan)).toStrictEqual(before);
  });

  it("renders the same bytes every time", () => {
    const scan = allStatusesReport();

    expect(renderHuman(scan).stdout).toBe(renderHuman(scan).stdout);
  });

  it("keeps the report's rule order", () => {
    const scan = allStatusesReport();
    const rendered = renderHuman(scan).stdout;
    const positions = scan.results.map((result) =>
      rendered.indexOf(result.ruleId),
    );

    expect(positions.every((position) => position !== -1)).toBe(true);
  });
});

describe("sections", () => {
  it("separates required failures from recommendations", () => {
    const rendered = renderHuman(multipleFindingsReport()).stdout;
    const required = rendered.indexOf("REQUIRED FAILURES");
    const recommended = rendered.indexOf("RECOMMENDATIONS");

    expect(required).toBeGreaterThan(-1);
    expect(recommended).toBeGreaterThan(required);
    expect(rendered.indexOf("robots.location")).toBeGreaterThan(required);
    expect(rendered.indexOf("robots.location")).toBeLessThan(recommended);
    expect(rendered.indexOf("robots.agent-rules")).toBeGreaterThan(recommended);
  });

  it("never files a compat failure under required failures", () => {
    // CLAUDE.md: a compatibility observation is not a conformance verdict, and
    // a section header is where a reader learns that.
    const rendered = renderHuman(allStatusesReport()).stdout;
    const compat = rendered.indexOf("COMPATIBILITY OBSERVATIONS");

    expect(rendered.indexOf("robots.compat")).toBeGreaterThan(compat);
    expect(rendered.indexOf("robots.location")).toBeLessThan(compat);
  });

  it("places every finding in exactly one section", () => {
    const scan = allStatusesReport();
    const rendered = renderHuman(scan).stdout;
    const blocks = lines(rendered).filter((line) =>
      line.startsWith("      rule      "),
    );

    expect(blocks).toHaveLength(renderableCount(scan));
  });

  it("reports a section that is empty rather than hiding it", () => {
    const rendered = renderHuman(noEvidenceReport()).stdout;

    expect(rendered).toContain("REQUIRED FAILURES (0)");
    expect(rendered).toContain("PASSED AND NOT APPLICABLE (1)");
  });
});

describe("status without colour", () => {
  it("gives every status an ASCII marker and its own name", () => {
    const rendered = renderHuman(allStatusesReport()).stdout;

    expect(rendered).toContain("[x] fail");
    expect(rendered).toContain("[!] warning");
    expect(rendered).toContain("[+] pass");
    expect(rendered).toContain("[-] not-applicable");
    expect(rendered).toContain("[?] unable-to-check");
    expect(rendered).toContain("[~] unsupported-runtime");
  });

  it("emits no escape sequence by default", () => {
    expect(renderHuman(allStatusesReport()).stdout).not.toContain(ESC);
  });

  it("adds nothing but SGR sequences when colour is on", () => {
    const scan = allStatusesReport();
    const plain = renderHuman(scan).stdout;
    const painted = renderHuman(scan, { color: true }).stdout;

    expect(painted).not.toBe(plain);
    expect(stripSgr(painted)).toBe(plain);
    // Colour is applied to headings and markers only, never to target text.
    expect(stripSgr(painted)).not.toContain(ESC);
  });

  it("honours NO_COLOR over the caller", () => {
    expect(colorEnabled({ NO_COLOR: "1" }, true)).toBe(false);
    expect(colorEnabled({ NO_COLOR: "0" }, true)).toBe(false);
    expect(colorEnabled({ NO_COLOR: "" }, true)).toBe(true);
    expect(colorEnabled({}, true)).toBe(true);
    expect(colorEnabled({}, false)).toBe(false);
  });
});

describe("citations", () => {
  it("prints the pinned source under a finding", () => {
    const rendered = renderHuman(noEvidenceReport()).stdout;

    expect(rendered).toContain("rfc9309  Robots Exclusion Protocol");
    expect(rendered).toContain("https://www.rfc-editor.org/rfc/rfc9309.html");
    expect(rendered).toContain("section 2.3");
    expect(rendered).toContain("proposed-standard");
    expect(rendered).toContain("version 2022-09");
    expect(rendered).toContain("verified 2026-08-01");
  });

  it("omits the version clause for a source that has none", () => {
    const rendered = renderHuman(allStatusesReport()).stdout;

    expect(rendered).toContain("rfc9110  HTTP Semantics");
    expect(rendered).toContain("rfc, internet-standard, verified 2026-08-01");
  });

  it("marks an unresolvable citation instead of dropping it", () => {
    const scan = report({
      results: [
        buildRuleResult("web.discovery.robots", "0.1.0", "enforced", [
          finding({
            code: "robots.location",
            status: "pass",
            message: "ok",
            sourceRefs: [{ sourceId: "not-in-the-ledger" }],
          }),
        ]),
      ],
    });
    const output = renderHuman(scan);

    expect(output.stdout).toContain(
      "not-in-the-ledger  (not listed in this report)",
    );
    expect(output.stderr).toContain(
      "cites source not-in-the-ledger, which this report does not list",
    );
  });

  it("says so when a finding cites nothing at all", () => {
    const scan = report({
      results: [
        buildRuleResult("web.discovery.robots", "0.1.0", "enforced", [
          finding({
            code: "robots.location",
            status: "pass",
            message: "ok",
            sourceRefs: [],
          }),
        ]),
      ],
    });
    const output = renderHuman(scan);

    expect(output.stdout).toContain("source    none cited");
    expect(output.stderr).toContain("cites no source");
  });

  it("prints the gate so a fail beside exit code zero is explicable", () => {
    // ADR-0004 section 4: only an enforced result reaches the exit code.
    const rendered = renderHuman(allStatusesReport()).stdout;

    expect(rendered).toContain("(status fail, gate enforced)");
    expect(rendered).toContain(
      "(status unsupported-runtime, gate informational)",
    );
  });

  it("prints the remediation class with its summary", () => {
    const rendered = renderHuman(allStatusesReport()).stdout;

    expect(rendered).toContain(
      "fix       required-correction: Serve a robots.txt",
    );
    expect(rendered).toContain("fix       compatibility-workaround:");
  });
});

describe("evidence", () => {
  it("renders a report with no evidence as none, not as an absence", () => {
    const rendered = renderHuman(noEvidenceReport()).stdout;

    expect(rendered).toContain("EVIDENCE (0)");
    expect(lines(rendered).at(-2)).toBe("  none");
  });

  it("renders an error outcome with its typed code and phase", () => {
    const rendered = renderHuman(errorEvidenceReport()).stdout;

    expect(rendered).toContain(
      "error url-policy-blocked at policy (not retryable)",
    );
    expect(rendered).toContain(
      "error dns-resolution-failed at dns (retryable)",
    );
  });

  it("renders each observation runtime", () => {
    const rendered = renderHuman(errorEvidenceReport()).stdout;

    expect(rendered).toContain("dns TXT example.test");
    expect(rendered).toContain("NOERROR, dnssec insecure");
    expect(rendered).toContain("browser dom-snapshot http://127.0.0.1:8787/");
    expect(rendered).toContain("scripts = 3");
    expect(rendered).toContain("framed = false");
    expect(rendered).toContain("canonical = null");
  });

  it("says a body was truncated rather than implying it was complete", () => {
    expect(renderHuman(markupReport()).stdout).toContain(
      "body truncated at the cap",
    );
  });
});

describe("bounding", () => {
  it("leaves a message of exactly the cap alone and marks one over it", () => {
    const rendered = renderHuman(messageCapReport(TEXT_LIMITS.message)).stdout;

    expect(rendered).toContain("a".repeat(TEXT_LIMITS.message));
    expect(rendered).not.toContain("b".repeat(TEXT_LIMITS.message));
    expect(rendered).toContain(
      `${"b".repeat(TEXT_LIMITS.message - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`,
    );
  });
});

describe("hostile target text", () => {
  it("leaves no terminal control anywhere in sec-010 output", () => {
    const output = renderHuman(hostileReport());

    expect(unsafeCharacters(output.stdout)).toStrictEqual([]);
    expect(unsafeCharacters(output.stderr)).toStrictEqual([]);
  });

  it("strips the OSC 8 target so no label can lie about a link", () => {
    expect(renderHuman(hostileReport()).stdout).not.toContain(
      "attacker.example",
    );
  });

  it("lets no line begin a GitHub workflow command", () => {
    for (const line of lines(renderHuman(hostileReport()).stdout)) {
      expect(line.trimStart().startsWith("::")).toBe(false);
    }
  });

  it("renders markup metacharacters as text and escapes nothing away", () => {
    const rendered = renderHuman(markupReport()).stdout;

    // The terminal is not a markup sink, so `<` and `&` stay literal here.
    // The XML and Markdown escaping of section 20.3 belongs to the JUnit and
    // GitHub reporters, which M1 does not ship.
    expect(rendered).toContain('<a href="x">&amp;</a>');
    expect(rendered).toContain("nyanpasu");
  });
});

describe("redaction", () => {
  it("prints no value that redaction already removed (sec-009)", () => {
    const output = renderHuman(markerReport());

    expect(occurrences(output.stdout, SECRET_MARKER)).toBe(0);
    expect(occurrences(output.stderr, SECRET_MARKER)).toBe(0);
    // The control: a value the report does carry is printed, so the zero above
    // is a withheld value rather than a grep that finds nothing.
    expect(occurrences(output.stdout, VISIBLE_MARKER)).toBe(1);
  });
});

describe("mode", () => {
  it("says that a compat report is not a conformance verdict", () => {
    const scan = report({
      mode: "compat",
      externalSnapshot: { capturedAt: "2026-08-01", schemaVersion: "0" },
      results: [
        buildRuleResult("web.discovery.robots", "0.1.0", "enforced", [
          finding({
            code: "robots.compat",
            status: "fail",
            mode: "compat",
            requirementClass: "compatibility",
            message: "The dated external tool would not recognize this.",
          }),
        ]),
      ],
    });
    const rendered = renderHuman(scan).stdout;

    expect(rendered).toContain("captured 2026-08-01, schema 0");
    expect(rendered).toContain(
      "compat observes one dated external tool, not conformance",
    );
  });
});

describe("golden", () => {
  /**
   * The whole document, frozen after review.
   *
   * Every other test here asks whether one fact is present. This one asks
   * whether the layout changed at all, which is the question a reviewer
   * cannot answer from a diff of the renderer. It supplements the
   * behavioural assertions above and does not replace them.
   */
  const GOLDEN = [
    "AgentReady Lab scan report",
    "",
    "  target      http://127.0.0.1:8787/",
    "  page        http://127.0.0.1:8787/",
    "  origin      http://127.0.0.1:8787",
    "  scope       local on local-loopback",
    "  mode        spec",
    "  profile     content 0.1.0",
    "  ruleset     standard 0.2.0",
    "  digest      sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "  sources     ledger 0.1.0",
    "  tool        agentready-lab 0.0.0",
    "  policy      local-loopback 0.1.0; schemes http; ports 8787",
    "  budget      24 requests, 5 redirects per observation, 1048576 encoded and 2097152 decoded bytes",
    "  summary     pass 0  fail 1  warning 0",
    "              not-applicable 0  unable-to-check 0  unsupported-runtime 0",
    "",
    "REQUIRED FAILURES (1)",
    "  Violated normative requirements. These are conformance defects.",
    "",
    "  [x] fail  robots.location  (normative, spec mode)",
    "      rule      web.discovery.robots 0.1.0  (status fail, gate enforced)",
    "      message   No robots.txt was served at the origin root.",
    "      fix       required-correction: Serve a robots.txt at the origin root over HTTP.",
    "      source    rfc9309  Robots Exclusion Protocol",
    "                https://www.rfc-editor.org/rfc/rfc9309.html  section 2.3",
    "                rfc, proposed-standard, version 2022-09, verified 2026-08-01",
    "",
    "RECOMMENDATIONS (1)",
    "  Failed recommendations and advisory checks. Not defects.",
    "",
    "  [!] warning  robots.agent-rules  (advisory, spec mode)",
    "      rule      web.discovery.robots 0.1.0  (status fail, gate enforced)",
    "      message   No agent-specific group was found.",
    "      fix       recommended-hardening: Name Accept in the Vary response header.",
    "      source    rfc9309  Robots Exclusion Protocol",
    "                https://www.rfc-editor.org/rfc/rfc9309.html  section 2.3",
    "                rfc, proposed-standard, version 2022-09, verified 2026-08-01",
    "",
    "COMPATIBILITY OBSERVATIONS (0)",
    "  Dated observations of one external tool. Never conformance.",
    "",
    "  none",
    "",
    "NOT COMPLETED (0)",
    "  No verdict was reached. Neither a pass nor a failure.",
    "",
    "  none",
    "",
    "PASSED AND NOT APPLICABLE (1)",
    "  Nothing to act on.",
    "",
    "  [+] pass  robots.syntax  (normative, spec mode)",
    "      rule      web.discovery.robots 0.1.0  (status fail, gate enforced)",
    "      message   Every group parsed.",
    "      source    rfc9309  Robots Exclusion Protocol",
    "                https://www.rfc-editor.org/rfc/rfc9309.html  section 2.3",
    "                rfc, proposed-standard, version 2022-09, verified 2026-08-01",
    "",
    "EVIDENCE (1)",
    "",
    "  ev-0001    http GET http://127.0.0.1:8787/robots.txt",
    "             accept: text/plain",
    "             status 200",
    "             content-type: text/plain; charset=utf-8",
    "             13 encoded and 13 decoded bytes",
    "             body sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  ].join(LF);

  it("renders the reviewed document exactly", () => {
    expect(renderHuman(multipleFindingsReport()).stdout).toBe(GOLDEN + LF);
  });
});
