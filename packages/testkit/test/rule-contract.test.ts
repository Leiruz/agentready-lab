import { RuleContractViolation } from "@agentready-lab/core";
import type { AssertionOutcomes, OutcomeKind } from "@agentready-lab/core";
import { describe, expect, it } from "vitest";

import {
  ContractAssertionError,
  InMemoryTransport,
  arrivalSegmentations,
  assertionsOf,
  buildScanInput,
  encodeText,
  expectAllRoutesMatched,
  expectDeterministic,
  expectEvidenceResolves,
  expectFindingCodes,
  expectGate,
  expectNoRequests,
  expectRequests,
  expectRequirementClasses,
  expectSerialDispatch,
  expectStatus,
  latencyProfiles,
  planningContextOf,
  respond,
  runRuleContract,
} from "../src/index.js";
import {
  httpRequest,
  outcomesFor,
  testAssertion,
  testRule,
} from "./support/rules.js";

function ruleReporting(
  kind: OutcomeKind,
  requirementClass: "normative" | "recommended" | "advisory" = "normative",
): ReturnType<typeof testRule> {
  const assertions = [testAssertion({ id: "test-001", requirementClass })];
  return testRule({
    id: "test.status",
    assertions,
    step: (context): AssertionOutcomes =>
      outcomesFor(assertions, context.mode, kind),
  });
}

describe("derived status", () => {
  // ADR-0002 section 5: the rule reports an outcome kind, the core decides the
  // status. Every row here is a status a rule cannot write for itself.
  it.each([
    ["satisfied", "normative", "pass"],
    ["violated", "normative", "fail"],
    ["violated", "recommended", "warning"],
    ["violated", "advisory", "warning"],
    ["not-present", "normative", "not-applicable"],
    ["indeterminate", "normative", "unable-to-check"],
  ] as const)("%s on a %s assertion is %s", async (kind, klass, status) => {
    const run = await runRuleContract({
      rule: ruleReporting(kind, klass),
      transport: new InMemoryTransport(),
    });

    expectStatus(run, status);
    expectFindingCodes(run, ["test-001"]);
    expectRequirementClasses(run, { "test-001": klass });
    expectGate(run, "enforced");
    expectNoRequests(run);
  });
});

describe("the ruleset outranks the rule", () => {
  it("refuses a rule claiming a stronger class than the pinned ruleset", async () => {
    const rule = ruleReporting("violated", "normative");

    await expect(
      runRuleContract({
        rule,
        transport: new InMemoryTransport(),
        // The pinned ruleset says recommended; the rule's metadata says
        // normative. ADR-0002 section 5 makes that exit 4.
        assertions: [
          {
            ...testAssertion({
              id: "test-001",
              requirementClass: "recommended",
            }),
            ruleId: rule.metadata.id,
          },
        ],
      }),
    ).rejects.toThrow(RuleContractViolation);
  });

  it("derives the class from the ruleset when the rule under-claims", async () => {
    const assertions = [
      testAssertion({ id: "test-001", requirementClass: "advisory" }),
    ];
    const rule = testRule({
      id: "test.underclaim",
      assertions,
      step: (context): AssertionOutcomes =>
        outcomesFor(assertions, context.mode, "violated"),
    });

    const run = await runRuleContract({
      rule,
      transport: new InMemoryTransport(),
      assertions: [
        {
          ...testAssertion({ id: "test-001", requirementClass: "normative" }),
          ruleId: rule.metadata.id,
        },
      ],
    });

    expectStatus(run, "fail");
    expectRequirementClasses(run, { "test-001": "normative" });
  });
});

