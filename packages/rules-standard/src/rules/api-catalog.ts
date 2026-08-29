import type {
  AssertionOutcome,
  AssertionOutcomes,
  ObservationRequest,
  OutcomeKind,
  RoundContext,
  RuleDefinition,
} from "@agentready-lab/core";

import type { JsonSafeObject, JsonSafeValue } from "../parsers/json-safe.js";
import {
  isJsonArray,
  isJsonObject,
  jsonPointer,
  parseJsonSafe,
} from "../parsers/json-safe.js";
import { mediaTypeParameter, parseMediaType } from "../parsers/media-type.js";

/**
 * `web.discovery.api-catalog`. Registry ordinal 13 (`specs/checks.v0.yaml`).
 *
 * Every metadata value is read from `specs/ruleset.standard.v0.yaml` at
 * `ruleset_version` 0.4.0 and `specs/sources.v0.yaml` at
 * `source_ledger_version` 0.4.0, under the ADR-0002 section 10 mapping.
 * `test/registry.test.ts` re-reads both files and compares, so a value edited
 * here without the spec is a test failure rather than a silent divergence.
 * `implementationStatus` reads `supported` because the ruleset now says so;
 * this file follows it rather than deciding it.
 *
 * TWO THINGS THIS RULE CANNOT DO, both recorded rather than worked around.
 *
 * 1. It cannot put a JSON Pointer in a finding. `docs/FIXTURE_CATALOG.md`
 *    section 11 requires `api-006` to fail "with precise JSON Pointer", and
 *    `FindingParam` in `packages/core` has a `json-pointer` kind for exactly
 *    that. But all four of this rule's assertions declare `params: []` in
 *    `specs/ruleset.standard.v0.yaml`, under that file's own
 *    "params unassigned" todo, and `validateOutcomeParams` rejects any
 *    parameter an assertion did not declare. So the pointer is computed, is
 *    exact, and has nowhere to go. `analyzeApiCatalog` returns it so the
 *    precision is testable today and so that assigning the parameter in the
 *    ruleset is a one-line change here rather than an investigation.
 *
 * 2. It cannot make `api-001` `pass` against the current base fixture. See
 *    `api-catalog.profile` below.
 */

/** RFC 9727 section 2. */
const CATALOG_PATH = "/.well-known/api-catalog";

/** RFC 9727 sections 4.2 and 6.2, and RFC 9264 section 4.2. */
const LINKSET_MEDIA_TYPE = "application/linkset+json";

/**
 * RFC 9727 section 4.2: "The Linkset SHOULD include a profile parameter
 * (Section 5 of [RFC9264]) with a Profile URI [RFC7284] value of
 * `https://www.rfc-editor.org/info/rfc9727`". Registered in section 7.3.
 *
 * The URI is therefore pinned by the source, not guessed. What is missing is
 * on the other side: the `valid-agent-site-v1` base fixture serves
 * `/.well-known/api-catalog` as bare `application/linkset+json` with no
 * profile parameter, which `apps/fixtures-worker/src/cases/shared.ts` already
 * records as `API_PROFILE_UNPINNED`. A recommended requirement that is
 * observably not followed is `violated`, which `findingStatus` derives to
 * `warning`, and `warning` outranks `pass` in `RULE_STATUS_PRECEDENCE`. So
 * `api-001` against the unmodified base is `warning`, not the `pass` the
 * fixture catalog states. That is a fixture defect, and it is left visible
 * here rather than hidden by reporting `satisfied` for something nothing
 * observed.
 */
const PROFILE_URI = "https://www.rfc-editor.org/info/rfc9727";

/**
 * A bound on the catalog document. Well under the whole-scan ceiling, because
 * an API catalog is a small document and a body this rule cannot finish
 * reading is worth refusing early.
 */
const MAX_CATALOG_BYTES = 262_144;

const OBSERVATION_ID = "well-known-api-catalog";

/**
 * The relation types by which a link context object names an API endpoint.
 *
 * RFC 9727 section 4.1 states the requirement -- "The API catalog MUST include
 * hyperlinks to API endpoints" -- and does not enumerate the relations that
 * satisfy it. These three shapes are the ones the RFC itself uses:
 *
 * - `SERVICE_RELATIONS`, with an `anchor`: Appendix A.1, where the anchor is
 *   the API endpoint and the RFC 8631 service relations describe it;
 * - `item`: Appendix A.2, where the anchor is the catalog and each `item`
 *   target is an API endpoint;
 * - `api-catalog`: section 4.3, a link to a nested catalog.
 *
 * Appendices A.1 and A.2 are informative, so this list is an interpretation of
 * a normative requirement and not a transcription of one. It is stated here,
 * in one named constant, rather than spread through the evaluator, and it is
 * the part of this rule an accepted decision should pin.
 */
