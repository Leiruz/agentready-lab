import { describe, expect, it } from "vitest";

import type {
  AssertionOutcomes,
  CanonicalScanReportV1,
  HttpTransportResult,
  ObservationRequest,
  RequestBatch,
  RoundContext,
  Transport,
} from "../src/index.js";
import {
  ConfigurationError,
  RuleContractViolation,
  RulesetAssertionIndex,
  canonicalizeJson,
  runScan,
  validateRuleAssertions,
} from "../src/index.js";
import type { TransportScript } from "./support/harness.js";
import {
  CountingTransport,
  DEFERRAL,
  DnsCapableTransport,
  RecordingTransport,
  assertion,
  body,
  httpRequest,
  outcome,
  remediationFor,
  rule,
  scanInput,
  templatesFor,
} from "./support/harness.js";

/**
 * The scan lifecycle end to end: `docs/ARCHITECTURE.md` sections 5 and 19,
 * ADR-0005 section 7's four determinism tests, and the M1 acceptance criteria
 * that are properties of the whole engine rather than of one function.
 *
 * `RecordingTransport` records a dispatch that begins before the previous
 * observation settles. ADR-0005 section 7 test 1 is the "serial dispatch" case
 * below, which reads that record after the scan. It cannot be an exception
 * thrown from the transport: `callTransport` in `dispatch.ts` converts every
 * transport exception into a `connection-failed` observation, exactly as a
 * hostile transport requires, so a throwing guard would be caught by the code
 * it was meant to check.
 */

const ROBOTS = "http://127.0.0.1:8787/robots.txt";
const SITEMAP = "http://127.0.0.1:8787/sitemap.xml";
const PAGE = "http://127.0.0.1:8787/";

function script(
  entries: readonly (readonly [string, string, number?])[],
  segments = 1,
): TransportScript {
  return new Map(
    entries.map(([url, text, latency]) => [
      url,
      {
        chunks: body(text, segments),
        ...(latency === undefined ? {} : { latency }),
      },
    ]),
  );
}

function ruleAt(
  id: string,
  requests: readonly ObservationRequest[],
  refs: readonly string[] = requests.map((request) => request.id),
): ReturnType<typeof rule> {
  const declaration = assertion({ id: `${id}.only`, ruleId: id });
  return rule({
    id,
    assertions: [declaration],
    plan: () => requests,
    step: (): AssertionOutcomes => ({
      kind: "outcomes",
      outcomes: [outcome(declaration.id, "satisfied", refs)],
    }),
  });
}

function assertionsOf(
  rules: readonly ReturnType<typeof rule>[],
): ReturnType<typeof assertion>[] {
  return rules.flatMap((definition) =>
    definition.metadata.assertions.map((declaration) =>
      assertion({
        id: declaration.id,
        ruleId: definition.metadata.id,
        requirementClass: declaration.requirementClass,
      }),
    ),
  );
}

describe("deduplication across rules", () => {
  it("gives four rules asking for /robots.txt one call and one evidence entry", async () => {
    const rules = ["a.one", "a.two", "a.three", "a.four"].map((id) =>
      ruleAt(id, [
        httpRequest("robots", "/robots.txt", { accept: "text/plain" }),
      ]),
    );
    const transport = new RecordingTransport(
      script([[ROBOTS, "User-agent: *"]]),
    );

    const report = await runScan(
      scanInput({ rules, assertions: assertionsOf(rules), transport }),
    );

    expect(transport.callCount).toBe(1);
    expect(report.evidence).toHaveLength(1);
    expect(report.evidence[0]?.id).toBe("ev-001");
    for (const result of report.results) {
      expect(result.findings[0]?.evidenceRefs).toStrictEqual(["ev-001"]);
    }
  });

  it("gives text/html and text/markdown two calls and two evidence entries", async () => {
    const rules = [
      ruleAt("a.html", [httpRequest("page", "/", { accept: "text/html" })]),
      ruleAt("a.markdown", [
        httpRequest("page", "/", { accept: "text/markdown" }),
      ]),
    ];
    const transport = new RecordingTransport(script([[PAGE, "<html></html>"]]));

    const report = await runScan(
      scanInput({ rules, assertions: assertionsOf(rules), transport }),
    );

    expect(transport.callCount).toBe(2);
    expect(report.evidence.map((entry) => entry.id)).toStrictEqual([
      "ev-001",
      "ev-002",
    ]);
  });

  it("does not alias two requests differing only in a byte limit", async () => {
    const rules = [
      ruleAt("a.big", [
        httpRequest("r", "/robots.txt", { maxDecodedBytes: 100 }),
      ]),
      ruleAt("a.small", [
        httpRequest("r", "/robots.txt", { maxDecodedBytes: 10 }),
      ]),
    ];
    const transport = new RecordingTransport(script([[ROBOTS, "hello"]]));

    const report = await runScan(
      scanInput({ rules, assertions: assertionsOf(rules), transport }),
    );

    expect(transport.callCount).toBe(2);
    const limits = transport.sequence.filter(
      (entry) => entry.event === "dispatched",
    );
    expect(limits).toHaveLength(2);
    expect(report.evidence).toHaveLength(2);
  });
});

