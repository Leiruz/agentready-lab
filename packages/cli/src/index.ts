import { CORE_PACKAGE_VERSION } from "@agentready-lab/core";
import { REPORTERS_PACKAGE_VERSION } from "@agentready-lab/reporters";
import { RULES_STANDARD_PACKAGE_VERSION } from "@agentready-lab/rules-standard";
import { TRANSPORT_NODE_PACKAGE_VERSION } from "@agentready-lab/transport-node";

/**
 * Scaffold marker for `@agentready-lab/cli`.
 *
 * No command, flag, configuration loader or exit code exists yet, and the
 * package deliberately declares no `bin` entry: it gets one in M1, when
 * `check` exists and has golden tests (`docs/ROADMAP.md`).
 */
export const CLI_PACKAGE_VERSION = "0.0.0";

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
