import { describe, expect, it } from "vitest";

import type {
  AssertionOutcomes,
  DnsTransportResult,
  HttpTransportRequest,
  HttpTransportResult,
  ObservationRequest,
  PlanningContext,
  RoundContext,
  Transport,
} from "../src/index.js";
import {
  DEFAULT_NETWORK_BUDGET,
  canonicalRequestKey,
  createRuleState,
  resolveObservationRequest,
  runScan,
} from "../src/index.js";

import { MEMO_KEYS } from "../src/index.js";
import {
  RecordingTransport,
  TARGET,
  assertion,
  body,
  httpRequest,
  outcome,
  rule,
  scanInput,
} from "./support/harness.js";

/**
 * Request resolution and dispatch paths that the end-to-end tests reach only
 * incidentally: the `page` target, DNS observation names, a malformed target
 * origin, redirect evidence, and the shared memo.
 */

const CONTEXT: PlanningContext = {
  target: TARGET,
  budget: DEFAULT_NETWORK_BUDGET,
  networkProfile: "local-loopback",
};

const RESOLVED = (): boolean => true;
const UNRESOLVED = (): boolean => false;

describe("request resolution", () => {
  it("resolves the page target to the normalized page URL", () => {
    const resolution = resolveObservationRequest(
      {
        kind: "http",
        id: "page",
        method: "GET",
        target: { kind: "page" },
        accept: "text/html",
        redirects: "follow-same-origin",
        maxEncodedBytes: 1024,
        maxDecodedBytes: 2048,
      },
      CONTEXT,
      createRuleState("a.one"),
      RESOLVED,
    );

    expect(resolution.request).toMatchObject({
      kind: "http",
      url: "http://127.0.0.1:8787/",
    });
    expect(resolution.refusal).toBeNull();
  });

  it("lowers a byte limit to the rule's value and never raises it", () => {
    const lower = resolveObservationRequest(
      httpRequest("a", "/robots.txt", { maxEncodedBytes: 1024 }),
      CONTEXT,
      createRuleState("a.one"),
      RESOLVED,
    );
    expect(lower.request).toMatchObject({ maxEncodedBytes: 1024 });

    const higher = resolveObservationRequest(
      httpRequest("a", "/robots.txt", { maxEncodedBytes: 999_999_999 }),
      CONTEXT,
      createRuleState("a.one"),
      RESOLVED,
    );
    expect(higher.request).toMatchObject({
      maxEncodedBytes: DEFAULT_NETWORK_BUDGET.maxEncodedResponseBytes,
    });
  });

  it("falls back to the policy ceiling for a limit that is not a whole count", () => {
    // A `NaN` reaching the dedup key would make the key unequal to itself.
    const resolution = resolveObservationRequest(
      httpRequest("a", "/robots.txt", { maxDecodedBytes: Number.NaN }),
      CONTEXT,
      createRuleState("a.one"),
      RESOLVED,
    );
    expect(resolution.request).toMatchObject({
      maxDecodedBytes: DEFAULT_NETWORK_BUDGET.maxDecodedResponseBytes,
    });
  });

  it("refuses a request when the target origin does not parse", () => {
    const resolution = resolveObservationRequest(
      httpRequest("a", "/robots.txt"),
      { ...CONTEXT, target: { ...TARGET, origin: "not-an-origin" } },
      createRuleState("a.one"),
      RESOLVED,
    );
    expect(resolution.request).toMatchObject({
      kind: "refused",
      reason: "malformed",
    });
    expect(resolution.refusal).toStrictEqual({
      code: "invalid-url",
      phase: "policy",
    });
  });

  it("builds a DNS query name from the target host", () => {
    const bare = resolveObservationRequest(
      {
        kind: "dns",
        id: "a",
        name: { kind: "target-host" },
        recordType: "TXT",
      },
      CONTEXT,
      createRuleState("a.one"),
      RESOLVED,
    );
    expect(bare.request).toStrictEqual({
      kind: "dns",
      name: "127.0.0.1",
      recordType: "TXT",
    });

    const prefixed = resolveObservationRequest(
      {
        kind: "dns",
        id: "b",
        name: { kind: "target-host-prefixed", prefix: "_agent" },
        recordType: "TXT",
      },
      CONTEXT,
      createRuleState("a.one"),
      RESOLVED,
    );
    expect(prefixed.request).toMatchObject({ name: "_agent.127.0.0.1" });
  });

  it("refuses a discovered DNS name whose provenance does not resolve", () => {
    const resolution = resolveObservationRequest(
      {
        kind: "dns",
        id: "c",
        name: {
          kind: "discovered",
          name: "elsewhere.invalid",
          provenance: { fromObservation: "nothing", locator: "/0" },
        },
        recordType: "TXT",
      },
      CONTEXT,
      createRuleState("a.one"),
      UNRESOLVED,
    );
    expect(resolution.request).toStrictEqual({
      kind: "refused",
      raw: "elsewhere.invalid",
      reason: "unknown-provenance",
    });
  });

  it("accepts a discovered DNS name once its provenance resolves", () => {
    const resolution = resolveObservationRequest(
      {
        kind: "dns",
        id: "c",
        name: {
          kind: "discovered",
          name: "elsewhere.invalid",
          provenance: { fromObservation: "seed", locator: "/0" },
        },
        recordType: "SVCB",
      },
      CONTEXT,
      createRuleState("a.one"),
      RESOLVED,
    );
    expect(resolution.request).toMatchObject({ name: "elsewhere.invalid" });
  });

  it("resolves a page or origin-path request with no rule state at all", () => {
    // A caller that only wants the canonical key for a request the engine
    // will make had to fabricate a `RuleRuntimeState` and a provenance
    // resolver to satisfy the signature, neither of which these two target
    // kinds read. Omitting them must produce the identical resolution.
    for (const request of [
      httpRequest("a", "/robots.txt"),
      {
        kind: "http",
        id: "page",
        method: "GET",
        target: { kind: "page" },
        accept: "text/html",
        redirects: "follow-same-origin",
        maxEncodedBytes: 1024,
        maxDecodedBytes: 2048,
      } satisfies ObservationRequest,
      {
        kind: "dns",
        id: "d",
        name: { kind: "target-host" },
        recordType: "TXT",
      } satisfies ObservationRequest,
    ]) {
      expect(resolveObservationRequest(request, CONTEXT)).toStrictEqual(
        resolveObservationRequest(
          request,
          CONTEXT,
          createRuleState("a.one"),
          RESOLVED,
        ),
      );
    }
  });

  it("refuses a discovered URL when no provenance resolver is supplied", () => {
    // Fail-closed, not permissive: with nothing able to vouch for it, a
    // discovered URL is refused exactly as an unknown-provenance one is.
    const resolution = resolveObservationRequest(
      {
        kind: "http",
        id: "c",
        method: "GET",
        target: {
          kind: "discovered",
          url: "http://127.0.0.1:8787/found",
          provenance: { fromObservation: "seed", locator: "/0" },
        },
        accept: "text/html",
        redirects: "follow-same-origin",
        maxEncodedBytes: 1024,
        maxDecodedBytes: 2048,
      },
      CONTEXT,
    );
    expect(resolution.request).toMatchObject({ kind: "refused" });
    expect(resolution.refusal).toStrictEqual({
      code: "invalid-url",
      phase: "policy",
    });
  });
});