describe("serial dispatch", () => {
  it("never starts request N+1 before request N settles", async () => {
    const rules = [
      ruleAt("a.one", [httpRequest("a", "/robots.txt")]),
      ruleAt("a.two", [httpRequest("b", "/sitemap.xml")]),
      ruleAt("a.three", [httpRequest("c", "/missing")]),
    ];
    const transport = new RecordingTransport(
      script([
        [ROBOTS, "one", 7],
        [SITEMAP, "two", 0],
      ]),
    );

    await runScan(
      scanInput({ rules, assertions: assertionsOf(rules), transport }),
    );

    // The transport records an overlap rather than throwing on one, because
    // `callTransport` converts any transport exception into a
    // `connection-failed` observation and would have swallowed the complaint.
    // The record is read here, after the scan, where nothing can catch it.
    expect(transport.concurrencyViolations).toStrictEqual([]);
    // Every settlement kind is represented: a slow response, a fast response,
    // and an unscripted URL that the transport answers with a failure.
    expect(transport.sequence.map((entry) => entry.event)).toStrictEqual([
      "dispatched",
      "settled",
      "dispatched",
      "settled",
      "dispatched",
      "settled",
    ]);
  });

  it("opens no socket for a denied reservation or a refused URL", async () => {
    const rules = [
      ruleAt("a.one", [httpRequest("a", "/robots.txt")]),
      ruleAt("a.two", [httpRequest("b", "/sitemap.xml")]),
      ruleAt("a.three", [httpRequest("c", "/third")]),
    ];
    const transport = new RecordingTransport(
      script([
        [ROBOTS, "one"],
        [SITEMAP, "two"],
      ]),
    );

    const report = await runScan(
      scanInput({
        rules,
        assertions: assertionsOf(rules),
        transport,
        budget: { maxRequests: 2 },
      }),
    );

    expect(transport.callCount).toBe(2);
    const denied = report.evidence[2];
    expect(denied?.kind).toBe("http");
    expect(denied?.outcome).toStrictEqual({
      kind: "error",
      error: {
        code: "request-budget-exhausted",
        phase: "policy",
        message: "The scan request or byte budget is exhausted.",
        retryable: false,
      },
    });
  });
});

