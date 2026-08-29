/**
 * AgentReady Lab fixture Worker.
 *
 * The Workers adapter from ADR-0006 section 4: `export default { fetch }` over
 * the shared layer-A handler and nothing else. All fixture behaviour lives in
 * the compiled manifest, so local and deployed behaviour share one handler
 * (`docs/ARCHITECTURE.md` section 13).
 *
 * It is never an arbitrary proxy. The manifest is a closed union of data with
 * no function member, redirect targets are literal same-manifest routes, and
 * no response depends on a query string. `test/manifest-validation.test.ts`
 * proves the build-time gate rejects each of those shapes.
 *
 * This file is compiled with `"types": ["@cloudflare/workers-types"]` and no
 * Node types, and the Worker declares no `dependencies` at all.
 */
import { base, fixtures } from "./cases/index.js";
import { createFixtureHandler } from "./handler.js";
import { compileManifest } from "./manifest.js";

/**
 * NOT DEPLOYED. ADR-0006 section 2 keeps `manifestHost` as a label for a
 * Workers deployment that does not exist: no domain is owned, and `ROADMAP.md`
 * leaves the deployment optional. The origin is compiled in rather than read
 * from the request because it is substituted into response bodies, and a
 * request-derived origin would reflect the client's `Host` header into a
 * `Sitemap` record and an Agent Skills artifact URL.
 *
 * Replace it with the owned domain when `pnpm fixtures:deploy` is first
 * configured, which needs explicit human approval.
 */
const FIXTURE_ORIGIN = "https://fixtures.invalid";

const handleFixture = createFixtureHandler(
  compileManifest(fixtures, base, { origin: FIXTURE_ORIGIN }),
);

const handler: ExportedHandler = {
  fetch(request): Response {
    return handleFixture(request);
  },
};

export default handler;
