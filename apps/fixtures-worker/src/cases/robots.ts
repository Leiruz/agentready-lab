/** `docs/FIXTURE_CATALOG.md` section 5. Rule `web.discovery.robots`. */
import { defineFixture } from "../manifest.js";
import type { FixtureDefinition } from "../manifest.js";

import {
  BASE_CONTENT_SIGNAL,
  BASE_ROBOTS,
  BASE_ROBOTS_GROUPS,
  NOT_FOUND_HTML,
  robotsTxt,
  text,
} from "./base/valid-agent-site-v1.js";
import {
  ASSERTIONS_UNASSIGNED,
  COLLATERAL_UNDECIDED,
  COMPAT_ID_UNASSIGNED,
  changed,
  collateral,
} from "./shared.js";

const RULE = "web.discovery.robots";
const PROFILE = "content";
const SECTION = "docs/FIXTURE_CATALOG.md section 5";
const PLAIN = "text/plain; charset=utf-8";

/** The two rules a missing or unparseable robots.txt necessarily takes with it. */
function robotsCollateral(reason: string) {
  return [
    collateral("spec", "web.policy.ai-crawler", reason),
    collateral("spec", "web.policy.content-signals", reason),
  ];
}

export const robotsCases: readonly FixtureDefinition[] = [
  defineFixture({
    id: "rob-001",
    title: "Valid robots.txt",
    condition:
      "GET /robots.txt returns bounded UTF-8 plain text with a valid User-agent group and rules.",
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
    todos: [ASSERTIONS_UNASSIGNED, COMPAT_ID_UNASSIGNED],
  }),

  defineFixture({
    id: "rob-002",
    title: "robots.txt is absent",
    condition: "/robots.txt returns an actual 404.",
    catalogSection: SECTION,
    classification: "compatibility-only",
    layer: "a",
    base: "valid-agent-site-v1",
    expected: {
      rule: RULE,
      profile: PROFILE,
      spec: { status: "not-applicable", assertions: [] },
      compat: { status: "fail", assertions: [] },
    },
    changedFromBase: [
      changed("spec", RULE, "not-applicable"),
      changed("compat", RULE, "fail"),
      ...robotsCollateral(
        "no robots.txt means no crawler policy and no Content Signals declaration",
      ),
    ],
    overrides: { "/robots.txt": { kind: "absent" } },
    todos: [ASSERTIONS_UNASSIGNED, COMPAT_ID_UNASSIGNED, COLLATERAL_UNDECIDED],
  }),

  defineFixture({
    id: "rob-003",
    title: "robots.txt is a soft 404",
    condition:
      "Returns 200 text/html containing the site's generic not-found page.",
    catalogSection: SECTION,
    classification: "normative",
    layer: "a",
    base: "valid-agent-site-v1",
    expected: {
      rule: RULE,
      profile: PROFILE,
      spec: { status: "fail", assertions: [] },
      compat: { status: "fail", assertions: [] },
    },
    changedFromBase: [
      changed("spec", RULE, "fail"),
      changed("compat", RULE, "fail"),
      ...robotsCollateral(
        "an HTML not-found page carries no parseable REP records",
      ),
    ],
    overrides: {
      "/robots.txt": text("text/html; charset=utf-8", NOT_FOUND_HTML),
    },
    todos: [ASSERTIONS_UNASSIGNED, COMPAT_ID_UNASSIGNED, COLLATERAL_UNDECIDED],
  }),

  defineFixture({
    id: "rob-004",
    title: "One same-origin redirect to a valid robots.txt",
    condition:
      "One same-origin redirect leads to a valid /robots-final.txt; redirect evidence is retained.",
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
      "/robots.txt": {
        kind: "redirect",
        status: 302,
        target: { kind: "route", path: "/robots-final.txt" },
      },
      "/robots-final.txt": text(PLAIN, BASE_ROBOTS),
    },
    todos: [ASSERTIONS_UNASSIGNED],
  }),

  defineFixture({
    id: "rob-005",
    title: "Redirect loop exceeds the redirect budget",
    condition:
      "Redirect loop exceeds the per-observation redirect budget, so a transport limit must not become a false syntax failure.",
    catalogSection: SECTION,
    classification: "normative",
    layer: "a",
    base: "valid-agent-site-v1",
    expected: {
      rule: RULE,
      profile: PROFILE,
      spec: { status: "unable-to-check", assertions: [] },
    },
    changedFromBase: [
      changed("spec", RULE, "unable-to-check"),
      ...robotsCollateral(
        "the loop means no robots.txt representation is ever read",
      ),
    ],
    overrides: {
      "/robots.txt": {
        kind: "redirect",
        status: 302,
        target: { kind: "route", path: "/robots-loop.txt" },
      },
      "/robots-loop.txt": {
        kind: "redirect",
        status: 302,
        target: { kind: "route", path: "/robots.txt" },
      },
    },
    todos: [ASSERTIONS_UNASSIGNED, COLLATERAL_UNDECIDED],
  }),

  defineFixture({
    id: "rob-006",
    title: "Valid group among comments and unknown records",
    condition:
      "A valid group is surrounded by comments, blank lines, and unknown fields; parsing stays tolerant without inventing semantics.",
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
        robotsTxt({
          groups: [
            "# A comment before the first group.",
            "Unknown-field: ignored by RFC 9309 section 2.2.4",
            "",
            "",
            BASE_ROBOTS_GROUPS,
            "",
            "# A trailing comment.",
            "Crawl-delay: 10",
          ].join("\n"),
          contentSignal: BASE_CONTENT_SIGNAL,
          sitemap: "{{origin}}/sitemap.xml",
        }),
      ),
    },
    todos: [ASSERTIONS_UNASSIGNED],
  }),
];
