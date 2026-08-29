/**
 * `docs/FIXTURE_CATALOG.md` section 10 and ADR-0009. Rule
 * `web.policy.content-signals`.
 *
 * ADR-0009 retired `content-signals.syntax` outright: RFC 9309 section 2.2.4
 * defines no syntax for an extension record, explicitly permits leniency, and
 * addresses its only MUST to the crawler rather than to the publisher. After
 * that decision **no case in this family can expect `spec: fail`**, and the
 * three recognized tokens are the vocabulary of the compat assertion and of
 * nothing else.
 *
 * The values below are recorded verbatim as fixture bytes. No assertion in
 * this rule produces a verdict about a token's value, so nothing here should
 * be read as an allowed value set.
 */
import { defineFixture } from "../manifest.js";
import type { FixtureDefinition } from "../manifest.js";

import {
  BASE_ROBOTS_GROUPS,
  robotsTxt,
  text,
} from "./base/valid-agent-site-v1.js";
import {
  ASSERTIONS_UNASSIGNED,
  COMPAT_ID_UNASSIGNED,
  changed,
} from "./shared.js";

const RULE = "web.policy.content-signals";
const PROFILE = "content";
const SECTION = "docs/FIXTURE_CATALOG.md section 10, ADR-0009 section 6";
const PLAIN = "text/plain; charset=utf-8";
const UNRECOGNIZED = "content-signals.unrecognized-vocabulary";

/** The base robots.txt with only its `Content-Signal` record changed. */
function robotsWithSignal(contentSignal: string | null): string {
  return robotsTxt({
    groups: BASE_ROBOTS_GROUPS,
    contentSignal,
    sitemap: "{{origin}}/sitemap.xml",
  });
}

export const contentSignalsCases: readonly FixtureDefinition[] = [
  defineFixture({
    id: "sig-001",
    title: "Complete valid declaration",
    condition:
      "A valid directive declares recognized values for search, ai-input, and ai-train. This is the base robots.txt unchanged.",
    catalogSection: SECTION,
    classification: "advisory",
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
    id: "sig-002",
    title: "Partial declaration",
    condition:
      "A syntactically valid directive declares only one recognized token permitted by the dated snapshot; the undeclared dimensions are reported.",
    catalogSection: SECTION,
    classification: "advisory",
    layer: "a",
    base: "valid-agent-site-v1",
    expected: {
      rule: RULE,
      profile: PROFILE,
      spec: { status: "pass", assertions: [] },
      compat: { status: "pass", assertions: [] },
    },
    changedFromBase: [],
    overrides: {
      "/robots.txt": text(PLAIN, robotsWithSignal("search=yes")),
    },
    todos: [ASSERTIONS_UNASSIGNED, COMPAT_ID_UNASSIGNED],
  }),

  defineFixture({
    id: "sig-003",
    title: "No recognized token present",
    condition:
      "A syntactically valid RFC 9309 record declares only tokens outside the dated compatibility set, with no recognized token present.",
    catalogSection: SECTION,
    classification: "advisory",
    layer: "a",
    base: "valid-agent-site-v1",
    expected: {
      rule: RULE,
      profile: PROFILE,
      // ADR-0009 section 6 names this assertion and this status. The earlier
      // `spec: fail` expectation is retired with content-signals.syntax.
      spec: { status: "warning", assertions: [UNRECOGNIZED] },
      compat: { status: "fail", assertions: [] },
    },
    changedFromBase: [
      changed("spec", RULE, "warning", UNRECOGNIZED),
      changed("compat", RULE, "fail"),
    ],
    overrides: {
      "/robots.txt": text(
        PLAIN,
        robotsWithSignal("ai-summarise=yes, ai-index=no"),
      ),
    },
    todos: [COMPAT_ID_UNASSIGNED],
  }),

  defineFixture({
    id: "sig-004",
    title: "One token declared twice with conflicting values",
    condition:
      "The same token is declared twice with conflicting values and the pinned source does not define conflict resolution.",
    catalogSection: SECTION,
    classification: "ambiguous",
    layer: "a",
    base: "valid-agent-site-v1",
    expected: {
      rule: RULE,
      profile: PROFILE,
      spec: {
        status: "warning",
        assertions: ["content-signals.conflicting-declaration"],
      },
    },
    changedFromBase: [
      changed(
        "spec",
        RULE,
        "warning",
        "content-signals.conflicting-declaration",
      ),
    ],
    overrides: {
      "/robots.txt": text(
        PLAIN,
        robotsWithSignal("search=yes, ai-train=yes, ai-train=no"),
      ),
    },
    // ADR-0009's fixture table leaves this row's compat verdict "unchanged",
    // which the catalog records as no stated compat expectation at all. None
    // is invented here.
    todos: [],
  }),

  defineFixture({
    id: "sig-005",
    title: "Known token beside an unknown extension token",
    condition:
      "A valid known token appears beside an unknown extension token; the known declaration remains usable.",
    catalogSection: SECTION,
    classification: "advisory",
    layer: "a",
    base: "valid-agent-site-v1",
    expected: {
      rule: RULE,
      profile: PROFILE,
      // Same spec assertion as sig-003, which ADR-0009 section 6 states rather
      // than hides. The cases stay distinct: the compat verdicts are opposite
      // and the finding's recognized-token-count parameter is zero there and
      // non-zero here.
      spec: { status: "warning", assertions: [UNRECOGNIZED] },
      compat: { status: "pass", assertions: [] },
    },
    changedFromBase: [changed("spec", RULE, "warning", UNRECOGNIZED)],
    overrides: {
      "/robots.txt": text(
        PLAIN,
        robotsWithSignal("search=yes, ai-summarise=yes"),
      ),
    },
    todos: [COMPAT_ID_UNASSIGNED],
  }),

  defineFixture({
    id: "sig-006",
    title: "No Content Signals declaration",
    condition: "No Content Signals declaration exists.",
    catalogSection: SECTION,
    classification: "compatibility-only",
    layer: "a",
    base: "valid-agent-site-v1",
    expected: {
      rule: RULE,
      profile: PROFILE,
      // ADR-0002 section 5 names this case: all four spec assertions are
      // not-present together, which is the only way a rule status may be
      // not-applicable. The four ids are therefore pinned, not inferred.
      spec: {
        status: "not-applicable",
        assertions: [
          "content-signals.coverage",
          "content-signals.effect",
          "content-signals.conflicting-declaration",
          UNRECOGNIZED,
        ],
      },
      compat: { status: "fail", assertions: [] },
    },
    changedFromBase: [
      changed("spec", RULE, "not-applicable"),
      changed("compat", RULE, "fail"),
    ],
    overrides: { "/robots.txt": text(PLAIN, robotsWithSignal(null)) },
    todos: [COMPAT_ID_UNASSIGNED],
  }),
];