const SERVICE_RELATIONS: readonly string[] = [
  "service-desc",
  "service-doc",
  "service-meta",
  "status",
];

/** Relations whose targets are themselves the API endpoints or catalogs. */
const ENDPOINT_RELATIONS: readonly string[] = ["item", "api-catalog"];

const ASSERTION_ORDER = [
  "api-catalog.discovery",
  "api-catalog.linkset",
  "api-catalog.relations",
  "api-catalog.profile",
] as const;

export interface ApiCatalogAnalysis {
  readonly discovery: OutcomeKind;
  readonly linkset: OutcomeKind;
  readonly relations: OutcomeKind;
  readonly profile: OutcomeKind;
  /**
   * RFC 6901 pointer to the location that failed, or `null`. Exact, and
   * currently unreportable: see the note at the top of this file.
   */
  readonly pointer: string | null;
}

/** Every assertion reports the same kind. Used for absence and for errors. */
function uniform(kind: OutcomeKind): ApiCatalogAnalysis {
  return {
    discovery: kind,
    linkset: kind,
    relations: kind,
    profile: kind,
    pointer: null,
  };
}

interface LinksetShape {
  readonly ok: true;
  readonly contexts: readonly JsonSafeObject[];
}

interface LinksetDefect {
  readonly ok: false;
  readonly pointer: string;
}

/**
 * RFC 9264 sections 4.2.1 to 4.2.3: the link set, link context object and link
 * target object rules, checked in document order so the pointer names the
 * first defect rather than an arbitrary one.
 */
function readLinkset(value: JsonSafeValue): LinksetShape | LinksetDefect {
  if (!isJsonObject(value)) return { ok: false, pointer: "" };
  const members = Object.keys(value);
  // Section 4.2.1: an object that "MUST contain 'linkset' as its sole member".
  // RFC 9264's own JSON-LD example (Appendix A) keeps it sole and conveys the
  // context in a `Link` field, so this is not in tension with section 4.2.
  if (members.length !== 1 || members[0] !== "linkset") {
    return { ok: false, pointer: "" };
  }
  const linkset = value["linkset"];
  if (!isJsonArray(linkset)) {
    return { ok: false, pointer: jsonPointer(["linkset"]) };
  }

  const contexts: JsonSafeObject[] = [];
  for (const [index, entry] of linkset.entries()) {
    if (!isJsonObject(entry)) {
      return { ok: false, pointer: jsonPointer(["linkset", index]) };
    }
    for (const [relation, member] of Object.entries(entry)) {
      const at = ["linkset", index, relation] as const;
      // Section 4.2.2: `anchor` is OPTIONAL and, when present, is a URI
      // reference rather than an array of link target objects.
      if (relation === "anchor") {
        if (typeof member !== "string") {
          return { ok: false, pointer: jsonPointer(at) };
        }
        continue;
      }
      if (!isJsonArray(member)) {
        return { ok: false, pointer: jsonPointer(at) };
      }
      for (const [position, target] of member.entries()) {
        if (!isJsonObject(target)) {
          return { ok: false, pointer: jsonPointer([...at, position]) };
        }
        // Section 4.2.3: "Each link target object MUST contain an 'href'
        // member". An empty string is explicitly permitted.
        if (typeof target["href"] !== "string") {
          return { ok: false, pointer: jsonPointer([...at, position, "href"]) };
        }
      }
    }
    contexts.push(entry);
  }
  return { ok: true, contexts };
}

function hasTargets(entry: JsonSafeObject, relation: string): boolean {
  const member = entry[relation];
  return isJsonArray(member) && member.length > 0;
}

/** RFC 9727 section 4.1, read through `SERVICE_RELATIONS`/`ENDPOINT_RELATIONS`. */
function namesApiEndpoint(entry: JsonSafeObject): boolean {
  if (ENDPOINT_RELATIONS.some((relation) => hasTargets(entry, relation))) {
    return true;
  }
  const anchor = entry["anchor"];
  if (typeof anchor !== "string" || anchor === "") return false;
  return SERVICE_RELATIONS.some((relation) => hasTargets(entry, relation));
}

