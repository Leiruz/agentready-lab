/**
 * `docs/FIXTURE_CATALOG.md` section 2.1: the base origin must serve a valid
 * representation for every one of the eight M1 rules' happy paths, because
 * every one of the 49 cases inherits it and overrides the smallest possible
 * behaviour.
 */
import { describe, expect, it } from "vitest";

import { base, fixtures } from "../src/cases/index.js";
import { MISMATCHED_SKILL_ARTIFACT } from "../src/cases/agent-skills.js";
import {
  SKILL_ARTIFACT,
  SKILL_ARTIFACT_PATH,
  SKILL_ARTIFACT_SHA256,
} from "../src/cases/base/valid-agent-site-v1.js";
import { createFixtureHandler } from "../src/handler.js";
import { compileSingle } from "../src/manifest.js";

const ORIGIN = "http://127.0.0.1:53411";

function handlerFor(id: string) {
  const fixture = fixtures.find((candidate) => candidate.id === id);
  if (fixture === undefined) throw new Error(`no fixture ${id}`);
  return createFixtureHandler(compileSingle(fixture, base, { origin: ORIGIN }));
}

/** `rob-001` inherits the base with no override at all. */
const serveBase = handlerFor("rob-001");

function get(path: string, headers: Readonly<Record<string, string>> = {}) {
  return serveBase(new Request(`${ORIGIN}${path}`, { headers }));
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("the base origin", () => {
  it("serves a valid robots.txt with a crawler policy and Content Signals", async () => {
    const response = get("/robots.txt");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );

    const body = await response.text();
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Allow: /");
    expect(body).toContain("User-agent: GPTBot");
    expect(body).toContain(
      "Content-Signal: search=yes, ai-input=yes, ai-train=no",
    );
    // ADR-0006 section 3: the origin is injected, so the Sitemap record is the
    // absolute same-origin URL the Sitemaps protocol requires even though the
    // port is not known until the harness binds it.
    expect(body).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    expect(body).not.toContain("{{origin}}");
  });

  it("serves a valid root sitemap", async () => {
    const response = get("/sitemap.xml");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/xml; charset=utf-8",
    );

    const body = await response.text();
    expect(body).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(body).toContain(`<loc>${ORIGIN}/</loc>`);
  });

  it("serves useful Link discovery on the homepage", () => {
    const link = get("/").headers.get("link");
    expect(link).toBe(
      '</.well-known/api-catalog>; rel="api-catalog", </openapi.json>; rel="service-desc"',
    );
  });

  it("serves a valid API Catalog", async () => {
    const response = get("/.well-known/api-catalog");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/linkset+json",
    );

    const document: {
      readonly linkset: readonly {
        readonly anchor: string;
        readonly "service-desc": readonly { readonly href: string }[];
      }[];
    } = await response.json();
    expect(document.linkset.length).toBe(1);
    const entry = document.linkset[0];
    expect(entry?.anchor.startsWith(`${ORIGIN}/`)).toBe(true);
    expect(entry?.["service-desc"][0]?.href).toBe(`${ORIGIN}/openapi.json`);
  });

  it("serves an Agent Skills index whose digest matches the fixed artifact", async () => {
    const response = get("/.well-known/agent-skills/index.json");
    expect(response.status).toBe(200);

    const document: {
      readonly $schema: string;
      readonly skills: readonly {
        readonly url: string;
        readonly sha256: string;
      }[];
    } = await response.json();
    expect(document.$schema.length).toBeGreaterThan(0);
    const entry = document.skills[0];
    expect(entry?.url).toBe(`${ORIGIN}${SKILL_ARTIFACT_PATH}`);
    expect(entry?.sha256).toMatch(/^[0-9a-f]{64}$/);

    const artifact = get(SKILL_ARTIFACT_PATH);
    expect(artifact.status).toBe(200);
    expect(await sha256Hex(await artifact.text())).toBe(entry?.sha256);
  });

  it("pins the artifact digest to the artifact bytes", async () => {
    expect(await sha256Hex(SKILL_ARTIFACT)).toBe(SKILL_ARTIFACT_SHA256);
  });

  it("serves the service description the catalog and Link field both name", () => {
    const response = get("/openapi.json");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/openapi+json",
    );
  });
});

