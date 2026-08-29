/**
 * The declarative fixture manifest.
 *
 * `docs/decisions/0006-local-fixture-host-model.md` section 4 makes a route
 * specification a closed union of *data*. There is deliberately no member of
 * `RouteSpec` that is a function: a function could read the query string, and
 * a fixture that reads the query string is one refactor away from being a
 * proxy or an open redirect. Keeping the union closed is what lets
 * `validateFixtures` decide, at build time, that neither is possible.
 *
 * Web APIs only: `TextEncoder`, `URL`, `Request`, `Response`, `Headers`. No
 * `node:*`, no `cloudflare:*`, no workspace dependency.
 */
import type { Mode, Profile, RuleId, Status } from "./ruleset-ids.js";
import {
  MODES,
  PROFILES,
  STATUSES,
  assertionIdsFor,
  isRuleId,
  profilesFor,
} from "./ruleset-ids.js";

// ---------------------------------------------------------------------------
// Route specifications
// ---------------------------------------------------------------------------

export interface HeaderSpec {
  readonly name: string;
  readonly value: string;
}

export interface ResponseSpec {
  readonly status: number;
  readonly headers: readonly HeaderSpec[];
  readonly body: string;
}

/**
 * ADR-0006 section 5. A `Location` value is symbolic in the manifest and is
 * resolved to a concrete string only after the ephemeral ports for the case
 * are bound. Layer A may use `route` and nothing else.
 */
export type RedirectTarget =
  | { readonly kind: "route"; readonly path: string }
  | {
      readonly kind: "peer-server";
      readonly server: string;
      readonly path: string;
    }
  | {
      readonly kind: "loopback-name";
      readonly host: "localhost";
      readonly path: string;
    }
  | {
      readonly kind: "address-literal";
      readonly address: string;
      readonly path: string;
    };

export type RedirectStatus = 301 | 302 | 303 | 307 | 308;

export type SimpleRoute =
  | { readonly kind: "static"; readonly response: ResponseSpec }
  | {
      readonly kind: "redirect";
      readonly status: RedirectStatus;
      readonly target: RedirectTarget;
    }
  | { readonly kind: "absent" };

export interface NegotiatedVariant {
  /** An exact media type compared against the request's `Accept` field. */
  readonly accept: string;
  readonly route: SimpleRoute;
}

export type RouteSpec =
  | SimpleRoute
  | {
      readonly kind: "negotiated";
      /** Field names added to `Vary`. Empty means no `Vary` header at all. */
      readonly vary: readonly string[];
      readonly variants: readonly NegotiatedVariant[];
      readonly otherwise: SimpleRoute;
    };

// ---------------------------------------------------------------------------
// Fixture definitions
// ---------------------------------------------------------------------------

/**
 * `.claude/rules/standards.md`, "Fixture provenance": a manifest entry must
 * say whether the case is normative, recommended, advisory, ambiguous, or
 * compatibility-only.
 */
