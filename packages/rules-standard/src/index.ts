import type { AnyRuleDefinition } from "@agentready-lab/core";

import { aiCrawlerRule } from "./rules/ai-crawler.js";
import { apiCatalogRule } from "./rules/api-catalog.js";
import { contentSignalsRule } from "./rules/content-signals.js";
import { linkRule } from "./rules/link.js";
import { markdownNegotiationRule } from "./rules/markdown-negotiation.js";
import { robotsRule } from "./rules/robots.js";
import { sitemapRule } from "./rules/sitemap.js";
import { skillsRule } from "./rules/skills.js";

/**
 * `@agentready-lab/rules-standard`: the built-in versioned rules of
 * `docs/ARCHITECTURE.md` section 4.
 *
 * The package is compiled with `"lib": ["ES2023"]` and `"types": []`, so
 * network, DNS, socket, filesystem, environment, clock and randomness globals
 * are undeclared identifiers here, and
 * `test/boundaries/package-boundaries.test.ts` asserts that `fetch`,
 * `process`, `URL` and `AbortSignal` all fail to resolve.
 *
 * All eight M1 rules are registered here already and each one is a metadata
 * placeholder whose `plan`, `step` and `finish` throw. That is deliberate:
 * eight rule families are implemented in parallel, and registering them one at
 * a time would make this file the one file every one of those changes had to
 * touch. An agent implementing a rule replaces exactly
 * `src/rules/<name>.ts`, deletes `test/not-implemented/<name>.test.ts`, and
 * changes nothing here.
 */
export const RULES_STANDARD_PACKAGE_VERSION = "0.0.0";

/**
 * The pinned artifacts a scan cites, projected from `specs/` at build time.
 *
 * They live in this package because they are the ruleset these rules belong
 * to: the assertion set the engine validates each rule against, the source
 * ledger a finding's citations resolve in, and the message and remediation
 * prose the core renders. `packages/cli` composes them into a `ScanInput` and
 * derives none of them, which is what `docs/ARCHITECTURE.md` section 4 means
 * by "package composition only".
 *
 * `src/generated/pinned-artifacts.ts` is written by `pnpm specs:canonicalise`
 * and held current by `pnpm specs:validate`.
 */
export {
  PINNED_ASSERTIONS,
  PINNED_PROFILE_VERSIONS,
  PINNED_REMEDIATION,
  PINNED_REMEDIATION_VERSION,
  PINNED_RULESET,
  PINNED_SOURCE_LEDGER,
  PINNED_SOURCE_LEDGER_VERSION,
  PINNED_TEMPLATES,
  PINNED_TEMPLATES_VERSION,
} from "./generated/pinned-artifacts.js";

export { aiCrawlerRule } from "./rules/ai-crawler.js";
export { apiCatalogRule } from "./rules/api-catalog.js";
export { contentSignalsRule } from "./rules/content-signals.js";
export { linkRule } from "./rules/link.js";
export { markdownNegotiationRule } from "./rules/markdown-negotiation.js";
export { robotsRule } from "./rules/robots.js";
export { sitemapRule } from "./rules/sitemap.js";
export { skillsRule } from "./rules/skills.js";

/**
 * The eight M1 rules of `docs/ROADMAP.md` section 4, in stable registry order.
 *
 * The order is the `ordinal` of `specs/checks.v0.yaml`, which is where
 * ADR-0005 section 2 says the ordinals are defined, restricted to the eight
 * rules M1 implements: 1 robots, 2 sitemap, 3 link, 5 markdown, 6 ai-crawler,
 * 7 content-signals, 11 skills, 13 api-catalog. It is not cosmetic. ADR-0005
 * makes registry order the order in which request budget is reserved at plan
 * time, so an earlier rule can starve a later one, and `ScanInput.registry`
 * is documented as already being in this order.
 *
 * `test/registry.test.ts` re-derives the order from the snapshot rather than
 * trusting this array.
 */
export const STANDARD_RULESET: readonly AnyRuleDefinition[] = [
  robotsRule,
  sitemapRule,
  linkRule,
  markdownNegotiationRule,
  aiCrawlerRule,
  contentSignalsRule,
  skillsRule,
  apiCatalogRule,
];
