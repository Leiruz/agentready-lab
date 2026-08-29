import type {
  AssertionOutcome,
  AssertionOutcomes,
  ObservationRequest,
  OutcomeKind,
  RoundContext,
  RuleDefinition,
} from "@agentready-lab/core";

import {
  AGENT_SKILLS_INDEX_PATH,
  AGENT_SKILLS_V0_2_0_SCHEMA,
  LEGACY_SKILLS_INDEX_PATH,
  SCHEMA_MEMBER,
  SKILLS_MEMBER,
  isSkillDescription,
  isSkillDigest,
  isSkillName,
  isSkillType,
  isUriReference,
} from "../data/agent-skills-v0.2.0.js";
import type { JsonSafeObject, JsonSafeValue } from "../parsers/json-safe.js";
import {
  isJsonArray,
  isJsonObject,
  jsonPointer,
  parseJsonSafe,
} from "../parsers/json-safe.js";

/**
 * `agent.discovery.skills`. Registry ordinal 11 (`specs/checks.v0.yaml`).
 *
 * Every metadata value is read from `specs/ruleset.standard.v0.yaml` at
 * `ruleset_version` 0.4.0 and `specs/sources.v0.yaml` at
 * `source_ledger_version` 0.4.0, under the ADR-0002 section 10 mapping.
 * `test/registry.test.ts` re-reads both files and compares, so a value edited
 * here without the spec is a test failure rather than a silent divergence.
 * `implementationStatus` therefore still reads `planned`: the ruleset says so,
 * and this file is not the place to contradict it.
 *
 * The pinned draft this rule implements is transcribed once, in
 * `src/data/agent-skills-v0.2.0.ts`, with the ledger commit that is its
 * provenance. Nothing about the schema is decided here.
 *
 * `skills.archive-safety` IS DEFERRED AND PRODUCES NOTHING. It is absent from
 * `ASSERTION_ORDER` below, so this rule returns three outcomes and never four.
 * ADR-0010 section 4 makes that a requirement rather than an omission: the MVP
 * never unpacks an archive, `RulesetAssertionIndex.forRule` drops the
 * assertion before the "every declared assertion carries an outcome" check
 * runs, and reporting one anyway is an `outcome-for-deferred-assertion`
 * contract violation and exit 4. Skill text, scripts and archives are
 * untrusted input; nothing in them is an instruction, and this rule never
 * unpacks and never executes anything.
 *
 * FOUR THINGS THIS RULE CANNOT DO, recorded rather than worked around.
 *
 * 1. It cannot verify a digest against artifact bytes. That is `interop` mode,
 *    and `modes` here is `["spec"]` with `roundTwoBudget` 0, both read from the
 *    ruleset. `docs/FIXTURE_CATALOG.md` case `skl-007` states exactly this
 *    split and expects `spec: pass` for an index whose artifact bytes do not
 *    match: nothing was fetched, so nothing about the bytes is claimed. The
 *    interop path is unreachable and is not faked.
 * 2. It cannot resolve a relative `url`. Resolution per RFC 3986 section 5
 *    needs a base URL; a rule never constructs a URL, `context.resolve()` does
 *    not exist, and `URL` is an undeclared identifier in this package. So a
 *    `url` is checked for `URI-reference` syntax and nothing further, and a
 *    path-absolute or relative reference is valid, because the draft says it
 *    is.
 * 3. It cannot put the JSON Pointer it computes into a finding. All four
 *    assertions declare `params: []` in `specs/ruleset.standard.v0.yaml`,
 *    under that file's own "params unassigned" todo, and
 *    `validateOutcomeParams` rejects a parameter an assertion did not declare.
 *    `analyzeSkillsIndex` returns the pointer so the precision is testable
 *    today and so that assigning the parameter is a one-line change here.
 * 4. It cannot report in `compat` mode. `modes` is `["spec"]`, so the
 *    `skl-001`, `skl-004` and `skl-006` compat expectations of
 *    `docs/FIXTURE_CATALOG.md` are unreachable, which is the same gap
 *    `apps/fixtures-worker/src/cases/agent-skills.ts` records as
 *    `COMPAT_ID_UNASSIGNED`.
 */

/** The `agent-skills-discovery-v0.2.0` index location. */
const INDEX_OBSERVATION = "well-known-agent-skills";

