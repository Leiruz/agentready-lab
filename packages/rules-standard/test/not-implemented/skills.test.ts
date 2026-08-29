import { it } from "vitest";

import { skillsRule } from "../../src/rules/skills.js";
import { expectNotImplemented } from "../support/not-implemented.js";

/**
 * Delete this file when `agent.discovery.skills` is implemented.
 *
 * One file per rule, so that eight agents working in parallel never edit the
 * same one. What is left in this directory is the remaining work, reported by
 * the test run rather than tracked in a comment.
 */
it("agent.discovery.skills is not implemented", () => {
  expectNotImplemented(skillsRule);
});
