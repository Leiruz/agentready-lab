import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../src/run.js";
import type { CommandResult } from "../src/result.js";
import {
  TEST_CWD,
  configPath,
  testEnvironment,
} from "./support/environment.js";

/**
 * Fixture `sec-011` (`docs/FIXTURE_CATALOG.md` section 13): "Source map is
 * absolute or contains `..`" is "Configuration rejected before scanning".
 *
 * Each rejected form gets its own case, and each case asserts the transport
 * was never constructed as well as the exit code. "Before scanning" is an
 * ordering claim, and only the counter tests the ordering.
 */

const MAP_FILE = path.join(TEST_CWD, "map.json");

async function withInlineMap(
  entries: Readonly<Record<string, string>>,
): Promise<CommandResult & { readonly factoryCalls: number }> {
  const { environment, probe } = testEnvironment({
    argv: ["check", "http://127.0.0.1:3000/"],
    files: {
      [configPath()]: JSON.stringify({ report: { sourceMap: entries } }),
    },
  });
  const result = await runCli(environment);
  return { ...result, factoryCalls: probe.factoryCalls };
}

async function withFlag(
  flagValue: string,
  fileContents?: string,
): Promise<CommandResult & { readonly factoryCalls: number }> {
  const { environment, probe } = testEnvironment({
    argv: ["check", "http://127.0.0.1:3000/", "--source-map", flagValue],
    files: fileContents === undefined ? {} : { [MAP_FILE]: fileContents },
  });
  const result = await runCli(environment);
  return { ...result, factoryCalls: probe.factoryCalls };
}

/** Every form the threat model and the fixture name, one case each. */
const REJECTED: readonly {
  readonly label: string;
  readonly value: string;
  readonly says: string;
}[] = [
  { label: "a POSIX absolute path", value: "/etc/passwd", says: "is absolute" },
  {
    label: "a backslash-rooted path",
    value: "\\windows\\system32",
    says: "is absolute",
  },
  {
    label: "a leading traversal",
    value: "../outside/robots.txt",
    says: "contains a '..' segment",
  },
  {
    label: "an interior traversal",
    value: "public/../../outside/robots.txt",
    says: "contains a '..' segment",
  },
  {
    label: "a trailing traversal",
    value: "public/robots.txt/..",
    says: "contains a '..' segment",
  },
  {
    label: "a backslash traversal",
    value: "public\\..\\..\\outside",
    says: "contains a '..' segment",
  },
  {
    label: "a Windows drive letter",
    value: "C:/windows/system32/drivers/etc/hosts",
    says: "begins with a drive letter",
  },
  {
    label: "a bare drive-relative path",
    value: "C:robots.txt",
    says: "begins with a drive letter",
  },
  {
    label: "a UNC path",
    value: "\\\\attacker\\share\\robots.txt",
    says: "is a UNC path",
  },
  {
    label: "a forward-slash UNC path",
    value: "//attacker/share/robots.txt",
    says: "is a UNC path",
  },
  {
    label: "a percent-encoded traversal",
    value: "public/%2e%2e/%2e%2e/outside",
    says: "contains a percent-encoded dot",
  },
  {
    label: "an uppercase percent-encoded traversal",
    value: "public/%2E%2E/outside",
    says: "contains a percent-encoded dot",
  },
  { label: "an empty path", value: "", says: "is empty" },
];

describe("sec-011: repository source-map paths", () => {
  for (const one of REJECTED) {
    it(`rejects ${one.label}, before scanning`, async () => {
      const result = await withInlineMap({ "/robots.txt": one.value });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(one.says);
      expect(result.factoryCalls).toBe(0);
    });
  }

  it("names the entry that was rejected", async () => {
    const result = await withInlineMap({
      "/robots.txt": "public/robots.txt",
      "/sitemap.xml": "../outside.xml",
    });
    expect(result.stderr).toContain('report.sourceMap["/sitemap.xml"]');
    expect(result.stderr).not.toContain('report.sourceMap["/robots.txt"]');
  });

  it("accepts an ordinary repository-relative path", async () => {
    const result = await withInlineMap({
      "/robots.txt": "public/robots.txt",
      "/.well-known/api-catalog": "public/.well-known/api-catalog",
    });
    // It gets past the source map and stops later, on the pinned artifacts.
    expect(result.stderr).not.toContain("sourceMap");
    expect(result.exitCode).toBe(2);
  });

  it("accepts a single-dot segment, which does not leave the repository", async () => {
    const result = await withInlineMap({
      "/robots.txt": "./public/robots.txt",
    });
    expect(result.stderr).not.toContain("sourceMap");
  });

  const BAD_KEYS: readonly { readonly key: string; readonly says: string }[] = [
    { key: "robots.txt", says: "is not origin-relative" },
    { key: "//evil.example/robots.txt", says: "is protocol-relative" },
    { key: "/a/../../robots.txt", says: "contains a '..' segment" },
    { key: "/a\\b", says: "contains a control character or a backslash" },
  ];

  for (const one of BAD_KEYS) {
    it(`rejects the key ${JSON.stringify(one.key)}`, async () => {
      const result = await withInlineMap({ [one.key]: "public/robots.txt" });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(one.says);
      expect(result.factoryCalls).toBe(0);
    });
  }

  it("rejects a non-string value", async () => {
    const { environment, probe } = testEnvironment({
      argv: ["check", "http://127.0.0.1:3000/"],
      files: {
        [configPath()]: '{"report":{"sourceMap":{"/robots.txt":["a"]}}}',
      },
    });
    const result = await runCli(environment);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("is not a string");
    expect(probe.factoryCalls).toBe(0);
  });
});

describe("--source-map", () => {
  it("applies the same path rules to its own argument", async () => {
    for (const value of [
      "/etc/map.json",
      "../map.json",
      "C:/map.json",
      "\\\\host\\share\\map.json",
    ]) {
      const result = await withFlag(value);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("--source-map");
      expect(result.factoryCalls).toBe(0);
    }
  });

  it("reports a missing file rather than scanning without a map", async () => {
    const result = await withFlag("map.json");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("which does not exist");
    expect(result.factoryCalls).toBe(0);
  });

  it("reports invalid JSON", async () => {
    const result = await withFlag("map.json", "{ not json");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("which is not valid JSON");
  });

  it("reports a JSON array, which is not a map", async () => {
    const result = await withFlag("map.json", '["/robots.txt"]');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("which is not a JSON object");
  });

  it("validates the paths inside the file it names", async () => {
    const result = await withFlag(
      "map.json",
      '{"/robots.txt": "../outside/robots.txt"}',
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("contains a '..' segment");
    expect(result.factoryCalls).toBe(0);
  });

  it("validates the configuration's map even when a flag will replace it", async () => {
    // Validation is not conditional on a value being used. A repository path
    // that escapes is a defect in the file whether or not this invocation
    // would have read it, and reporting it only sometimes would make the same
    // configuration valid or invalid depending on the command line.
    const { environment, probe } = testEnvironment({
      argv: ["check", "http://127.0.0.1:3000/", "--source-map", "map.json"],
      files: {
        [configPath()]: JSON.stringify({
          report: { sourceMap: { "/robots.txt": "../escapes/robots.txt" } },
        }),
        [MAP_FILE]: '{"/robots.txt": "public/robots.txt"}',
      },
    });
    const result = await runCli(environment);
    expect(result.stderr).toContain("contains a '..' segment");
    expect(result.exitCode).toBe(2);
    expect(probe.factoryCalls).toBe(0);
  });
});
