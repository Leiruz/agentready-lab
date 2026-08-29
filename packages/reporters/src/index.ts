/**
 * `@agentready-lab/reporters`: pure transforms of an immutable canonical
 * report (`docs/ARCHITECTURE.md` section 4 and section 14).
 *
 * M1 ships two reporters and no more. JUnit, GitHub Summary and SARIF are M2
 * work and are absent rather than stubbed: an empty module that implies a
 * format exists is a claim this project does not get to make.
 *
 * There is no filesystem, network, clock or randomness in this package, and
 * its tsconfig pins `"types": []`, which makes `process`, `fetch` and
 * `require` undeclared identifiers here rather than merely discouraged.
 */
export const REPORTERS_PACKAGE_VERSION = "0.0.0";

export { renderHuman } from "./human.js";
export type { HumanReporterOptions } from "./human.js";

export { renderJson } from "./json.js";

export {
  colorEnabled,
  formatDiagnostics,
  reportDiagnostics,
} from "./output.js";
export type { ReporterOutput } from "./output.js";

export {
  TEXT_LIMITS,
  TRUNCATION_MARKER,
  neutralizeWorkflowCommands,
  sanitize,
} from "./sanitize.js";
