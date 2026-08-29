/**
 * `docs/FIXTURE_CATALOG.md` section 12. Rule `agent.discovery.skills`.
 *
 * `agent.discovery.skills` is not in the `content` profile, so every case here
 * selects `agent-service`. The document shape follows the pinned draft: the
 * ledger entry `agent-skills-discovery-v0.2.0` records the schema at commit
 * 1bd1167983fa5ac9cd47987710c525308eda1a98, read on 2026-08-29. An earlier
 * revision of these cases predated that pin and carried a placeholder
 * `$schema`, a `sha256` member holding bare hex, and a `type` the draft does
 * not define, so the known-good base was not a valid v0.2.0 index at all.
 */
import { defineFixture } from "../manifest.js";
import type { FixtureDefinition } from "../manifest.js";

import {
  BASE_SKILL_ENTRY,
  LEGACY_SKILLS_INDEX_PATH,
  SKILLS_INDEX_PATH,
  SKILL_ARTIFACT_PATH,
  skillsIndex,
  text,
} from "./base/valid-agent-site-v1.js";
import {
  ASSERTIONS_UNASSIGNED,
  COMPAT_ID_UNASSIGNED,
  changed,
} from "./shared.js";

const RULE = "agent.discovery.skills";
const PROFILE = "agent-service";
const SECTION = "docs/FIXTURE_CATALOG.md section 12";
const JSON_TYPE = "application/json; charset=utf-8";
const PLAIN = "text/plain; charset=utf-8";

/**
 * The same length and layout as the base artifact and a different byte, so
 * `skl-007` differs from the base in its digest and in nothing else.
 */
export const MISMATCHED_SKILL_ARTIFACT = [
  "AgentReady Lab fixture skill artifact v2.",
  "Fixed bytes. Never unpacked, never executed.",
  "",
].join("\n");

export const agentSkillsCases: readonly FixtureDefinition[] = [
  defineFixture({
    id: "skl-001",
    title: "Valid v0.2.0 index",
    condition:
      "/.well-known/agent-skills/index.json contains the pinned $schema, one valid entry, an absolute artifact URL, and a syntactically valid SHA-256 digest.",
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
    id: "skl-002",
    title: "Index omits $schema",
    condition: "The index omits the $schema required by the pinned ruleset.",
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
      [SKILLS_INDEX_PATH]: text(
        JSON_TYPE,
        skillsIndex([BASE_SKILL_ENTRY], { schema: null }),
      ),
    },
    todos: [ASSERTIONS_UNASSIGNED],
  }),

  defineFixture({
    id: "skl-003",
    title: "Digest syntax is invalid",
    condition:
      "The entry digest uses an invalid algorithm, length, and encoding.",
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
      [SKILLS_INDEX_PATH]: text(
        JSON_TYPE,
        skillsIndex([{ ...BASE_SKILL_ENTRY, digest: "SHA1:D6B0EF7410" }]),
      ),
    },
    todos: [ASSERTIONS_UNASSIGNED],
  }),

  defineFixture({
    id: "skl-004",
    title: "Only the legacy path exists",
    condition:
      "Only /.well-known/skills/index.json exists and is otherwise valid.",
    catalogSection: SECTION,
    classification: "normative",
    layer: "a",
    base: "valid-agent-site-v1",
    expected: {
      rule: RULE,
      profile: PROFILE,
      // Named by docs/FIXTURE_CATALOG.md section 12.
      spec: { status: "fail", assertions: ["skills.path-schema"] },
      compat: { status: "pass", assertions: [] },
    },
    changedFromBase: [changed("spec", RULE, "fail", "skills.path-schema")],
    overrides: {
      [SKILLS_INDEX_PATH]: { kind: "absent" },
      [LEGACY_SKILLS_INDEX_PATH]: text(
        JSON_TYPE,
        skillsIndex([BASE_SKILL_ENTRY]),
      ),
    },
    todos: [COMPAT_ID_UNASSIGNED],
  }),

  defineFixture({
    id: "skl-005",
    title: "Entry URL is not absolute",
    condition:
      "The entry URL is not an absolute HTTP(S) URL where the pinned draft requires one; the finding must carry a JSON Pointer.",
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
      [SKILLS_INDEX_PATH]: text(
        JSON_TYPE,
        skillsIndex([{ ...BASE_SKILL_ENTRY, url: SKILL_ARTIFACT_PATH }]),
      ),
    },
    todos: [ASSERTIONS_UNASSIGNED],
  }),

  defineFixture({
    id: "skl-006",
    title: "Discovery endpoint is absent",
    condition: "The v0.2 discovery endpoint is absent.",
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
    overrides: { [SKILLS_INDEX_PATH]: { kind: "absent" } },
    todos: [ASSERTIONS_UNASSIGNED, COMPAT_ID_UNASSIGNED],
  }),

  defineFixture({
    id: "skl-007",
    title: "Artifact bytes do not match the declared digest",
    condition:
      "Static metadata is valid, but the fixed artifact bytes do not match the declared digest. The artifact is hashed as bytes and never unpacked or executed.",
    catalogSection: SECTION,
    classification: "normative",
    layer: "a",
    base: "valid-agent-site-v1",
    expected: {
      rule: RULE,
      profile: PROFILE,
      // Shape validation and opt-in dereference are separate: the index is
      // valid in static mode and only a bounded same-origin fetch can see the
      // mismatch.
      spec: { status: "pass", assertions: [] },
      interop: { status: "fail", assertions: [] },
    },
    changedFromBase: [changed("interop", RULE, "fail")],
    overrides: {
      [SKILL_ARTIFACT_PATH]: text(PLAIN, MISMATCHED_SKILL_ARTIFACT),
    },
    todos: [ASSERTIONS_UNASSIGNED],
  }),
];
