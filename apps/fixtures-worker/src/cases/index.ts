/**
 * The 49 protocol cases of `docs/FIXTURE_CATALOG.md` sections 5 to 12.
 *
 * Two of them, `lnk-001` and `lnk-002`, are declared here and served by the
 * raw transport harness instead: ADR-0006 section 4 puts every case whose
 * subject is the wire in layer B, and a normalized `Response` cannot carry two
 * physical `Link` field lines. `compileManifest` filters them out; the
 * manifest validator asserts they declare no override and carry a reason.
 *
 * The 24 security cases of section 13 are not here at all. They are harness
 * cases, not Worker endpoints, and most must never be deployed.
 */
import type { FixtureDefinition } from "../manifest.js";

import { agentSkillsCases } from "./agent-skills.js";
import { aiCrawlerCases } from "./ai-crawler.js";
import { apiCatalogCases } from "./api-catalog.js";
import { contentSignalsCases } from "./content-signals.js";
import { linkCases } from "./link.js";
import { markdownCases } from "./markdown.js";
import { robotsCases } from "./robots.js";
import { sitemapCases } from "./sitemap.js";

export const fixtures: readonly FixtureDefinition[] = [
  ...robotsCases,
  ...sitemapCases,
  ...linkCases,
  ...markdownCases,
  ...aiCrawlerCases,
  ...contentSignalsCases,
  ...apiCatalogCases,
  ...agentSkillsCases,
];

export { base } from "./base/valid-agent-site-v1.js";