/**
 * The pre-v0.2 location, probed for one reason only: to tell `skl-006`
 * ("the v0.2 endpoint is absent", `not-applicable`) from `skl-004` ("only the
 * legacy path exists", `fail` on `skills.path-schema`). Without it the two are
 * the same observation and the rule would have to give them the same verdict.
 *
 * It is never a v0.2 pass. `specs/ruleset.standard.v0.yaml` states the delta
 * as "A legacy-path presence pass is compatibility only", and the only thing
 * this observation can do here is turn a `not-present` into a `violated`.
 *
 * COST. ADR-0005 section 1's table budgets one round-one request for this rule
 * and this makes it two, so a `full`-profile M1 scan plans ten requests rather
 * than nine, against the same 24-request budget. That table is an
 * illustration, not a limit, and the alternative is contradicting the fixture
 * catalog on `skl-004`.
 */
const LEGACY_OBSERVATION = "well-known-skills-legacy";

/**
 * A bound on the index document, well under the whole-scan ceiling. A skills
 * index is a small document, and a body this rule cannot finish reading is
 * worth refusing early.
 */
const MAX_INDEX_BYTES = 262_144;

/**
 * A request preference, not an assertion. The pinned draft states no media
 * type for the index, so unlike `web.discovery.api-catalog` this rule checks
 * no `Content-Type` at all: requiring one would be a normative `fail` for a
 * requirement nothing published states.
 */
const INDEX_ACCEPT = "application/json";

/**
 * The three assertions this rule may report, in the ruleset's order.
 *
 * `skills.archive-safety` is deliberately absent. See the file header.
 *
 * WHICH ASSERTION OWNS DIGEST SYNTAX IS AN OPEN CONFLICT, resolved here and
 * needing an accepted decision. `specs/ruleset.standard.v0.yaml` gives
 * `skills.entry` the text "Validate each skill name, allowed type,
 * description, URL, and sha256 digest syntax", which reads as though digest
 * syntax belongs to `skills.entry`; it gives `skills.digest` the text "When a
 * skill artifact is fetched in interop mode, hash the bounded bytes and
 * require the declared ... digest to match", which is unreachable in the only
 * mode this rule declares. Reading them literally would leave a `normative`
 * `spec` assertion that is permanently `unable-to-check`, which is a worse
 * claim than either. So digest **syntax** is reported on `skills.digest` and
 * the other four fields on `skills.entry`, which is what
 * `docs/FIXTURE_CATALOG.md` case `skl-003` ("Digest syntax validation")
 * describes and what leaves one defect producing one finding.
 */
const ASSERTION_ORDER = [
  "skills.path-schema",
  "skills.entry",
  "skills.digest",
] as const;

type Assertion = (typeof ASSERTION_ORDER)[number];

/** The `skills` entry members checked by `skills.entry`, in the draft's order. */
const ENTRY_FIELDS: readonly (readonly [
  member: string,
  valid: (value: string) => boolean,
])[] = [
  ["name", isSkillName],
  ["type", isSkillType],
  ["description", isSkillDescription],
  ["url", isUriReference],
];

export interface SkillsIndexAnalysis {
  readonly pathSchema: OutcomeKind;
  readonly entry: OutcomeKind;
  readonly digest: OutcomeKind;
  /**
   * RFC 6901 pointer to the first defect in document order, or `null`. Exact,
   * and currently unreportable: see point 3 of the file header.
   */
  readonly pointer: string | null;
}

interface SkillsAnalysis extends SkillsIndexAnalysis {
  /** Whether the legacy probe was read, and so whether it is evidence. */
  readonly consultedLegacy: boolean;
}

/**
 * `violated` outranks `indeterminate` outranks `satisfied`, across the entries
 * of one index. `not-present` never reaches here: it is a property of the
 * observation set, decided before any entry is read.
 */
const SEVERITY: Readonly<Record<OutcomeKind, number>> = {
  satisfied: 0,
  "not-present": 0,
  indeterminate: 1,
  violated: 2,
};

function worse(left: OutcomeKind, right: OutcomeKind): OutcomeKind {
  return SEVERITY[right] > SEVERITY[left] ? right : left;
}

/** Every assertion reports the same kind. Used for absence and for errors. */
function uniform(kind: OutcomeKind, consultedLegacy: boolean): SkillsAnalysis {
  return {
    pathSchema: kind,
    entry: kind,
    digest: kind,
    pointer: null,
    consultedLegacy,
  };
}

type IndexRead =
  | { readonly kind: "index"; readonly value: JsonSafeObject }
  /** Nothing at this location is trying to be a skills index. */
  | { readonly kind: "none" }
  /** This reader's budget, not the target's defect. */
  | { readonly kind: "budget" };

