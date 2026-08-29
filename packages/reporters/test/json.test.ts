import {
  buildRuleResult,
  canonicalizeJson,
  encodeCanonicalJson,
} from "@agentready-lab/core";
import { describe, expect, it } from "vitest";

import { renderJson } from "../src/index.js";
import {
  SECRET_MARKER,
  VISIBLE_MARKER,
  allStatusesReport,
  finding,
  hostileReport,
  markerReport,
  markupReport,
  noEvidenceReport,
  report,
} from "./support/fixtures.js";

/**
 * `docs/ARCHITECTURE.md` section 14 and ADR-0007.
 */

const CANONICAL_KEYS = [
  "effectiveOptions",
  "evidence",
  "mode",
  "policy",
  "profile",
  "results",
  "ruleset",
  "schemaVersion",
  "sourceLedgerVersion",
  "sources",
  "summary",
  "target",
  "tool",
];

/** Keys an operational envelope would add. None may reach the canonical form. */
const VOLATILE_KEYS = [
  "startedAt",
  "finishedAt",
  "durationMs",
  "elapsedMs",
  "runId",
  "timestamp",
  "generatedAt",
  "hostname",
];

/** `JSON.parse` is typed `any`; nothing downstream of this sees that. */
function parseJson(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  return parsed;
}

describe("stdout is JSON and nothing else", () => {
  it("parses whole and equals the report it was given", () => {
    const scan = allStatusesReport();
    const parsed: unknown = parseJson(renderJson(scan).stdout);

    expect(parsed).toStrictEqual(scan);
  });

  it("keeps diagnostics off stdout when the two streams are captured apart", () => {
    // The shape a CLI would use: one collector per stream. If any diagnostic
    // could reach stdout, the parse below would fail rather than the assertion.
    const scan = report({
      results: [
        buildRuleResult("web.discovery.robots", "0.1.0", "enforced", [
          finding({
            code: "robots.location",
            status: "pass",
            message: "ok",
            sourceRefs: [{ sourceId: "not-in-the-ledger" }],
            evidenceRefs: ["ev-does-not-exist"],
          }),
        ]),
      ],
    });

    const out: string[] = [];
    const err: string[] = [];
    const output = renderJson(scan);
    out.push(output.stdout);
    err.push(output.stderr);

    expect(() => parseJson(out.join(""))).not.toThrow();
    expect(err.join("")).toContain("not-in-the-ledger");
    expect(err.join("")).toContain("ev-does-not-exist");
    expect(out.join("")).not.toContain("agentready-lab: finding");
  });

  it("emits nothing on stderr for a report with no integrity problem", () => {
    expect(renderJson(noEvidenceReport()).stderr).toBe("");
  });
});

describe("canonical bytes", () => {
  it("is exactly core's RFC 8785 form, with no trailing newline", () => {
    const scan = allStatusesReport();
    const stdout = renderJson(scan).stdout;

    expect(stdout).toBe(canonicalizeJson(scan));
    expect(new TextEncoder().encode(stdout)).toStrictEqual(
      encodeCanonicalJson(scan),
    );
    expect(stdout.endsWith("}")).toBe(true);
  });

  it("is byte-identical across repeated runs", () => {
    const scan = allStatusesReport();
    const first = new TextEncoder().encode(renderJson(scan).stdout);
    const second = new TextEncoder().encode(renderJson(scan).stdout);

    expect(first).toStrictEqual(second);
  });

  it("sorts object keys, so two builds of one report cannot differ", () => {
    const stdout = renderJson(noEvidenceReport()).stdout;

    expect(stdout.indexOf('"mode"')).toBeLessThan(stdout.indexOf('"policy"'));
    expect(stdout.startsWith('{"effectiveOptions"')).toBe(true);
  });
});

describe("volatile metadata", () => {
  it("carries only the canonical top-level fields", () => {
    const parsed: unknown = parseJson(renderJson(allStatusesReport()).stdout);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("the canonical report must be a JSON object");
    }

    expect(Object.keys(parsed).sort()).toStrictEqual(CANONICAL_KEYS);
  });

  it("names no clock, duration or run identifier anywhere", () => {
    const stdout = renderJson(allStatusesReport()).stdout;

    for (const key of VOLATILE_KEYS) {
      expect(stdout).not.toContain(`"${key}"`);
    }
  });

  it("carries the external snapshot only in compat mode", () => {
    const spec = report({
      mode: "compat",
      externalSnapshot: { capturedAt: "2026-08-01", schemaVersion: "0" },
      results: noEvidenceReport().results,
    });

    expect(renderJson(spec).stdout).toContain('"externalSnapshot"');
    expect(renderJson(noEvidenceReport()).stdout).not.toContain(
      '"externalSnapshot"',
    );
  });
});

describe("hostile target text", () => {
  it("escapes every C0 control rather than emitting a raw byte", () => {
    // JSON string escaping is the sink-correct escape here, and core's
    // canonicalizer is the only serializer in the project. C1 and
    // bidirectional characters are *not* escaped by RFC 8785 and are not
    // removed here either: core strips them as a value enters the report, and
    // re-bounding at this sink would change the canonical bytes and with them
    // the digest. See the JSON reporter's own comment.
    const stdout = renderJson(hostileReport()).stdout;

    for (const character of stdout) {
      const code = character.codePointAt(0) ?? 0;
      expect(code < 0x20).toBe(false);
    }
    expect(() => parseJson(stdout)).not.toThrow();
  });

  it("round-trips markup metacharacters without altering them", () => {
    const scan = markupReport();
    const parsed: unknown = parseJson(renderJson(scan).stdout);

    expect(parsed).toStrictEqual(scan);
  });

  it("prints no value that redaction already removed (sec-009)", () => {
    const output = renderJson(markerReport());

    expect(output.stdout).not.toContain(SECRET_MARKER);
    expect(output.stderr).not.toContain(SECRET_MARKER);
    expect(output.stdout).toContain(VISIBLE_MARKER);
  });
});
