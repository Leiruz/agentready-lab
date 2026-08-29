import { describe, expect, it } from "vitest";

import type { AnyRuleDefinition, OutcomeKind } from "@agentready-lab/core";

import { runCli } from "../src/run.js";
import type { CommandResult } from "../src/result.js";
import {
  artifactsFor,
  fakeRule,
  testEnvironment,
} from "./support/environment.js";
import type { FakeRuleSpec } from "./support/environment.js";

/**
 * The exit-code matrix of `docs/IMPLEMENTATION_SPEC.md` section 10.1.
 *
 * These run a real scan. `runScan`, `buildReport`, `deriveRuleStatus` and both
 * reporters all execute; only the rule behaviour and the pinned artifacts are
 * injected, because `packages/rules-standard` is entirely `planned` and no
 * pinned templates exist yet. That is the honest boundary of what can be
 * tested today, and it is the whole of the CLI's own contribution: everything
 * from "a report exists" to "the process exits N" is exercised here.
 */

/**
 * An SGR introducer, built from a char code rather than written as an escape,
 * so this file stays free of the control character it is looking for.
 */
const SGR = new RegExp(`${String.fromCharCode(27)}\\[`);

async function scan(
  specs: readonly FakeRuleSpec[],
  extraArgs: readonly string[] = [],
): Promise<CommandResult & { readonly httpCalls: number }> {
  const rules = specs.map(fakeRule);
  const registry: readonly AnyRuleDefinition[] = rules.map(
    (rule) => rule.definition,
  );
  const { environment, probe } = testEnvironment({
    argv: ["check", "http://127.0.0.1:3000/", ...extraArgs],
    registry,
    pinnedArtifacts: artifactsFor(rules),
  });
  const result = await runCli(environment);
  return { ...result, httpCalls: probe.httpCalls };
}

function statusesIn(stdout: string): readonly string[] {
  const parsed: unknown = JSON.parse(stdout);
  if (typeof parsed !== "object" || parsed === null || !("results" in parsed)) {
    throw new Error("the JSON reporter did not emit a report object");
  }
  const results: unknown = parsed.results;
  if (!Array.isArray(results)) throw new Error("results is not an array");
  return results.map((result: unknown) => {
    if (
      typeof result !== "object" ||
      result === null ||
      !("status" in result)
    ) {
      throw new Error("a result carries no status");
    }
    return String(result.status);
  });
}

