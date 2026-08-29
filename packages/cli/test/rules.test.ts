import { describe, expect, it } from "vitest";

import { STANDARD_RULESET } from "@agentready-lab/rules-standard";

import { runCli } from "../src/run.js";
import type { CommandResult } from "../src/result.js";
import { fakeRule, testEnvironment } from "./support/environment.js";

/**
 * `rules list` and `rules explain`.
 *
 * The output assertions run against an injected registry, so they say what
 * they mean without depending on eight rules that are being written in
 * parallel. One smoke test runs against the real pinned ruleset and asserts
 * only what is stable about it: which ids it carries. It deliberately does not
 * assert an implementation status, because every one of those is expected to
 * change.
 */

const REGISTRY = [
  fakeRule({
    id: "web.discovery.alpha",
    outcome: "satisfied",
    category: "discoverability",
    profiles: ["content", "full"],
  }).definition,
  fakeRule({
    id: "web.policy.beta",
    outcome: "satisfied",
    applicability: "informational",
    implementationStatus: "planned",
    category: "bot-access-control",
    profiles: ["api", "full"],
  }).definition,
];

async function run(argv: readonly string[]): Promise<CommandResult> {
  const { environment, probe } = testEnvironment({ argv, registry: REGISTRY });
  const result = await runCli(environment);
  expect(probe.factoryCalls).toBe(0);
  return result;
}

interface ListedRule {
  readonly ruleId: string;
  readonly gate: string;
  readonly applicability: string;
  readonly implementationStatus: string;
  readonly profiles: readonly string[];
}

function parseList(stdout: string): readonly ListedRule[] {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed))
    throw new Error("rules list json is not an array");
  return parsed.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("a listed rule is not an object");
    }
    const record: Readonly<Record<string, unknown>> = { ...entry };
    return {
      ruleId: String(record["ruleId"]),
      gate: String(record["gate"]),
      applicability: String(record["applicability"]),
      implementationStatus: String(record["implementationStatus"]),
      profiles: Array.isArray(record["profiles"])
        ? record["profiles"].map(String)
        : [],
    };
  });
}

