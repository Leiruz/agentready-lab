/**
 * AgentReady Lab fixture Worker.
 *
 * The declarative fixture manifest described in `docs/FIXTURE_CATALOG.md`
 * does not exist yet, so every path is unregistered and the Worker answers
 * 404. It is never an arbitrary proxy: it will only ever serve fixed cases
 * from a manifest compiled into the bundle.
 *
 * This file is compiled with `"types": ["@cloudflare/workers-types"]` and no
 * Node types, and the Worker declares no `dependencies` at all.
 */
const handler: ExportedHandler = {
  fetch(): Response {
    return new Response("Unregistered fixture path\n", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};

export default handler;