describe("determinism", () => {
  const rules = [
    ruleAt("a.one", [httpRequest("a", "/robots.txt")]),
    ruleAt("a.two", [httpRequest("b", "/sitemap.xml")]),
    ruleAt("a.three", [httpRequest("c", "/")]),
  ];

  async function reportJson(
    latencies: readonly [number, number, number],
    segments: number,
  ): Promise<string> {
    const transport = new RecordingTransport(
      new Map([
        [
          ROBOTS,
          { chunks: body("User-agent: *", segments), latency: latencies[0] },
        ],
        [
          SITEMAP,
          { chunks: body("<urlset/>", segments), latency: latencies[1] },
        ],
        [
          PAGE,
          { chunks: body("<html></html>", segments), latency: latencies[2] },
        ],
      ]),
    );
    return canonicalizeJson(
      await runScan(
        scanInput({ rules, assertions: assertionsOf(rules), transport }),
      ),
    );
  }

  it("is byte-identical across latency profiles, including a reversed one", async () => {
    // ADR-0005 section 7 test 2. Completion *order* is fixed by the
    // dispatcher, so the free variable is completion *latency*.
    const flat = await reportJson([0, 0, 0], 1);
    const rising = await reportJson([1, 5, 11], 1);
    const falling = await reportJson([11, 5, 1], 1);

    expect(rising).toBe(flat);
    expect(falling).toBe(flat);
  });

  it("is byte-identical across chunk segmentations", async () => {
    // ADR-0005 section 7 test 3. This is the test the first revision did not
    // have, and the one that would have caught the byte-budget race.
    const whole = await reportJson([0, 0, 0], 1);
    for (const segments of [2, 3, 5, 13]) {
      expect(await reportJson([0, 0, 0], segments)).toBe(whole);
    }
  });

  it("fails the same observation under every segmentation when a byte budget is crossed", async () => {
    // ADR-0005 section 7 test 4. Ten bytes each against a 25-byte whole-scan
    // decoded budget: the third observation is the one that crosses it, on
    // every run and under every segmentation.
    const failing = async (
      segments: number,
    ): Promise<CanonicalScanReportV1> => {
      const transport = new RecordingTransport(
        new Map([
          [ROBOTS, { chunks: body("0123456789", segments) }],
          [SITEMAP, { chunks: body("0123456789", segments) }],
          [PAGE, { chunks: body("0123456789", segments) }],
        ]),
      );
      return runScan(
        scanInput({
          rules,
          assertions: assertionsOf(rules),
          transport,
          budget: { maxTotalDecodedBytes: 25 },
        }),
      );
    };

    const baseline = canonicalizeJson(await failing(1));
    for (const segments of [2, 7, 10]) {
      expect(canonicalizeJson(await failing(segments))).toBe(baseline);
    }

    const report = await failing(1);
    expect(report.evidence[0]?.outcome.kind).toBe("response");
    expect(report.evidence[1]?.outcome.kind).toBe("response");
    expect(report.evidence[2]?.outcome).toMatchObject({
      kind: "error",
      error: { code: "request-budget-exhausted", phase: "body" },
    });
  });
});

describe("configuration refusals", () => {
  async function refuse(
    overrides: Parameters<typeof scanInput>[0],
  ): Promise<{ transport: CountingTransport; error: unknown }> {
    const transport = overrides.transport as CountingTransport;
    let error: unknown;
    try {
      await runScan(scanInput(overrides));
    } catch (caught) {
      error = caught;
    }
    return { transport, error };
  }

  const rules = [ruleAt("a.one", [httpRequest("a", "/robots.txt")])];

  it("performs zero transport calls for maxConcurrency above 1", async () => {
    const { transport, error } = await refuse({
      rules,
      assertions: assertionsOf(rules),
      transport: new CountingTransport(),
      budget: { maxConcurrency: 2 },
    });
    expect(transport.calls).toBe(0);
    expect(error).toBeInstanceOf(ConfigurationError);
    expect((error as ConfigurationError).code).toBe("concurrency-unsupported");
    expect(String(error)).toMatch(/refused rather than clamped/);
  });

  it("performs zero transport calls for an unknown selector", async () => {
    const { transport, error } = await refuse({
      rules,
      assertions: assertionsOf(rules),
      transport: new CountingTransport(),
      include: "web.discovery.nothing",
    });
    expect(transport.calls).toBe(0);
    expect((error as ConfigurationError).code).toBe("invalid-selector");
  });

  it("performs zero transport calls for an unknown rule option", async () => {
    const { transport, error } = await refuse({
      rules,
      assertions: assertionsOf(rules),
      transport: new CountingTransport(),
      ruleOptions: { "a.one": { invented: true } },
    });
    expect(transport.calls).toBe(0);
    expect((error as ConfigurationError).code).toBe("unknown-rule-option");
  });

  it("performs zero transport calls when an assertion has no remediation entry", async () => {
    const { transport, error } = await refuse({
      rules,
      assertions: assertionsOf(rules),
      transport: new CountingTransport(),
      remediation: new Map(),
    });
    expect(transport.calls).toBe(0);
    expect((error as ConfigurationError).code).toBe("remediation-missing");
  });

  it("performs zero transport calls when a cited source is not in the ledger", async () => {
    const { transport, error } = await refuse({
      rules,
      assertions: assertionsOf(rules),
      transport: new CountingTransport(),
      sources: [],
    });
    expect(transport.calls).toBe(0);
    expect((error as ConfigurationError).code).toBe("unresolved-source-ref");
  });

  // ADR-0007 section 1's pairing rule has its own code, and the two
  // directions are separate cases because a caller that cannot tell them apart
  // cannot tell which of the two arguments to change.
  it("refuses a compat report with no external snapshot", async () => {
    const { transport, error } = await refuse({
      rules,
      assertions: assertionsOf(rules),
      transport: new CountingTransport(),
      mode: "compat",
    });
    expect(transport.calls).toBe(0);
    expect(error).toBeInstanceOf(ConfigurationError);
    expect((error as ConfigurationError).code).toBe(
      "external-snapshot-mode-mismatch",
    );
  });

  it("refuses a spec report that carries an external snapshot", async () => {
    const { transport, error } = await refuse({
      rules,
      assertions: assertionsOf(rules),
      transport: new CountingTransport(),
      mode: "spec",
      externalSnapshot: { capturedAt: "2026-08-28", schemaVersion: "0" },
    });
    expect(transport.calls).toBe(0);
    expect((error as ConfigurationError).code).toBe(
      "external-snapshot-mode-mismatch",
    );
  });

  it("keeps no-assertion-for-mode for a ruleset that declares none", () => {
    // The other fault that shared this code until 2026-08-29. It is raised by
    // `validateRuleAssertions` against a well-formed configuration, so the two
    // are now distinguishable by code alone.
    const declaration = assertion({ id: "b.only", ruleId: "b.one" });
    const definition = rule({ id: "b.one", assertions: [declaration] });
    const index = new RulesetAssertionIndex([declaration]);

    expect(() => {
      validateRuleAssertions(definition.metadata, index, "interop");
    }).toThrow(/has no pinned assertion for mode interop/);
    try {
      validateRuleAssertions(definition.metadata, index, "interop");
    } catch (error) {
      expect((error as ConfigurationError).code).toBe("no-assertion-for-mode");
    }
  });

  it("refuses a request budget above the evidence ceiling", async () => {
    const { transport, error } = await refuse({
      rules,
      assertions: assertionsOf(rules),
      transport: new CountingTransport(),
      budget: { maxRequests: 1000 },
    });
    expect(transport.calls).toBe(0);
    expect((error as ConfigurationError).code).toBe(
      "evidence-ceiling-exceeded",
    );
  });
});

