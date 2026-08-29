import { it } from "vitest";

import { robotsRule } from "../../src/rules/robots.js";
import { expectNotImplemented } from "../support/not-implemented.js";

/**
 * Delete this file when `web.discovery.robots` is implemented.
 *
 * One file per rule, so that eight agents working in parallel never edit the
 * same one. What is left in this directory is the remaining work, reported by
 * the test run rather than tracked in a comment.
 */
it("web.discovery.robots is not implemented", () => {
  expectNotImplemented(robotsRule);
});
