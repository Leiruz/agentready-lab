import { it } from "vitest";

import { linkRule } from "../../src/rules/link.js";
import { expectNotImplemented } from "../support/not-implemented.js";

/**
 * Delete this file when `web.discovery.link` is implemented.
 *
 * One file per rule, so that eight agents working in parallel never edit the
 * same one. What is left in this directory is the remaining work, reported by
 * the test run rather than tracked in a comment.
 */
it("web.discovery.link is not implemented", () => {
  expectNotImplemented(linkRule);
});
