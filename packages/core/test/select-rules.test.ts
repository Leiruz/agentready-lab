import { describe, expect, it } from "vitest";

import type { SelectionInput } from "../src/index.js";
import {
  ConfigurationError,
  resolveSelectors,
  selectRules,
} from "../src/index.js";

import { assertion, rule } from "./support/harness.js";

/**
 * ADR-0004. Profile membership grants selection; applicability governs what
 * the absence of the mechanism means.
 */

const robots = rule({
  id: "web.discovery.robots",
  category: "discoverability",
  profiles: ["content", "api", "full"],
  assertions: [
    assertion({ id: "robots.location", ruleId: "web.discovery.robots" }),
  ],
});

const signals = rule({
  id: "web.policy.content-signals",
  category: "bot-access-control",
  profiles: ["content", "full"],
  applicability: "optional",
  assertions: [
    assertion({
      id: "content-signals.declaration",
      ruleId: "web.policy.content-signals",
    }),
  ],
});

const botAuth = rule({
  id: "web.identity.web-bot-auth",
  category: "bot-access-control",
  profiles: ["full"],
  applicability: "informational",
  assertions: [
    assertion({
      id: "web-bot-auth.header",
      ruleId: "web.identity.web-bot-auth",
    }),
  ],
});

const dnsAid = rule({
  id: "dns.discovery.dns-aid",
  category: "discovery",
  profiles: ["full"],
  runtime: ["dns"],
  assertions: [
    assertion({ id: "dns-aid.record", ruleId: "dns.discovery.dns-aid" }),
  ],
});

const commerce = rule({
  id: "commerce.discovery.ucp",
  category: "commerce",
  profiles: ["full"],
  applicability: "commerce-endpoint-required",
  assertions: [
    assertion({ id: "ucp.endpoint", ruleId: "commerce.discovery.ucp" }),
  ],
});

const planned = rule({
  id: "agent.browser.webmcp",
  category: "discovery",
  profiles: ["full"],
  implementationStatus: "planned",
  assertions: [
    assertion({ id: "webmcp.declared", ruleId: "agent.browser.webmcp" }),
  ],
});

const REGISTRY = [robots, signals, botAuth, dnsAid, commerce, planned];

function select(
  overrides: Partial<SelectionInput> = {},
): ReturnType<typeof selectRules> {
  return selectRules({
    registry: REGISTRY,
    profile: "content",
    availableRuntimes: ["http"],
    commerceEndpointConfigured: false,
    ...overrides,
  });
}

describe("profile membership", () => {
  it("selects every rule listing the profile, whatever its applicability", () => {
    // The `optional` rule is selected, not skipped: that is the whole of
    // ADR-0004 section 1, and it is what makes `sig-006`'s expected
    // `not-applicable` reachable.
    expect(select().map((entry) => entry.rule.metadata.id)).toStrictEqual([
      "web.discovery.robots",
      "web.policy.content-signals",
    ]);
  });

  it("keeps registry order", () => {
    const ids = select({ profile: "full" }).map(
      (entry) => entry.rule.metadata.id,
    );
    expect(ids).toStrictEqual(REGISTRY.map((entry) => entry.metadata.id));
  });
});

