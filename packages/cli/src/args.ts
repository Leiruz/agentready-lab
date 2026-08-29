import { parseArgs } from "node:util";

import type { InterpretationMode, ProfileId } from "@agentready-lab/core";

import { CliError, configurationError } from "./errors.js";
import { EXIT } from "./exit-codes.js";
import {
  CHECK_HELP,
  ROOT_HELP,
  RULES_EXPLAIN_HELP,
  RULES_HELP,
  RULES_LIST_HELP,
} from "./help.js";

/**
 * Argument parsing, and nothing else.
 *
 * Node 24's `node:util` `parseArgs` does the tokenizing. No dependency is
 * added for it and none should be: an argument parser is the kind of thing a
 * project acquires four of, and the built-in one already refuses an unknown
 * option, which is the only behaviour the exit-code contract needs from it.
 *
 * What this module deliberately does not do is decide anything. It produces a
 * typed `Invocation` and validates that each flag's value is in its
 * vocabulary; whether the combination is runnable is a question for the
 * command, which is where the transport, the registry and the configuration
 * file are.
 */

/** The two `--format` values M1 implements. */
export type OutputFormat = "human" | "json";

/**
 * The `--network-profile` vocabulary of `IMPLEMENTATION_SPEC.md` section 10.
 *
 * `hosted-public` is in `NetworkProfileId` and is not here, because
 * `ARCHITECTURE.md` section 9 keeps it in the report vocabulary only and no
 * flag selects it (ADR-0008 section 6).
 */
export type NetworkProfileFlag = "local-loopback" | "ci-public";

const FORMATS: readonly OutputFormat[] = ["human", "json"];
const MODES: readonly InterpretationMode[] = ["spec", "compat", "interop"];
const NETWORK_PROFILES: readonly NetworkProfileFlag[] = [
  "local-loopback",
  "ci-public",
];
/**
 * `commerce` is in the vocabulary and is refused later, not here.
 *
 * ADR-0004 section 10 requires a message naming the two reasons, and
 * `selectRules` already carries it. Leaving `commerce` out of this list would
 * turn that explanation into "not one of content, api, ...", which tells a
 * user nothing about why the profile they read about in section 7 does not
 * work.
 */
const PROFILES: readonly ProfileId[] = [
  "content",
  "api",
  "agent-service",
  "commerce",
  "full",
];

export interface CheckFlags {
  readonly networkProfile: NetworkProfileFlag | undefined;
  readonly mode: InterpretationMode | undefined;
  readonly profile: ProfileId | undefined;
  readonly ruleset: string | undefined;
  readonly include: string | undefined;
  readonly exclude: string | undefined;
  readonly format: OutputFormat | undefined;
  readonly sourceMap: string | undefined;
  readonly strictWarnings: boolean;
  readonly strictUnable: boolean;
  /** `undefined` leaves the decision to `NO_COLOR` and the default. */
  readonly color: boolean | undefined;
}

export type Invocation =
  | { readonly kind: "help"; readonly document: string }
  | { readonly kind: "check"; readonly url: string; readonly flags: CheckFlags }
  | {
      readonly kind: "rules-list";
      readonly profile: ProfileId | undefined;
      readonly mode: InterpretationMode | undefined;
      readonly format: OutputFormat;
    }
  | { readonly kind: "rules-explain"; readonly ruleId: string };

function oneOf<T extends string>(
  flag: string,
  value: string,
  allowed: readonly T[],
): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) {
    throw configurationError(
      `${flag} does not accept ${JSON.stringify(value)}.`,
      `Accepted values: ${allowed.join(", ")}.`,
    );
  }
  return found;
}

function optionalOneOf<T extends string>(
  flag: string,
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  return value === undefined ? undefined : oneOf(flag, value, allowed);
}

function errorCode(thrown: unknown): string {
  if (typeof thrown !== "object" || thrown === null) return "";
  if (!("code" in thrown)) return "";
  const code: unknown = thrown.code;
  return typeof code === "string" ? code : "";
}

/**
 * Turns a `parseArgs` rejection into the exit-code contract.
 *
 * Node's own message is kept as a second line rather than replaced, because it
 * is the only part that names the offending token. The first line is this
 * project's, so the contract sentence does not move if Node rewords its.
 */
function fromParseArgs(thrown: unknown, usage: string): CliError {
  const code = errorCode(thrown);
  const detail = thrown instanceof Error ? thrown.message : String(thrown);
  const headline =
    code === "ERR_PARSE_ARGS_UNKNOWN_OPTION"
      ? "unknown option."
      : code === "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL"
        ? "unexpected argument."
        : "invalid option value.";
  return new CliError(EXIT.configuration, [headline, detail, usage]);
}

function colorFrom(
  color: boolean | undefined,
  noColor: boolean | undefined,
): boolean | undefined {
  if (color === true && noColor === true) {
    throw configurationError(
      "--color and --no-color were both given.",
      "They contradict each other, so neither is applied rather than one winning silently.",
    );
  }
  if (noColor === true) return false;
  if (color === true) return true;
  return undefined;
}