describe("transport failures", () => {
  it("keeps a raw transport exception out of the public report", async () => {
    class ThrowingTransport implements Transport {
      http(): Promise<HttpTransportResult> {
        throw new Error(
          "ECONNREFUSED 127.0.0.1:8787 secret-marker-8f3a in the stack",
        );
      }
    }
    const rules = [ruleAt("a.one", [httpRequest("a", "/robots.txt")])];

    const report = await runScan(
      scanInput({
        rules,
        assertions: assertionsOf(rules),
        transport: new ThrowingTransport(),
      }),
    );

    expect(canonicalizeJson(report)).not.toMatch(/secret-marker-8f3a/);
    expect(report.evidence[0]?.outcome).toMatchObject({
      kind: "error",
      error: { code: "connection-failed", message: "The connection failed." },
    });
  });

  it("reports a transport failure as unable-to-check, never as fail", async () => {
    const declaration = assertion({ id: "a.only", ruleId: "a.one" });
    const definition = rule({
      id: "a.one",
      assertions: [declaration],
      plan: () => [httpRequest("a", "/robots.txt")],
      step: (context: RoundContext<unknown>): AssertionOutcomes => ({
        kind: "outcomes",
        outcomes: [
          outcome(
            declaration.id,
            context.observation("a").outcome.kind === "error"
              ? "indeterminate"
              : "satisfied",
            ["a"],
          ),
        ],
      }),
    });

    const report = await runScan(
      scanInput({
        rules: [definition],
        assertions: [declaration],
        transport: new RecordingTransport(),
      }),
    );

    expect(report.results[0]?.status).toBe("unable-to-check");
    expect(report.summary.unableToCheck).toBe(1);
    expect(report.summary.fail).toBe(0);
  });
});

