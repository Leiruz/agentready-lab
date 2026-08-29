/**
 * The shared layer-A handler (ADR-0006 section 4).
 *
 * One pure function, Web APIs only, no shared mutable state between calls and
 * no runtime-specific import. The Workers entry point wraps it as
 * `export default { fetch }`; a Node adapter in `packages/testkit` converts
 * `IncomingMessage` to `Request` and writes the `Response` back. Neither
 * adapter contains fixture behaviour, which is what makes "the case behaves
 * identically through the in-memory adapter and the Worker handler"
 * (`docs/FIXTURE_CATALOG.md` section 4) a property of this function rather
 * than of two implementations kept in step by review.
 */
import type { CompiledFixtureManifest, ResponseSpec } from "./manifest.js";
import { findRoute, resolveFixture, selectRoute } from "./routing.js";

export type FixtureHandler = (request: Request) => Response;

const PLAIN_TEXT = "text/plain; charset=utf-8";

function plain(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "content-type": PLAIN_TEXT },
  });
}

function notFound(): Response {
  return plain(404, "Unregistered fixture path\n");
}

function build(spec: ResponseSpec, vary: readonly string[]): Response {
  const headers = new Headers();
  for (const header of spec.headers) headers.append(header.name, header.value);
  if (vary.length !== 0) headers.set("vary", vary.join(", "));
  return new Response(spec.body, { status: spec.status, headers });
}

export function createFixtureHandler(
  manifest: CompiledFixtureManifest,
): FixtureHandler {
  return (request: Request): Response => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Fixtures answer GET and HEAD only\n", {
        status: 405,
        headers: { "content-type": PLAIN_TEXT, allow: "GET, HEAD" },
      });
    }

    const url = new URL(request.url);
    const fixture = resolveFixture(manifest, url.hostname);
    if (fixture === undefined) return notFound();

    const spec = findRoute(fixture, url.pathname);
    if (spec === undefined) return notFound();

    const selected = selectRoute(spec, request.headers.get("accept"));

    switch (selected.route.kind) {
      case "absent":
        return notFound();

      case "redirect": {
        const target = selected.route.target;
        if (target.kind !== "route") {
          // Unreachable for a validated manifest: the build-time gate rejects
          // a non-`route` target in a layer-A case (ADR-0006 section 5). Fail
          // closed rather than construct a redirect the manifest did not
          // authorise.
          return plain(500, "Fixture manifest is not valid for layer A\n");
        }
        const location = new URL(target.path, url).toString();
        const headers = new Headers({ location });
        if (selected.vary.length !== 0) {
          headers.set("vary", selected.vary.join(", "));
        }
        return new Response(null, { status: selected.route.status, headers });
      }

      case "static": {
        const response = build(selected.route.response, selected.vary);
        if (request.method !== "HEAD") return response;
        return new Response(null, {
          status: response.status,
          headers: response.headers,
        });
      }
    }
  };
}
