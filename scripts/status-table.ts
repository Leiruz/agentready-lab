import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { renderStatusTable, spliceStatusTable } from "./lib/status-table.js";

/**
 * `pnpm status:check` and, with `--write`, `pnpm status:write`.
 *
 * ADR-0008 section 3 requires a CI check that regenerates the
 * `PROJECT_STATUS.md` per-rule table and fails when the checked-in file
 * differs. `--check` is that gate; it is wired into `pnpm check`.
 *
 * Same two-modes-one-entry-point shape as `scripts/validate-registry.ts`, and
 * for the same reason: the thing CI blocks on and the thing a maintainer runs
 * to regenerate must not be able to drift apart.
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const RULESET = "specs/ruleset.standard.v0.yaml";
const STATUS = "PROJECT_STATUS.md";

function main(): number {
  const rewrite = process.argv.includes("--write");

  const rulesetPath = path.join(REPO_ROOT, RULESET);
  const statusPath = path.join(REPO_ROOT, STATUS);

  const table = renderStatusTable(readFileSync(rulesetPath, "utf8"));
  const committed = readFileSync(statusPath, "utf8");
  const regenerated = spliceStatusTable(committed, table);

  if (rewrite) {
    writeFileSync(statusPath, regenerated, "utf8");
    process.stdout.write(`wrote the generated table into ${STATUS}\n`);
    return 0;
  }

  if (regenerated !== committed) {
    process.stdout.write(
      `stale-generated-table  ${STATUS}  the committed per-rule table differs from ${RULESET}; run pnpm run status:write\n`,
    );
    return 1;
  }

  process.stdout.write(`${STATUS} per-rule table is current with ${RULESET}\n`);
  return 0;
}

process.exitCode = main();
