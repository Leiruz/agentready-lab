import type {
  AnyRuleDefinition,
  InterpretationMode,
  ProfileId,
  ResultGate,
  RuleMetadata,
} from "@agentready-lab/core";
import { canonicalizeJson } from "@agentready-lab/core";
import { neutralizeWorkflowCommands } from "@agentready-lab/reporters";

import type { OutputFormat } from "../args.js";
import { configurationError } from "../errors.js";
import { EXIT } from "../exit-codes.js";
import type { CommandResult } from "../result.js";

/**
 * `rules list` and `rules explain`.
 *
 * Both read the pinned registry and nothing else: no configuration, no
 * network policy, no transport, no filesystem. That is why they work in this
 * build while `check` cannot - they report what the ruleset declares, and a
 * declaration is available whether or not the rule behind it is implemented.
 *
 * ADR-0004's implementation constraints require `rules list` to print
 * "`rule_id`, category, profiles, applicability using the native names, and
 * gate, so a selector can be written without reading YAML". Implementation
 * status is printed beside them because a selector naming a `planned` rule is
 * exit 2 (section 6), and a listing that omitted the one field which decides
 * that would send a reader to the YAML for exactly the reason the constraint
 * exists to avoid.
 */

/**
 * ADR-0004 section 4. Only an `enforced` result reaches the exit code.
 *
 * The same derivation as `selectRules`, which does not export it. Two lines
 * that must agree is a real cost and the alternative is worse: calling the
 * selector here would mean choosing a profile, a runtime set and a commerce
 * flag in order to answer a question about one rule's metadata.
 */
function gateOf(metadata: RuleMetadata): ResultGate {
  return metadata.applicability === "informational"
    ? "informational"
    : "enforced";
}

function refuseCommerce(): never {
  throw configurationError(
    "--profile commerce is refused in M1.",
    "ADR-0004 section 10: the commerce rules are M6 work, and the profiles arrays in specs/checks.v0.yaml do not implement the profile that docs/IMPLEMENTATION_SPEC.md section 7 describes.",
  );
}

function selectForListing(
  registry: readonly AnyRuleDefinition[],
  profile: ProfileId | undefined,
  mode: InterpretationMode | undefined,
): readonly AnyRuleDefinition[] {
  if (profile === "commerce") refuseCommerce();
  return registry.filter((rule) => {
    const metadata = rule.metadata;
    if (profile !== undefined && !metadata.profiles.includes(profile)) {
      return false;
    }
    return mode === undefined || metadata.modes.includes(mode);
  });
}

interface Column {
  readonly heading: string;
  readonly value: (metadata: RuleMetadata) => string;
}

const COLUMNS: readonly Column[] = [
  { heading: "RULE", value: (metadata) => metadata.id },
  { heading: "VERSION", value: (metadata) => metadata.ruleVersion },
  { heading: "STATUS", value: (metadata) => metadata.implementationStatus },
  { heading: "APPLICABILITY", value: (metadata) => metadata.applicability },
  { heading: "GATE", value: (metadata) => gateOf(metadata) },
  { heading: "CATEGORY", value: (metadata) => metadata.category },
  { heading: "MODES", value: (metadata) => metadata.modes.join(" ") },
  { heading: "PROFILES", value: (metadata) => metadata.profiles.join(" ") },
];

/**
 * A table whose column widths come from its own contents.
 *
 * Deterministic because the registry is: the same ruleset always produces the
 * same widths. Nothing here reads a terminal width, so the bytes do not depend
 * on where the command ran.
 */
function table(rules: readonly AnyRuleDefinition[]): readonly string[] {
  const rows = rules.map((rule) =>
    COLUMNS.map((column) => column.value(rule.metadata)),
  );
  const widths = COLUMNS.map((column, index) =>
    Math.max(
      column.heading.length,
      ...rows.map((row) => (row[index] ?? "").length),
    ),
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, index) =>
        index === cells.length - 1 ? cell : cell.padEnd(widths[index] ?? 0),
      )
      .join("  ")
      .trimEnd();
  return [
    line(COLUMNS.map((column) => column.heading)),
    ...rows.map((row) => line(row)),
  ];
}

function listHuman(rules: readonly AnyRuleDefinition[], total: number): string {
  const implemented = rules.filter(
    (rule) => rule.metadata.implementationStatus !== "planned",
  ).length;
  const lines = [
    `AgentReady Lab rules (${String(rules.length)} of ${String(total)} in the pinned ruleset)`,
    "",
  ];
  if (rules.length === 0) {
    lines.push("  no rule in the pinned ruleset matches that filter");
  } else {
    lines.push(...table(rules).map((row) => `  ${row}`));
    lines.push(
      "",
      `  ${String(implemented)} of the ${String(rules.length)} listed rules are implemented. A selector naming a`,
      "  rule whose status is 'planned' is exit 2 (ADR-0004 section 6).",
    );
  }
  return neutralizeWorkflowCommands(`${lines.join("\n")}\n`);
}