describe("header ordering in the key", () => {
  it("sorts representation headers by name, so declaration order cannot matter", () => {
    const forward = canonicalRequestKey({
      kind: "http",
      method: "GET",
      url: "http://h.invalid/",
      representationHeaders: new Map([
        ["accept", ["text/html"]],
        ["accept-language", ["en"]],
      ]),
      redirects: "reject",
      maxRedirects: 1,
      maxEncodedBytes: 1,
      maxDecodedBytes: 2,
      scope: "local",
      networkProfile: "local-loopback",
    });
    const reversed = canonicalRequestKey({
      kind: "http",
      method: "GET",
      url: "http://h.invalid/",
      representationHeaders: new Map([
        ["accept-language", ["en"]],
        ["accept", ["text/html"]],
      ]),
      redirects: "reject",
      maxRedirects: 1,
      maxEncodedBytes: 1,
      maxDecodedBytes: 2,
      scope: "local",
      networkProfile: "local-loopback",
    });

    expect(forward).toBe(reversed);
    expect(forward).toContain("accept-language");
  });
});

describe("dispatch paths", () => {
  const declaration = assertion({ id: "a.only", ruleId: "a.one" });

  function oneRequest(request: ObservationRequest): ReturnType<typeof rule> {
    return rule({
      id: "a.one",
      assertions: [declaration],
      plan: () => [request],
      step: (context: RoundContext<unknown>): AssertionOutcomes => ({
        kind: "outcomes",
        outcomes: [
          outcome(
            declaration.id,
            context.observation(request.id).outcome.kind === "error"
              ? "indeterminate"
              : "satisfied",
            [request.id],
          ),
        ],
      }),
    });
  }

  it("records bounded redirect facts and sanitizes the location", async () => {
    const transport: Transport = {
      http(request: HttpTransportRequest): Promise<HttpTransportResult> {
        return Promise.resolve({
          kind: "response",
          status: 200,
          effectiveUrl: request.url,
          headers: new Map(),
          body: new Uint8Array(0),
          truncated: false,
          encodedBytes: 0,
          decodedBytes: 0,
          bodySha256: "0".repeat(64),
          redirects: [
            {
              status: 301,
              location: "http://127.0.0.1:8787/next[2J",
              decision: "followed",
            },
            {
              status: 302,
              location: "http://evil.invalid/",
              decision: "blocked",
            },
          ],
        });
      },
    };

    const report = await runScan(
      scanInput({
        rules: [oneRequest(httpRequest("a", "/robots.txt"))],
        assertions: [declaration],
        transport,
      }),
    );

    const outcomeValue = report.evidence[0]?.outcome;
    expect(outcomeValue).toMatchObject({
      redirects: [
        {
          status: 301,
          location: "http://127.0.0.1:8787/next�[2J",
          decision: "followed",
        },
        { status: 302, location: "http://evil.invalid/", decision: "blocked" },
      ],
    });
  });

  it("turns a DNS transport failure into a typed dns error observation", async () => {
    class FailingDns extends RecordingTransport {
      dns(): Promise<DnsTransportResult> {
        return Promise.resolve({
          kind: "failure",
          reason: { code: "dns-timeout", phase: "dns" },
        });
      }
    }

    const dnsRule = rule({
      id: "a.one",
      assertions: [declaration],
      runtime: ["dns"],
      plan: (): readonly ObservationRequest[] => [
        {
          kind: "dns",
          id: "a",
          name: { kind: "target-host" },
          recordType: "A",
        },
      ],
      step: (): AssertionOutcomes => ({
        kind: "outcomes",
        outcomes: [outcome(declaration.id, "indeterminate", ["a"])],
      }),
    });

    const report = await runScan(
      scanInput({
        rules: [dnsRule],
        assertions: [declaration],
        transport: new FailingDns(),
      }),
    );

    expect(report.evidence[0]).toMatchObject({
      kind: "dns",
      query: { name: "127.0.0.1", recordType: "A" },
      outcome: {
        kind: "error",
        error: { code: "dns-resolution-failed", phase: "dns", retryable: true },
      },
    });
    expect(report.results[0]?.status).toBe("unable-to-check");
  });
});