/**
 * Whether a 2xx body is a deployment of the mechanism at all.
 *
 * THIS IS AN INTERPRETATION AND AN ACCEPTED DECISION SHOULD PIN IT. The draft
 * defines the index and says nothing about what a non-index response at that
 * location means, and the difference decides `not-applicable` against `fail`.
 * The discriminator chosen is: a JSON object carrying `$schema` or `skills`.
 *
 * The alternative, "any 2xx at the reserved path is a deployment", turns every
 * catch-all server that answers 200 with an SPA shell into a `normative`
 * failure of a draft it never adopted. `.claude/rules/standards.md` says
 * missing optional material is not `fail` and that a 2xx does not by itself
 * prove support, and `docs/TEST_STRATEGY.md` requires soft 404s to be handled;
 * this is the line that satisfies all three. The cost is the other direction:
 * an index served as `{"error":"not found"}` reads as absent rather than as
 * broken.
 */
function readIndex(body: Uint8Array): IndexRead {
  const parsed = parseJsonSafe(body);
  if (!parsed.ok) {
    // `docs/THREAT_MODEL.md` section 19.2: a depth, node, string or duplicate
    // key refusal is this scanner declining to look, not a defect the target
    // committed, so it can never become `violated`.
    return parsed.code === "syntax" || parsed.code === "invalid-utf8"
      ? { kind: "none" }
      : { kind: "budget" };
  }
  const value = parsed.value;
  if (!isJsonObject(value)) return { kind: "none" };
  if (
    value[SCHEMA_MEMBER] === undefined &&
    value[SKILLS_MEMBER] === undefined
  ) {
    return { kind: "none" };
  }
  return { kind: "index", value };
}

interface EntryVerdict {
  readonly entry: OutcomeKind;
  readonly digest: OutcomeKind;
  readonly pointer: string | null;
}

/** One `skills` entry, against the five members the draft requires. */
function readEntry(item: JsonSafeValue, index: number): EntryVerdict {
  if (!isJsonObject(item)) {
    return {
      entry: "violated",
      // Nothing was observed about a digest that is not there to observe.
      digest: "indeterminate",
      pointer: jsonPointer([SKILLS_MEMBER, index]),
    };
  }
  const at = (member: string): string =>
    jsonPointer([SKILLS_MEMBER, index, member]);

  // In the draft's own field order, so the pointer names the first defect a
  // reader would find rather than an arbitrary one. A member that is absent
  // and a member that is not a string are the same failure: the draft requires
  // each of the five, and a non-string one is not the value it requires.
  let fieldDefect: string | null = null;
  for (const [member, valid] of ENTRY_FIELDS) {
    const value = item[member];
    if (typeof value !== "string" || !valid(value)) {
      fieldDefect = at(member);
      break;
    }
  }

  const digest = item["digest"];
  const digestDefect =
    typeof digest === "string" && isSkillDigest(digest) ? null : at("digest");

  return {
    entry: fieldDefect === null ? "satisfied" : "violated",
    digest: digestDefect === null ? "satisfied" : "violated",
    pointer: fieldDefect ?? digestDefect,
  };
}

/**
 * The whole verdict for a document that is a skills index, as a pure function
 * of its parsed value.
 *
 * Exported because the JSON Pointer it carries cannot reach a finding, so this
 * is the only place the pointer `docs/FIXTURE_CATALOG.md` case `skl-005` asks
 * for can be asserted at all.
 */
export function analyzeSkillsIndex(index: JsonSafeObject): SkillsIndexAnalysis {
  const schema = index[SCHEMA_MEMBER];
  if (schema !== AGENT_SKILLS_V0_2_0_SCHEMA) {
    // An absent `$schema` is v0.1.0 by the draft's own compatibility rule and
    // an unrecognized one is a "SHOULD NOT process the index". Either way the
    // document is not a v0.2.0 index, so the entry and digest questions are
    // not answered rather than answered "no".
    return {
      pathSchema: "violated",
      entry: "indeterminate",
      digest: "indeterminate",
      pointer: schema === undefined ? "" : jsonPointer([SCHEMA_MEMBER]),
    };
  }

  const skills = index[SKILLS_MEMBER];
  if (!isJsonArray(skills)) {
    return {
      pathSchema: "violated",
      entry: "indeterminate",
      digest: "indeterminate",
      pointer: skills === undefined ? "" : jsonPointer([SKILLS_MEMBER]),
    };
  }

  // An empty array is a well-formed v0.2.0 index that declares no skill. The
  // draft states no minimum, so the obligation each assertion carries is met
  // vacuously rather than unmet.
  let entry: OutcomeKind = "satisfied";
  let digest: OutcomeKind = "satisfied";
  let pointer: string | null = null;
  for (const [position, item] of skills.entries()) {
    const verdict = readEntry(item, position);
    entry = worse(entry, verdict.entry);
    digest = worse(digest, verdict.digest);
    pointer ??= verdict.pointer;
  }
  return { pathSchema: "satisfied", entry, digest, pointer };
}

