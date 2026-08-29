/**
 * `docs/FIXTURE_CATALOG.md` section 9. Rule `web.policy.ai-crawler`.
 *
 * Every override changes the `User-agent` groups and nothing else: the
 * `Sitemap` and `Content-Signal` records are written above the first group by
 * `robotsTxt`, so removing a group cannot take `web.policy.content-signals` or
 * `web.discovery.sitemap` with it.
 *
 * The product token below is fixture content. No pinned crawler-name dataset
 * exists yet, which is what `CRAWLER_DATASET_UNPINNED` records.
 */
import { defineFixture } from "../manifest.js";
import type { FixtureDefinition } from "../manifest.js";

import {
  BASE_CONTENT_SIGNAL,
  robotsTxt,
  text,
} from "./base/valid-agent-site-v1.js";
import {
  ASSERTIONS_UNASSIGNED,
  COMPAT_ID_UNASSIGNED,
  CRAWLER_DATASET_UNPINNED,
  changed,
} from "./shared.js";

const RULE = "web.policy.ai-crawler";
const PROFILE = "content";
const SECTION = "docs/FIXTURE_CATALOG.md section 9";
const PLAIN = "text/plain; charset=utf-8";

/** The base robots.txt with only its `User-agent` groups changed. */
function robotsWithGroups(...groups: readonly string[]): string {
  return robotsTxt({
    groups: groups.join("\n"),
    contentSignal: BASE_CONTENT_SIGNAL,
    sitemap: "{{origin}}/sitemap.xml",
  });
}

export const aiCrawlerCases: readonly FixtureDefinition[] = [
  defineFixture({
    id: "bot-001",
    title: "Explicit AI crawler group allows the tested path",
    condition:
      "An explicit configured AI crawler group allows the tested path /. This is the base robots.txt unchanged.",
    catalogSection: SECTION,
    classification: "normative",
    layer: "a",
    base: "valid-agent-site-v1",
    expected: {
      rule: RULE,
      profile: PROFILE,
      spec: { status: "pass", assertions: [] },
      compat: { status: "pass", assertions: [] },
    },
    changedFromBase: [],
    overrides: {},
    todos: [
      ASSERTIONS_UNASSIGNED,
      COMPAT_ID_UNASSIGNED,
      CRAWLER_DATASET_UNPINNED,
    ],
  }),

  defineFixture({
    id: "bot-002",
    title: "Explicit AI crawler group disallows the tested path",
    condition:
      "An explicit configured AI crawler group disallows the tested path /, so the declared policy exists but access is not permitted.",
    catalogSection: SECTION,
    classification: "recommended",
    layer: "a",
    base: "valid-agent-site-v1",
    expected: {
      rule: RULE,
      profile: PROFILE,
      // ai-rules.effective-access is `recommended` and says a disallowed
      // decision is a warning about agent reachability, not a protocol
      // failure. The compat verdict stays pass: the dated presence heuristic
      // recognises an explicit policy.
      spec: { status: "warning", assertions: [] },
      compat: { status: "pass", assertions: [] },
    },
    changedFromBase: [changed("spec", RULE, "warning")],
    overrides: {
      "/robots.txt": text(
        PLAIN,
        robotsWithGroups(
          "User-agent: *",
          "Allow: /",
          "Disallow: /private/",
          "",
          "User-agent: GPTBot",
          "Disallow: /",
        ),
      ),
    },
    todos: [
      ASSERTIONS_UNASSIGNED,
      COMPAT_ID_UNASSIGNED,
      CRAWLER_DATASET_UNPINNED,
    ],
  }),

  defineFixture({
    id: "bot-003",
    title: "Wildcard group applies",
    condition:
      "A wildcard group allows the tested path / and no more-specific group exists.",
    catalogSection: SECTION,
    classification: "normative",
    layer: "a",
    base: "valid-agent-site-v1",
    expected: {
      rule: RULE,
      profile: PROFILE,
      spec: { status: "pass", assertions: [] },
    },
    changedFromBase: [],
    overrides: {
      "/robots.txt": text(
        PLAIN,
        robotsWithGroups("User-agent: *", "Allow: /", "Disallow: /private/"),
      ),
    },
    todos: [ASSERTIONS_UNASSIGNED, CRAWLER_DATASET_UNPINNED],
  }),

  defineFixture({
    id: "bot-004",
    title: "Specific group beats the wildcard",
    condition:
      "The wildcard group disallows the tested path / but a more-specific configured bot group allows it.",
    catalogSection: SECTION,
    classification: "normative",
    layer: "a",
    base: "valid-agent-site-v1",
    expected: {
      rule: RULE,
      profile: PROFILE,
      spec: { status: "pass", assertions: [] },
    },
    changedFromBase: [],
    overrides: {
      "/robots.txt": text(
        PLAIN,
        robotsWithGroups(
          "User-agent: *",
          "Disallow: /",
          "",
          "User-agent: GPTBot",
          "Allow: /",
        ),
      ),
    },
    todos: [ASSERTIONS_UNASSIGNED, CRAWLER_DATASET_UNPINNED],
  }),

  defineFixture({
    id: "bot-005",
    title: "Two groups for one product token are combined",
    condition:
      "Two matching groups for the same product token contribute rules; the tested path /docs/public/report.html matches a longer Allow record from the second group.",
    catalogSection: SECTION,
    classification: "normative",
    layer: "a",
    base: "valid-agent-site-v1",
    expected: {
      rule: RULE,
      profile: PROFILE,
      spec: { status: "pass", assertions: [] },
    },
    changedFromBase: [],
    overrides: {
      "/robots.txt": text(
        PLAIN,
        robotsWithGroups(
          "User-agent: *",
          "Disallow: /",
          "",
          "User-agent: GPTBot",
          "Disallow: /docs/",
          "",
          "User-agent: GPTBot",
          "Allow: /docs/public/",
        ),
      ),
    },
    todos: [ASSERTIONS_UNASSIGNED, CRAWLER_DATASET_UNPINNED],
  }),

  defineFixture({
    id: "bot-006",
    title: "No matching group and no wildcard group",
    condition:
      "Neither a matching group nor a wildcard group exists, so the RFC 9309 default access decision applies.",
    catalogSection: SECTION,
    classification: "compatibility-only",
    layer: "a",
    base: "valid-agent-site-v1",
    expected: {
      rule: RULE,
      profile: PROFILE,
      spec: { status: "pass", assertions: [] },
      compat: { status: "fail", assertions: [] },
    },
    changedFromBase: [changed("compat", RULE, "fail")],
    overrides: {
      "/robots.txt": text(
        PLAIN,
        robotsWithGroups("User-agent: ExampleSearchBot", "Allow: /"),
      ),
    },
    todos: [
      ASSERTIONS_UNASSIGNED,
      COMPAT_ID_UNASSIGNED,
      CRAWLER_DATASET_UNPINNED,
    ],
  }),
];
