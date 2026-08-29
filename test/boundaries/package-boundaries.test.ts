import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

// docs/TEST_STRATEGY.md section 4 requires the package-direction checks to be
// proven before runtime code is added, using a small check rather than a large
// architectural framework. This is that check. It is a test and not a lint
// rule on purpose: lint can be silenced with a comment on the offending line.

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/** docs/ARCHITECTURE.md section 4. Values are workspace packages only. */
const ALLOWED_WORKSPACE_DEPENDENCIES: Readonly<
  Record<string, readonly string[]>
> = {
  "@agentready-lab/core": [],
  "@agentready-lab/rules-standard": ["@agentready-lab/core"],
  "@agentready-lab/transport-node": ["@agentready-lab/core"],
  "@agentready-lab/reporters": ["@agentready-lab/core"],
  "@agentready-lab/testkit": ["@agentready-lab/core"],
  "@agentready-lab/cli": [
    "@agentready-lab/core",
    "@agentready-lab/reporters",
    "@agentready-lab/rules-standard",
    "@agentready-lab/transport-node",
  ],
  "@agentready-lab/github-action": [
    "@agentready-lab/core",
    "@agentready-lab/reporters",
    "@agentready-lab/rules-standard",
    "@agentready-lab/transport-node",
  ],
  "fixtures-worker": [],
};

/**
 * `"types": []` with `"lib": ["ES2023"]` is what makes `fetch`, `process`,
 * `require`, `setTimeout`, `Buffer` and `window` undeclared identifiers, which
 * is the structural half of the runtime-neutrality invariant.
 */
const REQUIRED_TSCONFIG_TYPES: Readonly<Record<string, readonly string[]>> = {
  "packages/core": [],
  "packages/rules-standard": [],
  "packages/reporters": [],
  "packages/transport-node": ["node"],
  "packages/cli": ["node"],
  "packages/github-action": ["node"],
  "packages/testkit": ["node"],
  "apps/fixtures-worker": ["@cloudflare/workers-types"],
};

interface Manifest {
  readonly name?: string;
  readonly version?: string;
  readonly private?: boolean;
  readonly bin?: unknown;
  readonly dependencies?: Readonly<Record<string, string>>;
}

function readJson(relativePath: string): unknown {
  const text = readFileSync(path.join(repoRoot, relativePath), "utf8");
  // tsconfig files carry comments; package.json files do not. Strip nothing:
  // every file this helper reads is plain JSON.
  return JSON.parse(text);
}

function readManifest(packageDir: string): Manifest {
  return readJson(path.posix.join(packageDir, "package.json")) as Manifest;
}

function listPackageDirs(): readonly string[] {
  const workspace = parseYaml(
    readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8"),
  ) as { readonly packages?: readonly string[] };

  const globs = workspace.packages ?? [];
  return globs
    .map((glob) => glob.replace(/\/\*$/, ""))
    .flatMap((parent) =>
      readdirSync(path.join(repoRoot, parent), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.posix.join(parent, entry.name)),
    )
    .sort();
}

const packageDirs = listPackageDirs();

describe("workspace shape", () => {
  it("discovers exactly the eight declared projects", () => {
    expect(packageDirs).toStrictEqual([
      "apps/fixtures-worker",
      "packages/cli",
      "packages/core",
      "packages/github-action",
      "packages/reporters",
      "packages/rules-standard",
      "packages/testkit",
      "packages/transport-node",
    ]);
  });

  it.each(packageDirs)("%s is private and unpublishable", (dir) => {
    const manifest = readManifest(dir);
    // docs/IMPLEMENTATION_SPEC.md section 25 leaves the npm scope open, so
    // nothing here may be publishable yet.
    expect(manifest.private).toBe(true);
    expect(manifest.version).toBe("0.0.0");
  });

  it("does not give the CLI a bin entry before the M1 check command", () => {
    expect(readManifest("packages/cli").bin).toBeUndefined();
  });
});

describe("dependency direction", () => {
  it.each(packageDirs)("%s declares only permitted workspace deps", (dir) => {
    const manifest = readManifest(dir);
    const name = manifest.name ?? "";
    const allowed = ALLOWED_WORKSPACE_DEPENDENCIES[name];

    expect(allowed, `unknown workspace package ${name}`).toBeDefined();

    const declared = Object.keys(manifest.dependencies ?? {})
      .filter((dep) => dep.startsWith("@agentready-lab/"))
      .sort();

    expect(declared).toStrictEqual([...(allowed ?? [])].sort());
  });

  it("has no dependency cycle between workspace packages", () => {
    const graph = new Map<string, readonly string[]>(
      Object.entries(ALLOWED_WORKSPACE_DEPENDENCIES),
    );
    const visiting = new Set<string>();
    const done = new Set<string>();

    const walk = (node: string, trail: readonly string[]): void => {
      if (done.has(node)) return;
      expect(
        visiting.has(node),
        `cycle: ${[...trail, node].join(" -> ")}`,
      ).toBe(false);
      visiting.add(node);
      for (const next of graph.get(node) ?? []) walk(next, [...trail, node]);
      visiting.delete(node);
      done.add(node);
    };

    for (const node of graph.keys()) walk(node, []);
  });

  it("keeps the fixture Worker free of every runtime dependency", () => {
    // docs/ARCHITECTURE.md section 4: fixtures-worker must not import a
    // Node-only package. The cheapest way to guarantee that is to let it
    // depend on nothing at all.
    expect(readManifest("apps/fixtures-worker").dependencies).toBeUndefined();
  });
});

