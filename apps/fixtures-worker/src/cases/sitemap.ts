/** `docs/FIXTURE_CATALOG.md` section 6. Rule `web.discovery.sitemap`. */
import { defineFixture } from "../manifest.js";
import type { FixtureDefinition, FixtureTodo } from "../manifest.js";

import {
  BASE_CONTENT_SIGNAL,
  BASE_ROBOTS_GROUPS,
  NOT_FOUND_HTML,
  robotsTxt,
  text,
  urlsetXml,
} from "./base/valid-agent-site-v1.js";
import {
  ASSERTIONS_UNASSIGNED,
  COMPAT_ID_UNASSIGNED,
  changed,
} from "./shared.js";

const RULE = "web.discovery.sitemap";
const PROFILE = "content";
const SECTION = "docs/FIXTURE_CATALOG.md section 6";
const XML = "application/xml; charset=utf-8";
const PLAIN = "text/plain; charset=utf-8";

/** The base robots.txt with only its `Sitemap` record changed. */
function robotsWithSitemap(sitemap: string | null): string {
  return robotsTxt({
    groups: BASE_ROBOTS_GROUPS,
    contentSignal: BASE_CONTENT_SIGNAL,
    sitemap,
  });
}

function sitemapIndexXml(...children: readonly string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...children.flatMap((loc) => [
      "  <sitemap>",
      `    <loc>${loc}</loc>`,
      "    <lastmod>2026-08-28</lastmod>",
      "  </sitemap>",
    ]),
    "</sitemapindex>",
    "",
  ].join("\n");
}

/** An unclosed `<loc>` element. Well-formedness fails; nothing else changes. */
const MALFORMED_SITEMAP = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  "  <url>",
  "    <loc>{{origin}}/",
  "  </url>",
  "</urlset>",
  "",
].join("\n");

const BASE_TODOS: readonly FixtureTodo[] = [ASSERTIONS_UNASSIGNED];

export const sitemapCases: readonly FixtureDefinition[] = [
  defineFixture({
    id: "map-001",
    title: "Conventional root sitemap",
    condition: "/sitemap.xml returns a valid bounded urlset document.",
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
    id: "map-002",
    title: "Discovery through the robots.txt Sitemap record",
    condition:
      "robots.txt declares an absolute same-origin sitemap URL that returns a valid urlset.",
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
    overrides: {
      // The conventional path is removed so that discovery can only come from
      // the Sitemap record, which is the behaviour this case exists to test.
      "/sitemap.xml": { kind: "absent" },
      "/robots.txt": text(
        PLAIN,
        robotsWithSitemap("{{origin}}/sitemap-from-robots.xml"),
      ),
      "/sitemap-from-robots.xml": text(XML, urlsetXml("{{origin}}/")),
    },
    todos: [ASSERTIONS_UNASSIGNED, COMPAT_ID_UNASSIGNED],
  }),

  defineFixture({
    id: "map-003",
    title: "Sitemap index with one bounded child",
    condition:
      "Root sitemap is a valid sitemapindex referring to a bounded same-origin child sitemap.",
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
      "/sitemap.xml": text(
        XML,
        sitemapIndexXml("{{origin}}/sitemap-child.xml"),
      ),
      "/sitemap-child.xml": text(XML, urlsetXml("{{origin}}/")),
    },
    todos: BASE_TODOS,
  }),

  defineFixture({
    id: "map-004",
    title: "Malformed sitemap XML",
    condition: "Endpoint returns malformed XML with an unclosed element.",
    catalogSection: SECTION,
    classification: "normative",
    layer: "a",
    base: "valid-agent-site-v1",
    expected: {
      rule: RULE,
      profile: PROFILE,
      spec: { status: "fail", assertions: [] },
    },
    changedFromBase: [changed("spec", RULE, "fail")],
    overrides: { "/sitemap.xml": text(XML, MALFORMED_SITEMAP) },
    todos: BASE_TODOS,
  }),

  defineFixture({
    id: "map-005",
    title: "Sitemap path returns the not-found page",
    condition: "Endpoint returns 200 text/html with a generic not-found page.",
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
    ],
    overrides: {
      "/sitemap.xml": text("text/html; charset=utf-8", NOT_FOUND_HTML),
    },
    todos: [ASSERTIONS_UNASSIGNED, COMPAT_ID_UNASSIGNED],
  }),

  defineFixture({
    id: "map-006",
    title: "Relative Sitemap record",
    condition:
      "robots.txt contains a relative Sitemap: /nested.xml value, so the source-defined absolute URL form is not used.",
    catalogSection: SECTION,
    classification: "normative",
    layer: "a",
    base: "valid-agent-site-v1",
    expected: {
      rule: RULE,
      profile: PROFILE,
      spec: { status: "fail", assertions: [] },
    },
    changedFromBase: [changed("spec", RULE, "fail")],
    overrides: {
      "/sitemap.xml": { kind: "absent" },
      "/robots.txt": text(PLAIN, robotsWithSitemap("/nested.xml")),
      // Served so that the failure is about the URL form and nothing else.
      "/nested.xml": text(XML, urlsetXml("{{origin}}/")),
    },
    todos: [
      ASSERTIONS_UNASSIGNED,
      {
        kind: "catalog-names-no-such-assertion",
        detail:
          'docs/FIXTURE_CATALOG.md section 6 expects "spec: fail with syntax assertion". web.discovery.sitemap declares sitemap.xml, sitemap.directive and sitemap.canonical, and no assertion named for syntax. sitemap.directive is the closest match and is deliberately not encoded here.',
      },
    ],
  }),
];
