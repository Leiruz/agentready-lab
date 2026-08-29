import { describe, expect, it } from "vitest";

import type {
  AssertionOutcomes,
  CanonicalScanReportV1,
  ObservationRequest,
  RuleFinding,
} from "../src/index.js";
import {
  ConfigurationError,
  DEFAULT_NETWORK_BUDGET,
  EVIDENCE_RESPONSE_HEADERS,
  ScanByteLedger,
  assertSupportedConcurrency,
  canonicalizeJson,
  lowerBudget,
  projectEffectiveOptions,
  resolveRuleOptions,
  runScan,
} from "../src/index.js";

import {
  OTHER_SOURCE,
  RecordingTransport,
  SOURCE,
  assertion,
  body,
  httpRequest,
  outcome,
  rule,
  scanInput,
  templatesFor,
} from "./support/harness.js";

/**
 * `docs/ARCHITECTURE.md` sections 9 and 19, ADR-0004 section 8 and ADR-0007.
 *
 * The report is the product. These tests are about what it may and may not
 * contain: a bounded header allowlist, sanitized target text, cited sources
 * only, remediation where a defect was found, and nothing a reporter can
 * change.
 */

const ROBOTS = "http://127.0.0.1:8787/robots.txt";

const declaration = assertion({
  id: "robots.location",
  ruleId: "web.discovery.robots",
});
const recommended = assertion({
  id: "robots.style",
  ruleId: "web.discovery.robots",
  requirementClass: "recommended",
  sourceIds: ["rfc9110"],
});

function robotsRule(kinds: {
  location: Parameters<typeof outcome>[1];
  style: Parameters<typeof outcome>[1];
}): ReturnType<typeof rule> {
  return rule({
    id: "web.discovery.robots",
    assertions: [declaration, recommended],
    plan: (): readonly ObservationRequest[] => [
      httpRequest("robots", "/robots.txt", { accept: "text/plain" }),
      // A second, genuinely different representation of the same path, so the
      // rule has two evidence ids to cite and can cite them out of order.
      httpRequest("robots-markdown", "/robots.txt", {
        accept: "text/markdown",
      }),
    ],
    step: (): AssertionOutcomes => ({
      kind: "outcomes",
      outcomes: [
        outcome(recommended.id, kinds.style, [
          "robots-markdown",
          "robots",
          "robots",
        ]),
        outcome(declaration.id, kinds.location, ["robots"]),
      ],
    }),
  });
}

async function scan(
  kinds: Parameters<typeof robotsRule>[0] = {
    location: "satisfied",
    style: "violated",
  },
  headers: Readonly<Record<string, readonly string[]>> = {},
): Promise<CanonicalScanReportV1> {
  const transport = new RecordingTransport(
    new Map([[ROBOTS, { chunks: body("User-agent: *"), headers }]]),
  );
  return runScan(
    scanInput({
      rules: [robotsRule(kinds)],
      assertions: [declaration, recommended],
      transport,
    }),
  );
}

