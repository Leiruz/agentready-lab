import {
  DEFAULT_NETWORK_BUDGET,
  canonicalRequestKey,
  toPublicError,
} from "@agentready-lab/core";
import type { PublicErrorCode } from "@agentready-lab/core";
import { describe, expect, it } from "vitest";

import {
  InMemoryTransport,
  PUBLIC_ERROR_REASONS,
  REACHABLE_PUBLIC_ERROR_CODES,
  encodeText,
  expectSerialDispatch,
  failure,
  planningContextOf,
  respond,
  runRuleContract,
} from "../src/index.js";
import { httpRequest, testAssertion, testRule } from "./support/rules.js";

const ASSERTION = testAssertion({ id: "test-001" });

function ruleRequesting(
  id: string,
  requests: readonly ReturnType<typeof httpRequest>[],
): ReturnType<typeof testRule> {
  return testRule({
    id,
    assertions: [ASSERTION],
    plan: () => requests,
  });
}

describe("route keys", () => {
  const transport = new InMemoryTransport();
  const spec = {
    url: "http://127.0.0.1:8787/robots.txt",
    method: "GET",
    accept: "text/plain",
    redirects: "follow-same-origin",
    maxRedirects: 5,
    maxEncodedBytes: 65536,
    maxDecodedBytes: 131072,
  } as const;

  it("is core's canonical request key, not an approximation of it", () => {
    // Computed here from `canonicalRequestKey` directly. If the transport ever
    // grew its own key function, the two would drift and this would fail.
    expect(transport.httpRouteKey(spec)).toBe(
      canonicalRequestKey({
        kind: "http",
        method: "GET",
        url: "http://127.0.0.1:8787/robots.txt",
        representationHeaders: new Map([["accept", ["text/plain"]]]),
        redirects: "follow-same-origin",
        maxRedirects: 5,
        maxEncodedBytes: 65536,
        maxDecodedBytes: 131072,
        scope: "local",
        networkProfile: "local-loopback",
      }),
    );
  });

  // ADR-0005 section 3 lists exactly what two requests may differ by and still
  // be two requests. Each of these is one component of that key.
  it.each([
    ["method", { method: "HEAD" }],
    ["url", { url: "http://127.0.0.1:8787/sitemap.xml" }],
    ["accept", { accept: "text/markdown" }],
    ["redirects", { redirects: "reject" }],
    ["maxRedirects", { maxRedirects: 4 }],
    ["maxEncodedBytes", { maxEncodedBytes: 65535 }],
    ["maxDecodedBytes", { maxDecodedBytes: 131071 }],
  ] as const)("changes when %s changes", (_name, override) => {
    expect(transport.httpRouteKey({ ...spec, ...override })).not.toBe(
      transport.httpRouteKey(spec),
    );
  });

  it("separates scope and network profile", () => {
    const remote = new InMemoryTransport({
      scope: "remote",
      networkProfile: "ci-public",
    });
    expect(remote.httpRouteKey(spec)).not.toBe(transport.httpRouteKey(spec));
  });
});

describe("dedup behaviour under the real engine", () => {
  it("dispatches an Accept variant separately and answers each route", async () => {
    const transport = new InMemoryTransport();
    const rule = ruleRequesting("test.accept", [
      httpRequest("html", "/", { accept: "text/html" }),
      httpRequest("markdown", "/", { accept: "text/markdown" }),
    ]);
    const input = { rule, transport };
    const context = planningContextOf(input);
    transport
      .routeObservation(
        httpRequest("html", "/", { accept: "text/html" }),
        context,
        respond({ body: "<html></html>" }),
      )
      .routeObservation(
        httpRequest("markdown", "/", { accept: "text/markdown" }),
        context,
        respond({ body: "# markdown" }),
      );

    const run = await runRuleContract(input);

    expect(run.transport.urls).toStrictEqual([
      "http://127.0.0.1:8787/",
      "http://127.0.0.1:8787/",
    ]);
    expect(
      run.transport.httpRequests.map((request) => request.accept[0]),
    ).toStrictEqual(["text/html", "text/markdown"]);
    expect(run.transport.unmatched).toStrictEqual([]);
    // Two representations of one URL are two evidence entries with different
    // body digests, which is the observable form of "did not deduplicate".
    const digests = run.evidence.map((entry) =>
      entry.kind === "http" && entry.outcome.kind === "response"
        ? entry.outcome.bodySha256
        : "",
    );
    expect(new Set(digests).size).toBe(2);
  });

  it("dispatches one identical probe shared by two rules once", async () => {
    const transport = new InMemoryTransport();
    const shared = httpRequest("robots", "/robots.txt", {
      accept: "text/plain",
    });
    const first = ruleRequesting("test.first", [shared]);
    const second = ruleRequesting("test.second", [
      { ...shared, id: "robots-again" },
    ]);
    const input = { rule: first, transport, alsoRegister: [second] };
    transport.routeObservation(
      shared,
      planningContextOf(input),
      respond({ body: "User-agent: *\n" }),
    );

    const run = await runRuleContract(input);

    expect(run.transport.callCount).toBe(1);
    expect(run.report.evidence).toHaveLength(1);
    expectSerialDispatch(transport);
  });
});

