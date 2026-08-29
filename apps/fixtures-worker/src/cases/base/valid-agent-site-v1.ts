/**
 * The known-good base origin every protocol case inherits.
 *
 * `docs/FIXTURE_CATALOG.md` section 2.1 lists what it must serve: a valid
 * homepage, a distinct valid Markdown representation with `Vary: Accept`, a
 * valid `robots.txt` with a deterministic crawler policy and Content Signals,
 * a valid root sitemap, valid Link discovery, a valid API Catalog, and a valid
 * Agent Skills Discovery v0.2.0 index with fixed artifact bytes.
 *
 * Every one of the 49 cases overrides the smallest possible behaviour, so a
 * contract test can fail when an unrelated assertion changes.
 *
 * Bodies are built by joining explicit "\n" strings rather than by using
 * template literals with real newlines: the digest of the skill artifact is
 * pinned in the manifest, and a checkout that rewrote line endings would
 * otherwise change it.
 */
import type {
  FixtureBase,
  HeaderSpec,
  RouteSpec,
  SimpleRoute,
} from "../../manifest.js";

function lines(...parts: readonly string[]): string {
  return parts.join("\n");
}

/** A static route with an explicit status. */
export function statusText(
  status: number,
  contentType: string,
  body: string,
  extraHeaders: readonly HeaderSpec[] = [],
): SimpleRoute {
  return {
    kind: "static",
    response: {
      status,
      headers: [{ name: "content-type", value: contentType }, ...extraHeaders],
      body,
    },
  };
}

/** A `200 OK` static route. `contentType` is the whole field value. */
export function text(
  contentType: string,
  body: string,
  extraHeaders: readonly HeaderSpec[] = [],
): SimpleRoute {
  return statusText(200, contentType, body, extraHeaders);
}

// ---------------------------------------------------------------------------
// Representations
// ---------------------------------------------------------------------------

export const HTML_HOME = lines(
  "<!doctype html>",
  '<html lang="en">',
  "<head>",
  '<meta charset="utf-8">',
  "<title>AgentReady Lab fixture base</title>",
  "</head>",
  "<body>",
  "<h1>AgentReady Lab fixture base</h1>",
  "<p>Known-good base origin for the protocol fixtures.</p>",
  "</body>",
  "</html>",
  "",
);

export const MARKDOWN_HOME = lines(
  "# AgentReady Lab fixture base",
  "",
  "Known-good base origin for the protocol fixtures.",
  "",
);

/** The origin's generic not-found page, reused by the soft-404 cases. */
export const NOT_FOUND_HTML = lines(
  "<!doctype html>",
  '<html lang="en">',
  '<head><meta charset="utf-8"><title>Not found</title></head>',
  "<body><h1>Not found</h1><p>No such page.</p></body>",
  "</html>",
  "",
);

/**
 * One RFC 8288 field line carrying two links. Layer A cannot emit two physical
 * field lines at all: `Headers` combines repeated names into one entry, which
 * is why ADR-0006 section 4 puts `lnk-001` and `lnk-002` in layer B.
 */
export const BASE_LINK_HEADER =
  '</.well-known/api-catalog>; rel="api-catalog", </openapi.json>; rel="service-desc"';

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

/**
 * The wildcard group plus one explicitly named AI crawler group, which is what
 * `bot-001` and `sig-001` inherit unchanged.
 */
export const BASE_ROBOTS_GROUPS = lines(
  "User-agent: *",
  "Allow: /",
  "Disallow: /private/",
  "",
  "User-agent: GPTBot",
  "Allow: /",
);

export const BASE_CONTENT_SIGNAL = "search=yes, ai-input=yes, ai-train=no";

export interface RobotsParts {
  readonly groups: string;
  /** The `Content-Signal` value, or `null` to omit the record entirely. */
  readonly contentSignal: string | null;
  /** The `Sitemap` value, or `null` to omit the record entirely. */
  readonly sitemap: string | null;
}

