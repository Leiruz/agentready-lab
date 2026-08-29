import { describe, expect, it } from "vitest";

import { DEFAULT_NETWORK_BUDGET } from "@agentready-lab/core";

import type { CheckFlags } from "../src/args.js";
import { parseConfig } from "../src/config/load.js";
import type { FileConfig } from "../src/config/load.js";
import { resolveSettings } from "../src/config/settings.js";
import { runCli } from "../src/run.js";
import type { CommandResult } from "../src/result.js";
import {
  configPath,
  fakeRule,
  testEnvironment,
} from "./support/environment.js";

/**
 * Configuration: what is accepted, what is refused, and in which order the two
 * combine.
 *
 * The precedence half is tested against `resolveSettings` directly rather than
 * through the command, because the effective settings are not all observable
 * in M1 output: no reporter prints the source map, and `check` stops before a
 * report exists. A merge rule that can only be checked through a report is a
 * merge rule with no test until the report arrives.
 *
 * The refusal half goes through `runCli`, with the transport counter beside
 * every case, because "configuration validation occurs before network access"
 * (`docs/ARCHITECTURE.md` section 10) is a claim about ordering.
 */

const NO_FLAGS: CheckFlags = {
  networkProfile: undefined,
  mode: undefined,
  profile: undefined,
  ruleset: undefined,
  include: undefined,
  exclude: undefined,
  format: undefined,
  sourceMap: undefined,
  strictWarnings: false,
  strictUnable: false,
  color: undefined,
};

function settingsFrom(
  json: Readonly<Record<string, unknown>>,
  flags: Partial<CheckFlags> = {},
): ReturnType<typeof resolveSettings> {
  const file: FileConfig = parseConfig(
    JSON.stringify(json),
    "agentready.config.json",
  );
  return resolveSettings({
    flags: { ...NO_FLAGS, ...flags },
    file,
    flagSourceMap: undefined,
    env: {},
  });
}

async function run(
  argv: readonly string[],
  config?: string,
): Promise<CommandResult & { readonly factoryCalls: number }> {
  const { environment, probe } = testEnvironment({
    argv,
    files: config === undefined ? {} : { [configPath()]: config },
  });
  const result = await runCli(environment);
  return { ...result, factoryCalls: probe.factoryCalls };
}

describe("precedence", () => {
  it("uses the built-in defaults when nothing else specifies a value", () => {
    const settings = settingsFrom({});
    expect(settings.profile).toBe("content");
    expect(settings.mode).toBe("spec");
    expect(settings.format).toBe("human");
    expect(settings.networkProfile).toBe("local-loopback");
    expect(settings.budget).toStrictEqual(DEFAULT_NETWORK_BUDGET);
    expect(settings.color).toBe(false);
  });

  it("lets the configuration file override a default", () => {
    const settings = settingsFrom({ profile: "api", mode: "interop" });
    expect(settings.profile).toBe("api");
    expect(settings.mode).toBe("interop");
  });

  it("lets a flag override the configuration file", () => {
    const settings = settingsFrom(
      { profile: "api", mode: "interop" },
      { profile: "full", mode: "spec" },
    );
    expect(settings.profile).toBe("full");
    expect(settings.mode).toBe("spec");
  });
});

describe("selector merge semantics", () => {
  /**
   * A deny is a safety valve. If a flag could remove an entry from
   * `rules.disable`, a repository that turned a rule off could be turned back
   * on from the command line, which is a widening, and ADR-0004 section 9
   * permits configuration to narrow and never to widen.
   */
  it("unions rules.disable with --exclude", () => {
    const settings = settingsFrom(
      { rules: { disable: ["web.discovery.robots", "web.discovery.link"] } },
      { exclude: "web.discovery.sitemap" },
    );
    expect(settings.exclude?.split(",")).toStrictEqual([
      "web.discovery.robots",
      "web.discovery.link",
      "web.discovery.sitemap",
    ]);
  });

  it("keeps a disabled rule excluded when the flag repeats it", () => {
    const settings = settingsFrom(
      { rules: { disable: ["web.discovery.robots"] } },
      { exclude: "web.discovery.robots" },
    );
    expect(settings.exclude).toBe("web.discovery.robots");
  });

  /**
   * Replace, not union: merging two include lists makes "why did this rule
   * run" unanswerable from either source alone, and an include list widens.
   */
  it("lets --include replace rules.enable entirely", () => {
    const settings = settingsFrom(
      { rules: { enable: ["web.policy.content-signals"] } },
      { include: "agent.discovery.skills" },
    );
    expect(settings.include).toBe("agent.discovery.skills");
  });

  it("falls back to rules.enable when no --include is given", () => {
    const settings = settingsFrom({
      rules: {
        enable: ["web.policy.content-signals", "agent.discovery.skills"],
      },
    });
    expect(settings.include).toBe(
      "web.policy.content-signals,agent.discovery.skills",
    );
  });

  /**
   * An empty array is not an empty selector element. `""` would be refused by
   * the grammar (ADR-0004 section 5), so an empty list has to become "no
   * selector" and not "one empty selector".
   */
  it("turns an empty array into no selector at all", () => {
    const settings = settingsFrom({ rules: { disable: [], enable: [] } });
    expect(settings.exclude).toBeUndefined();
    expect(settings.include).toBeUndefined();
  });
});

