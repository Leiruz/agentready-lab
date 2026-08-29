/**
 * `docs/FIXTURE_CATALOG.md` section 15: the fixture build fails unless the
 * manifest satisfies these rules. ADR-0006 sections 5 and 6 add the redirect
 * and no-proxy rules.
 *
 * The negative block at the end matters more than the positive one. A
 * validator that only passes on good input proves nothing, so each of the
 * three shapes ADR-0006 exists to forbid, an open redirect, a query-controlled
 * responder, and a proxy route, is constructed here and asserted rejected.
 */
import { describe, expect, it } from "vitest";

import { base, fixtures } from "../src/cases/index.js";
import {
  MAX_BODY_BYTES,
  MAX_DNS_LABEL_LENGTH,
  TODO_KINDS,
  canonicalJson,
  compileManifest,
  compileSingle,
  defineFixture,
  manifestHostFor,
  mergedRoutes,
  validateFixtures,
} from "../src/manifest.js";
import type {
  FixtureDefinition,
  RouteSpec,
  SimpleRoute,
  ValidationIssue,
} from "../src/manifest.js";

const ORIGIN = "http://127.0.0.1:53411";

/** The 49 protocol cases, in catalog order. Renaming one fails here. */
const EXPECTED_IDS = [
  "rob-001",
  "rob-002",
  "rob-003",
  "rob-004",
  "rob-005",
  "rob-006",
  "map-001",
  "map-002",
  "map-003",
  "map-004",
  "map-005",
  "map-006",
  "lnk-001",
  "lnk-002",
  "lnk-003",
  "lnk-004",
  "lnk-005",
  "lnk-006",
  "md-001",
  "md-002",
  "md-003",
  "md-004",
  "md-005",
  "md-006",
  "bot-001",
  "bot-002",
  "bot-003",
  "bot-004",
  "bot-005",
  "bot-006",
  "sig-001",
  "sig-002",
  "sig-003",
  "sig-004",
  "sig-005",
  "sig-006",
  "api-001",
  "api-002",
  "api-003",
  "api-004",
  "api-005",
  "api-006",
  "skl-001",
  "skl-002",
  "skl-003",
  "skl-004",
  "skl-005",
  "skl-006",
  "skl-007",
] as const;

function codes(issues: readonly ValidationIssue[]): readonly string[] {
  return issues.map((issue) => issue.code);
}

function simpleRoutes(spec: RouteSpec): readonly SimpleRoute[] {
  if (spec.kind !== "negotiated") return [spec];
  return [...spec.variants.map((variant) => variant.route), spec.otherwise];
}

