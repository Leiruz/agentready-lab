/**
 * `docs/FIXTURE_CATALOG.md` section 8. Rule `web.content.markdown-negotiation`.
 *
 * Every overridden representation keeps the base `Link` field so that a case
 * about media types cannot also move `web.discovery.link`.
 */
import { defineFixture } from "../manifest.js";
import type { FixtureDefinition, HeaderSpec } from "../manifest.js";

import {
  BASE_LINK_HEADER,
  MARKDOWN_HOME,
  homepage,
  statusText,
  text,
} from "./base/valid-agent-site-v1.js";
import {
  ASSERTIONS_UNASSIGNED,
  COMPAT_ID_UNASSIGNED,
  changed,
} from "./shared.js";

const RULE = "web.content.markdown-negotiation";
const PROFILE = "content";
const SECTION = "docs/FIXTURE_CATALOG.md section 8";
const LINK: readonly HeaderSpec[] = [{ name: "link", value: BASE_LINK_HEADER }];

export const markdownCases: readonly FixtureDefinition[] = [
  defineFixture({
    id: "md-001",
    title: "Correct representation negotiation",
    condition:
      "Default request returns HTML; Accept: text/markdown returns 200 text/markdown; charset=utf-8 and Vary: Accept.",
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
    todos: [ASSERTIONS_UNASSIGNED, COMPAT_ID_UNASSIGNED],
  }),

  defineFixture({
    id: "md-002",
    title: "Vary omits Accept",
    condition:
      "Markdown representation is valid but Vary omits Accept; the main media assertion still passes.",
    catalogSection: SECTION,
    classification: "recommended",
    layer: "a",
    base: "valid-agent-site-v1",
    expected: {
      rule: RULE,
      profile: PROFILE,
      spec: { status: "warning", assertions: [] },
    },
    changedFromBase: [changed("spec", RULE, "warning")],
    overrides: { "/": homepage({ vary: [] }) },
    todos: [
      // markdown.vary is the only assertion in this rule whose subject is the
      // Vary field, and it is `recommended`, which ADR-0002 section 5 maps to
      // warning. The catalog still names no id, so it is not encoded here.
      ASSERTIONS_UNASSIGNED,
    ],
  }),

  defineFixture({
    id: "md-003",
    title: "Markdown request returns HTML",
    condition: "Markdown request returns 200 text/html.",
    catalogSection: SECTION,
    classification: "normative",
    layer: "a",
    base: "valid-agent-site-v1",
    expected: {
      rule: RULE,
      profile: PROFILE,
      // The one case docs/FIXTURE_CATALOG.md names an assertion for: its
      // section 2.3 worked example is this fixture.
      spec: { status: "fail", assertions: ["markdown.media-type"] },
      compat: { status: "fail", assertions: [] },
    },
    changedFromBase: [
      changed("spec", RULE, "fail", "markdown.media-type"),
      changed("compat", RULE, "fail"),
    ],
    overrides: {
      "/": homepage({
        markdown: text(
          "text/html; charset=utf-8",
          "<h1>Not Markdown</h1>\n",
          LINK,
        ),
      }),
    },
    todos: [COMPAT_ID_UNASSIGNED],
  }),

  defineFixture({
    id: "md-004",
    title: "Markdown request is refused",
    condition: "Markdown request returns 406 Not Acceptable.",
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
      "/": homepage({
        markdown: statusText(
          406,
          "text/plain; charset=utf-8",
          "No Markdown representation.\n",
          LINK,
        ),
      }),
    },
    todos: [ASSERTIONS_UNASSIGNED],
  }),

  defineFixture({
    id: "md-005",
    title: "Markdown bytes advertised as text/plain",
    condition: "Markdown bytes are returned as text/plain.",
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
      "/": homepage({
        markdown: text("text/plain; charset=utf-8", MARKDOWN_HOME, LINK),
      }),
    },
    todos: [ASSERTIONS_UNASSIGNED, COMPAT_ID_UNASSIGNED],
  }),

  defineFixture({
    id: "md-006",
    title: "Redirect to a valid Markdown representation",
    condition:
      "A same-origin redirect ends at a valid Markdown representation and retains correct Vary.",
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
      "/": homepage({
        markdown: {
          kind: "redirect",
          status: 302,
          target: { kind: "route", path: "/index.md" },
        },
      }),
      // A static route carries no negotiated Vary, so the field is written
      // explicitly: the effective response, not the requested one, is what the
      // rule evaluates.
      "/index.md": text("text/markdown; charset=utf-8", MARKDOWN_HOME, [
        ...LINK,
        { name: "vary", value: "Accept" },
      ]),
    },
    todos: [ASSERTIONS_UNASSIGNED],
  }),
];
