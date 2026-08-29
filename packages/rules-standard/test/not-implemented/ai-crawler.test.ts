import { it } from "vitest";

import { aiCrawlerRule } from "../../src/rules/ai-crawler.js";
import { expectNotImplemented } from "../support/not-implemented.js";

/**
 * Delete this file when `web.policy.ai-crawler` is implemented.
 *
 * One file per rule, so that eight agents working in parallel never edit the
 * same one. What is left in this directory is the remaining work, reported by
 * the test run rather than tracked in a comment.
 */
it("web.policy.ai-crawler is not implemented", () => {
  expectNotImplemented(aiCrawlerRule);
});