export const CLASSIFICATIONS = [
  "normative",
  "recommended",
  "advisory",
  "ambiguous",
  "compatibility-only",
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

/**
 * A typed marker for an expectation no pinned document decides yet.
 *
 * The manifest validator finds these; it never guesses past one. Inventing a
 * finding code here would bury an interpretation in evaluator data, which
 * `.claude/rules/standards.md` forbids.
 */
export const TODO_KINDS = [
  /** No pinned document names the assertion ids this case pins. */
  "assertion-ids-unassigned",
  /**
   * `specs/ruleset.standard.v0.yaml`'s own `todo` records that no accepted
   * decision names a single compat-mode assertion id, so every compat
   * expectation here carries a status and no id.
   */
  "compat-assertion-id-unassigned",
  /** The catalog names an assertion the pinned ruleset does not declare. */
  "catalog-names-no-such-assertion",
  /** A rule input this expectation depends on is not pinned anywhere. */
  "rule-input-unpinned",
  /** A value the fixture bytes must contain is not pinned by any document. */
  "pinned-value-unknown",
  /**
   * The override necessarily disturbs a second rule and no pinned document
   * decides what that rule then reports.
   */
  "collateral-outcome-undecided",
] as const;
export type TodoKind = (typeof TODO_KINDS)[number];

export interface FixtureTodo {
  readonly kind: TodoKind;
  readonly detail: string;
}

export interface ModeExpectation {
  readonly status: Status;
  /**
   * Assertion ids this case pins, which are also the finding codes a violation
   * reports (ADR-0002 section 9, ADR-0007 section 4). Empty means no pinned
   * document names them, and a matching todo is then required.
   */
  readonly assertions: readonly string[];
}

export interface Expected {
  readonly rule: RuleId;
  readonly profile: Profile;
  readonly spec: ModeExpectation;
  /** Present only where `docs/FIXTURE_CATALOG.md` states a compat expectation. */
  readonly compat?: ModeExpectation;
  /** Present only where the catalog states an interop expectation. */
  readonly interop?: ModeExpectation;
}

/**
 * `docs/FIXTURE_CATALOG.md` section 2.1: an override must declare **every**
 * assertion it expects to change, so a contract test fails when an unrelated
 * assertion changes relative to the base.
 *
 * "Every" includes a second rule the override necessarily disturbs. Removing
 * `/robots.txt` to test `web.discovery.robots` also removes the crawler policy
 * and the Content Signals declaration, and pretending otherwise would make the
 * isolation gate lie. Those entries name the foreign rule and, where no pinned
 * document decides the resulting status, carry `to: "undecided"` with a
 * matching todo instead of a guess.
 *
 * `assertion` is `null` where no pinned document names the id. The entry stays
 * enforceable at rule level: the rule, the base status and this case's status
 * are all pinned.
 */
export type ChangeTo = Status | "undecided";

export interface ChangedAssertion {
  readonly mode: Mode;
  readonly rule: RuleId;
  readonly assertion: string | null;
  readonly from: Status;
  readonly to: ChangeTo;
  /** Why this rule's outcome moves. Required for a rule other than the case's. */
  readonly reason?: string;
}

export const BASE_ID = "valid-agent-site-v1";

export interface FixtureDefinition {
  readonly id: string;
  readonly title: string;
  /** The intended condition, from `docs/FIXTURE_CATALOG.md`. */
  readonly condition: string;
  /** Provenance: the catalog section this case comes from. */
  readonly catalogSection: string;
  readonly classification: Classification;
  /** ADR-0006 section 4. `"b"` cases are declared here and served elsewhere. */
  readonly layer: "a" | "b";
  readonly layerBReason?: string;
  readonly base: typeof BASE_ID;
  readonly expected: Expected;
  readonly changedFromBase: readonly ChangedAssertion[];
  readonly overrides: Readonly<Record<string, RouteSpec>>;
  readonly todos: readonly FixtureTodo[];
}

export interface FixtureBase {
  readonly id: typeof BASE_ID;
  readonly routes: Readonly<Record<string, RouteSpec>>;
  /** The status every M1 rule holds on the unmodified base, in every mode. */
  readonly status: Status;
}

/**
 * Identity constructor. It exists so a case file reads as data and so a
 * definition is type-checked at its declaration site rather than only where
 * the array is assembled.
 */
export function defineFixture(
  definition: FixtureDefinition,
): FixtureDefinition {
  return definition;
}

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

/**
 * The one substitution token a body or header value may contain. ADR-0006
 * section 3 requires the origin to be injected rather than normalized away:
 * an absolute same-origin `Sitemap:` record and an absolute Agent Skills
 * artifact URL cannot be written any other way when the port is ephemeral.
 *
 * It is resolved at compile time from an origin the harness supplies, never
 * from anything on the request. A request-derived origin would reflect the
 * client's `Host` header into the response body.
 */
export const ORIGIN_TOKEN = "{{origin}}";

export interface CompileOptions {
  /** An absolute origin with no path, query, or fragment. */
  readonly origin: string;
}

export interface CompiledRoute {
  readonly path: string;
  readonly spec: RouteSpec;
}

export interface CompiledFixture {
  readonly id: string;
  readonly manifestHost: string;
  readonly layer: "a" | "b";
  readonly routes: readonly CompiledRoute[];
}

export type CompiledFixtureManifest =
  | { readonly kind: "single"; readonly fixture: CompiledFixture }
  | {
      readonly kind: "host-routed";
      readonly fixtures: readonly CompiledFixture[];
    };

/**
 * ADR-0006 section 2. The `<id>.fixture.test` name survives only as a manifest
 * label, used for uniqueness checking and for routing a possible future
 * Workers deployment. It is never given to a transport and never used to build
 * a scan target.
 */
export function manifestHostFor(id: string): string {
  return `${id}.fixture.test`;
}

function substitute(text: string, origin: string): string {
  return text.split(ORIGIN_TOKEN).join(origin);
}

function compileResponse(spec: ResponseSpec, origin: string): ResponseSpec {
  return {
    status: spec.status,
    headers: spec.headers.map((header) => ({
      name: header.name,
      value: substitute(header.value, origin),
    })),
    body: substitute(spec.body, origin),
  };
}

function compileSimple(route: SimpleRoute, origin: string): SimpleRoute {
  switch (route.kind) {
    case "static":
      return {
        kind: "static",
        response: compileResponse(route.response, origin),
      };
    case "redirect":
    case "absent":
      return route;
  }
}

function compileRoute(spec: RouteSpec, origin: string): RouteSpec {
  if (spec.kind !== "negotiated") return compileSimple(spec, origin);
  return {
    kind: "negotiated",
    vary: spec.vary,
    variants: spec.variants.map((variant) => ({
      accept: variant.accept,
      route: compileSimple(variant.route, origin),
    })),
    otherwise: compileSimple(spec.otherwise, origin),
  };
}

/** Base routes with the case's overrides applied, sorted by path. */
export function mergedRoutes(
  definition: FixtureDefinition,
  base: FixtureBase,
): readonly CompiledRoute[] {
  const merged = new Map<string, RouteSpec>();
  for (const [path, spec] of Object.entries(base.routes)) {
    merged.set(path, spec);
  }
  for (const [path, spec] of Object.entries(definition.overrides)) {
    merged.set(path, spec);
  }
  return [...merged.entries()]
    .map(([path, spec]) => ({ path, spec }))
    .sort((left, right) => (left.path < right.path ? -1 : 1));
}

export function compileFixture(
  definition: FixtureDefinition,
  base: FixtureBase,
  options: CompileOptions,
): CompiledFixture {
  return {
    id: definition.id,
    manifestHost: manifestHostFor(definition.id),
    layer: definition.layer,
    routes: mergedRoutes(definition, base).map((route) => ({
      path: route.path,
      spec: compileRoute(route.spec, options.origin),
    })),
  };
}

/** Every layer-A case, routed by the leftmost label of the request host. */
export function compileManifest(
  definitions: readonly FixtureDefinition[],
  base: FixtureBase,
  options: CompileOptions,
): CompiledFixtureManifest {
  return {
    kind: "host-routed",
    fixtures: definitions
      .filter((definition) => definition.layer === "a")
      .map((definition) => compileFixture(definition, base, options))
      .sort((left, right) => (left.id < right.id ? -1 : 1)),
  };
}

/** One case on its own ephemeral port, which is how the local harness runs. */
export function compileSingle(
  definition: FixtureDefinition,
  base: FixtureBase,
  options: CompileOptions,
): CompiledFixtureManifest {
  return { kind: "single", fixture: compileFixture(definition, base, options) };
}

/**
 * Key-sorted JSON. Two properties matter: the output is byte-stable across
 * builds regardless of property insertion order, and it throws on any value
 * JSON cannot represent, which is how a function smuggled into a `RouteSpec`
 * by a cast is caught at build time instead of at request time.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`non-finite number in manifest: ${String(value)}`);
    }
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return `[${items.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    const members = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${members.join(",")}}`;
  }
  throw new Error(`a ${typeof value} cannot appear in a manifest`);
}

// ---------------------------------------------------------------------------
// Build-time validation (docs/FIXTURE_CATALOG.md section 15)
// ---------------------------------------------------------------------------

export const MAX_BODY_BYTES = 65_536;
export const MAX_MANIFEST_BYTES = 4_194_304;
export const MAX_DNS_LABEL_LENGTH = 63;

export const ISSUE_CODES = [
  "id-not-lowercase-ascii",
  "id-duplicate",
  "manifest-host-invalid-label",
  "manifest-host-duplicate",
  "route-path-not-absolute",
  "route-path-has-query",
  "route-path-has-wildcard",
  "redirect-target-not-a-route",
  "redirect-route-target-undefined",
  "redirect-non-route-target-must-expect-block",
  "body-bytes-exceeded",
  "manifest-bytes-exceeded",
  "header-value-invalid",
  "unresolved-template-token",
  "unknown-rule",
  "unknown-profile",
  "profile-not-declared-by-rule",
  "unknown-status",
  "unknown-assertion",
  "assertion-ids-missing-todo",
  "changed-from-base-unknown-rule",
  "changed-from-base-missing",
  "changed-from-base-unexpected",
  "changed-from-base-wrong-status",
  "changed-from-base-no-op",
  "changed-from-base-missing-reason",
  "changed-from-base-undecided-without-todo",
  "changed-from-base-null-assertion-without-todo",
  "layer-b-has-overrides",
  "layer-b-missing-reason",
  "non-serializable-manifest",
] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];

export interface ValidationIssue {
  readonly code: IssueCode;
  readonly fixtureId: string;
  readonly detail: string;
}

const LOWERCASE_ASCII_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
/** RFC 9110 field values: visible ASCII, space and horizontal tab only. */
const SAFE_HEADER_VALUE = /^[\t -~]*$/;

function encodedLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function simpleRoutes(spec: RouteSpec): readonly SimpleRoute[] {
  if (spec.kind !== "negotiated") return [spec];
  return [...spec.variants.map((variant) => variant.route), spec.otherwise];
}

/**
 * ADR-0006 section 5: a case using a non-`route` redirect target must expect
 * the scan to be blocked, so the harness cannot build a redirect a scan
 * actually traverses.
 */
function expectsBlock(definition: FixtureDefinition): boolean {
  const statuses: readonly (Status | undefined)[] = [
    definition.expected.spec.status,
    definition.expected.compat?.status,
    definition.expected.interop?.status,
  ];
  return statuses.some(
    (status) => status === "unable-to-check" || status === "fail",
  );
}

function hasAssertionTodo(definition: FixtureDefinition): boolean {
  return definition.todos.some(
    (todo) =>
      todo.kind === "assertion-ids-unassigned" ||
      todo.kind === "compat-assertion-id-unassigned" ||
      todo.kind === "catalog-names-no-such-assertion",
  );
}

function validateModeExpectation(
  definition: FixtureDefinition,
  mode: Mode,
  expectation: ModeExpectation,
  push: (code: IssueCode, detail: string) => void,
): void {
  if (!STATUSES.includes(expectation.status)) {
    push("unknown-status", `${mode}: ${expectation.status}`);
  }

  const known = assertionIdsFor(definition.expected.rule);
  for (const assertion of expectation.assertions) {
    if (!known.includes(assertion)) {
      push(
        "unknown-assertion",
        `${mode}: ${assertion} is not declared by ${definition.expected.rule}`,
      );
    }
  }

  if (expectation.assertions.length === 0 && !hasAssertionTodo(definition)) {
    push(
      "assertion-ids-missing-todo",
      `${mode} names no assertion and declares no todo saying why`,
    );
  }
}

function validateChangedFromBase(
  definition: FixtureDefinition,
  base: FixtureBase,
  push: (code: IssueCode, detail: string) => void,
): void {
  for (const change of definition.changedFromBase) {
    if (!isRuleId(change.rule)) {
      push("changed-from-base-unknown-rule", change.rule);
      continue;
    }
    if (change.from !== base.status) {
      push(
        "changed-from-base-wrong-status",
        `${change.mode}: the base status is ${base.status}, not ${change.from}`,
      );
    }
    if (change.to === change.from) {
      push(
        "changed-from-base-no-op",
        `${change.mode} ${change.rule}: declaring a change to the base status says nothing`,
      );
    }
    if (
      change.to === "undecided" &&
      !definition.todos.some(
        (todo) => todo.kind === "collateral-outcome-undecided",
      )
    ) {
      push(
        "changed-from-base-undecided-without-todo",
        `${change.mode} ${change.rule}`,
      );
    }
    if (
      change.rule !== definition.expected.rule &&
      change.reason === undefined
    ) {
      push(
        "changed-from-base-missing-reason",
        `${change.rule} is not this case's rule and carries no reason`,
      );
    }
    if (change.assertion === null) {
      if (!hasAssertionTodo(definition)) {
        push(
          "changed-from-base-null-assertion-without-todo",
          `${change.mode}: unnamed assertion with no todo explaining why`,
        );
      }
    } else if (!assertionIdsFor(change.rule).includes(change.assertion)) {
      push(
        "unknown-assertion",
        `changedFromBase names ${change.assertion}, which ${change.rule} does not declare`,
      );
    }
  }

  const declared = new Map<Mode, ChangeTo>();
  for (const change of definition.changedFromBase) {
    if (change.rule === definition.expected.rule) {
      declared.set(change.mode, change.to);
    }
  }

  for (const mode of MODES) {
    const expectation = definition.expected[mode];
    const change = declared.get(mode);
    if (expectation === undefined) {
      if (change !== undefined) {
        push(
          "changed-from-base-unexpected",
          `${mode} is declared changed but the case states no ${mode} expectation`,
        );
      }
      continue;
    }
    if (expectation.status === base.status) {
      if (change !== undefined) {
        push(
          "changed-from-base-unexpected",
          `${mode} equals the base status but a change is declared`,
        );
      }
      continue;
    }
    if (change === undefined) {
      push(
        "changed-from-base-missing",
        `${mode} status ${expectation.status} differs from the base and is not declared`,
      );
    } else if (change !== expectation.status) {
      push(
        "changed-from-base-wrong-status",
        `${mode}: declared a change to ${change} but the expectation says ${expectation.status}`,
      );
    }
  }
}

function validateRoutes(
  definition: FixtureDefinition,
  base: FixtureBase,
  push: (code: IssueCode, detail: string) => void,
): number {
  const routes = mergedRoutes(definition, base);
  const paths = new Set(routes.map((route) => route.path));
  let bytes = 0;

  for (const route of routes) {
    // "//" is a protocol-relative reference and "\" is folded to "/" by the
    // WHATWG URL parser, so either one lets `new URL(path, requestUrl)` in the
    // handler land on a different host. An absolute path here means one
    // leading slash and nothing that can become a second one.
    if (
      !route.path.startsWith("/") ||
      route.path.startsWith("//") ||
      route.path.includes("\\")
    ) {
      push("route-path-not-absolute", route.path);
    }
    if (route.path.includes("?") || route.path.includes("#")) {
      push("route-path-has-query", route.path);
    }
    if (route.path.includes("*")) {
      push("route-path-has-wildcard", route.path);
    }

    for (const simple of simpleRoutes(route.spec)) {
      if (simple.kind === "redirect") {
        if (simple.target.kind !== "route") {
          if (definition.layer === "a") {
            push(
              "redirect-target-not-a-route",
              `${route.path}: layer A may only redirect to a route this manifest defines`,
            );
          } else if (!expectsBlock(definition)) {
            push(
              "redirect-non-route-target-must-expect-block",
              `${route.path}: ADR-0006 section 5 forbids a followed non-route redirect`,
            );
          }
        } else if (!paths.has(simple.target.path)) {
          push(
            "redirect-route-target-undefined",
            `${route.path} -> ${simple.target.path}`,
          );
        }
        continue;
      }
      if (simple.kind !== "static") continue;

      const size = encodedLength(simple.response.body);
      bytes += size;
      if (size > MAX_BODY_BYTES) {
        push("body-bytes-exceeded", `${route.path}: ${String(size)} bytes`);
      }
      if (simple.response.body.includes(ORIGIN_TOKEN)) {
        push("unresolved-template-token", route.path);
      }
      for (const header of simple.response.headers) {
        if (!SAFE_HEADER_VALUE.test(header.value)) {
          push("header-value-invalid", `${route.path}: ${header.name}`);
        }
        if (header.value.includes(ORIGIN_TOKEN)) {
          push("unresolved-template-token", `${route.path}: ${header.name}`);
        }
      }
    }
  }

  return bytes;
}

/**
 * The build-time gate. `docs/FIXTURE_CATALOG.md` section 15 plus ADR-0006
 * sections 5 and 6.
 *
 * Validation runs on the *compiled* routes, so an unresolved `{{origin}}`
 * token and an over-cap body are both build failures rather than runtime
 * surprises.
 */
export function validateFixtures(
  definitions: readonly FixtureDefinition[],
  base: FixtureBase,
  options: CompileOptions,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenIds = new Set<string>();
  const seenHosts = new Set<string>();
  let totalBytes = 0;

  const compiledBase: FixtureBase = {
    ...base,
    routes: Object.fromEntries(
      Object.entries(base.routes).map(([path, spec]) => [
        path,
        compileRoute(spec, options.origin),
      ]),
    ),
  };

  for (const definition of definitions) {
    const compiled: FixtureDefinition = {
      ...definition,
      overrides: Object.fromEntries(
        Object.entries(definition.overrides).map(([path, spec]) => [
          path,
          compileRoute(spec, options.origin),
        ]),
      ),
    };
    const push = (code: IssueCode, detail: string): void => {
      issues.push({ code, fixtureId: definition.id, detail });
    };

    if (!LOWERCASE_ASCII_ID.test(definition.id)) {
      push("id-not-lowercase-ascii", definition.id);
    }
    if (seenIds.has(definition.id)) push("id-duplicate", definition.id);
    seenIds.add(definition.id);

    const host = manifestHostFor(definition.id);
    for (const label of host.split(".")) {
      if (!DNS_LABEL.test(label) || label.length > MAX_DNS_LABEL_LENGTH) {
        push("manifest-host-invalid-label", `${host}: label "${label}"`);
      }
    }
    if (seenHosts.has(host)) push("manifest-host-duplicate", host);
    seenHosts.add(host);

    if (definition.layer === "b") {
      if (Object.keys(definition.overrides).length !== 0) {
        push(
          "layer-b-has-overrides",
          "a layer-B case is served by the raw transport harness, not by this handler",
        );
      }
      if (
        definition.layerBReason === undefined ||
        definition.layerBReason.length === 0
      ) {
        push("layer-b-missing-reason", "ADR-0006 section 4 requires a reason");
      }
    }

    if (!isRuleId(definition.expected.rule)) {
      push("unknown-rule", definition.expected.rule);
      continue;
    }
    if (!PROFILES.includes(definition.expected.profile)) {
      push("unknown-profile", definition.expected.profile);
    } else if (
      !profilesFor(definition.expected.rule).includes(
        definition.expected.profile,
      )
    ) {
      push(
        "profile-not-declared-by-rule",
        `${definition.expected.rule} does not run in profile ${definition.expected.profile}`,
      );
    }

    for (const mode of MODES) {
      const expectation = definition.expected[mode];
      if (expectation !== undefined) {
        validateModeExpectation(definition, mode, expectation, push);
      }
    }

    validateChangedFromBase(definition, base, push);
    totalBytes += validateRoutes(compiled, compiledBase, push);
  }

  if (totalBytes > MAX_MANIFEST_BYTES) {
    issues.push({
      code: "manifest-bytes-exceeded",
      fixtureId: "*",
      detail: `${String(totalBytes)} bytes`,
    });
  }

  try {
    canonicalJson(compileManifest(definitions, base, options));
  } catch (error) {
    issues.push({
      code: "non-serializable-manifest",
      fixtureId: "*",
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  return issues;
}