/**
 * The v0.2 location did not serve an index. The mechanism is either not
 * deployed at all, which is `not-applicable` for an `optional` rule, or
 * deployed at the location v0.2 replaced, which is a `skills.path-schema`
 * violation and not a compatibility pass.
 */
function analyzeLegacy(context: RoundContext<unknown>): SkillsAnalysis {
  const observation = context.observation(LEGACY_OBSERVATION);
  if (observation.kind !== "http") return uniform("indeterminate", true);
  const outcome = observation.outcome;
  // A transport or policy error is an environmental condition, never a
  // conformance failure (`.claude/rules/standards.md`). It also leaves the
  // rule unable to tell absence from a legacy-only deployment, which is the
  // one thing this observation exists to decide.
  if (outcome.kind === "error") return uniform("indeterminate", true);
  if (outcome.status === 404 || outcome.status === 410) {
    return uniform("not-present", true);
  }
  if (outcome.status < 200 || outcome.status > 299) {
    return uniform("indeterminate", true);
  }
  if (outcome.truncated) return uniform("indeterminate", true);

  const read = readIndex(outcome.body);
  if (read.kind === "budget") return uniform("indeterminate", true);
  if (read.kind === "none") return uniform("not-present", true);
  return {
    pathSchema: "violated",
    // The legacy document is not governed by the pinned draft, so its entries
    // are not evidence for or against a v0.2.0 entry requirement. Reading them
    // would be judging a document against a schema it never claimed.
    entry: "indeterminate",
    digest: "indeterminate",
    pointer: null,
    consultedLegacy: true,
  };
}

function analyze(context: RoundContext<unknown>): SkillsAnalysis {
  const observation = context.observation(INDEX_OBSERVATION);
  if (observation.kind !== "http") return uniform("indeterminate", false);
  const outcome = observation.outcome;
  if (outcome.kind === "error") return uniform("indeterminate", false);
  if (outcome.status === 404 || outcome.status === 410) {
    return analyzeLegacy(context);
  }
  if (outcome.status < 200 || outcome.status > 299) {
    return uniform("indeterminate", false);
  }
  // A body cut off at the cap cannot be told from one that ends there.
  if (outcome.truncated) return uniform("indeterminate", false);

  const read = readIndex(outcome.body);
  if (read.kind === "budget") return uniform("indeterminate", false);
  // A 2xx that is not an index, including a 204 with no representation at all.
  if (read.kind === "none") return analyzeLegacy(context);
  return { ...analyzeSkillsIndex(read.value), consultedLegacy: false };
}

function kindFor(analysis: SkillsAnalysis, assertion: Assertion): OutcomeKind {
  switch (assertion) {
    case "skills.path-schema":
      return analysis.pathSchema;
    case "skills.entry":
      return analysis.entry;
    case "skills.digest":
      return analysis.digest;
  }
}

function evaluate(context: RoundContext<unknown>): AssertionOutcomes {
  const analysis = analyze(context);
  // `docs/THREAT_MODEL.md` section 20.1 keeps evidence to what explains the
  // assertion, so the legacy probe is cited only where it was read, and only
  // by the assertion whose verdict it changed.
  const pathSchemaRefs = analysis.consultedLegacy
    ? [INDEX_OBSERVATION, LEGACY_OBSERVATION]
    : [INDEX_OBSERVATION];
  const outcomes: readonly AssertionOutcome[] = ASSERTION_ORDER.map(
    (assertion): AssertionOutcome => ({
      assertion,
      kind: kindFor(analysis, assertion),
      // Empty because `specs/ruleset.standard.v0.yaml` declares no parameter
      // for any of these assertions. `analysis.pointer` is the value a
      // `json-pointer` parameter would carry.
      params: {},
      observationRefs:
        assertion === "skills.path-schema"
          ? pathSchemaRefs
          : [INDEX_OBSERVATION],
    }),
  );
  return { kind: "outcomes", outcomes };
}