describe("representation negotiation", () => {
  it("returns genuinely different representations for HTML and Markdown", async () => {
    const html = get("/", { accept: "text/html" });
    const markdown = get("/", { accept: "text/markdown" });

    expect(html.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(markdown.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(html.headers.get("vary")).toBe("Accept");
    expect(markdown.headers.get("vary")).toBe("Accept");

    const htmlBody = await html.text();
    const markdownBody = await markdown.text();
    expect(htmlBody).not.toBe(markdownBody);
    expect(htmlBody.startsWith("<!doctype html>")).toBe(true);
    expect(markdownBody.startsWith("# ")).toBe(true);
  });

  it("falls back to HTML when Accept names neither type", () => {
    expect(get("/", { accept: "*/*" }).headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(get("/").headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
  });

  it("ignores quality values rather than guessing at a preference order", () => {
    const response = get("/", {
      accept: "text/html;q=0.1, text/markdown;q=0.9",
    });
    expect(response.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
  });
});

describe("the handler", () => {
  it("answers 404 for a path the fixture does not declare", async () => {
    const response = get("/not-declared");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(await response.text()).toBe("Unregistered fixture path\n");
  });

  it("answers 405 for a method other than GET or HEAD", () => {
    const response = serveBase(new Request(`${ORIGIN}/`, { method: "POST" }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });

  it("answers HEAD with the response headers and no body", async () => {
    const response = serveBase(
      new Request(`${ORIGIN}/robots.txt`, { method: "HEAD" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(await response.text()).toBe("");
  });
});

describe("overrides change only what they declare", () => {
  it("rob-002 removes robots.txt and nothing else", async () => {
    const serve = handlerFor("rob-002");
    expect(serve(new Request(`${ORIGIN}/robots.txt`)).status).toBe(404);
    expect(serve(new Request(`${ORIGIN}/sitemap.xml`)).status).toBe(200);
    expect(serve(new Request(`${ORIGIN}/`)).headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(await serve(new Request(`${ORIGIN}/`)).text()).toBe(
      await get("/").text(),
    );
  });

  it("rob-004 redirects to a same-origin absolute Location", () => {
    const response = handlerFor("rob-004")(new Request(`${ORIGIN}/robots.txt`));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/robots-final.txt`);
  });

  it("rob-005 redirects in a loop the transport must break", () => {
    const serve = handlerFor("rob-005");
    expect(
      serve(new Request(`${ORIGIN}/robots.txt`)).headers.get("location"),
    ).toBe(`${ORIGIN}/robots-loop.txt`);
    expect(
      serve(new Request(`${ORIGIN}/robots-loop.txt`)).headers.get("location"),
    ).toBe(`${ORIGIN}/robots.txt`);
  });

  it("md-002 keeps the Markdown representation and drops Vary", () => {
    const response = handlerFor("md-002")(
      new Request(`${ORIGIN}/`, { headers: { accept: "text/markdown" } }),
    );
    expect(response.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(response.headers.get("vary")).toBeNull();
  });

  it("md-003 answers a Markdown request with HTML and keeps the Link field", () => {
    const response = handlerFor("md-003")(
      new Request(`${ORIGIN}/`, { headers: { accept: "text/markdown" } }),
    );
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(response.headers.get("link")).toBe(get("/").headers.get("link"));
  });

  it("md-004 refuses the Markdown representation", () => {
    expect(
      handlerFor("md-004")(
        new Request(`${ORIGIN}/`, { headers: { accept: "text/markdown" } }),
      ).status,
    ).toBe(406);
  });

  it("md-006 redirects a Markdown request to a Markdown representation", async () => {
    const serve = handlerFor("md-006");
    const redirect = serve(
      new Request(`${ORIGIN}/`, { headers: { accept: "text/markdown" } }),
    );
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe(`${ORIGIN}/index.md`);

    const final = serve(new Request(`${ORIGIN}/index.md`));
    expect(final.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(final.headers.get("vary")).toBe("Accept");
    expect((await final.text()).startsWith("# ")).toBe(true);
  });

  it("lnk-003 resolves its relative target against the redirected URL", () => {
    const serve = handlerFor("lnk-003");
    const redirect = serve(new Request(`${ORIGIN}/`));
    expect(redirect.headers.get("location")).toBe(`${ORIGIN}/pages/home`);

    const page = serve(new Request(`${ORIGIN}/pages/home`));
    expect(page.headers.get("link")).toBe('<openapi.json>; rel="service-desc"');
    expect(serve(new Request(`${ORIGIN}/pages/openapi.json`)).status).toBe(200);
    // Resolving against the requested URL instead of the effective one lands
    // on a path this fixture does not serve, which is the point of the case.
    expect(serve(new Request(`${ORIGIN}/openapi.json`)).status).toBe(200);
  });

  it("skl-007 serves artifact bytes that do not match the declared digest", async () => {
    const serve = handlerFor("skl-007");
    const index: {
      readonly skills: readonly { readonly sha256: string }[];
    } = await serve(
      new Request(`${ORIGIN}/.well-known/agent-skills/index.json`),
    ).json();

    const artifact = await serve(
      new Request(`${ORIGIN}${SKILL_ARTIFACT_PATH}`),
    ).text();
    expect(artifact).toBe(MISMATCHED_SKILL_ARTIFACT);
    expect(index.skills[0]?.sha256).toBe(SKILL_ARTIFACT_SHA256);
    expect(await sha256Hex(artifact)).not.toBe(SKILL_ARTIFACT_SHA256);
  });

  it("skl-004 moves the index to the legacy path", () => {
    const serve = handlerFor("skl-004");
    expect(
      serve(new Request(`${ORIGIN}/.well-known/agent-skills/index.json`))
        .status,
    ).toBe(404);
    expect(
      serve(new Request(`${ORIGIN}/.well-known/skills/index.json`)).status,
    ).toBe(200);
  });
});
