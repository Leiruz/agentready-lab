/**
 * Fixture and route resolution. Pure functions over the compiled manifest and
 * a parsed `URL`; nothing here reads a query string.
 */
import type {
  CompiledFixture,
  CompiledFixtureManifest,
  RouteSpec,
  SimpleRoute,
} from "./manifest.js";

/**
 * ADR-0006 section 2. A deployed Worker selects the case from the leftmost
 * label of the request host, which is the `manifestHost` label and nothing
 * else. The local harness binds one case per ephemeral port, where the host is
 * an IP literal and the manifest carries exactly one fixture.
 */
export function resolveFixture(
  manifest: CompiledFixtureManifest,
  hostname: string,
): CompiledFixture | undefined {
  if (manifest.kind === "single") return manifest.fixture;
  const label = hostname.split(".")[0];
  if (label === undefined || label.length === 0) return undefined;
  return manifest.fixtures.find((fixture) => fixture.id === label);
}

export function findRoute(
  fixture: CompiledFixture,
  path: string,
): RouteSpec | undefined {
  return fixture.routes.find((route) => route.path === path)?.spec;
}

/**
 * The media types an `Accept` field names, lowercased, in field order. Quality
 * values and wildcards are ignored on purpose: a fixture must select the same
 * representation on every run, and the cases that exist here only ever send
 * one exact media type.
 */
export function acceptedMediaTypes(accept: string | null): readonly string[] {
  if (accept === null) return [];
  return accept
    .split(",")
    .map((entry) => (entry.split(";")[0] ?? "").trim().toLowerCase())
    .filter((mediaType) => mediaType.length !== 0);
}

export interface SelectedRoute {
  readonly route: SimpleRoute;
  /** Field names to place in `Vary`. Empty means no `Vary` header. */
  readonly vary: readonly string[];
}

export function selectRoute(
  spec: RouteSpec,
  accept: string | null,
): SelectedRoute {
  if (spec.kind !== "negotiated") return { route: spec, vary: [] };

  const accepted = acceptedMediaTypes(accept);
  const match = spec.variants.find((variant) =>
    accepted.includes(variant.accept.toLowerCase()),
  );
  return { route: match?.route ?? spec.otherwise, vary: spec.vary };
}
