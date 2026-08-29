import { parseInvocation } from "./args.js";
import { check } from "./commands/check.js";
import { rulesExplain, rulesList } from "./commands/rules.js";
import type { CliEnvironment } from "./environment.js";
import { formatError, toCliError } from "./errors.js";
import { EXIT } from "./exit-codes.js";
import type { CommandResult } from "./result.js";

/**
 * The one entry point, and the one place a thrown value becomes an exit code.
 *
 * It returns a result instead of writing and exiting, which is what makes the
 * golden tests of `docs/ROADMAP.md` M1 ("CLI help and exit behavior have
 * golden tests") assertions about a value rather than about captured
 * descriptors. The caller writes `stdout` and `stderr` and passes `exitCode`
 * to the process; this package does neither and imports no process global
 * outside `environment.ts`.
 *
 * Every failure path funnels through `toCliError`, so there is exactly one
 * place where an exception decides an exit code, and no command can produce a
 * sixth one.
 */
export async function runCli(
  environment: CliEnvironment,
): Promise<CommandResult> {
  try {
    const invocation = parseInvocation(environment.argv);
    switch (invocation.kind) {
      case "help":
        return { exitCode: EXIT.ok, stdout: invocation.document, stderr: "" };
      case "rules-list":
        return rulesList({
          registry: environment.registry,
          profile: invocation.profile,
          mode: invocation.mode,
          format: invocation.format,
        });
      case "rules-explain":
        return rulesExplain({
          registry: environment.registry,
          ruleId: invocation.ruleId,
        });
      case "check":
        return await check({
          environment,
          url: invocation.url,
          flags: invocation.flags,
        });
    }
  } catch (thrown) {
    const error = toCliError(thrown);
    return { exitCode: error.exitCode, stdout: "", stderr: formatError(error) };
  }
}