describe("two rounds", () => {
  const declaration = assertion({ id: "map.dereference", ruleId: "a.sitemap" });

  function twoRoundRule(
    discovered: string,
    budget = 1,
  ): ReturnType<typeof rule> {
    return rule({
      id: "a.sitemap",
      assertions: [declaration],
      roundTwoBudget: budget,
      plan: () => [
        httpRequest("robots", "/robots.txt", { accept: "text/plain" }),
      ],
      step: (): RequestBatch => ({
        kind: "requests",
        requests: [
          {
            kind: "http",
            id: "declared-sitemap",
            method: "GET",
            target: {
              kind: "discovered",
              url: discovered,
              provenance: { fromObservation: "robots", locator: "line 3" },
            },
            accept: "application/xml",
            redirects: "follow-same-origin",
            maxEncodedBytes: 65536,
            maxDecodedBytes: 131072,
          },
        ],
      }),
      finish: (context: RoundContext<unknown>): AssertionOutcomes => ({
        kind: "outcomes",
        outcomes: [
          outcome(
            declaration.id,
            context.observation("declared-sitemap").outcome.kind === "error"
              ? "indeterminate"
              : "satisfied",
            ["robots", "declared-sitemap"],
          ),
        ],
      }),
    });
  }

  it("continues the evidence sequence into round two", async () => {
    const definition = twoRoundRule(SITEMAP);
    const transport = new RecordingTransport(
      script([
        [ROBOTS, "Sitemap: /sitemap.xml"],
        [SITEMAP, "<urlset/>"],
      ]),
    );

    const report = await runScan(
      scanInput({ rules: [definition], assertions: [declaration], transport }),
    );

    expect(transport.urls).toStrictEqual([ROBOTS, SITEMAP]);
    expect(report.evidence.map((entry) => entry.id)).toStrictEqual([
      "ev-001",
      "ev-002",
    ]);
    expect(report.results[0]?.findings[0]?.evidenceRefs).toStrictEqual([
      "ev-001",
      "ev-002",
    ]);
    expect(report.results[0]?.status).toBe("pass");
  });

  it("refuses a cross-origin discovered URL without opening a socket", async () => {
    const definition = twoRoundRule("http://evil.invalid/sitemap.xml");
    const transport = new RecordingTransport(script([[ROBOTS, "Sitemap: x"]]));

    const report = await runScan(
      scanInput({ rules: [definition], assertions: [declaration], transport }),
    );

    expect(transport.urls).toStrictEqual([ROBOTS]);
    expect(report.evidence[1]?.outcome).toMatchObject({
      kind: "error",
      error: { code: "url-policy-blocked", phase: "policy" },
    });
    expect(report.results[0]?.status).toBe("unable-to-check");
  });

  it("exits 4 for a round-two batch larger than roundTwoBudget", async () => {
    const definition = twoRoundRule(SITEMAP, 0);
    const transport = new RecordingTransport(script([[ROBOTS, "Sitemap: x"]]));

    await expect(
      runScan(
        scanInput({
          rules: [definition],
          assertions: [declaration],
          transport,
        }),
      ),
    ).rejects.toThrow(/roundTwoBudget of 0/);
  });

  it("exits 4 when a rule reuses a request id across its two rounds", async () => {
    const definition = rule({
      id: "a.sitemap",
      assertions: [declaration],
      roundTwoBudget: 1,
      plan: () => [httpRequest("robots", "/robots.txt")],
      step: (): RequestBatch => ({
        kind: "requests",
        requests: [httpRequest("robots", "/sitemap.xml")],
      }),
    });
    const transport = new RecordingTransport(script([[ROBOTS, "x"]]));

    let thrown: unknown;
    try {
      await runScan(
        scanInput({
          rules: [definition],
          assertions: [declaration],
          transport,
        }),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RuleContractViolation);
    expect((thrown as RuleContractViolation).code).toBe("duplicate-request-id");
    expect((thrown as RuleContractViolation).exitCode).toBe(4);
  });

  it("exits 4 when a rule asks for an observation it never requested", async () => {
    const own = assertion({ id: "a.only", ruleId: "a.one" });
    const definition = rule({
      id: "a.one",
      assertions: [own],
      plan: () => [],
      step: (context: RoundContext<unknown>): AssertionOutcomes => {
        context.observation("never-requested");
        return { kind: "outcomes", outcomes: [] };
      },
    });

    let thrown: unknown;
    try {
      await runScan(
        scanInput({
          rules: [definition],
          assertions: [own],
          transport: new RecordingTransport(),
        }),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RuleContractViolation);
    expect((thrown as RuleContractViolation).code).toBe(
      "unknown-observation-ref",
    );
  });
});

describe("deferred assertions", () => {
  // ADR-0010 section 4 end to end. `agent.discovery.skills` declares four
  // spec assertions and reports three outcomes, and the fourth is absent from
  // the findings rather than present with a neutral verdict.
  const evaluated = assertion({
    id: "skills.path-schema",
    ruleId: "agent.discovery.skills",
  });
  const deferred = assertion({
    id: "skills.archive-safety",
    ruleId: "agent.discovery.skills",
    requirementClass: "recommended",
    deferred: DEFERRAL,
  });

  it("runs the rule and reports no finding for the deferred assertion", async () => {
    const definition = rule({
      id: "agent.discovery.skills",
      assertions: [evaluated],
      declaredAssertions: [evaluated, deferred],
    });

    const report = await runScan(
      scanInput({
        rules: [definition],
        assertions: [evaluated, deferred],
        transport: new RecordingTransport(),
        // Neither a template nor a remediation entry exists for the deferred
        // assertion, which is the point: a deferred assertion is owed neither,
        // and demanding either would fail the scan at exit 2.
        templates: templatesFor([evaluated]),
        remediation: remediationFor([evaluated]),
      }),
    );

    expect(report.results[0]).toMatchObject({
      ruleId: "agent.discovery.skills",
      status: "pass",
    });
    expect(
      report.results[0]?.findings.map((finding) => finding.code),
    ).toStrictEqual([evaluated.id]);
  });

  it("refuses a rule that reports an outcome for the deferred assertion", async () => {
    const definition = rule({
      id: "agent.discovery.skills",
      assertions: [evaluated],
      declaredAssertions: [evaluated, deferred],
      step: (): AssertionOutcomes => ({
        kind: "outcomes",
        outcomes: [
          outcome(evaluated.id, "satisfied"),
          outcome(deferred.id, "satisfied"),
        ],
      }),
    });

    let thrown: unknown;
    try {
      await runScan(
        scanInput({
          rules: [definition],
          assertions: [evaluated, deferred],
          transport: new RecordingTransport(),
          templates: templatesFor([evaluated]),
          remediation: remediationFor([evaluated]),
        }),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RuleContractViolation);
    expect((thrown as RuleContractViolation).code).toBe(
      "outcome-for-deferred-assertion",
    );
  });
});

describe("uninvoked rules", () => {
  it("reports unsupported-runtime without calling the rule", async () => {
    const declaration = assertion({ id: "dns.record", ruleId: "dns.one" });
    const definition = rule({
      id: "dns.one",
      assertions: [declaration],
      runtime: ["dns"],
      plan: () => {
        throw new Error("plan() must not run for an unavailable runtime");
      },
    });

    const report = await runScan(
      scanInput({
        rules: [definition],
        assertions: [declaration],
        transport: new RecordingTransport(),
      }),
    );

    expect(report.results[0]).toStrictEqual({
      ruleId: "dns.one",
      ruleVersion: "0.1.0",
      status: "unsupported-runtime",
      gate: "enforced",
      findings: [],
    });
    expect(report.summary.unsupportedRuntime).toBe(1);
  });

  it("invokes the same rule once the transport resolves DNS", async () => {
    const declaration = assertion({ id: "dns.record", ruleId: "dns.one" });
    const definition = rule({
      id: "dns.one",
      assertions: [declaration],
      runtime: ["dns"],
      plan: (): readonly ObservationRequest[] => [
        {
          kind: "dns",
          id: "aaaa",
          name: { kind: "target-host" },
          recordType: "TXT",
        },
      ],
      step: (): AssertionOutcomes => ({
        kind: "outcomes",
        outcomes: [outcome(declaration.id, "satisfied", ["aaaa"])],
      }),
    });

    const report = await runScan(
      scanInput({
        rules: [definition],
        assertions: [declaration],
        transport: new DnsCapableTransport(),
      }),
    );

    expect(report.results[0]?.status).toBe("pass");
    expect(report.evidence[0]).toMatchObject({
      kind: "dns",
      query: { name: "127.0.0.1", recordType: "TXT" },
      outcome: { kind: "answer", rcode: "NOERROR" },
    });
  });
});