describe("network budgets", () => {
  /**
   * ADR-0004 section 9's stated exception: "the effective value is the
   * **minimum** across all sources. Configuration and rule options may lower a
   * budget and may never raise it."
   */
  it("lets the file lower a budget", () => {
    const settings = settingsFrom({ network: { maxRequests: 4 } });
    expect(settings.budget.maxRequests).toBe(4);
  });

  it("does not let the file raise a budget", () => {
    const settings = settingsFrom({
      network: {
        maxRequests: DEFAULT_NETWORK_BUDGET.maxRequests + 100,
        maxTotalDecodedBytes: DEFAULT_NETWORK_BUDGET.maxTotalDecodedBytes * 4,
      },
    });
    expect(settings.budget.maxRequests).toBe(
      DEFAULT_NETWORK_BUDGET.maxRequests,
    );
    expect(settings.budget.maxTotalDecodedBytes).toBe(
      DEFAULT_NETWORK_BUDGET.maxTotalDecodedBytes,
    );
  });

  /**
   * ADR-0005 section 1: refused rather than clamped, "because a user who
   * configured concurrency and did not get it should be told".
   *
   * The check has to be on the requested value. `lowerBudget` takes a
   * field-wise minimum, so a 2 that reached it would come out as a 1 and
   * core's own `assertSupportedConcurrency` would then see a legal value.
   */
  it("refuses maxConcurrency above 1 rather than clamping it", async () => {
    const result = await run(
      ["check", "http://127.0.0.1:3000/"],
      '{"network":{"maxConcurrency":2}}',
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("network.maxConcurrency is 2");
    expect(result.stderr).toContain(
      "refuses a higher value rather than clamping",
    );
    expect(result.factoryCalls).toBe(0);
  });

  it("accepts maxConcurrency of exactly 1", () => {
    const settings = settingsFrom({ network: { maxConcurrency: 1 } });
    expect(settings.budget.maxConcurrency).toBe(1);
  });

  it("refuses a zero or negative budget", async () => {
    for (const value of [0, -1, 1.5]) {
      const result = await run(
        ["check", "http://127.0.0.1:3000/"],
        `{"network":{"maxRequests":${String(value)}}}`,
      );
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("must be a positive integer");
      expect(result.factoryCalls).toBe(0);
    }
  });
});

describe("configuration validation happens before any transport call", () => {
  const REFUSED: readonly {
    readonly label: string;
    readonly json: string;
    readonly says: string;
  }[] = [
    { label: "malformed JSON", json: "{ nope", says: "is not valid JSON" },
    { label: "a JSON array", json: "[]", says: "must be a JSON object" },
    {
      label: "an unknown top-level key",
      json: '{"profil":"content"}',
      says: 'unknown key "profil"',
    },
    {
      label: "an unknown network key",
      json: '{"network":{"maxRedirect":2}}',
      says: 'unknown key "maxRedirect"',
    },
    {
      label: "a prototype-pollution key",
      json: '{"__proto__":{"polluted":true}}',
      says: 'unknown key "__proto__"',
    },
    {
      label: "an unknown profile",
      json: '{"profile":"everything"}',
      says: "profile does not accept",
    },
    {
      label: "a non-string mode",
      json: '{"mode":7}',
      says: "mode must be a string",
    },
    {
      label: "a non-array rules.disable",
      json: '{"rules":{"disable":"web.discovery.robots"}}',
      says: "rules.disable must be an array of selectors",
    },
    {
      label: "a non-string selector",
      json: '{"rules":{"disable":[1]}}',
      says: "rules.disable[0] must be a string",
    },
  ];

  for (const one of REFUSED) {
    it(`refuses ${one.label} with zero transport calls`, async () => {
      const result = await run(["check", "http://127.0.0.1:3000/"], one.json);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(one.says);
      expect(result.factoryCalls).toBe(0);
    });
  }

  /** ADR-0004 section 7 removed it, and silence would look like acceptance. */
  it("refuses rules.severity by name", async () => {
    const result = await run(
      ["check", "http://127.0.0.1:3000/"],
      '{"rules":{"severity":{"web.discovery.robots":"error"}}}',
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "rules.severity was removed from the configuration schema",
    );
    expect(result.stderr).toContain("ADR-0004 section 7");
    expect(result.factoryCalls).toBe(0);
  });

  /**
   * `docs/ARCHITECTURE.md` section 10 shows the key and no whole-scan deadline
   * exists. Accepting it would be accepting a security budget that does
   * nothing, which is the failure mode ADR-0005 section 1 rejects for
   * concurrency.
   */
  it("refuses network.totalTimeoutMs rather than ignoring it", async () => {
    const result = await run(
      ["check", "http://127.0.0.1:3000/"],
      '{"network":{"totalTimeoutMs":30000}}',
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "network.totalTimeoutMs is not implemented",
    );
    expect(result.factoryCalls).toBe(0);
  });

  /**
   * The same section shows `"profile": "content@0.1.0"`. Nothing in the
   * project pins a profile version, so the versioned form is refused rather
   * than parsed into a version this tool would have made up.
   */
  it("refuses the versioned profile form the documentation shows", async () => {
    const result = await run(
      ["check", "http://127.0.0.1:3000/"],
      '{"profile":"content@0.1.0"}',
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("must be a bare profile id");
    expect(result.factoryCalls).toBe(0);
  });

  it("accepts the $schema key the documented example carries", () => {
    const settings = settingsFrom({
      $schema: "./schemas/config-v1.schema.json",
      profile: "content",
    });
    expect(settings.profile).toBe("content");
  });

  it("treats an absent configuration file as no configuration", async () => {
    const result = await run(["rules", "list"]);
    expect(result.exitCode).toBe(0);
  });

  it("refuses to run when the configuration file cannot be read", async () => {
    const { environment, probe } = testEnvironment({
      argv: ["check", "http://127.0.0.1:3000/"],
      unreadable: [configPath()],
    });
    const result = await runCli(environment);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("could not be read");
    expect(probe.factoryCalls).toBe(0);
  });
});

describe("selectors are resolved before the transport exists", () => {
  // A registry with the rule the valid halves of these selectors name, so an
  // empty element is what fails rather than a zero-match on everything.
  const REGISTRY = [
    fakeRule({ id: "web.discovery.robots", outcome: "satisfied" }).definition,
  ];

  const BAD: readonly { readonly selector: string; readonly says: string }[] = [
    {
      selector: "Web.Discovery.Robots",
      says: "contains an uppercase character",
    },
    { selector: "web.*.robots", says: "is not a namespace glob" },
    { selector: "web.discovery.robots,", says: "is empty" },
    { selector: ",web.discovery.robots", says: "is empty" },
    { selector: "web.discovery.robots,,web.other", says: "is empty" },
    { selector: "web.discovery.robots@0.1.0", says: "is not a rule id" },
    { selector: "@category:", says: "is not a category name" },
    { selector: "@profile:Content", says: "contains an uppercase character" },
    { selector: "no.such.rule", says: "matches no rule in the pinned ruleset" },
    { selector: "agent.*", says: "matches no rule in the pinned ruleset" },
  ];

  for (const one of BAD) {
    it(`refuses --include ${JSON.stringify(one.selector)}`, async () => {
      const { environment, probe } = testEnvironment({
        argv: ["check", "http://127.0.0.1:3000/", "--include", one.selector],
        registry: REGISTRY,
      });
      const result = await runCli(environment);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(one.says);
      expect(probe.factoryCalls).toBe(0);
    });
  }

  it("accepts a repeated element as idempotent", async () => {
    const { environment } = testEnvironment({
      argv: [
        "check",
        "http://127.0.0.1:3000/",
        "--include",
        "web.discovery.robots,web.discovery.robots,web.*",
      ],
      registry: REGISTRY,
    });
    const result = await runCli(environment);
    // Past the selector, stopped on the pinned artifacts.
    expect(result.stderr).not.toContain("invalid-selector");
    expect(result.stderr).toContain("no pinned message templates");
  });

  it("refuses a bad selector in rules.disable too", async () => {
    const result = await run(
      ["check", "http://127.0.0.1:3000/"],
      '{"rules":{"disable":["WEB.*"]}}',
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("contains an uppercase character");
    expect(result.factoryCalls).toBe(0);
  });
});