describe("gate and resolution", () => {
  it("gates an informational rule out of the exit code", () => {
    const entry = select({ profile: "full" }).find(
      (candidate) => candidate.rule.metadata.id === "web.identity.web-bot-auth",
    );
    expect(entry?.gate).toBe("informational");
  });

  it("gates every other applicability as enforced", () => {
    const gates = select({ profile: "full" })
      .filter((entry) => entry.rule.metadata.id !== "web.identity.web-bot-auth")
      .map((entry) => entry.gate);
    expect(new Set(gates)).toStrictEqual(new Set(["enforced"]));
  });

  it("resolves a rule needing an unavailable runtime before plan()", () => {
    const entry = select({ profile: "full" }).find(
      (candidate) => candidate.rule.metadata.id === "dns.discovery.dns-aid",
    );
    expect(entry?.resolution).toBe("unsupported-runtime");
  });

  it("invokes that rule once the runtime is available", () => {
    const entry = select({
      profile: "full",
      availableRuntimes: ["http", "dns"],
    }).find(
      (candidate) => candidate.rule.metadata.id === "dns.discovery.dns-aid",
    );
    expect(entry?.resolution).toBe("invoke");
  });

  it("resolves commerce-endpoint-required to not-applicable without an endpoint", () => {
    const entry = select({ profile: "full" }).find(
      (candidate) => candidate.rule.metadata.id === "commerce.discovery.ucp",
    );
    expect(entry?.resolution).toBe("commerce-endpoint-absent");
  });

  it("invokes it once an endpoint is configured", () => {
    const entry = select({
      profile: "full",
      commerceEndpointConfigured: true,
    }).find(
      (candidate) => candidate.rule.metadata.id === "commerce.discovery.ucp",
    );
    expect(entry?.resolution).toBe("invoke");
  });
});

describe("include and exclude", () => {
  it("adds a rule the profile does not list", () => {
    const ids = select({ include: "web.identity.web-bot-auth" }).map(
      (entry) => entry.rule.metadata.id,
    );
    expect(ids).toContain("web.identity.web-bot-auth");
  });

  it("lets exclude win over include without an error", () => {
    const ids = select({
      include: "web.identity.web-bot-auth",
      exclude: "web.identity.web-bot-auth,web.discovery.robots",
    }).map((entry) => entry.rule.metadata.id);
    expect(ids).toStrictEqual(["web.policy.content-signals"]);
  });

  it("refuses to include a planned rule", () => {
    expect(() => select({ include: "agent.browser.webmcp" })).toThrow(
      /implementation_status is planned/,
    );
  });
});

describe("selector grammar", () => {
  it("matches a namespace glob, a category and a profile", () => {
    expect([...resolveSelectors("web.discovery.*", REGISTRY)]).toStrictEqual([
      "web.discovery.robots",
    ]);
    expect([...resolveSelectors("@category:commerce", REGISTRY)]).toStrictEqual(
      ["commerce.discovery.ucp"],
    );
    expect([...resolveSelectors("@profile:api", REGISTRY)]).toStrictEqual([
      "web.discovery.robots",
    ]);
  });

  it("accepts a repeated element idempotently", () => {
    expect([
      ...resolveSelectors(
        "web.discovery.robots,web.discovery.robots,web.*",
        REGISTRY,
      ),
    ]).toStrictEqual([
      "web.discovery.robots",
      "web.policy.content-signals",
      "web.identity.web-bot-auth",
    ]);
  });

  it.each([
    ["an unknown rule id", "web.discovery.nothing"],
    ["a zero-match glob", "agent.nothing.*"],
    ["an unknown category", "@category:invented"],
    ["an unknown profile", "@profile:invented"],
    ["a non-final wildcard", "web.*.robots"],
    ["a bare wildcard", "*"],
    ["an empty element", "web.discovery.robots,"],
    ["a doubled comma", "web.discovery.robots,,web.*"],
    ["an uppercase character", "Web.discovery.robots"],
    ["a version suffix", "web.discovery.robots@0.1.0"],
    ["the camelCase external id", "robotsTxt"],
  ])("exits 2 for %s", (_name, selector) => {
    let thrown: unknown;
    try {
      resolveSelectors(selector, REGISTRY);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConfigurationError);
    expect((thrown as ConfigurationError).exitCode).toBe(2);
    expect((thrown as ConfigurationError).code).toBe("invalid-selector");
  });
});

describe("refusals", () => {
  it("refuses --profile commerce in M1", () => {
    expect(() => select({ profile: "commerce" })).toThrow(
      /commerce rules are M6 work/,
    );
  });

  it("refuses a registry with a duplicated rule id", () => {
    expect(() => select({ registry: [robots, robots] })).toThrow(
      /declares web.discovery.robots more than once/,
    );
  });
});