describe("the shared memo", () => {
  it("parses once and hands three rules the same frozen value", async () => {
    let parses = 0;
    const declarations = ["a.one", "a.two", "a.three"].map((id) =>
      assertion({ id: `${id}.only`, ruleId: id }),
    );
    const seen: unknown[] = [];

    const rules = declarations.map((declaration, index) =>
      rule({
        id: ["a.one", "a.two", "a.three"][index] ?? "",
        assertions: [declaration],
        plan: () => [
          httpRequest("robots", "/robots.txt", { accept: "text/plain" }),
        ],
        step: (context: RoundContext<unknown>): AssertionOutcomes => {
          const parsed = context.memo(MEMO_KEYS[0], () => {
            parses += 1;
            return { groups: [{ agent: "*", allow: ["/"] }] };
          });
          seen.push(parsed);
          return {
            kind: "outcomes",
            outcomes: [outcome(declaration.id, "satisfied", ["robots"])],
          };
        },
      }),
    );

    const transport = new RecordingTransport(
      new Map([
        ["http://127.0.0.1:8787/robots.txt", { chunks: body("User-agent: *") }],
      ]),
    );

    const report = await runScan(
      scanInput({ rules, assertions: declarations, transport }),
    );

    expect(parses).toBe(1);
    expect(transport.callCount).toBe(1);
    expect(new Set(seen).size).toBe(1);
    expect(Object.isFrozen(seen[0])).toBe(true);
    expect(report.results).toHaveLength(3);
  });
});