function listJson(rules: readonly AnyRuleDefinition[]): string {
  return canonicalizeJson(
    rules.map((rule) => {
      const metadata = rule.metadata;
      return {
        ruleId: metadata.id,
        ruleVersion: metadata.ruleVersion,
        ruleset: { id: metadata.ruleset.id, version: metadata.ruleset.version },
        title: metadata.title,
        category: metadata.category,
        profiles: [...metadata.profiles],
        applicability: metadata.applicability,
        gate: gateOf(metadata),
        modes: [...metadata.modes],
        observationRuntime: [...metadata.observationRuntime],
        implementationStatus: metadata.implementationStatus,
        sourceMaturity: metadata.sourceMaturity,
        externalCompatibilityId: metadata.externalCompatibilityId,
      };
    }),
  );
}

export function rulesList(input: {
  readonly registry: readonly AnyRuleDefinition[];
  readonly profile: ProfileId | undefined;
  readonly mode: InterpretationMode | undefined;
  readonly format: OutputFormat;
}): CommandResult {
  const rules = selectForListing(input.registry, input.profile, input.mode);
  const stdout =
    input.format === "json"
      ? listJson(rules)
      : listHuman(rules, input.registry.length);
  return { exitCode: EXIT.ok, stdout, stderr: "" };
}

function field(name: string, value: string): string {
  return `  ${name.padEnd(16)}${value}`;
}

function assertionLines(metadata: RuleMetadata): readonly string[] {
  if (metadata.assertions.length === 0) return ["  none declared"];
  return metadata.assertions.flatMap((assertion) => {
    const citations = assertion.sourceRefs
      .map((ref) =>
        ref.section === undefined
          ? ref.sourceId
          : `${ref.sourceId} section ${ref.section}`,
      )
      .join(", ");
    const params = Object.keys(assertion.params).sort();
    const lines = [
      `  ${assertion.id}`,
      `      mode          ${assertion.mode}`,
      `      class         ${assertion.requirementClass}`,
      `      sources       ${citations === "" ? "none" : citations}`,
      `      params        ${params.length === 0 ? "none declared" : params.join(", ")}`,
      `      excerpt       ${assertion.excerptAuthorized ? "authorized" : "not authorized"}`,
    ];
    if (assertion.deferred !== undefined) {
      lines.push(
        `      deferred      ${assertion.deferred.adr}: ${assertion.deferred.reason}`,
        `                    returns when ${assertion.deferred.until}`,
      );
    }
    return lines;
  });
}

function sourceLines(metadata: RuleMetadata): readonly string[] {
  if (metadata.sources.length === 0) return ["  none pinned"];
  return metadata.sources.flatMap((source) => [
    `  ${source.id}  ${source.title}`,
    `      ${source.url}`,
    `      ${source.kind}, ${source.status}${source.version === undefined ? "" : `, ${source.version}`}, verified ${source.verifiedAt}`,
  ]);
}

export function rulesExplain(input: {
  readonly registry: readonly AnyRuleDefinition[];
  readonly ruleId: string;
}): CommandResult {
  const rule = input.registry.find(
    (candidate) => candidate.metadata.id === input.ruleId,
  );
  if (rule === undefined) {
    throw configurationError(
      `no rule in the pinned ruleset has the id ${JSON.stringify(input.ruleId)}.`,
      "Run 'agentready-lab rules list' for the ids this build carries.",
    );
  }

  const metadata = rule.metadata;
  const lines = [
    `${metadata.id} ${metadata.ruleVersion}`,
    "",
    field("title", metadata.title),
    field("ruleset", `${metadata.ruleset.id} ${metadata.ruleset.version}`),
    field("category", metadata.category),
    field(
      "applicability",
      `${metadata.applicability} (gate ${gateOf(metadata)})`,
    ),
    field("status", metadata.implementationStatus),
    field("maturity", metadata.sourceMaturity),
    field("modes", metadata.modes.join(", ")),
    field("runtimes", metadata.observationRuntime.join(", ")),
    field("profiles", metadata.profiles.join(", ")),
    field(
      "compat id",
      metadata.externalCompatibilityId ??
        "none; this rule has no external counterpart",
    ),
    field("round two", `${String(metadata.roundTwoBudget)} requests`),
    "",
    "ASSERTIONS",
    ...assertionLines(metadata),
    "",
    "PINNED SOURCES",
    ...sourceLines(metadata),
  ];

  if (metadata.implementationStatus === "planned") {
    lines.push(
      "",
      "NOTE",
      "  This rule is declared and not implemented. Naming it in --include is",
      "  exit 2 (ADR-0004 section 6); the declaration above is what it will",
      "  assert, not what it has asserted.",
    );
  }

  return {
    exitCode: EXIT.ok,
    stdout: neutralizeWorkflowCommands(`${lines.join("\n")}\n`),
    stderr: "",
  };
}