describe("exit codes", () => {
  it("is 0 when every enforced rule passes", async () => {
    const result = await scan([{ id: "a.b.pass", outcome: "satisfied" }]);
    expect(result.exitCode).toBe(0);
    expect(result.httpCalls).toBe(0);
  });

  it("is 1 when an enforced normative assertion is violated", async () => {
    const result = await scan([{ id: "a.b.fail", outcome: "violated" }]);
    expect(result.exitCode).toBe(1);
  });

  it("is 0 for a warning without --strict-warnings", async () => {
    const result = await scan([
      { id: "a.b.warn", outcome: "violated", requirementClass: "recommended" },
    ]);
    expect(result.exitCode).toBe(0);
  });

  it("is 1 for a warning with --strict-warnings", async () => {
    const result = await scan(
      [
        {
          id: "a.b.warn",
          outcome: "violated",
          requirementClass: "recommended",
        },
      ],
      ["--strict-warnings"],
    );
    expect(result.exitCode).toBe(1);
  });

  it("is 0 for an unable-to-check without --strict-unable", async () => {
    const result = await scan([{ id: "a.b.unable", outcome: "indeterminate" }]);
    expect(result.exitCode).toBe(0);
  });

  it("is 1 for an unable-to-check with --strict-unable", async () => {
    const result = await scan(
      [{ id: "a.b.unable", outcome: "indeterminate" }],
      ["--strict-unable"],
    );
    expect(result.exitCode).toBe(1);
  });

  it("does not let --strict-warnings promote an unable result, or the reverse", async () => {
    const unableUnderWarnings = await scan(
      [{ id: "a.b.unable", outcome: "indeterminate" }],
      ["--strict-warnings"],
    );
    const warningUnderUnable = await scan(
      [
        {
          id: "a.b.warn",
          outcome: "violated",
          requirementClass: "recommended",
        },
      ],
      ["--strict-unable"],
    );
    expect(unableUnderWarnings.exitCode).toBe(0);
    expect(warningUnderUnable.exitCode).toBe(0);
  });

  it("is 0 for a not-applicable result", async () => {
    const result = await scan([{ id: "a.b.absent", outcome: "not-present" }]);
    expect(result.exitCode).toBe(0);
  });

  /**
   * ADR-0004 section 4: "The exit code considers only results with
   * `gate: "enforced"`", and "`--strict-warnings` and `--strict-unable` do not
   * promote an informational result."
   */
  it("ignores an informational failure, under every strictness", async () => {
    for (const flags of [[], ["--strict-warnings"], ["--strict-unable"]]) {
      const result = await scan(
        [
          {
            id: "a.b.info",
            outcome: "violated",
            applicability: "informational",
          },
        ],
        [...flags, "--format", "json"],
      );
      // The failure is in the report and not in the exit code, which is what
      // `gate` exists to make explicable from the report alone.
      expect(statusesIn(result.stdout)).toStrictEqual(["fail"]);
      expect(result.exitCode).toBe(0);
    }
  });

  it("takes the worst enforced result across several rules", async () => {
    const mixed: readonly FakeRuleSpec[] = [
      { id: "a.b.one", outcome: "satisfied" },
      { id: "a.b.two", outcome: "violated" },
      { id: "a.b.three", outcome: "satisfied" },
    ];
    const result = await scan(mixed);
    expect(result.exitCode).toBe(1);
  });

  it("is 4 when a rule violates the engine contract", async () => {
    // A rule that returns no outcome for an assertion it declares is
    // `missing-assertion-outcome`, which `RuleContractViolation` carries
    // exit 4 for. The report is discarded rather than emitted: an omitted
    // assertion is the one a rule would have failed.
    const rule = fakeRule({ id: "a.b.silent", outcome: "satisfied" });
    const silent: AnyRuleDefinition = {
      ...rule.definition,
      step: () => ({ kind: "outcomes", outcomes: [] }),
    };
    const { environment } = testEnvironment({
      argv: ["check", "http://127.0.0.1:3000/"],
      registry: [silent],
      pinnedArtifacts: artifactsFor([rule]),
    });
    const result = await runCli(environment);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain(
      "rule contract violation: missing-assertion-outcome",
    );
    expect(result.stdout).toBe("");
  });

  it("puts JSON only on stdout and diagnostics only on stderr", async () => {
    const rules = [fakeRule({ id: "a.b.json", outcome: "violated" })];
    const { environment } = testEnvironment({
      argv: ["check", "http://127.0.0.1:3000/", "--format", "json"],
      registry: rules.map((rule) => rule.definition),
      pinnedArtifacts: artifactsFor(rules),
    });
    const result = await runCli(environment);

    expect(result.exitCode).toBe(1);
    // Parses whole, with no leading banner and no trailing newline.
    expect(() => JSON.parse(result.stdout) as unknown).not.toThrow();
    expect(result.stdout.endsWith("\n")).toBe(false);
    expect(statusesIn(result.stdout)).toStrictEqual(["fail"]);
    expect(result.stderr).toBe("");
  });

  it("renders human output without colour by default and with it on request", async () => {
    const rules = [fakeRule({ id: "a.b.human", outcome: "violated" })];
    const build = (argv: readonly string[]): Promise<CommandResult> =>
      runCli(
        testEnvironment({
          argv,
          registry: rules.map((rule) => rule.definition),
          pinnedArtifacts: artifactsFor(rules),
        }).environment,
      );

    const plain = await build(["check", "http://127.0.0.1:3000/"]);
    const coloured = await build([
      "check",
      "http://127.0.0.1:3000/",
      "--color",
    ]);

    expect(plain.stdout).not.toMatch(SGR);
    expect(coloured.stdout).toMatch(SGR);
    expect(plain.stdout).toContain("[x] fail");
    expect(plain.stdout).toContain("REQUIRED FAILURES (1)");
  });

  it("lets NO_COLOR override --color", async () => {
    const rules = [fakeRule({ id: "a.b.nocolor", outcome: "satisfied" })];
    const { environment } = testEnvironment({
      argv: ["check", "http://127.0.0.1:3000/", "--color"],
      env: { NO_COLOR: "1" },
      registry: rules.map((rule) => rule.definition),
      pinnedArtifacts: artifactsFor(rules),
    });
    const result = await runCli(environment);
    expect(result.stdout).not.toMatch(SGR);
  });

  it("produces byte-identical JSON across runs", async () => {
    const specs: readonly FakeRuleSpec[] = [
      { id: "a.b.one", outcome: "violated" },
      { id: "a.b.two", outcome: "satisfied" },
    ];
    const first = await scan(specs, ["--format", "json"]);
    const second = await scan(specs, ["--format", "json"]);
    expect(first.stdout).toBe(second.stdout);
  });
});

describe("outcome to status mapping reaches the exit code", () => {
  const cases: readonly {
    readonly outcome: OutcomeKind;
    readonly status: string;
  }[] = [
    { outcome: "satisfied", status: "pass" },
    { outcome: "violated", status: "fail" },
    { outcome: "not-present", status: "not-applicable" },
    { outcome: "indeterminate", status: "unable-to-check" },
  ];

  for (const one of cases) {
    it(`maps ${one.outcome} to ${one.status}`, async () => {
      const result = await scan(
        [{ id: "a.b.map", outcome: one.outcome }],
        ["--format", "json"],
      );
      expect(statusesIn(result.stdout)).toStrictEqual([one.status]);
    });
  }
});