describe("mode distinction", () => {
  const assertions = [
    testAssertion({ id: "test-spec-001" }),
    testAssertion({
      id: "test-compat-001",
      mode: "compat",
      requirementClass: "compatibility",
    }),
  ];
  const rule = testRule({
    id: "test.modes",
    assertions,
    modes: ["spec", "compat"],
    step: (context): AssertionOutcomes =>
      outcomesFor(assertions, context.mode, "violated"),
  });

  it("evaluates only the spec assertion in spec mode", async () => {
    const run = await runRuleContract({
      rule,
      transport: new InMemoryTransport(),
      mode: "spec",
    });

    expectFindingCodes(run, ["test-spec-001"]);
    expect(run.report.externalSnapshot).toBeUndefined();
  });

  it("evaluates only the compat assertion in compat mode", async () => {
    const run = await runRuleContract({
      rule,
      transport: new InMemoryTransport(),
      mode: "compat",
    });

    expectFindingCodes(run, ["test-compat-001"]);
    expectRequirementClasses(run, { "test-compat-001": "compatibility" });
    // ADR-0007 section 1: required in compat mode, refused in every other.
    expect(run.report.externalSnapshot).toBeDefined();
  });
});

describe("unsupported runtime", () => {
  const rule = testRule({
    id: "test.dns",
    assertions: [testAssertion({ id: "test-001" })],
    runtime: ["dns"],
  });

  it("is unsupported-runtime against a transport with no dns method", async () => {
    const run = await runRuleContract({
      rule,
      transport: new InMemoryTransport(),
    });

    expectStatus(run, "unsupported-runtime");
    expectFindingCodes(run, []);
    expectNoRequests(run);
  });

  it("is invoked against a transport that declares dns", async () => {
    const run = await runRuleContract({
      rule,
      transport: new InMemoryTransport({ dns: true }),
    });

    expectStatus(run, "pass");
  });
});

describe("evidence and requests", () => {
  const assertions = [testAssertion({ id: "test-001" })];
  const request = httpRequest("robots", "/robots.txt", {
    accept: "text/plain",
  });
  const rule = testRule({
    id: "test.evidence",
    assertions,
    plan: () => [request],
    step: (context): AssertionOutcomes =>
      outcomesFor(assertions, context.mode, "violated", ["robots"]),
  });

  it("resolves every cited evidence reference and the exact request", async () => {
    const transport = new InMemoryTransport();
    const input = { rule, transport };
    transport.routeObservation(
      request,
      planningContextOf(input),
      respond({
        body: "User-agent: *\nDisallow: /\n",
        headers: { "Content-Type": "text/plain" },
      }),
    );

    const run = await runRuleContract(input);

    expect(expectEvidenceResolves(run)).toStrictEqual(["ev-001"]);
    expectRequests(run, [
      {
        url: "http://127.0.0.1:8787/robots.txt",
        method: "GET",
        accept: "text/plain",
      },
    ]);
    expectAllRoutesMatched(transport);
    expectSerialDispatch(transport);
  });

  it("fails the request assertion when the rule asks for something else", async () => {
    const transport = new InMemoryTransport();
    const input = { rule, transport };
    transport.routeObservation(
      request,
      planningContextOf(input),
      respond({ body: "User-agent: *\n" }),
    );
    const run = await runRuleContract(input);

    expect(() => {
      expectRequests(run, [{ url: "http://127.0.0.1:8787/sitemap.xml" }]);
    }).toThrow(ContractAssertionError);
    expect(() => {
      expectRequests(run, []);
    }).toThrow(ContractAssertionError);
    expect(() => {
      expectNoRequests(run);
    }).toThrow(ContractAssertionError);
  });
});

describe("assertion helpers fail when they should", () => {
  it("rejects a wrong status, wrong codes and a wrong class", async () => {
    const run = await runRuleContract({
      rule: ruleReporting("satisfied"),
      transport: new InMemoryTransport(),
    });

    expect(() => {
      expectStatus(run, "fail");
    }).toThrow(ContractAssertionError);
    expect(() => {
      expectFindingCodes(run, ["test-002"]);
    }).toThrow(ContractAssertionError);
    expect(() => {
      expectRequirementClasses(run, { "test-001": "advisory" });
    }).toThrow(ContractAssertionError);
    expect(() => {
      expectGate(run, "informational");
    }).toThrow(ContractAssertionError);
  });

  it("reports an unmatched route rather than letting it look like a rule bug", async () => {
    const transport = new InMemoryTransport();
    const rule = testRule({
      id: "test.unrouted",
      assertions: [testAssertion({ id: "test-001" })],
      plan: () => [httpRequest("page", "/")],
    });

    await runRuleContract({ rule, transport });

    expect(() => {
      expectAllRoutesMatched(transport);
    }).toThrow(ContractAssertionError);
  });
});