describe("the shipped manifest", () => {
  it("declares the 49 protocol cases in catalog order", () => {
    expect(fixtures.map((fixture) => fixture.id)).toStrictEqual([
      ...EXPECTED_IDS,
    ]);
  });

  it("passes the build-time gate with no issues", () => {
    expect(validateFixtures(fixtures, base, { origin: ORIGIN })).toStrictEqual(
      [],
    );
  });

  it("uses lowercase ASCII ids that are unique", () => {
    const ids = fixtures.map((fixture) => fixture.id);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("derives a unique manifestHost of valid DNS labels", () => {
    const hosts = fixtures.map((fixture) => manifestHostFor(fixture.id));
    for (const host of hosts) {
      for (const label of host.split(".")) {
        expect(label).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
        expect(label.length).toBeLessThanOrEqual(MAX_DNS_LABEL_LENGTH);
      }
    }
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it("uses absolute route paths with no query and no wildcard", () => {
    for (const fixture of fixtures) {
      for (const route of mergedRoutes(fixture, base)) {
        expect(route.path.startsWith("/"), route.path).toBe(true);
        expect(route.path.startsWith("//"), route.path).toBe(false);
        expect(route.path).not.toMatch(/[?#*\\]/);
      }
    }
  });

  it("redirects only to a literal route the same manifest defines", () => {
    for (const fixture of fixtures) {
      const routes = mergedRoutes(fixture, base);
      const paths = new Set(routes.map((route) => route.path));
      for (const route of routes) {
        for (const simple of simpleRoutes(route.spec)) {
          if (simple.kind !== "redirect") continue;
          expect(simple.target.kind, `${fixture.id} ${route.path}`).toBe(
            "route",
          );
          if (simple.target.kind === "route") {
            expect(paths.has(simple.target.path)).toBe(true);
          }
        }
      }
    }
  });

  it("bounds every compiled body at build time", () => {
    const manifest = compileManifest(fixtures, base, { origin: ORIGIN });
    if (manifest.kind !== "host-routed") throw new Error("wrong manifest kind");
    const encoder = new TextEncoder();
    for (const fixture of manifest.fixtures) {
      for (const route of fixture.routes) {
        for (const simple of simpleRoutes(route.spec)) {
          if (simple.kind !== "static") continue;
          expect(
            encoder.encode(simple.response.body).length,
            `${fixture.id} ${route.path}`,
          ).toBeLessThanOrEqual(MAX_BODY_BYTES);
        }
      }
    }
  });

  it("generates byte-identical manifests on two builds", () => {
    const first = canonicalJson(
      compileManifest(fixtures, base, { origin: ORIGIN }),
    );
    const second = canonicalJson(
      compileManifest(fixtures, base, { origin: ORIGIN }),
    );
    expect(second).toBe(first);
    expect(first).not.toContain("{{origin}}");
  });

  it("keeps the two layer-B cases out of the deployable manifest", () => {
    const layerB = fixtures
      .filter((fixture) => fixture.layer === "b")
      .map((fixture) => fixture.id);
    expect(layerB).toStrictEqual(["lnk-001", "lnk-002"]);

    const manifest = compileManifest(fixtures, base, { origin: ORIGIN });
    if (manifest.kind !== "host-routed") throw new Error("wrong manifest kind");
    expect(manifest.fixtures.map((fixture) => fixture.id)).not.toContain(
      "lnk-001",
    );

    for (const fixture of fixtures) {
      if (fixture.layer !== "b") continue;
      expect(Object.keys(fixture.overrides)).toStrictEqual([]);
      expect(fixture.layerBReason).toBeTruthy();
    }
  });
});

describe("declared expectations", () => {
  it("declares an intended change for every status that differs from the base", () => {
    for (const fixture of fixtures) {
      for (const mode of ["spec", "compat", "interop"] as const) {
        const expectation = fixture.expected[mode];
        if (expectation === undefined) continue;
        const declared = fixture.changedFromBase.filter(
          (change) =>
            change.mode === mode && change.rule === fixture.expected.rule,
        );
        if (expectation.status === base.status) {
          expect(declared, `${fixture.id} ${mode}`).toStrictEqual([]);
        } else {
          expect(
            declared.map((change) => change.to),
            `${fixture.id} ${mode}`,
          ).toStrictEqual([expectation.status]);
        }
      }
    }
  });

  it("gives every unresolved expectation a typed todo", () => {
    const byKind = new Map<string, number>();
    for (const fixture of fixtures) {
      for (const todo of fixture.todos) {
        expect(TODO_KINDS).toContain(todo.kind);
        expect(todo.detail.length).toBeGreaterThan(0);
        byKind.set(todo.kind, (byKind.get(todo.kind) ?? 0) + 1);
      }
    }

    // The counts are asserted so that resolving one of the underlying
    // decisions shows up here as a diff rather than passing silently.
    expect(Object.fromEntries([...byKind].sort())).toStrictEqual({
      "assertion-ids-unassigned": 42,
      "catalog-names-no-such-assertion": 1,
      "collateral-outcome-undecided": 3,
      "compat-assertion-id-unassigned": 25,
      "pinned-value-unknown": 9,
      "rule-input-unpinned": 6,
    });
  });

  it("names an assertion id only where a pinned document names one", () => {
    const named = fixtures
      .filter((fixture) =>
        (["spec", "compat", "interop"] as const).some(
          (mode) => (fixture.expected[mode]?.assertions.length ?? 0) !== 0,
        ),
      )
      .map((fixture) => fixture.id);

    expect(named).toStrictEqual([
      "md-003",
      "sig-003",
      "sig-004",
      "sig-005",
      "sig-006",
      "api-005",
      "skl-004",
    ]);
  });

  it("selects the profile each rule actually declares", () => {
    const byPrefix = new Map(
      fixtures.map((fixture) => [
        fixture.id.split("-")[0],
        fixture.expected.profile,
      ]),
    );
    expect(byPrefix.get("api")).toBe("api");
    expect(byPrefix.get("skl")).toBe("agent-service");
    for (const prefix of ["rob", "map", "lnk", "md", "bot", "sig"]) {
      expect(byPrefix.get(prefix), prefix).toBe("content");
    }
  });

  it("never expects spec: fail for a Content Signals case", () => {
    // ADR-0009 section 3: the rule is advisory and compatibility only.
    for (const fixture of fixtures) {
      if (fixture.expected.rule !== "web.policy.content-signals") continue;
      expect(fixture.expected.spec.status, fixture.id).not.toBe("fail");
    }
  });
});

// ---------------------------------------------------------------------------
// Negative tests
// ---------------------------------------------------------------------------

const MINIMAL: FixtureDefinition = defineFixture({
  id: "neg-001",
  title: "Negative-test scaffold",
  condition: "Not a catalog case.",
  catalogSection: "test/manifest-validation.test.ts",
  classification: "normative",
  layer: "a",
  base: "valid-agent-site-v1",
  expected: {
    rule: "web.discovery.robots",
    profile: "content",
    spec: { status: "pass", assertions: [] },
  },
  changedFromBase: [],
  overrides: {},
  todos: [
    {
      kind: "assertion-ids-unassigned",
      detail: "scaffold for the negative tests",
    },
  ],
});

function reject(overrides: Readonly<Record<string, RouteSpec>>) {
  return validateFixtures([{ ...MINIMAL, overrides }], base, {
    origin: ORIGIN,
  });
}

describe("the validator rejects what ADR-0006 forbids", () => {
  it("rejects an open redirect to an address literal", () => {
    const issues = reject({
      "/robots.txt": {
        kind: "redirect",
        status: 302,
        target: { kind: "address-literal", address: "192.168.0.1", path: "/" },
      },
    });
    expect(codes(issues)).toContain("redirect-target-not-a-route");
  });

  it("rejects an open redirect to a loopback name", () => {
    const issues = reject({
      "/robots.txt": {
        kind: "redirect",
        status: 302,
        target: { kind: "loopback-name", host: "localhost", path: "/" },
      },
    });
    expect(codes(issues)).toContain("redirect-target-not-a-route");
  });

  it("rejects a redirect to an absolute URL smuggled through a route target", () => {
    const issues = reject({
      "/robots.txt": {
        kind: "redirect",
        status: 302,
        target: { kind: "route", path: "https://evil.example/take-over" },
      },
    });
    expect(codes(issues)).toContain("redirect-route-target-undefined");
  });

  it("rejects a redirect to a route the manifest does not define", () => {
    const issues = reject({
      "/robots.txt": {
        kind: "redirect",
        status: 302,
        target: { kind: "route", path: "/never-declared.txt" },
      },
    });
    expect(codes(issues)).toContain("redirect-route-target-undefined");
  });

  it("rejects a ?status= controlled responder", () => {
    const issues = reject({
      "/echo?status=500": {
        kind: "static",
        response: {
          status: 200,
          headers: [{ name: "content-type", value: "text/plain" }],
          body: "whatever the caller asked for",
        },
      },
    });
    expect(codes(issues)).toContain("route-path-has-query");
  });

  it("rejects a ?url= proxy route", () => {
    const issues = reject({
      "/proxy?url=https://example.com": {
        kind: "static",
        response: {
          status: 200,
          headers: [{ name: "content-type", value: "text/plain" }],
          body: "upstream body",
        },
      },
    });
    expect(codes(issues)).toContain("route-path-has-query");
  });

  it("rejects a protocol-relative route path", () => {
    const issues = reject({
      "//evil.example/robots.txt": { kind: "absent" },
    });
    expect(codes(issues)).toContain("route-path-not-absolute");
  });

  it("rejects a wildcard route path", () => {
    const issues = reject({ "/assets/*": { kind: "absent" } });
    expect(codes(issues)).toContain("route-path-has-wildcard");
  });

  it("rejects a body over the build-time cap", () => {
    const issues = reject({
      "/robots.txt": {
        kind: "static",
        response: {
          status: 200,
          headers: [{ name: "content-type", value: "text/plain" }],
          body: "a".repeat(MAX_BODY_BYTES + 1),
        },
      },
    });
    expect(codes(issues)).toContain("body-bytes-exceeded");
  });

  it("rejects a header value carrying a field-line break", () => {
    const issues = reject({
      "/robots.txt": {
        kind: "static",
        response: {
          status: 200,
          headers: [
            { name: "content-type", value: "text/plain" },
            { name: "x-injected", value: "ok\r\nset-cookie: session=1" },
          ],
          body: "",
        },
      },
    });
    expect(codes(issues)).toContain("header-value-invalid");
  });

  it("strips a function smuggled into a route by a cast", () => {
    // The union has no function member, so this can only arrive through a
    // cast. Compilation rebuilds each route from the fields the union declares,
    // so the smuggled member never reaches the compiled manifest and the
    // handler has nothing to call.
    const smuggled = {
      kind: "static",
      response: {
        status: 200,
        headers: [{ name: "content-type", value: "text/plain" }],
        body: "",
      },
      respond: () => "arbitrary",
    } as unknown as RouteSpec;

    const manifest = compileSingle(
      { ...MINIMAL, overrides: { "/robots.txt": smuggled } },
      base,
      { origin: ORIGIN },
    );
    if (manifest.kind !== "single") throw new Error("wrong manifest kind");
    const route = manifest.fixture.routes.find(
      (candidate) => candidate.path === "/robots.txt",
    );

    expect(route?.spec.kind).toBe("static");
    expect(Object.keys(route?.spec ?? {}).sort()).toStrictEqual([
      "kind",
      "response",
    ]);
    expect(canonicalJson(manifest)).not.toContain("respond");
  });

  it("refuses to serialize a value JSON cannot represent", () => {
    // The other half of the same guarantee: if a future route kind ever did
    // carry something unserializable through compilation, the build fails
    // rather than shipping it.
    expect(() => canonicalJson({ respond: () => "arbitrary" })).toThrow(
      /function/,
    );
    expect(
      codes(validateFixtures([MINIMAL], base, { origin: ORIGIN })),
    ).not.toContain("non-serializable-manifest");
  });

  it("rejects an id that is not lowercase ASCII", () => {
    const issues = validateFixtures([{ ...MINIMAL, id: "ROB_001" }], base, {
      origin: ORIGIN,
    });
    expect(codes(issues)).toContain("id-not-lowercase-ascii");
  });

  it("rejects a duplicate id", () => {
    const issues = validateFixtures([MINIMAL, MINIMAL], base, {
      origin: ORIGIN,
    });
    expect(codes(issues)).toContain("id-duplicate");
  });

  it("rejects a manifestHost label over 63 characters", () => {
    const issues = validateFixtures(
      [{ ...MINIMAL, id: "a".repeat(64) }],
      base,
      {
        origin: ORIGIN,
      },
    );
    expect(codes(issues)).toContain("manifest-host-invalid-label");
  });

  it("rejects a profile the rule does not declare", () => {
    const issues = validateFixtures(
      [
        {
          ...MINIMAL,
          expected: {
            rule: "agent.discovery.skills",
            profile: "content",
            spec: { status: "pass", assertions: [] },
          },
        },
      ],
      base,
      { origin: ORIGIN },
    );
    expect(codes(issues)).toContain("profile-not-declared-by-rule");
  });

  it("rejects an assertion id the rule does not declare", () => {
    const issues = validateFixtures(
      [
        {
          ...MINIMAL,
          expected: {
            rule: "web.policy.content-signals",
            profile: "content",
            // Retired by ADR-0009 section 3 and absent from the ruleset.
            spec: { status: "pass", assertions: ["content-signals.syntax"] },
          },
        },
      ],
      base,
      { origin: ORIGIN },
    );
    expect(codes(issues)).toContain("unknown-assertion");
  });

  it("rejects an undeclared change of status relative to the base", () => {
    const issues = validateFixtures(
      [
        {
          ...MINIMAL,
          expected: {
            rule: "web.discovery.robots",
            profile: "content",
            spec: { status: "fail", assertions: [] },
          },
        },
      ],
      base,
      { origin: ORIGIN },
    );
    expect(codes(issues)).toContain("changed-from-base-missing");
  });

  it("rejects an expectation with no assertion id and no todo", () => {
    const issues = validateFixtures([{ ...MINIMAL, todos: [] }], base, {
      origin: ORIGIN,
    });
    expect(codes(issues)).toContain("assertion-ids-missing-todo");
  });

  it("rejects a layer-B case that tries to serve routes here", () => {
    const issues = validateFixtures(
      [
        {
          ...MINIMAL,
          layer: "b",
          layerBReason: "wire-level",
          overrides: { "/robots.txt": { kind: "absent" } },
        },
      ],
      base,
      { origin: ORIGIN },
    );
    expect(codes(issues)).toContain("layer-b-has-overrides");
  });

  it("rejects a layer-B case with no stated reason", () => {
    const issues = validateFixtures([{ ...MINIMAL, layer: "b" }], base, {
      origin: ORIGIN,
    });
    expect(codes(issues)).toContain("layer-b-missing-reason");
  });
});
