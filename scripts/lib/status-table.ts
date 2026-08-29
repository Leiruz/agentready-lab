import { parse } from "yaml";

/**
 * The generated per-rule implementation-status table of ADR-0008 section 3.
 *
 * `implementation_status` in `specs/ruleset.standard.v0.yaml` is the single
 * machine-readable authority. `PROJECT_STATUS.md` keeps its project-wide phase
 * prose and carries this table as a summary, regenerated and compared by CI so
 * it can never become a competing source of truth.
 *
 * Source maturity is printed beside implementation status on purpose. They are
 * different vocabularies over different subjects, `.claude/rules/standards.md`
 * says so, and the fastest way to stop a reader conflating them is to show a
 * rule whose source set is `stable` and whose implementation is `planned`.
 */

const BEGIN = "<!-- BEGIN GENERATED: rule-implementation-status -->";
const END = "<!-- END GENERATED: rule-implementation-status -->";

interface Rule {
  readonly rule_id?: unknown;
  readonly rule_version?: unknown;
  readonly implementation_status?: unknown;
  readonly maturity?: unknown;
}

function cell(value: unknown): string {
  return typeof value === "string" && value !== "" ? value : "(missing)";
}

/**
 * Renders the table body from the ruleset, in file order.
 *
 * File order is ADR-0005 section 2's budget-reservation order, so a reader of
 * the table and a reader of a scan see rules in the same sequence.
 */
export function renderStatusTable(rulesetYaml: string): string {
  const parsed: unknown = parse(rulesetYaml, { uniqueKeys: true });
  const rules =
    typeof parsed === "object" && parsed !== null && "rules" in parsed
      ? (parsed as { rules?: unknown }).rules
      : undefined;
  if (!Array.isArray(rules)) {
    throw new Error("specs/ruleset.standard.v0.yaml has no rules array");
  }

  const lines = [
    BEGIN,
    "",
    "<!-- Generated from specs/ruleset.standard.v0.yaml by scripts/status-table.ts.",
    "     Do not edit by hand: `pnpm run status:check` fails when this differs",
    "     from the ruleset, and `pnpm run status:write` regenerates it. -->",
    "",
    "| Rule | Rule version | Implementation status | Source maturity |",
    "| --- | --- | --- | --- |",
  ];

  for (const raw of rules as readonly Rule[]) {
    lines.push(
      `| \`${cell(raw.rule_id)}\` | ${cell(raw.rule_version)} | ${cell(
        raw.implementation_status,
      )} | ${cell(raw.maturity)} |`,
    );
  }

  lines.push("", END);
  return lines.join("\n");
}

/**
 * Replaces the generated region of `markdown`.
 *
 * Absent markers are an error rather than an append: a document that lost its
 * markers has been edited in a way this script cannot reconcile, and guessing
 * where the table belongs is how a generator starts overwriting prose.
 */
export function spliceStatusTable(markdown: string, table: string): string {
  const start = markdown.indexOf(BEGIN);
  const end = markdown.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `PROJECT_STATUS.md is missing the ${BEGIN} / ${END} markers`,
    );
  }
  return markdown.slice(0, start) + table + markdown.slice(end + END.length);
}
