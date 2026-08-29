import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runCli } from "../src/run.js";
import { testEnvironment } from "./support/environment.js";

/**
 * `docs/ROADMAP.md` M1: "CLI help and exit behavior have golden tests."
 *
 * The expected documents are committed files rather than the constants the
 * source exports, which is the whole point: comparing `ROOT_HELP` with
 * `ROOT_HELP` would pass for any text at all. A change to a help document has
 * to be made twice, and the second time is where someone reads it.
 *
 * `.gitattributes` sets `* text=auto eol=lf`, so these files are LF on every
 * checkout and the comparison is byte-for-byte with no normalization.
 */

const GOLDEN = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "golden",
);

function golden(name: string): string {
  return fs.readFileSync(path.join(GOLDEN, `${name}.txt`), "utf8");
}

async function help(argv: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const { environment, probe } = testEnvironment({ argv });
  const result = await runCli(environment);
  expect(probe.factoryCalls).toBe(0);
  expect(probe.httpCalls).toBe(0);
  return result;
}

const DOCUMENTS: readonly {
  readonly name: string;
  readonly argv: readonly string[];
}[] = [
  { name: "root", argv: ["--help"] },
  { name: "root", argv: ["-h"] },
  { name: "check", argv: ["check", "--help"] },
  { name: "check", argv: ["check", "-h"] },
  // The flag is read after the URL as well as before it.
  { name: "check", argv: ["check", "http://127.0.0.1:3000/", "--help"] },
  { name: "rules", argv: ["rules", "--help"] },
  { name: "rules-list", argv: ["rules", "list", "--help"] },
  { name: "rules-explain", argv: ["rules", "explain", "--help"] },
];

describe("help documents", () => {
  for (const document of DOCUMENTS) {
    it(`'${document.argv.join(" ")}' prints the ${document.name} document`, async () => {
      const result = await help(document.argv);
      expect(result.stdout).toBe(golden(document.name));
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  }

  it("advertises no command, flag or format this build does not implement", () => {
    const everything = DOCUMENTS.map((document) => golden(document.name)).join(
      "\n",
    );
    for (const absent of [
      "report diff",
      "profiles list",
      "doctor",
      "--output",
      "--include-metadata",
      "junit",
      "github-summary",
      "sarif",
    ]) {
      expect(everything).not.toContain(absent);
    }
  });

  it("documents all five exit codes exactly once, in order", () => {
    const codes = [...golden("root").matchAll(/^ {2}([0-4]) {2}/gm)].map(
      (match) => match[1],
    );
    expect(codes).toStrictEqual(["0", "1", "2", "3", "4"]);
  });
});

describe("usage errors", () => {
  it("refuses an empty invocation with exit 2 and no help on stdout", async () => {
    const result = await help([]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("no command given");
    expect(result.stderr).toContain("agentready-lab --help");
  });

  it("refuses an unknown command", async () => {
    const result = await help(["scan"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('unknown command "scan"');
    expect(result.stderr).toContain("Known commands: check, rules.");
  });

  /**
   * `report diff`, `profiles list` and `doctor` are `IMPLEMENTATION_SPEC.md`
   * section 10 commands that later milestones own. They get the ordinary
   * unknown-command refusal and no message of their own: a tailored "not yet"
   * is an advertisement, and `CLAUDE.md` forbids implying a planned feature
   * exists.
   */
  for (const command of ["report", "profiles", "doctor"]) {
    it(`treats '${command}' as an unknown command`, async () => {
      const result = await help([command]);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(`unknown command "${command}"`);
    });
  }

  it("refuses an unknown rules subcommand", async () => {
    const result = await help(["rules", "describe"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('unknown rules subcommand "describe"');
  });

  it("refuses 'rules' with no subcommand", async () => {
    const result = await help(["rules"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("rules needs a subcommand");
  });
});