describe("evidence", () => {
  it("carries a digest and a length, never the body", async () => {
    const report = await scan();
    const evidence = report.evidence[0];
    expect(evidence?.kind).toBe("http");
    expect(evidence?.outcome).toMatchObject({
      kind: "response",
      status: 200,
      decodedBytes: 13,
      truncated: false,
    });
    expect(canonicalizeJson(report)).not.toMatch(/User-agent/);
    expect(JSON.stringify(evidence)).not.toMatch(/"body"/);
  });

  it("keeps only allowlisted response headers", async () => {
    const report = await scan(undefined, {
      "content-type": ["text/plain"],
      vary: ["accept"],
      "set-cookie": ["session=secret-marker-91ab"],
      server: ["nginx"],
    });
    const outcomeValue = report.evidence[0]?.outcome;
    expect(outcomeValue).toMatchObject({
      headers: { "content-type": ["text/plain"], vary: ["accept"] },
    });
    expect(canonicalizeJson(report)).not.toMatch(/secret-marker-91ab/);
    expect(canonicalizeJson(report)).not.toMatch(/nginx/);
  });

  it("names its response-header allowlist explicitly", () => {
    // A caller cannot widen this: it is a constant, not an input.
    expect([...EVIDENCE_RESPONSE_HEADERS]).toStrictEqual([
      "content-type",
      "link",
      "vary",
    ]);
  });

  it("sanitizes terminal and bidirectional controls out of header values", async () => {
    const report = await scan(undefined, {
      link: ["</a>; rel=\u001b[31mnext\u202e"],
    });
    const serialized = canonicalizeJson(report);
    // `includes` rather than a pattern: a regular expression holding these
    // characters is itself the thing `no-control-regex` exists to flag.
    expect(serialized.includes("\u001b")).toBe(false);
    expect(serialized.includes("\u202e")).toBe(false);
    // Each stripped character becomes U+FFFD, so the payload renders inertly
    // rather than disappearing: a reader can still see something was removed.
    expect(serialized).toMatch(/rel=�\[31mnext�/);
  });
});

describe("findings", () => {
  it("sorts by code and rewrites observation refs to sorted evidence ids", async () => {
    const report = await scan();
    const findings = report.results[0]?.findings ?? [];
    expect(findings.map((finding) => finding.code)).toStrictEqual([
      "robots.location",
      "robots.style",
    ]);
    // The rule cited `robots-markdown` first and `robots` twice; the engine
    // deduplicates and sorts.
    expect(findings[1]?.evidenceRefs).toStrictEqual(["ev-001", "ev-002"]);
  });

  it("derives the class and the status from the ruleset, not from the rule", async () => {
    const report = await scan();
    const findings = report.results[0]?.findings ?? [];
    expect(findings[0]).toMatchObject({
      requirementClass: "normative",
      status: "pass",
      mode: "spec",
      message: "robots.location is satisfied",
    });
    // A violated recommendation is a warning and can never be a fail.
    expect(findings[1]).toMatchObject({
      requirementClass: "recommended",
      status: "warning",
    });
    expect(report.results[0]?.status).toBe("warning");
  });

  it("derives citations from the assertion declaration", async () => {
    const report = await scan();
    const findings = report.results[0]?.findings ?? [];
    expect(findings[0]?.sourceRefs).toStrictEqual([{ sourceId: "rfc9309" }]);
    expect(findings[1]?.sourceRefs).toStrictEqual([{ sourceId: "rfc9110" }]);
  });

  it("attaches remediation to a warning and withholds it from a pass", async () => {
    const report = await scan();
    const findings: readonly RuleFinding[] = report.results[0]?.findings ?? [];
    expect(findings[0]?.remediation).toBeUndefined();
    expect(findings[1]?.remediation).toStrictEqual({
      class: "recommended-hardening",
      summary: "Fix robots.style.",
    });
  });
});

describe("sources", () => {
  it("carries only the sources a finding actually cites", async () => {
    const report = await scan();
    expect(report.sources.map((source) => source.id)).toStrictEqual([
      "rfc9110",
      "rfc9309",
    ]);
    expect(report.sources[1]).toStrictEqual(SOURCE);
    expect(report.sources[0]).toStrictEqual(OTHER_SOURCE);
  });

  it("drops a ledger source no finding cites", async () => {
    const single = rule({
      id: "web.discovery.robots",
      assertions: [declaration],
      plan: () => [],
      step: (): AssertionOutcomes => ({
        kind: "outcomes",
        outcomes: [outcome(declaration.id, "satisfied")],
      }),
    });
    const report = await runScan(
      scanInput({
        rules: [single],
        assertions: [declaration],
        transport: new RecordingTransport(),
      }),
    );
    expect(report.sources.map((source) => source.id)).toStrictEqual([
      "rfc9309",
    ]);
  });

  it("names the source ledger version and omits externalSnapshot outside compat", async () => {
    const report = await scan();
    expect(report.sourceLedgerVersion).toBe("0.2.0");
    expect("externalSnapshot" in report).toBe(false);
  });
});

describe("effective options", () => {
  it("records every validated key, including defaults the user did not set", async () => {
    const declared = assertion({
      id: "crawler.access",
      ruleId: "web.policy.ai-crawler",
    });
    const definition = rule({
      id: "web.policy.ai-crawler",
      assertions: [declared],
      defaultOptions: {
        testedPath: "/",
        tokens: ["GPTBot"],
        strict: false,
        retries: 2,
      },
      plan: () => [],
      step: (): AssertionOutcomes => ({
        kind: "outcomes",
        outcomes: [outcome(declared.id, "satisfied")],
      }),
    });

    const report = await runScan(
      scanInput({
        rules: [definition],
        assertions: [declared],
        transport: new RecordingTransport(),
        ruleOptions: { "web.policy.ai-crawler": { testedPath: "/private" } },
      }),
    );

    expect(report.effectiveOptions).toStrictEqual([
      {
        ruleId: "web.policy.ai-crawler",
        options: {
          retries: { kind: "integer", value: 2 },
          strict: { kind: "boolean", value: false },
          testedPath: { kind: "string", value: "/private" },
          tokens: { kind: "string-list", value: ["GPTBot"] },
        },
      },
    ]);
  });

  it("refuses an option key the rule does not declare", () => {
    expect(() => resolveRuleOptions("r", { a: 1 }, { b: 2 })).toThrow(
      ConfigurationError,
    );
  });

  it("refuses an option value no kind can express", () => {
    expect(() => projectEffectiveOptions("r", { nested: { a: 1 } })).toThrow(
      /not a boolean, whole number, string or list of strings/,
    );
  });
});

describe("immutability", () => {
  it("cannot be mutated by a reporter", async () => {
    const report = await scan();
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.results)).toBe(true);
    expect(Object.isFrozen(report.results[0]?.findings[0])).toBe(true);
    expect(Object.isFrozen(report.evidence[0])).toBe(true);

    const mutable = report as { schemaVersion: string };
    expect(() => {
      mutable.schemaVersion = "9.9.9";
    }).toThrow(TypeError);
    expect(() => {
      // The cast is the point: a reporter that ignored `readonly` and pushed
      // a result must still be stopped, and only the freeze can stop it.
      (report.results as unknown as unknown[]).push("intruder");
    }).toThrow(TypeError);
    expect(report.schemaVersion).toBe("1.0.0");
  });
});