/**
 * The whole verdict, as a pure function of the two things observed: the
 * `Content-Type` field value and the body bytes.
 *
 * Exported because the JSON Pointer it carries cannot reach a finding, so this
 * is the only place the "precise JSON Pointer" of `docs/FIXTURE_CATALOG.md`
 * case `api-006` can be asserted at all.
 */
export function analyzeApiCatalog(
  contentType: string | undefined,
  body: Uint8Array,
): ApiCatalogAnalysis {
  const mediaType =
    contentType === undefined ? null : parseMediaType(contentType);
  if (mediaType?.essence !== LINKSET_MEDIA_TYPE) {
    // RFC 9727 sections 4.2 and 6.2 make `application/linkset+json` a MUST at
    // this location. Nothing downstream is evaluated: `docs/THREAT_MODEL.md`
    // section 19.1 forbids sniffing a body into a format its label denies, so
    // the linkset questions are not answerable rather than answered "no".
    return {
      discovery: "violated",
      linkset: "indeterminate",
      relations: "indeterminate",
      profile: "indeterminate",
      pointer: null,
    };
  }

  // RFC 9264 section 5: the value is a non-empty, space-separated list of
  // profile URIs. Split generously: a URI contains no whitespace, so an
  // over-eager separator can only fail to find a URI that was not there.
  const profileParameter = mediaTypeParameter(mediaType, "profile");
  const profile: OutcomeKind =
    profileParameter?.split(/\s+/).includes(PROFILE_URI) === true
      ? "satisfied"
      : "violated";

  const parsed = parseJsonSafe(body);
  if (!parsed.ok) {
    // A document this reader refused for its own budget is not a defect the
    // target committed; a document that is not UTF-8 JSON is. `duplicate-key`
    // sits with the budget codes because the reader declines to pick one of
    // two meanings, which is an ambiguity and not a finding.
    const violation =
      parsed.code === "syntax" || parsed.code === "invalid-utf8";
    return {
      discovery: "satisfied",
      linkset: violation ? "violated" : "indeterminate",
      relations: "indeterminate",
      profile,
      pointer: parsed.pointer,
    };
  }

  const shape = readLinkset(parsed.value);
  if (!shape.ok) {
    return {
      discovery: "satisfied",
      linkset: "violated",
      relations: "indeterminate",
      profile,
      pointer: shape.pointer,
    };
  }

  // An empty `linkset` array is well-formed RFC 9264 and is not an API
  // catalog: `docs/FIXTURE_CATALOG.md` case `api-005` fails here and not on
  // `api-catalog.linkset`, which is what "beyond array presence" means.
  const qualifying = shape.contexts.some(namesApiEndpoint);
  if (qualifying) {
    return {
      discovery: "satisfied",
      linkset: "satisfied",
      relations: "satisfied",
      profile,
      pointer: null,
    };
  }
  return {
    discovery: "satisfied",
    linkset: "satisfied",
    relations: "violated",
    profile,
    pointer:
      shape.contexts.length === 0
        ? jsonPointer(["linkset"])
        : jsonPointer(["linkset", 0]),
  };
}

function firstHeader(
  headers: ReadonlyMap<string, readonly string[]>,
  name: string,
): string | undefined {
  const values = headers.get(name);
  // RFC 9110 section 8.3: more than one `Content-Type` says nothing about
  // which representation was sent, so it is not a media type at all.
  return values?.length === 1 ? values[0] : undefined;
}

function evaluate(context: RoundContext<unknown>): AssertionOutcomes {
  const analysis = analyze(context);
  const outcomes: readonly AssertionOutcome[] = ASSERTION_ORDER.map(
    (assertion): AssertionOutcome => ({
      assertion,
      kind: kindFor(analysis, assertion),
      // Empty because `specs/ruleset.standard.v0.yaml` declares no parameter
      // for any of these four assertions. `analysis.pointer` is the value a
      // `json-pointer` parameter would carry.
      params: {},
      observationRefs: [OBSERVATION_ID],
    }),
  );
  return { kind: "outcomes", outcomes };
}