describe("determinism", () => {
  const assertions = [testAssertion({ id: "test-001" })];
  const requests = [
    httpRequest("robots", "/robots.txt", { accept: "text/plain" }),
    httpRequest("sitemap", "/sitemap.xml", { accept: "application/xml" }),
    httpRequest("page", "/", { accept: "text/html" }),
  ];
  const rule = testRule({
    id: "test.determinism",
    assertions,
    plan: () => requests,
    step: (context): AssertionOutcomes =>
      outcomesFor(assertions, context.mode, "violated", [
        "page",
        "robots",
        "sitemap",
      ]),
  });

  it("is byte-identical across latency profiles", async () => {
    const profiles = latencyProfiles(requests.length);
    const runs = [];
    for (const profile of profiles) {
      const transport = new InMemoryTransport();
      const input = { rule, transport };
      const context = planningContextOf(input);
      requests.forEach((request, index) => {
        transport.routeObservation(
          request,
          context,
          respond({
            body: `body for ${request.id}`,
            latencyTicks: profile.ticks[index] ?? 0,
          }),
        );
      });
      runs.push(await runRuleContract(input));
      expectSerialDispatch(transport);
    }

    expectDeterministic(
      runs,
      profiles.map((profile) => profile.name),
    );
    expect(runs).toHaveLength(5);
  });

  it("is byte-identical across body segmentations", async () => {
    const body = encodeText("User-agent: *\nDisallow: /private\nAllow: /\n");
    const segmentations = arrivalSegmentations(body, 12);
    const runs = [];
    for (const segmentation of segmentations) {
      const transport = new InMemoryTransport();
      const input = { rule, transport };
      const context = planningContextOf(input);
      for (const request of requests) {
        transport.routeObservation(
          request,
          context,
          respond({ body: segmentation.chunks }),
        );
      }
      runs.push(await runRuleContract(input));
    }

    expectDeterministic(
      runs,
      segmentations.map((segmentation) => segmentation.name),
    );
  });

  it("fails a determinism assertion when the reports differ", async () => {
    const first = await runRuleContract({
      rule: ruleReporting("satisfied"),
      transport: new InMemoryTransport(),
    });
    const second = await runRuleContract({
      rule: ruleReporting("violated"),
      transport: new InMemoryTransport(),
    });

    expect(() => {
      expectDeterministic([first, second]);
    }).toThrow(ContractAssertionError);
  });
});

describe("scan input construction", () => {
  const assertions = [testAssertion({ id: "test-001" })];
  const rule = testRule({
    id: "test.input",
    assertions,
    defaultOptions: { userAgent: "agentready-lab", depth: 1 },
  });

  it("derives the ruleset, ledger, templates and remediation from the rule", () => {
    const input = buildScanInput({ rule, transport: new InMemoryTransport() });

    expect(input.rulesetAssertions).toStrictEqual(assertionsOf([rule]));
    expect(input.sourceLedger.has("rfc9309")).toBe(true);
    expect(input.templates.get("test-001")?.violated).toBeDefined();
    expect(input.remediation.get("test-001")?.class).toBe(
      "required-correction",
    );
    expect(input.mode).toBe("spec");
    expect(input.profile.id).toBe("content");
  });

  it("passes rule options through and records them in the report", async () => {
    const run = await runRuleContract({
      rule,
      transport: new InMemoryTransport(),
      options: { depth: 3 },
    });

    expect(run.report.effectiveOptions).toStrictEqual([
      {
        ruleId: "test.input",
        options: {
          depth: { kind: "integer", value: 3 },
          userAgent: { kind: "string", value: "agentready-lab" },
        },
      },
    ]);
  });
});