describe("summary and policy", () => {
  it("counts rule results by derived status", async () => {
    const report = await scan({
      location: "not-present",
      style: "not-present",
    });
    expect(report.results[0]?.status).toBe("not-applicable");
    expect(report.summary).toStrictEqual({
      pass: 0,
      fail: 0,
      warning: 0,
      notApplicable: 1,
      unableToCheck: 0,
      unsupportedRuntime: 0,
    });
  });

  it("publishes the effective budget rather than the requested one", async () => {
    const report = await scan();
    expect(report.policy).toStrictEqual({
      id: "local-loopback",
      version: "0.1.0",
      allowedSchemes: ["http", "https"],
      allowedPorts: [8787],
      sameOriginDiscovery: true,
      maxRequests: DEFAULT_NETWORK_BUDGET.maxRequests,
      maxRedirectsPerObservation: DEFAULT_NETWORK_BUDGET.maxRedirects,
      maxEncodedResponseBytes: DEFAULT_NETWORK_BUDGET.maxEncodedResponseBytes,
      maxDecodedResponseBytes: DEFAULT_NETWORK_BUDGET.maxDecodedResponseBytes,
    });
  });

  it("keeps an informational result out of the gate but in the summary", async () => {
    const declared = assertion({
      id: "bot-auth.header",
      ruleId: "web.identity.web-bot-auth",
    });
    const definition = rule({
      id: "web.identity.web-bot-auth",
      assertions: [declared],
      applicability: "informational",
      plan: () => [],
      step: (): AssertionOutcomes => ({
        kind: "outcomes",
        outcomes: [outcome(declared.id, "violated")],
      }),
    });

    const report = await runScan(
      scanInput({
        rules: [definition],
        assertions: [declared],
        transport: new RecordingTransport(),
        templates: templatesFor([declared]),
      }),
    );

    expect(report.results[0]?.gate).toBe("informational");
    expect(report.results[0]?.status).toBe("fail");
    expect(report.summary.fail).toBe(1);
  });
});

describe("budget arithmetic", () => {
  it("takes the minimum across sources and never the override", () => {
    const lowered = lowerBudget(DEFAULT_NETWORK_BUDGET, {
      maxRequests: 4,
      maxTotalDecodedBytes: 999999999,
    });
    expect(lowered.maxRequests).toBe(4);
    // Configuration may lower a budget and may never raise one.
    expect(lowered.maxTotalDecodedBytes).toBe(
      DEFAULT_NETWORK_BUDGET.maxTotalDecodedBytes,
    );
    expect(lowered.maxRedirects).toBe(DEFAULT_NETWORK_BUDGET.maxRedirects);
  });

  it("refuses concurrency above one rather than clamping it", () => {
    expect(() => {
      assertSupportedConcurrency(1);
    }).not.toThrow();
    expect(() => {
      assertSupportedConcurrency(2);
    }).toThrow(ConfigurationError);
  });

  it("draws the scan byte budget down and never below zero", () => {
    const ledger = new ScanByteLedger({
      ...DEFAULT_NETWORK_BUDGET,
      maxTotalEncodedBytes: 10,
      maxTotalDecodedBytes: 10,
    });
    ledger.consume(4, 6);
    expect(ledger.remainingEncoded).toBe(6);
    expect(ledger.remainingDecoded).toBe(4);
    ledger.consume(100, 100);
    expect(ledger.remainingEncoded).toBe(0);
    expect(ledger.remainingDecoded).toBe(0);
  });
});
