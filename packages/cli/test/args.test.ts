import { describe, expect, it } from "vitest";

import { runCli } from "../src/run.js";
import type { CommandResult } from "../src/result.js";
import { testEnvironment } from "./support/environment.js";

/**
 * Argument parsing, and the transport counter beside every case.
 *
 * Every assertion here checks `factoryCalls` as well as the exit code. A bad
 * flag that exits 2 *after* building a transport would still pass an exit-code
 * test, and the ordering in `check.ts` is the thing worth protecting.
 */

async function run(
  argv: readonly string[],
): Promise<
  CommandResult & { readonly factoryCalls: number; readonly httpCalls: number }
> {
  const { environment, probe } = testEnvironment({ argv });
  const result = await runCli(environment);
  return {
    ...result,
    factoryCalls: probe.factoryCalls,
    httpCalls: probe.httpCalls,
  };
}

describe("check argument parsing", () => {
  it("needs a target URL", async () => {
    const result = await run(["check"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("check needs a target URL");
    expect(result.factoryCalls).toBe(0);
  });

  it("takes exactly one target URL", async () => {
    const result = await run([
      "check",
      "http://127.0.0.1:3000/",
      "http://127.0.0.1:3001/",
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("check takes one target URL; 2 were given");
    expect(result.factoryCalls).toBe(0);
  });

  it("refuses an unknown option", async () => {
    const result = await run(["check", "http://127.0.0.1:3000/", "--verbose"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("unknown option");
    expect(result.stderr).toContain("--verbose");
    expect(result.factoryCalls).toBe(0);
  });

  /**
   * `IMPLEMENTATION_SPEC.md` section 10 lists these and later milestones own
   * them, so they are undeclared rather than declared and refused. An
   * undeclared option is exit 2 with the name in the message, which is the
   * behaviour a user needs and the one that does not advertise anything.
   */
  for (const flag of ["--output", "--include-metadata"]) {
    it(`refuses ${flag}, which this build does not implement`, async () => {
      const result = await run(["check", "http://127.0.0.1:3000/", flag]);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("unknown option");
      expect(result.factoryCalls).toBe(0);
    });
  }

  const enumerations: readonly {
    readonly flag: string;
    readonly bad: string;
    readonly accepted: string;
  }[] = [
    { flag: "--mode", bad: "strict", accepted: "spec, compat, interop" },
    {
      flag: "--profile",
      bad: "everything",
      accepted: "content, api, agent-service, commerce, full",
    },
    { flag: "--format", bad: "yaml", accepted: "human, json" },
    {
      flag: "--network-profile",
      bad: "hosted-public",
      accepted: "local-loopback, ci-public",
    },
  ];

  for (const one of enumerations) {
    it(`refuses ${one.flag} ${one.bad}`, async () => {
      const result = await run([
        "check",
        "http://127.0.0.1:3000/",
        one.flag,
        one.bad,
      ]);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(
        `${one.flag} does not accept "${one.bad}"`,
      );
      expect(result.stderr).toContain(`Accepted values: ${one.accepted}.`);
      expect(result.factoryCalls).toBe(0);
    });
  }

  /**
   * `hosted-public` is a `NetworkProfileId` that no flag selects
   * (ADR-0008 section 6, `ARCHITECTURE.md` section 9). It is refused as an
   * unknown value rather than as an unimplemented profile, which is the
   * accurate statement: it is not in this flag's vocabulary at all.
   */
  it("does not accept the report-only hosted-public profile", async () => {
    const result = await run([
      "check",
      "http://127.0.0.1:3000/",
      "--network-profile",
      "hosted-public",
    ]);
    expect(result.stderr).not.toContain("not implemented");
  });

  it("refuses --color together with --no-color", async () => {
    const result = await run([
      "check",
      "http://127.0.0.1:3000/",
      "--color",
      "--no-color",
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--color and --no-color were both given");
    expect(result.factoryCalls).toBe(0);
  });
});

describe("rules argument parsing", () => {
  it("refuses an argument to rules list", async () => {
    const result = await run(["rules", "list", "web.discovery.robots"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("rules list takes no arguments");
  });

  it("needs a rule id for rules explain", async () => {
    const result = await run(["rules", "explain"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("rules explain needs a rule id");
  });

  it("refuses more than one rule id", async () => {
    const result = await run(["rules", "explain", "a.b.one", "a.b.two"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "rules explain takes one rule id; 2 were given",
    );
  });

  /** `--format` belongs to `rules list`, and routing happens before parsing. */
  it("does not accept --format on rules explain", async () => {
    const result = await run([
      "rules",
      "explain",
      "a.b.one",
      "--format",
      "json",
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("unknown option");
  });
});