/**
 * The two extension records are written above the first `User-agent` line so
 * that no case can change one rule's outcome by accident.
 *
 * RFC 9309 section 2.2 gives an ABNF for `user-agent`, `allow` and `disallow`
 * and nothing else, and section 2.2.4 leaves every other record undefined.
 * ADR-0009 forbids inventing a grammar or a placement rule for
 * `Content-Signal`, so no placement here can be the specified one. Writing it
 * outside every group is the placement that keeps `web.policy.content-signals`
 * independent of `web.policy.ai-crawler`: `bot-006` removes the wildcard group
 * entirely, and a group-scoped signal would vanish with it, changing a second
 * rule's outcome and breaking the catalog's own isolation requirement.
 */
export function robotsTxt(parts: RobotsParts): string {
  const preamble = [
    "# AgentReady Lab known-good base origin.",
    "# robots.txt is crawler guidance, not access control.",
  ];
  if (parts.sitemap !== null) preamble.push(`Sitemap: ${parts.sitemap}`);
  if (parts.contentSignal !== null) {
    preamble.push(`Content-Signal: ${parts.contentSignal}`);
  }
  return lines(...preamble, "", parts.groups, "");
}

export const BASE_ROBOTS = robotsTxt({
  groups: BASE_ROBOTS_GROUPS,
  contentSignal: BASE_CONTENT_SIGNAL,
  sitemap: "{{origin}}/sitemap.xml",
});

// ---------------------------------------------------------------------------
// Sitemaps
// ---------------------------------------------------------------------------

export function urlsetXml(...locations: readonly string[]): string {
  return lines(
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...locations.flatMap((loc) => [
      "  <url>",
      `    <loc>${loc}</loc>`,
      "    <lastmod>2026-08-28</lastmod>",
      "  </url>",
    ]),
    "</urlset>",
    "",
  );
}

export const BASE_SITEMAP = urlsetXml("{{origin}}/", "{{origin}}/openapi.json");

// ---------------------------------------------------------------------------
// API Catalog (RFC 9727 over the RFC 9264 JSON linkset)
// ---------------------------------------------------------------------------

export const BASE_API_CATALOG = lines(
  "{",
  '  "linkset": [',
  "    {",
  '      "anchor": "{{origin}}/api/orders",',
  '      "service-desc": [',
  "        {",
  '          "href": "{{origin}}/openapi.json",',
  '          "type": "application/openapi+json"',
  "        }",
  "      ]",
  "    }",
  "  ]",
  "}",
  "",
);

export const BASE_OPENAPI = lines(
  "{",
  '  "openapi": "3.1.0",',
  '  "info": { "title": "AgentReady Lab fixture API", "version": "1.0.0" },',
  '  "paths": {}',
  "}",
  "",
);

// ---------------------------------------------------------------------------
// Agent Skills Discovery v0.2.0
// ---------------------------------------------------------------------------

/**
 * NOT PINNED. No document in this repository records the exact `$schema`
 * identifier, field spelling, or `type` vocabulary of Agent Skills Discovery
 * v0.2.0; `docs/STANDARDS_REGISTRY.md` cites the draft repository and
 * `specs/sources.v0.yaml` does not exist yet. The shape below follows the only
 * pinned prose there is, `skills.entry` in `specs/ruleset.standard.v0.yaml`
 * ("each skill name, allowed type, description, URL, and sha256 digest").
 *
 * The identifier is deliberately under `.invalid` (RFC 6761 section 6.4) so it
 * can never resolve and can never be mistaken for the real one. Every `skl-*`
 * case carries a `pinned-value-unknown` todo pointing here.
 */
export const AGENT_SKILLS_V0_2_0_SCHEMA =
  "https://unpinned.invalid/agent-skills-discovery/v0.2.0/index.schema.json";

export const SKILL_ARTIFACT_PATH =
  "/.well-known/agent-skills/artifacts/hello-world.txt";

/** Fixed artifact bytes. Hashed as bytes, never unpacked and never executed. */
export const SKILL_ARTIFACT = lines(
  "AgentReady Lab fixture skill artifact v1.",
  "Fixed bytes. Never unpacked, never executed.",
  "",
);

/**
 * The lowercase hexadecimal SHA-256 of `SKILL_ARTIFACT`, computed once and
 * pinned here because the manifest is data. `test/base-origin.test.ts`
 * recomputes it with `crypto.subtle` and fails if the bytes drift.
 */