describe("rules list", () => {
  /**
   * ADR-0004's implementation constraints: "`agentready-lab rules list` prints
   * `rule_id`, category, profiles, applicability using the native names, and
   * gate, so a selector can be written without reading YAML."
   */
  it("prints every field the decision requires", async () => {
    const result = await run(["rules", "list"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");

    for (const heading of [
      "RULE",
      "VERSION",
      "STATUS",
      "APPLICABILITY",
      "GATE",
      "CATEGORY",
      "MODES",
      "PROFILES",
    ]) {
      expect(result.stdout).toContain(heading);
    }
    expect(result.stdout).toContain("web.discovery.alpha");
    expect(result.stdout).toContain("discoverability");
    expect(result.stdout).toContain("content full");
  });

  it("uses the native applicability names, not the snapshot's", async () => {
    const result = await run(["rules", "list"]);
    // ADR-0004 section 2 renames these. The published strings must not appear.
    expect(result.stdout).not.toContain("opt-in");
    expect(result.stdout).not.toContain("commerce-opt-in");
    expect(result.stdout).toContain("informational");
    expect(result.stdout).toContain("applicable");
  });

  /** ADR-0004 section 4: only an `enforced` result reaches the exit code. */
  it("derives the gate from applicability", async () => {
    const listed = parseList(
      (await run(["rules", "list", "--format", "json"])).stdout,
    );
    expect(
      listed.find((rule) => rule.ruleId === "web.discovery.alpha")?.gate,
    ).toBe("enforced");
    expect(listed.find((rule) => rule.ruleId === "web.policy.beta")?.gate).toBe(
      "informational",
    );
  });

  /**
   * Section 6 makes a selector naming a `planned` rule exit 2, so the field
   * that decides it has to be visible here or the listing sends a reader back
   * to the YAML the constraint exists to avoid.
   */
  it("prints implementation status and says what it costs", async () => {
    const result = await run(["rules", "list"]);
    expect(result.stdout).toContain("planned");
    expect(result.stdout).toContain("supported");
    expect(result.stdout).toContain("1 of the 2 listed rules are implemented");
    expect(result.stdout).toContain("ADR-0004 section 6");
  });

  it("filters by profile", async () => {
    const listed = parseList(
      (await run(["rules", "list", "--profile", "api", "--format", "json"]))
        .stdout,
    );
    expect(listed.map((rule) => rule.ruleId)).toStrictEqual([
      "web.policy.beta",
    ]);
  });

  it("filters by mode", async () => {
    const spec = parseList(
      (await run(["rules", "list", "--mode", "spec", "--format", "json"]))
        .stdout,
    );
    const compat = parseList(
      (await run(["rules", "list", "--mode", "compat", "--format", "json"]))
        .stdout,
    );
    expect(spec).toHaveLength(2);
    expect(compat).toHaveLength(0);
  });

  it("says so rather than printing an empty table when nothing matches", async () => {
    const result = await run(["rules", "list", "--mode", "compat"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "no rule in the pinned ruleset matches that filter",
    );
  });

  /** ADR-0004 section 10. */
  it("refuses --profile commerce", async () => {
    const result = await run(["rules", "list", "--profile", "commerce"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--profile commerce is refused in M1");
    expect(result.stderr).toContain("ADR-0004 section 10");
  });

  it("emits canonical JSON with sorted keys and no trailing newline", async () => {
    const result = await run(["rules", "list", "--format", "json"]);
    expect(result.stdout.endsWith("\n")).toBe(false);
    expect(result.stderr).toBe("");
    const first = result.stdout;
    const second = (await run(["rules", "list", "--format", "json"])).stdout;
    expect(first).toBe(second);
    // RFC 8785 sorts object keys, so `applicability` precedes `ruleId`.
    expect(first.indexOf('"applicability"')).toBeLessThan(
      first.indexOf('"ruleId"'),
    );
  });
});

describe("rules explain", () => {
  it("prints the rule's pinned metadata, assertions and sources", async () => {
    const result = await run(["rules", "explain", "web.discovery.alpha"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("web.discovery.alpha 0.1.0");
    expect(result.stdout).toContain("ASSERTIONS");
    expect(result.stdout).toContain("web.discovery.alpha.one");
    expect(result.stdout).toContain("class         normative");
    expect(result.stdout).toContain("PINNED SOURCES");
    expect(result.stdout).toContain("https://example.invalid/spec");
    expect(result.stdout).toContain("verified 2026-08-29");
  });

  it("says when a rule is declared and not implemented", async () => {
    const result = await run(["rules", "explain", "web.policy.beta"]);
    expect(result.stdout).toContain("status          planned");
    expect(result.stdout).toContain(
      "This rule is declared and not implemented",
    );
  });

  it("does not add that note for an implemented rule", async () => {
    const result = await run(["rules", "explain", "web.discovery.alpha"]);
    expect(result.stdout).not.toContain("declared and not implemented");
  });

  it("refuses an unknown rule id", async () => {
    const result = await run(["rules", "explain", "web.discovery.nope"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      'no rule in the pinned ruleset has the id "web.discovery.nope"',
    );
    expect(result.stderr).toContain("agentready-lab rules list");
  });

  it("refuses a selector, which is not a rule id", async () => {
    const result = await run(["rules", "explain", "web.*"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("no rule in the pinned ruleset has the id");
  });
});

describe("against the real pinned ruleset", () => {
  const EXPECTED_IDS: readonly string[] = [
    "web.discovery.robots",
    "web.discovery.sitemap",
    "web.discovery.link",
    "web.content.markdown-negotiation",
    "web.policy.ai-crawler",
    "web.policy.content-signals",
    "agent.discovery.skills",
    "web.discovery.api-catalog",
  ];

  it("lists the eight M1 rules in registry order", async () => {
    const { environment } = testEnvironment({
      argv: ["rules", "list", "--format", "json"],
      registry: STANDARD_RULESET,
    });
    const result = await runCli(environment);
    expect(result.exitCode).toBe(0);
    expect(parseList(result.stdout).map((rule) => rule.ruleId)).toStrictEqual(
      EXPECTED_IDS,
    );
  });

  it("explains each of them", async () => {
    for (const id of EXPECTED_IDS) {
      const { environment } = testEnvironment({
        argv: ["rules", "explain", id],
        registry: STANDARD_RULESET,
      });
      const result = await runCli(environment);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(id);
      expect(result.stdout).toContain("PINNED SOURCES");
    }
  });
});