function parseCheck(args: readonly string[]): Invocation {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...args],
      allowPositionals: true,
      strict: true,
      options: {
        "network-profile": { type: "string" },
        mode: { type: "string" },
        profile: { type: "string" },
        ruleset: { type: "string" },
        include: { type: "string" },
        exclude: { type: "string" },
        format: { type: "string" },
        "source-map": { type: "string" },
        "strict-warnings": { type: "boolean" },
        "strict-unable": { type: "boolean" },
        color: { type: "boolean" },
        "no-color": { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (thrown) {
    throw fromParseArgs(thrown, "Run 'agentready-lab check --help'.");
  }

  const values = parsed.values;
  if (values.help === true) return { kind: "help", document: CHECK_HELP };

  const [url, ...extra] = parsed.positionals;
  if (url === undefined) {
    throw configurationError(
      "check needs a target URL.",
      "Usage: agentready-lab check <url> [options]",
    );
  }
  if (extra.length !== 0) {
    throw configurationError(
      `check takes one target URL; ${String(extra.length + 1)} were given.`,
      `Unexpected: ${extra.map((one) => JSON.stringify(one)).join(", ")}.`,
    );
  }

  return {
    kind: "check",
    url,
    flags: {
      networkProfile: optionalOneOf(
        "--network-profile",
        values["network-profile"],
        NETWORK_PROFILES,
      ),
      mode: optionalOneOf("--mode", values.mode, MODES),
      profile: optionalOneOf("--profile", values.profile, PROFILES),
      ruleset: values.ruleset,
      include: values.include,
      exclude: values.exclude,
      format: optionalOneOf("--format", values.format, FORMATS),
      sourceMap: values["source-map"],
      strictWarnings: values["strict-warnings"] ?? false,
      strictUnable: values["strict-unable"] ?? false,
      color: colorFrom(values.color, values["no-color"]),
    },
  };
}

function parseRulesList(args: readonly string[]): Invocation {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...args],
      allowPositionals: true,
      strict: true,
      options: {
        profile: { type: "string" },
        mode: { type: "string" },
        format: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (thrown) {
    throw fromParseArgs(thrown, "Run 'agentready-lab rules list --help'.");
  }

  const values = parsed.values;
  if (values.help === true) return { kind: "help", document: RULES_LIST_HELP };
  if (parsed.positionals.length !== 0) {
    throw configurationError(
      "rules list takes no arguments.",
      `Unexpected: ${parsed.positionals.map((one) => JSON.stringify(one)).join(", ")}.`,
      "Run 'agentready-lab rules list --help'.",
    );
  }

  return {
    kind: "rules-list",
    profile: optionalOneOf("--profile", values.profile, PROFILES),
    mode: optionalOneOf("--mode", values.mode, MODES),
    format: optionalOneOf("--format", values.format, FORMATS) ?? "human",
  };
}

function parseRulesExplain(args: readonly string[]): Invocation {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...args],
      allowPositionals: true,
      strict: true,
      options: { help: { type: "boolean", short: "h" } },
    });
  } catch (thrown) {
    throw fromParseArgs(thrown, "Run 'agentready-lab rules explain --help'.");
  }

  if (parsed.values.help === true) {
    return { kind: "help", document: RULES_EXPLAIN_HELP };
  }

  const [ruleId, ...extra] = parsed.positionals;
  if (ruleId === undefined) {
    throw configurationError(
      "rules explain needs a rule id.",
      "Usage: agentready-lab rules explain <rule-id>",
    );
  }
  if (extra.length !== 0) {
    throw configurationError(
      `rules explain takes one rule id; ${String(extra.length + 1)} were given.`,
      "A selector is not accepted here. Use 'agentready-lab rules list' to find an id.",
    );
  }
  return { kind: "rules-explain", ruleId };
}

function parseRules(args: readonly string[]): Invocation {
  const [subcommand, ...rest] = args;
  if (subcommand === undefined) {
    throw configurationError(
      "rules needs a subcommand.",
      "Usage: agentready-lab rules <list|explain> [options]",
    );
  }
  if (subcommand === "--help" || subcommand === "-h") {
    return { kind: "help", document: RULES_HELP };
  }
  if (subcommand === "list") return parseRulesList(rest);
  if (subcommand === "explain") return parseRulesExplain(rest);
  throw configurationError(
    `unknown rules subcommand ${JSON.stringify(subcommand)}.`,
    "Known subcommands: list, explain.",
  );
}

/**
 * Routes on the command word before parsing flags.
 *
 * `parseArgs` needs the option table up front and the table differs per
 * command, so routing cannot come after it. Doing it in this order also means
 * `--format` is unknown to `rules explain` rather than accepted and ignored.
 */
export function parseInvocation(argv: readonly string[]): Invocation {
  const [command, ...rest] = argv;
  if (command === undefined) {
    throw configurationError(
      "no command given.",
      "Usage: agentready-lab <check|rules> [options]",
      "Run 'agentready-lab --help'.",
    );
  }
  if (command === "--help" || command === "-h") {
    return { kind: "help", document: ROOT_HELP };
  }
  if (command === "check") return parseCheck(rest);
  if (command === "rules") return parseRules(rest);
  throw configurationError(
    `unknown command ${JSON.stringify(command)}.`,
    "Known commands: check, rules.",
    "Run 'agentready-lab --help'.",
  );
}