describe("type environment", () => {
  it.each(Object.entries(REQUIRED_TSCONFIG_TYPES))(
    "%s pins its tsconfig types to the declared runtime",
    (dir, expected) => {
      const tsconfig = readJson(path.posix.join(dir, "tsconfig.json")) as {
        readonly compilerOptions?: { readonly types?: readonly string[] };
      };
      expect(tsconfig.compilerOptions?.types).toStrictEqual(expected);
    },
  );

  it.each(["packages/core/src", "packages/rules-standard/src"])(
    "%s imports no node: builtin",
    (dir) => {
      const offenders = readdirSync(path.join(repoRoot, dir), {
        recursive: true,
        withFileTypes: true,
      })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
        .filter((entry) =>
          /["']node:/.test(
            readFileSync(path.join(entry.parentPath, entry.name), "utf8"),
          ),
        )
        .map((entry) => path.join(entry.parentPath, entry.name));

      expect(offenders).toStrictEqual([]);
    },
  );
});

/**
 * ADR-0002's implementation constraints: the rule package pins
 * `lib: ["ES2023"], types: []`, and a compile test asserts that
 * `AbortSignal`, `URL`, `fetch` and `process` are unresolvable there.
 *
 * The value is the diagnostic code TypeScript actually reports. Three are
 * TS2304. `process` is TS2591, the "install @types/node" wording of the same
 * cannot-find-name failure, which TypeScript prefers for a known Node global
 * once a `types` field is present. Pinning each code keeps a change in which
 * error is reported visible rather than silent.
 */
const UNRESOLVABLE_IN_RULES: Readonly<Record<string, number>> = {
  AbortSignal: 2304,
  URL: 2304,
  fetch: 2304,
  process: 2591,
};

interface ProbeDiagnostic {
  readonly code: number;
  readonly message: string;
}

/**
 * Type-checks `export const probe: unknown = <name>;` as a source file of
 * `packageDir`, under that package's own compiler options and its own ambient
 * declaration files, both read from its `tsconfig.json` rather than restated
 * here. Re-adding `types/runtime-neutral-globals.d.ts` to the rule package
 * therefore changes what the probe compiles against.
 *
 * Only the declaration files the config contributes are program roots: a
 * global name resolves or does not without reference to the package's own
 * sources, and compiling those would make this fail for unrelated reasons.
 * The probe file exists in memory only and is never written to the package.
 */
function probeGlobal(
  packageDir: string,
  name: string,
): readonly ProbeDiagnostic[] {
  const configPath = path.join(repoRoot, packageDir, "tsconfig.json");
  const configFile = ts.readConfigFile(
    configPath,
    // `.bind` because a bare `ts.sys.readFile` is an unbound method.
    ts.sys.readFile.bind(ts.sys),
  );
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath),
  );

  const probePath = path.join(repoRoot, packageDir, "src", "globals.probe.ts");
  const probeText = `export const probe: unknown = ${name};\n`;
  const isProbe = (fileName: string): boolean =>
    path.resolve(fileName) === probePath;

  const host = ts.createCompilerHost(parsed.options, true);
  const readSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, createNew) =>
    isProbe(fileName)
      ? ts.createSourceFile(fileName, probeText, languageVersion, true)
      : readSourceFile(fileName, languageVersion, onError, createNew);

  const program = ts.createProgram({
    rootNames: [
      ...parsed.fileNames.filter((fileName) => fileName.endsWith(".d.ts")),
      probePath,
    ],
    options: parsed.options,
    host,
  });

  return program
    .getSemanticDiagnostics()
    .filter(({ file }) => file !== undefined && isProbe(file.fileName))
    .map((diagnostic) => ({
      code: diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
    }));
}

describe("rule package globals", () => {
  // The type environment block above proves the tsconfig settings; this one
  // proves what they do. `packages/core` keeps
  // `types/runtime-neutral-globals.d.ts` and `packages/rules-standard` does
  // not, which is the entire difference between the two packages below.

  it.each(Object.entries(UNRESOLVABLE_IN_RULES))(
    "%s cannot be named in packages/rules-standard",
    (name, code) => {
      const diagnostics = probeGlobal("packages/rules-standard", name);

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.code).toBe(code);
      expect(diagnostics[0]?.message).toContain(`Cannot find name '${name}'.`);
    },
  );

  it("still resolves URL in packages/core", () => {
    // Without this control the four cases above would pass just as well if
    // the probe compiled nothing at all. `URL` is a pure parser with no I/O
    // that core needs for `context.resolve()`; rules never construct one.
    expect(probeGlobal("packages/core", "URL")).toStrictEqual([]);
  });
});

describe("supply-chain settings", () => {
  // docs/THREAT_MODEL.md section 22. These are one-line deletions away from
  // being gone, and nothing else in the repo would notice.
  const workspace = parseYaml(
    readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8"),
  ) as {
    readonly onlyBuiltDependencies?: readonly string[];
    readonly strictPeerDependencies?: boolean;
    readonly minimumReleaseAge?: number;
  };

  it("keeps dependency build scripts on an explicit allow-list", () => {
    expect(workspace.onlyBuiltDependencies).toStrictEqual([]);
  });

  it("fails installs on unmet peer ranges", () => {
    expect(workspace.strictPeerDependencies).toBe(true);
  });

  it("quarantines freshly published releases for at least a day", () => {
    expect(workspace.minimumReleaseAge).toBeGreaterThanOrEqual(1440);
  });
});