export const skillsRule: RuleDefinition = {
  apiVersion: 1,
  metadata: {
    id: "agent.discovery.skills",
    externalCompatibilityId: "agentSkills",
    ruleVersion: "0.1.0",
    ruleset: { id: "standard", version: "0.4.0" },
    title: "Agent Skills discovery",
    category: "discovery",
    profiles: ["agent-service", "full"],
    applicability: "optional",
    modes: ["spec"],
    observationRuntime: ["http"],
    sourceMaturity: "draft",
    implementationStatus: "supported",
    sources: [
      {
        id: "isit-2026-08-28",
        title: "Is Your Site Agent-Ready? — Full Documentation",
        url: "https://isitagentready.com/llms-full.txt",
        kind: "compatibility-contract",
        status: "compatibility-snapshot",
        version: "snapshot 2026-08-28",
        verifiedAt: "2026-08-28",
      },
      {
        id: "agent-skills-discovery-v0.2.0",
        title: "Agent Skills Discovery RFC",
        url: "https://github.com/cloudflare/agent-skills-discovery-rfc",
        kind: "open-source-profile",
        status: "active-draft",
        version: "0.2.0",
        verifiedAt: "2026-08-28",
      },
    ],
    assertions: [
      {
        id: "skills.path-schema",
        mode: "spec",
        requirementClass: "normative",
        sourceRefs: [{ sourceId: "agent-skills-discovery-v0.2.0" }],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "skills.entry",
        mode: "spec",
        requirementClass: "normative",
        sourceRefs: [{ sourceId: "agent-skills-discovery-v0.2.0" }],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "skills.digest",
        mode: "spec",
        requirementClass: "normative",
        sourceRefs: [{ sourceId: "agent-skills-discovery-v0.2.0" }],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "skills.archive-safety",
        mode: "spec",
        requirementClass: "recommended",
        sourceRefs: [],
        params: {},
        excerptAuthorized: false,
        deferred: {
          adr: "ADR-0010",
          reason:
            "Two independent reasons, either of which is sufficient. Uncited: agent-skills-discovery-v0.2.0 defines the archive entry type and the digest over an artifact's raw bytes and states no size, file-count, path, link or compression-ratio limit. Those limits are docs/THREAT_MODEL.md section 19.6, which is this project's own control rather than a ledger source. Unevaluable: section 19.6 also records that the MVP does not unpack an archive at all, so nothing observes the metadata this assertion is about. An uninspected archive reported as pass would be a claim the scanner never checked, and reported as fail would be a claim about a target that did nothing wrong.",
          until:
            "An accepted decision permits unpacking a downloaded skill archive under the controls docs/THREAT_MODEL.md section 19.6 lists, and names the limit values. That decision must also assign source_refs for the limits it sets, which under ADR-0010 section 1 may be a project-policy source provided the assertion is not normative.",
        },
      },
    ],
    // Nothing is dereferenced. Verifying a declared digest against artifact
    // bytes is `interop`, which this rule does not declare.
    roundTwoBudget: 0,
  },
  defaultOptions: {},
  plan(): readonly ObservationRequest[] {
    return [
      {
        kind: "http",
        id: INDEX_OBSERVATION,
        method: "GET",
        target: { kind: "origin-path", path: AGENT_SKILLS_INDEX_PATH },
        accept: INDEX_ACCEPT,
        redirects: "follow-same-origin",
        maxEncodedBytes: MAX_INDEX_BYTES,
        maxDecodedBytes: MAX_INDEX_BYTES,
      },
      {
        kind: "http",
        id: LEGACY_OBSERVATION,
        method: "GET",
        target: { kind: "origin-path", path: LEGACY_SKILLS_INDEX_PATH },
        accept: INDEX_ACCEPT,
        redirects: "follow-same-origin",
        maxEncodedBytes: MAX_INDEX_BYTES,
        maxDecodedBytes: MAX_INDEX_BYTES,
      },
    ];
  },
  step(context: RoundContext<unknown>): AssertionOutcomes {
    return evaluate(context);
  },
  /**
   * Unreachable through `runScan`: `step` always returns outcomes, so the
   * engine never opens a second round. It evaluates rather than throwing so
   * that the two entry points cannot disagree if `roundTwoBudget` ever grows.
   */
  finish(context: RoundContext<unknown>): AssertionOutcomes {
    return evaluate(context);
  },
};
