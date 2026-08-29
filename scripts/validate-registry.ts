import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import type { CanonicalArtifacts } from "./lib/validate-registry.js";
import { validateRegistry } from "./lib/validate-registry.js";

/**
 * `pnpm specs:validate` and, with `--write`, `pnpm specs:canonicalise`.
 *
 * One entry point for both so that the thing CI blocks on and the thing a
 * maintainer runs to regenerate cannot drift apart: regeneration is validation
 * that is also allowed to write its output.
 *
 * Run by plain `node` over the TypeScript sources (Node.js 24 strips types
 * with no flag). There is no build step, so this cannot go stale against
 * `dist`. `scripts/lib/ts-extension-resolve.js` supplies the one resolution
 * rule Node is missing; see that file.
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const REGISTRY = "specs/checks.v0.yaml";
const SCHEMA = "specs/rule.schema.json";
const CANONICAL = "specs/checks.v0.canonical.json";
const DIGEST = "specs/checks.v0.digest.txt";

function read(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function readIfPresent(relativePath: string): string | null {
  try {
    return read(relativePath);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

function write(relativePath: string, contents: string): void {
  writeFileSync(path.join(REPO_ROOT, relativePath), contents, "utf8");
}

async function main(): Promise<number> {
  const rewrite = process.argv.includes("--write");

  const committedCanonical = readIfPresent(CANONICAL);
  const committedDigest = readIfPresent(DIGEST);

  // In `--write` mode the committed artifacts are about to be replaced, so
  // comparing against them would only produce noise the run then fixes.
  const committed: CanonicalArtifacts | null =
    rewrite || committedCanonical === null || committedDigest === null
      ? null
      : { canonicalJson: committedCanonical, digest: committedDigest };

  const result = await validateRegistry({
    registryYaml: read(REGISTRY),
    schemaJson: read(SCHEMA),
    committed,
  });

  const issues = [...result.issues];
  if (!rewrite) {
    for (const [file, contents] of [
      [CANONICAL, committedCanonical],
      [DIGEST, committedDigest],
    ] as const) {
      if (contents !== null) continue;
      issues.push({
        code: "missing-generated-artifact",
        location: file,
        message: `${file} is a committed generated artifact; run pnpm specs:canonicalise`,
      });
    }
  }

  for (const issue of issues) {
    const where = issue.location === "" ? "(root)" : issue.location;
    process.stdout.write(`${issue.code}  ${where}  ${issue.message}\n`);
  }

  if (rewrite) {
    // Refuse to bake a broken registry into the generated artifacts. A
    // staleness issue is the one thing this mode is allowed to resolve, and in
    // this mode it is never reported.
    if (issues.length > 0 || result.artifacts === null) {
      process.stdout.write(
        `\nrefusing to write: ${String(issues.length)} issue(s) must be fixed first\n`,
      );
      return 1;
    }
    write(CANONICAL, result.artifacts.canonicalJson);
    write(DIGEST, `${result.artifacts.digest}\n`);
    process.stdout.write(
      `wrote ${CANONICAL} (${String(result.artifacts.canonicalJson.length)} chars) and ${DIGEST}\n${result.artifacts.digest}\n`,
    );
    return 0;
  }

  if (issues.length > 0) {
    process.stdout.write(
      `\n${String(issues.length)} issue(s) in ${REGISTRY}\n`,
    );
    return 1;
  }

  process.stdout.write(
    `${REGISTRY} is valid: 22 checks, canonical artifacts current\n${result.artifacts?.digest ?? ""}\n`,
  );
  return 0;
}

process.exitCode = await main();