describe("failure vocabulary", () => {
  it("keeps the reason table and the code list in step", () => {
    expect([...REACHABLE_PUBLIC_ERROR_CODES].sort()).toStrictEqual(
      Object.keys(PUBLIC_ERROR_REASONS).sort(),
    );
  });

  it.each(REACHABLE_PUBLIC_ERROR_CODES)(
    "projects the %s helper back to %s",
    (code) => {
      expect(toPublicError(failure(code).reason).code).toBe(code);
    },
  );

  it.each(REACHABLE_PUBLIC_ERROR_CODES)(
    "delivers %s to the report as a typed error, never an exception",
    async (code: PublicErrorCode) => {
      const transport = new InMemoryTransport();
      const request = httpRequest("probe", "/probe.json");
      const rule = ruleRequesting("test.errors", [request]);
      const input = { rule, transport };
      transport.routeObservation(
        request,
        planningContextOf(input),
        failure(code),
      );

      const run = await runRuleContract(input);
      const [evidence] = run.evidence;

      expect(evidence?.kind).toBe("http");
      expect(
        evidence?.outcome.kind === "error" ? evidence.outcome.error.code : "",
      ).toBe(code);
      // A message from the constant table of ADR-0003 section 6, never from an
      // exception.
      expect(
        evidence?.outcome.kind === "error"
          ? evidence.outcome.error.message
          : "",
      ).not.toBe("");
    },
  );
});

describe("recording and never throwing", () => {
  it("settles an unrouted request as a typed failure and records it", async () => {
    const transport = new InMemoryTransport();
    const rule = ruleRequesting("test.unrouted", [
      httpRequest("missing", "/missing"),
    ]);

    const run = await runRuleContract({ rule, transport });

    expect(run.transport.unmatched).toHaveLength(1);
    expect(run.transport.describeUnmatched()).toContain(
      "http://127.0.0.1:8787/missing",
    );
    const [evidence] = run.evidence;
    expect(
      evidence?.outcome.kind === "error" ? evidence.outcome.error.code : "",
    ).toBe("connection-failed");
  });

  it("records the effective caps and the remaining scan budget", async () => {
    const transport = new InMemoryTransport();
    const request = httpRequest("page", "/", {
      maxEncodedBytes: 1024,
      maxDecodedBytes: 2048,
    });
    const rule = ruleRequesting("test.caps", [request]);
    const input = { rule, transport };
    transport.routeObservation(
      request,
      planningContextOf(input),
      respond({ body: "ok" }),
    );

    const run = await runRuleContract(input);
    const [recorded] = run.transport.httpRequests;

    expect(recorded?.maxEncodedBytes).toBe(1024);
    expect(recorded?.maxDecodedBytes).toBe(2048);
    expect(recorded?.maxRedirects).toBe(DEFAULT_NETWORK_BUDGET.maxRedirects);
    expect(recorded?.scanRemainingDecodedBytes).toBe(
      DEFAULT_NETWORK_BUDGET.maxTotalDecodedBytes,
    );
    expect(recorded?.matched).toBe(true);
  });
});

describe("byte caps", () => {
  const body = encodeText("0123456789");

  async function runWithBudget(
    maxDecodedBytes: number,
    maxTotalDecodedBytes: number,
  ): Promise<string> {
    const transport = new InMemoryTransport();
    const request = httpRequest("page", "/", { maxDecodedBytes });
    const rule = ruleRequesting("test.bytes", [request]);
    const input = {
      rule,
      transport,
      budget: { maxTotalDecodedBytes },
    };
    transport.routeObservation(
      request,
      planningContextOf(input),
      respond({ body }),
    );
    const run = await runRuleContract(input);
    const [evidence] = run.evidence;
    return evidence?.outcome.kind === "error"
      ? evidence.outcome.error.code
      : "";
  }

  it("reports response-limit when the per-response cap binds", async () => {
    expect(await runWithBudget(4, 1_000_000)).toBe("response-limit");
  });

  it("reports the scan budget when the whole-scan remainder binds", async () => {
    expect(await runWithBudget(1024, 4)).toBe("request-budget-exhausted");
  });

  it("delivers the body when neither binds", async () => {
    expect(await runWithBudget(1024, 1_000_000)).toBe("");
  });
});
