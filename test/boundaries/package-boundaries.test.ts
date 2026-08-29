import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
