import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  renderStatusTable,
  spliceStatusTable,
} from "../../../scripts/lib/status-table.js";

/**
 * ADR-0008 section 3's CI check, as a merge-blocking test.
 *
 * `pnpm run status:check` is the same gate with a filesystem and an exit code,
 * and it is wired into `pnpm check`. This exists as well because
 * `.github/workflows/ci.yml` runs its steps individually and does not run
 * `pnpm check`, so a script-only gate would be one CI never executes. Step 4
 * runs `pnpm test`, so putting the gate here is what makes it real today.
 *
 * It lives under `packages/core/test/` for the same reason
 * `registry-validation.test.ts` does: that is the one vitest project running
 * repository-level scripts, and `vitest.config.ts` is owned elsewhere. Neither
 * test is about `packages/core`, and a `repo` project would be a better home
 * for both.
 */

function readRepoFile(relative: string): string {
  return readFileSync(new URL(`../../../${relative}`, import.meta.url), "utf8");
}

const RULESET = readRepoFile("specs/ruleset.standard.v0.yaml");
const STATUS = readRepoFile("PROJECT_STATUS.md");

describe("the generated per-rule implementation-status table", () => {
  it("matches what the committed PROJECT_STATUS.md carries", () => {
    expect(spliceStatusTable(STATUS, renderStatusTable(RULESET))).toBe(STATUS);
  });

  it("reports every rule in the ruleset, in file order", () => {
    const table = renderStatusTable(RULESET);
    const rows = table
      .split("\n")
      .filter((line) => line.startsWith("| `"))
      .map((line) => line.split("|")[1]?.trim());
    expect(rows).toHaveLength(22);
    expect(rows[0]).toBe("`web.discovery.robots`");
    expect(rows[21]).toBe("`commerce.payment.ap2`");
  });

  it("does not let a hand-edited status pass", () => {
    // ADR-0008 section 3: `PROJECT_STATUS.md` is a summary and never a
    // competing source of truth. Claiming a rule is `supported` while the
    // ruleset says `planned` is exactly the drift the gate exists to stop.
    //
    // The row is one of the fourteen rules outside M1, whose assertions cite
    // no source yet and which therefore cannot be implemented before that
    // changes. An M1 row would make this test fail on the day its rule was
    // finished, which is a true status change and not drift.
    const drifted = STATUS.replace(
      "| `commerce.payment.ap2` | 0.1.0 | planned | experimental |",
      "| `commerce.payment.ap2` | 0.1.0 | supported | experimental |",
    );
    expect(drifted).not.toBe(STATUS);
    expect(spliceStatusTable(drifted, renderStatusTable(RULESET))).not.toBe(
      drifted,
    );
  });

  it("refuses to guess where the table belongs when the markers are gone", () => {
    expect(() =>
      spliceStatusTable("# Project Status\n", renderStatusTable(RULESET)),
    ).toThrow(/missing the/);
  });

  it("rejects a ruleset with no rules array rather than emitting an empty table", () => {
    expect(() => renderStatusTable('schema_version: "0"\n')).toThrow(
      /no rules array/,
    );
  });
});
