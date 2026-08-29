import { CORE_PACKAGE_VERSION } from "@agentready-lab/core";
import { REPORTERS_PACKAGE_VERSION } from "@agentready-lab/reporters";
import { RULES_STANDARD_PACKAGE_VERSION } from "@agentready-lab/rules-standard";
import { TRANSPORT_NODE_PACKAGE_VERSION } from "@agentready-lab/transport-node";

import { CLI_PACKAGE_VERSION } from "./version.js";

/**
 * `@agentready-lab/cli`: argument parsing, configuration and package
 * composition (`docs/ARCHITECTURE.md` section 4).
 *
 * `check` now completes: `nodeEnvironment` supplies the pinned assertions,
 * source ledger, message templates and remediation table from
 * `packages/rules-standard`'s generated projection of `specs/`, and six of the
 * eight rules are `supported`, so a scan of a loopback origin produces a
 * report with real findings and an exit code derived from them.
 *
 * The package still declares no `bin`, and that is now the narrower claim it
 * was always meant to be. `docs/IMPLEMENTATION_SPEC.md` section 10 makes help
 * text and exit-code goldens the bar for a command to be public, and
 * `web.discovery.sitemap` and `agent.discovery.skills` are still `planned`, so
 * a default invocation is refused rather than served with two silent gaps. A
 * `bin` entry belongs with the last two rules. Everything here is reachable
 * through `runCli` by any caller that wires an environment.
 */
export { CLI_PACKAGE_VERSION } from "./version.js";

export { runCli } from "./run.js";
export { nodeEnvironment } from "./environment.js";
export type {
  CliEnvironment,
  FileRead,
  PinnedArtifacts,
} from "./environment.js";
export type { CommandResult } from "./result.js";
export { EXIT } from "./exit-codes.js";
export type { ExitCode } from "./exit-codes.js";
export { CliError } from "./errors.js";

/**
 * The CLI is the composition root (`CLAUDE.md`, package boundaries), so it is
 * the one place that imports all four libraries. Reading their version
 * markers here proves every declared workspace edge resolves at type and
 * runtime level; it is not a public interface.
 */
export const COMPOSED_PACKAGE_VERSIONS = {
  cli: CLI_PACKAGE_VERSION,
  core: CORE_PACKAGE_VERSION,
  reporters: REPORTERS_PACKAGE_VERSION,
  "rules-standard": RULES_STANDARD_PACKAGE_VERSION,
  "transport-node": TRANSPORT_NODE_PACKAGE_VERSION,
} as const;
