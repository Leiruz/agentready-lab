import type { ExitCode } from "./exit-codes.js";

/**
 * What a command produces.
 *
 * Two strings and a code, never a stream write. The reporters made the same
 * choice for the same reason (`packages/reporters/src/output.ts`): "stdout
 * contains JSON only" is a property that can be asserted about a value and
 * only reviewed about a side effect. Keeping it a value up here as well means
 * a golden test captures exactly what a user would see, in both streams, with
 * no interleaving to reason about.
 *
 * Writing the two strings to real descriptors is the caller's job, and this
 * package never calls `process.exit`.
 */
export interface CommandResult {
  readonly exitCode: ExitCode;
  readonly stdout: string;
  readonly stderr: string;
}