function kindFor(
  analysis: ApiCatalogAnalysis,
  assertion: (typeof ASSERTION_ORDER)[number],
): OutcomeKind {
  switch (assertion) {
    case "api-catalog.discovery":
      return analysis.discovery;
    case "api-catalog.linkset":
      return analysis.linkset;
    case "api-catalog.relations":
      return analysis.relations;
    case "api-catalog.profile":
      return analysis.profile;
  }
}

function analyze(context: RoundContext<unknown>): ApiCatalogAnalysis {
  const observation = context.observation(OBSERVATION_ID);
  if (observation.kind !== "http") return uniform("indeterminate");
  const outcome = observation.outcome;
  // A transport or policy error is an environmental condition, never a
  // conformance failure (`.claude/rules/standards.md`).
  if (outcome.kind === "error") return uniform("indeterminate");
  // Applicability is `optional`: an origin that publishes no API catalog has
  // not violated RFC 9727, it has not deployed the mechanism. Every assertion
  // must agree, which `validateRuleOutcomes` enforces as `mixed-not-present`.
  if (outcome.status === 404 || outcome.status === 410) {
    return uniform("not-present");
  }
  if (outcome.status < 200 || outcome.status > 299) {
    return uniform("indeterminate");
  }
  // A body cut off at the cap cannot be told from one that ends there.
  if (outcome.truncated) return uniform("indeterminate");

  return analyzeApiCatalog(
    firstHeader(outcome.headers, "content-type"),
    outcome.body,
  );
}

export const apiCatalogRule: RuleDefinition = {
  apiVersion: 1,
  metadata: {
    id: "web.discovery.api-catalog",
    externalCompatibilityId: "apiCatalog",
    ruleVersion: "0.1.0",
    ruleset: { id: "standard", version: "0.4.0" },
    title: "API Catalog",
    category: "discovery",
    profiles: ["api", "agent-service", "full"],
    applicability: "optional",
    modes: ["spec"],
    observationRuntime: ["http"],
    sourceMaturity: "stable",
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
        id: "rfc9727",
        title:
          "RFC 9727: api-catalog: A Well-Known URI and Link Relation to Help Discovery of APIs",
        url: "https://www.rfc-editor.org/rfc/rfc9727",
        kind: "ietf-rfc",
        status: "proposed-standard",
        version: "RFC 9727",
        verifiedAt: "2026-08-28",
      },
      {
        id: "rfc9264",
        title:
          "RFC 9264: Linkset: Media Types and a Link Relation Type for Link Sets",
        url: "https://www.rfc-editor.org/rfc/rfc9264",
        kind: "ietf-rfc",
        status: "proposed-standard",
        version: "RFC 9264",
        verifiedAt: "2026-08-28",
      },
      {
        id: "rfc8288",
        title: "RFC 8288: Web Linking",
        url: "https://www.rfc-editor.org/rfc/rfc8288",
        kind: "ietf-rfc",
        status: "proposed-standard",
        version: "RFC 8288",
        verifiedAt: "2026-08-28",
      },
    ],
    assertions: [
      {
        id: "api-catalog.discovery",
        mode: "spec",
        requirementClass: "normative",
        sourceRefs: [{ sourceId: "rfc9727" }],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "api-catalog.linkset",
        mode: "spec",
        requirementClass: "normative",
        sourceRefs: [{ sourceId: "rfc9264" }],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "api-catalog.relations",
        mode: "spec",
        requirementClass: "normative",
        sourceRefs: [{ sourceId: "rfc9727", section: "4.1" }],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "api-catalog.profile",
        mode: "spec",
        requirementClass: "recommended",
        sourceRefs: [{ sourceId: "rfc9727" }],
        params: {},
        excerptAuthorized: false,
      },
    ],
    // Nothing is dereferenced. RFC 9727's own links are resolved only in
    // `interop` mode, which the ruleset scopes to one selected service
    // description; `spec` mode reads the catalog and stops.
    roundTwoBudget: 0,
  },
  defaultOptions: {},
  plan(): readonly ObservationRequest[] {
    return [
      {
        kind: "http",
        id: OBSERVATION_ID,
        method: "GET",
        target: { kind: "origin-path", path: CATALOG_PATH },
        accept: LINKSET_MEDIA_TYPE,
        redirects: "follow-same-origin",
        maxEncodedBytes: MAX_CATALOG_BYTES,
        maxDecodedBytes: MAX_CATALOG_BYTES,
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