export const SKILL_ARTIFACT_SHA256 =
  "d6b0ef741083cc4990cde3e429bf7af9fde657c96350ea405a548a7686232fda";

export interface SkillEntry {
  readonly name: string;
  readonly type: string;
  readonly description: string;
  readonly url: string;
  readonly sha256: string;
}

export const BASE_SKILL_ENTRY: SkillEntry = {
  name: "hello-world",
  type: "skill",
  description: "A fixed fixture skill that does nothing.",
  url: `{{origin}}${SKILL_ARTIFACT_PATH}`,
  sha256: SKILL_ARTIFACT_SHA256,
};

export function skillsIndex(
  entries: readonly SkillEntry[],
  options: { readonly schema: string | null } = {
    schema: AGENT_SKILLS_V0_2_0_SCHEMA,
  },
): string {
  const head =
    options.schema === null
      ? []
      : [`  "$schema": ${JSON.stringify(options.schema)},`];
  return lines(
    "{",
    ...head,
    '  "skills": [',
    ...entries.flatMap((entry, index) => [
      "    {",
      `      "name": ${JSON.stringify(entry.name)},`,
      `      "type": ${JSON.stringify(entry.type)},`,
      `      "description": ${JSON.stringify(entry.description)},`,
      `      "url": ${JSON.stringify(entry.url)},`,
      `      "sha256": ${JSON.stringify(entry.sha256)}`,
      index === entries.length - 1 ? "    }" : "    },",
    ]),
    "  ]",
    "}",
    "",
  );
}

export const BASE_SKILLS_INDEX = skillsIndex([BASE_SKILL_ENTRY]);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const HOME_PATH = "/";
export const ROBOTS_PATH = "/robots.txt";
export const SITEMAP_PATH = "/sitemap.xml";
export const API_CATALOG_PATH = "/.well-known/api-catalog";
export const SKILLS_INDEX_PATH = "/.well-known/agent-skills/index.json";
export const LEGACY_SKILLS_INDEX_PATH = "/.well-known/skills/index.json";
export const OPENAPI_PATH = "/openapi.json";

export interface HomepageOptions {
  /** The complete `Link` field value, or `null` for no `Link` field. */
  readonly link?: string | null;
  /** Field names for `Vary`. An empty array emits no `Vary` header. */
  readonly vary?: readonly string[];
  readonly markdown?: SimpleRoute;
  readonly html?: SimpleRoute;
}

/**
 * The negotiated homepage. `Accept: text/markdown` selects the Markdown
 * representation and anything else selects HTML, and both carry `Vary: Accept`
 * so a cache cannot serve one for the other.
 */
export function homepage(options: HomepageOptions = {}): RouteSpec {
  const link = options.link === undefined ? BASE_LINK_HEADER : options.link;
  const linkHeaders: readonly HeaderSpec[] =
    link === null ? [] : [{ name: "link", value: link }];

  return {
    kind: "negotiated",
    vary: options.vary ?? ["Accept"],
    variants: [
      {
        accept: "text/markdown",
        route:
          options.markdown ??
          text("text/markdown; charset=utf-8", MARKDOWN_HOME, linkHeaders),
      },
    ],
    otherwise:
      options.html ?? text("text/html; charset=utf-8", HTML_HOME, linkHeaders),
  };
}

export const base: FixtureBase = {
  id: "valid-agent-site-v1",
  status: "pass",
  routes: {
    [HOME_PATH]: homepage(),
    [ROBOTS_PATH]: text("text/plain; charset=utf-8", BASE_ROBOTS),
    [SITEMAP_PATH]: text("application/xml; charset=utf-8", BASE_SITEMAP),
    [API_CATALOG_PATH]: text("application/linkset+json", BASE_API_CATALOG),
    [SKILLS_INDEX_PATH]: text(
      "application/json; charset=utf-8",
      BASE_SKILLS_INDEX,
    ),
    [SKILL_ARTIFACT_PATH]: text("text/plain; charset=utf-8", SKILL_ARTIFACT),
    [OPENAPI_PATH]: text("application/openapi+json", BASE_OPENAPI),
  },
};
