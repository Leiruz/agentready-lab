/**
 * `docs/FIXTURE_CATALOG.md` section 11. Rule `web.discovery.api-catalog`.
 *
 * `web.discovery.api-catalog` is not in the `content` profile, so every case
 * here selects `api`.
 */
import { defineFixture } from "../manifest.js";
import type { FixtureDefinition } from "../manifest.js";

import { BASE_API_CATALOG, text } from "./base/valid-agent-site-v1.js";
import {
  API_PROFILE_UNPINNED,
  ASSERTIONS_UNASSIGNED,
  COMPAT_ID_UNASSIGNED,
  changed,
} from "./shared.js";

const RULE = "web.discovery.api-catalog";
const PROFILE = "api";
const SECTION = "docs/FIXTURE_CATALOG.md section 11";
const LINKSET = "application/linkset+json";
const PATH = "/.well-known/api-catalog";

const TWO_CONTEXTS = [
  "{",
  '  "linkset": [',
  "    {",
  '      "anchor": "{{origin}}/api/orders",',
  '      "service-desc": [',
  '        { "href": "{{origin}}/openapi.json", "type": "application/openapi+json" }',
  "      ]",
  "    },",
  "    {",
  '      "anchor": "{{origin}}/api/inventory",',
  '      "service-desc": [',
  '        { "href": "{{origin}}/openapi.json", "type": "application/openapi+json" }',
  "      ]",
  "    }",
  "  ]",
  "}",
  "",
].join("\n");

/** A missing closing brace on the first link object. */
const MALFORMED_JSON = [
  "{",
  '  "linkset": [',
  "    {",
  '      "anchor": "{{origin}}/api/orders",',
  '      "service-desc": [',
  '        { "href": "{{origin}}/openapi.json"',
  "      ]",
  "    }",
  "  ]",
  "}",
  "",
].join("\n");

const EMPTY_LINKSET = ["{", '  "linkset": []', "}", ""].join("\n");

/** No anchor, and `describedby` is not a hyperlink to an API endpoint. */
const NO_ANCHOR_NO_API_RELATION = [
  "{",
  '  "linkset": [',
  "    {",
  '      "describedby": [',
  '        { "href": "{{origin}}/", "type": "text/html" }',
  "      ]",
  "    }",
  "  ]",
  "}",
  "",
].join("\n");

export const apiCatalogCases: readonly FixtureDefinition[] = [
  defineFixture({
    id: "api-001",
    title: "Valid API Catalog",
    condition:
      "/.well-known/api-catalog returns application/linkset+json with a valid non-empty API entry, anchor, and service-description relation.",
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
    todos: [ASSERTIONS_UNASSIGNED, COMPAT_ID_UNASSIGNED, API_PROFILE_UNPINNED],
  }),

  defineFixture({
    id: "api-002",
    title: "Two independent API contexts",
    condition:
      "A valid catalog contains two independent API contexts and correctly resolved link targets.",
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
    overrides: { [PATH]: text(LINKSET, TWO_CONTEXTS) },
    todos: [ASSERTIONS_UNASSIGNED, API_PROFILE_UNPINNED],
  }),

  defineFixture({
    id: "api-003",
    title: "Catalog served as text/html",
    condition: "Valid-looking JSON is returned as text/html.",
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
      [PATH]: text("text/html; charset=utf-8", BASE_API_CATALOG),
    },
    todos: [ASSERTIONS_UNASSIGNED, COMPAT_ID_UNASSIGNED],
  }),

  defineFixture({
    id: "api-004",
    title: "Malformed JSON at the correct media type",
    condition: "The correct media type contains malformed JSON.",
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
    overrides: { [PATH]: text(LINKSET, MALFORMED_JSON) },
    todos: [ASSERTIONS_UNASSIGNED],
  }),

  defineFixture({
    id: "api-005",
    title: "Empty linkset array",
    condition:
      "The document contains an empty linkset array, so the catalog has no required hyperlink to an API endpoint.",
    catalogSection: SECTION,
    classification: "normative",
    layer: "a",
    base: "valid-agent-site-v1",
    expected: {
      rule: RULE,
      profile: PROFILE,
      // Named by docs/FIXTURE_CATALOG.md section 11.
      spec: { status: "fail", assertions: ["api-catalog.relations"] },
    },
    changedFromBase: [changed("spec", RULE, "fail", "api-catalog.relations")],
    overrides: { [PATH]: text(LINKSET, EMPTY_LINKSET) },
    todos: [],
  }),

  defineFixture({
    id: "api-006",
    title: "Entry omits its anchor and any API relation",
    condition:
      "An entry omits its context/anchor and contains no hyperlink relation to an API endpoint or nested catalog; the finding must carry a precise JSON Pointer.",
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
    overrides: { [PATH]: text(LINKSET, NO_ANCHOR_NO_API_RELATION) },
    todos: [ASSERTIONS_UNASSIGNED],
  }),
];
