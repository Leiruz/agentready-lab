import { describe, expect, it } from "vitest";

import { runCli } from "../src/run.js";
import {
  artifactsFor,
  fakeRule,
  testEnvironment,
} from "./support/environment.js";

/**
 * The two reasons `check` cannot complete against the production wiring, and
 * the guarantee that each of them is decided before a request.
 *
 * Both are temporary and neither is a stub. The first disappears rule by rule
 * as `implementationStatus` moves off `planned`; the second disappears when
 * the pinned templates and remediation text `docs/ROADMAP.md` M1 lists arrive.
 * Nothing has to remember to delete either check, and the tests below are what
 * will fail if one of them outlives its condition.
 */

describe("a selected rule that is not implemented", () => {
  it("refuses the scan, names the rules, and issues no request", async () => {
    const rules = [
      fakeRule({ id: "a.b.done", outcome: "satisfied" }),
      fakeRule({
        id: "a.b.todo",
        outcome: "satisfied",
        implementationStatus: "planned",
      }),
    ];
    const { environment, probe } = testEnvironment({
      argv: ["check", "http://127.0.0.1:3000/"],
      registry: rules.map((rule) => rule.definition),
      pinnedArtifacts: artifactsFor(rules),
    });

    const result = await runCli(environment);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "1 of the selected rules are declared and not implemented",
    );
    expect(result.stderr).toContain("Planned: a.b.todo.");
    expect(result.stderr).toContain("a verdict nothing computed");
    expect(result.stdout).toBe("");
    expect(probe.httpCalls).toBe(0);
  });

  it("does not refuse a planned rule the profile does not select", async () => {
    const rules = [
      fakeRule({ id: "a.b.done", outcome: "satisfied", profiles: ["content"] }),
      fakeRule({
        id: "a.b.elsewhere",
        outcome: "satisfied",
        implementationStatus: "planned",
        profiles: ["api"],
      }),
    ];
    const { environment } = testEnvironment({
      argv: ["check", "http://127.0.0.1:3000/", "--profile", "content"],
      registry: rules.map((rule) => rule.definition),
      pinnedArtifacts: artifactsFor(rules),
    });

    const result = await runCli(environment);
    expect(result.exitCode).toBe(0);
  });

  it("lets --exclude remove a planned rule so the rest can run", async () => {
    const rules = [
      fakeRule({ id: "a.b.done", outcome: "satisfied" }),
      fakeRule({
        id: "a.b.todo",
        outcome: "satisfied",
        implementationStatus: "planned",
      }),
    ];
    const { environment } = testEnvironment({
      argv: ["check", "http://127.0.0.1:3000/", "--exclude", "a.b.todo"],
      registry: rules.map((rule) => rule.definition),
      pinnedArtifacts: artifactsFor(rules),
    });

    const result = await runCli(environment);
    expect(result.exitCode).toBe(0);
  });

  /** ADR-0004 section 6: `--include` naming a planned rule is core's exit 2. */
  it("reports core's own refusal when --include names a planned rule", async () => {
    const rules = [
      fakeRule({
        id: "a.b.todo",
        outcome: "satisfied",
        implementationStatus: "planned",
        profiles: ["api"],
      }),
    ];
    const { environment, probe } = testEnvironment({
      argv: ["check", "http://127.0.0.1:3000/", "--include", "a.b.todo"],
      registry: rules.map((rule) => rule.definition),
      pinnedArtifacts: artifactsFor(rules),
    });

    const result = await runCli(environment);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "configuration refused: include-unimplemented-rule",
    );
    expect(probe.httpCalls).toBe(0);
  });
});

describe("missing pinned artifacts", () => {
  it("refuses the scan and explains why they are not synthesised", async () => {
    const rules = [fakeRule({ id: "a.b.done", outcome: "satisfied" })];
    const { environment, probe } = testEnvironment({
      argv: ["check", "http://127.0.0.1:3000/"],
      registry: rules.map((rule) => rule.definition),
      pinnedArtifacts: undefined,
    });

    const result = await runCli(environment);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "no pinned message templates or remediation table",
    );
    expect(result.stderr).toContain("ADR-0007 sections 1 and 3");
    expect(result.stderr).toContain("compare a rule with itself");
    expect(result.stdout).toBe("");
    expect(probe.httpCalls).toBe(0);
  });
});

describe("--ruleset", () => {
  it("accepts the version this build pins", async () => {
    const rules = [fakeRule({ id: "a.b.done", outcome: "satisfied" })];
    const { environment } = testEnvironment({
      argv: ["check", "http://127.0.0.1:3000/", "--ruleset", "0.0.1"],
      registry: rules.map((rule) => rule.definition),
      pinnedArtifacts: artifactsFor(rules),
    });
    expect((await runCli(environment)).exitCode).toBe(0);
  });

  it("refuses any other version, before the transport is built", async () => {
    const rules = [fakeRule({ id: "a.b.done", outcome: "satisfied" })];
    const { environment, probe } = testEnvironment({
      argv: ["check", "http://127.0.0.1:3000/", "--ruleset", "9.9.9"],
      registry: rules.map((rule) => rule.definition),
      pinnedArtifacts: artifactsFor(rules),
    });

    const result = await runCli(environment);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      '--ruleset "9.9.9" is not the ruleset this build pins',
    );
    expect(result.stderr).toContain('This build carries "0.0.1"');
    expect(probe.factoryCalls).toBe(0);
  });
});

describe("--profile commerce", () => {
  /** ADR-0004 section 10, raised by core's own selector. */
  it("is refused, with core's two reasons, before any request", async () => {
    const rules = [fakeRule({ id: "a.b.done", outcome: "satisfied" })];
    const { environment, probe } = testEnvironment({
      argv: ["check", "http://127.0.0.1:3000/", "--profile", "commerce"],
      registry: rules.map((rule) => rule.definition),
      pinnedArtifacts: artifactsFor(rules),
    });

    const result = await runCli(environment);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "configuration refused: commerce-profile-unavailable",
    );
    expect(probe.httpCalls).toBe(0);
  });
});

describe("--mode compat", () => {
  /**
   * ADR-0007 section 1 requires an external snapshot in `compat` mode. Nothing
   * loads `specs/checks.v0.yaml` at run time, so the pinned artifacts carry no
   * snapshot and core refuses the combination. Recorded as a test rather than
   * left to be discovered, because the flag is accepted by the parser and the
   * refusal comes later.
   */
  it("is refused while no external snapshot is pinned", async () => {
    const rules = [fakeRule({ id: "a.b.done", outcome: "satisfied" })];
    const { environment, probe } = testEnvironment({
      argv: ["check", "http://127.0.0.1:3000/", "--mode", "compat"],
      registry: rules.map((rule) => rule.definition),
      pinnedArtifacts: artifactsFor(rules),
    });

    const result = await runCli(environment);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "configuration refused: external-snapshot-mode-mismatch",
    );
    expect(probe.httpCalls).toBe(0);
  });
});
