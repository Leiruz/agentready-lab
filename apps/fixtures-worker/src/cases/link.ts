/** `docs/FIXTURE_CATALOG.md` section 7. Rule `web.discovery.link`. */
import { defineFixture } from "../manifest.js";
import type { FixtureDefinition } from "../manifest.js";

import { BASE_OPENAPI, homepage, text } from "./base/valid-agent-site-v1.js";
import {
  ASSERTIONS_UNASSIGNED,
  COMPAT_ID_UNASSIGNED,
  changed,
} from "./shared.js";

const RULE = "web.discovery.link";
const PROFILE = "content";
const SECTION = "docs/FIXTURE_CATALOG.md section 7";

/**
 * ADR-0006 section 4 puts these two in layer B: `Headers` combines repeated
 * field names into one entry, so a `Response` cannot carry two physical `Link`
 * field lines and the case would pass without exercising what it names.
 */
const LAYER_B_REASON =
  "ADR-0006 section 4: two physical Link field lines are unrepresentable in a normalized Response, so the raw transport harness in packages/testkit serves this case.";

export const linkCases: readonly FixtureDefinition[] = [
  defineFixture({
    id: "lnk-001",
    title: "Multiple Link field lines",
    condition:
      "Homepage has multiple Link field lines containing a valid agent-useful relation.",
    catalogSection: SECTION,
    classification: "normative",
    layer: "b",
    layerBReason: LAYER_B_REASON,
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
    id: "lnk-002",
    title: "Quoted title containing a comma",
    condition: "Link parameters contain a quoted title with a comma.",
    catalogSection: SECTION,
    classification: "normative",
    layer: "b",
    layerBReason: LAYER_B_REASON,
    base: "valid-agent-site-v1",
    expected: {
      rule: RULE,
      profile: PROFILE,
      spec: { status: "pass", assertions: [] },
    },
    changedFromBase: [],
    overrides: {},
    todos: [ASSERTIONS_UNASSIGNED],
  }),

  defineFixture({
    id: "lnk-003",
    title: "Relative target resolved against the redirected URL",
    condition:
      "A valid relative target is resolved against the effective redirected page URL.",
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
      "/": {
        kind: "redirect",
        status: 302,
        target: { kind: "route", path: "/pages/home" },
      },
      // The target is written without a leading slash, so it resolves to
      // /pages/openapi.json against the effective URL and to /openapi.json
      // against the requested one. Only one of those is served.
      "/pages/home": homepage({
        link: '<openapi.json>; rel="service-desc"',
      }),
      "/pages/openapi.json": text("application/openapi+json", BASE_OPENAPI),
    },
    todos: [ASSERTIONS_UNASSIGNED],
  }),

  defineFixture({
    id: "lnk-004",
    title: "Unclosed quoted parameter",
    condition: "Field value contains an unclosed quoted parameter.",
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
      // Exactly one field line. ADR-0006 records that an unclosed quote
      // swallows any following link once the values are combined, so this
      // condition cannot be composed with a second Link line at all.
      "/": homepage({
        link: '</.well-known/api-catalog>; rel="api-catalog"; title="unclosed',
      }),
    },
    todos: [ASSERTIONS_UNASSIGNED],
  }),

  defineFixture({
    id: "lnk-005",
    title: "Valid syntax, no selected discovery relation",
    condition:
      'Header is valid RFC 8288 syntax but exposes only rel="stylesheet".',
    catalogSection: SECTION,
    classification: "advisory",
    layer: "a",
    base: "valid-agent-site-v1",
    expected: {
      rule: RULE,
      profile: PROFILE,
      // links.parse and links.relation are satisfied; the advisory
      // links.agent-useful is not, and warning outranks pass in ADR-0002
      // section 5's precedence order.
      spec: { status: "warning", assertions: [] },
      compat: { status: "fail", assertions: [] },
    },
    changedFromBase: [
      changed("spec", RULE, "warning"),
      changed("compat", RULE, "fail"),
    ],
    overrides: {
      "/": homepage({ link: '</style.css>; rel="stylesheet"' }),
    },
    todos: [ASSERTIONS_UNASSIGNED, COMPAT_ID_UNASSIGNED],
  }),

  defineFixture({
    id: "lnk-006",
    title: "No Link field",
    condition: "Homepage contains no Link field.",
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
    ],
    overrides: { "/": homepage({ link: null }) },
    todos: [ASSERTIONS_UNASSIGNED, COMPAT_ID_UNASSIGNED],
  }),
];
