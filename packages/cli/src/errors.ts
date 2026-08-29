import {
  ConfigurationError,
  RuleContractViolation,
} from "@agentready-lab/core";
import { TEXT_LIMITS, sanitize } from "@agentready-lab/reporters";

import type { ExitCode } from "./exit-codes.js";
import { EXIT } from "./exit-codes.js";

/**
 * The one error type this package throws, and the one place a thrown value
 * becomes an exit code.
 *
 * `lines` rather than a single message with embedded newlines, because the
 * two usability requirements in `docs/ROADMAP.md` M1 are both multi-line
 * explanations and both have golden tests. Joining and re-splitting a string
 * to indent it is a formatting rule hidden in a data shape; a list of lines is
 * the shape the formatter actually wants.
 */
export class CliError extends Error {
  readonly exitCode: ExitCode;
  /** The message, first line first. Never empty. */
  readonly lines: readonly string[];

  constructor(exitCode: ExitCode, lines: readonly [string, ...string[]]) {
    super(lines[0]);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.lines = lines;
  }
}

/** Exit 2 with one line, which is the common case. */
export function configurationError(
  first: string,
  ...rest: readonly string[]
): CliError {
  return new CliError(EXIT.configuration, [first, ...rest]);
}

/**
 * `agentready-lab: ` on the first line and an aligned indent under it.
 *
 * The same prefix the reporters use for their diagnostics
 * (`formatDiagnostics`), so a caller filtering this tool's lines out of a CI
 * log has one prefix to filter and not two.
 */
const PREFIX = "agentready-lab: ";

/**
 * The last guard before anything reaches a terminal.
 *
 * Several of these messages quote something the user supplied - a URL, a
 * configuration key, a source-map path - and a URL is bounded but not
 * sanitized when the policy refuses it, because the length and control
 * checks in `url-policy.ts` run before the parse and report `invalid-url`
 * for exactly the input that would be dangerous to echo. So the escape
 * happens here, once, at the sink, in the same shape the human reporter uses
 * (`packages/reporters/src/human.ts`): line by line, so the line structure
 * survives a function that removes newlines.
 */
export function formatError(error: CliError): string {
  const [first, ...rest] = error.lines;
  const indent = " ".repeat(PREFIX.length);
  const safe = (line: string): string => sanitize(line, TEXT_LIMITS.value);
  return [
    `${PREFIX}${safe(first ?? "")}`,
    ...rest.map((line) => (line === "" ? "" : `${indent}${safe(line)}`)),
    "",
  ].join("\n");
}

/**
 * Maps anything thrown out of the composed libraries onto the contract.
 *
 * The two core error classes carry their own `exitCode`, and it is read from
 * the instance rather than restated here: `ConfigurationError.exitCode` and
 * `RuleContractViolation.exitCode` are declared next to the conditions they
 * describe precisely so the two cannot drift, and a second table here would be
 * the drift.
 *
 * Anything else is exit 4. That is deliberately not a friendly default: an
 * unexpected exception escaping the engine is an invariant violation whether
 * or not it arrived in a class that says so.
 */
export function toCliError(thrown: unknown): CliError {
  if (thrown instanceof CliError) return thrown;
  if (thrown instanceof ConfigurationError) {
    return new CliError(thrown.exitCode, [
      `configuration refused: ${thrown.code}`,
      thrown.message,
    ]);
  }
  if (thrown instanceof RuleContractViolation) {
    return new CliError(thrown.exitCode, [
      `rule contract violation: ${thrown.code}`,
      thrown.message,
      "This is a defect in a rule or in the engine, not in the target. The scan was discarded rather than reported.",
    ]);
  }
  const detail = thrown instanceof Error ? thrown.message : String(thrown);
  return new CliError(EXIT.internal, [
    "internal error: an unexpected exception escaped the scan",
    detail,
  ]);
}
