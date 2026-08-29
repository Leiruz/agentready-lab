import type {
  InterpretationMode,
  NetworkBudget,
  ProfileId,
} from "@agentready-lab/core";
import { DEFAULT_NETWORK_BUDGET, lowerBudget } from "@agentready-lab/core";
import { colorEnabled } from "@agentready-lab/reporters";

import type { CheckFlags, NetworkProfileFlag, OutputFormat } from "../args.js";
import type { FileConfig } from "./load.js";
import type { SourceMap } from "./source-map.js";

/**
 * Precedence, and the two places it does not apply.
 *
 * ADR-0004 section 9: "Command-line flag, then configuration file, then
 * profile default, then registry default. The first source that specifies a
 * value wins." That is the whole rule for a scalar, and `??` is the whole
 * implementation.
 *
 * Two settings are not scalars and do not get it.
 *
 * `exclude` **unions** `rules.disable` with `--exclude`. A deny is a safety
 * valve, and precedence would let a flag re-enable a rule the repository's own
 * configuration turned off, which is a widening. It is the same reasoning that
 * makes every network budget a field-wise minimum in section 9's one stated
 * exception: configuration may narrow and may never widen.
 *
 * `include` **replaces**: `--include` wins outright over `rules.enable`, and
 * neither is merged into the other. Unioning them would make "why did this
 * rule run" unanswerable from either source alone, and an include list is a
 * widening, so merging it is exactly the direction the paragraph above
 * refuses.
 */

export interface EffectiveSettings {
  readonly networkProfile: NetworkProfileFlag;
  readonly mode: InterpretationMode;
  readonly profile: ProfileId;
  /** The version the caller asked for, if any. Checked against the build. */
  readonly ruleset: string | undefined;
  readonly include: string | undefined;
  readonly exclude: string | undefined;
  readonly format: OutputFormat;
  readonly budget: NetworkBudget;
  readonly sourceMap: SourceMap | undefined;
  readonly ruleOptions:
    Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined;
  readonly strictWarnings: boolean;
  readonly strictUnable: boolean;
  readonly color: boolean;
}

/**
 * Joins selector sources into one selector list.
 *
 * Duplicates are dropped rather than passed through, although ADR-0004
 * section 5 makes a repeated element idempotent anyway. The reason is the
 * error message: a list that repeats an element names it twice in the "matches
 * no rule" refusal, and a user reading that would look for two mistakes.
 *
 * An empty result is `undefined` and never `""`. The grammar refuses an empty
 * element, so an empty string would turn `"disable": []` into an invalid
 * selector rather than into no selector at all.
 */
function selectorList(
  sources: readonly (readonly string[] | string | undefined)[],
): string | undefined {
  const elements = new Set<string>();
  for (const source of sources) {
    if (source === undefined) continue;
    const parts = typeof source === "string" ? source.split(",") : source;
    for (const part of parts) elements.add(part);
  }
  return elements.size === 0 ? undefined : [...elements].join(",");
}

export function resolveSettings(input: {
  readonly flags: CheckFlags;
  readonly file: FileConfig;
  /** The map named by `--source-map`, already read and validated. */
  readonly flagSourceMap: SourceMap | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
}): EffectiveSettings {
  const { flags, file } = input;
  return {
    networkProfile:
      flags.networkProfile ?? file.networkProfile ?? "local-loopback",
    mode: flags.mode ?? file.mode ?? "spec",
    profile: flags.profile ?? file.profile ?? "content",
    ruleset: flags.ruleset ?? file.ruleset,
    // Replace, never merge.
    include: selectorList([flags.include ?? file.enable]),
    // Union, because a deny must survive a flag.
    exclude: selectorList([file.disable, flags.exclude]),
    format: flags.format ?? "human",
    // ADR-0004 section 9's exception: the effective value is the minimum
    // across sources, so this is `lowerBudget` and not an override merge.
    // `maxConcurrency` is absent from `file.budget` by construction: the
    // loader refuses anything but 1 rather than letting a minimum clamp it.
    budget: lowerBudget(DEFAULT_NETWORK_BUDGET, file.budget),
    // A map given on the command line replaces the one in the file rather
    // than merging entry by entry. A half-merged mapping would put a finding
    // on a file from one source and the next finding on a file from another,
    // and nothing in either document would say which.
    sourceMap: input.flagSourceMap ?? file.sourceMap,
    ruleOptions: file.ruleOptions,
    strictWarnings: flags.strictWarnings,
    strictUnable: flags.strictUnable,
    // Colour is off unless asked for. This package returns strings rather
    // than holding a stream, so it cannot ask whether stdout is a terminal,
    // and guessing would make the bytes depend on where they were run.
    // `colorEnabled` is what gives NO_COLOR the last word.
    color: colorEnabled(input.env, flags.color ?? false),
  };
}
