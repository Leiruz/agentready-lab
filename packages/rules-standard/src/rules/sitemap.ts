import type {
  AssertionOutcome,
  AssertionOutcomes,
  DiscoveredProvenance,
  HttpObservationRequest,
  ObservationRequest,
  OutcomeKind,
  RequestBatch,
  RoundContext,
  RuleDefinition,
} from "@agentready-lab/core";

import { parseMediaType } from "../parsers/media-type.js";
import type { ParsedRobots } from "../parsers/robots.js";
import {
  PARSED_ROBOTS_MEMO_KEY,
  parseRobots,
  robotsObservationRequest,
} from "../parsers/robots.js";
import type { SitemapDocument, SitemapParse } from "../parsers/sitemap-xml.js";
import {
  PROTOCOL_MAX_ENTRIES,
  PROTOCOL_MAX_LOC_LENGTH,
  SITEMAP_NAMESPACE,
  SITEMAP_PARSE_LIMITS,
  isAbsoluteUrl,
  isW3cDatetime,
  parseSitemapXml,
} from "../parsers/sitemap-xml.js";

/**
 * `web.discovery.sitemap`. Registry ordinal 2 (`specs/checks.v0.yaml`).
 *
 * Every metadata value is read from `specs/ruleset.standard.v0.yaml` at
 * `ruleset_version` 0.4.0 and `specs/sources.v0.yaml` at
 * `source_ledger_version` 0.4.0, under the ADR-0002 section 10 mapping.
 * `test/registry.test.ts` re-reads both files and compares, so a value edited
 * here without the spec is a test failure rather than a silent divergence.
 * `implementationStatus` therefore still reads `planned`: the ruleset is the
 * authority for it and this change does not edit `specs/`.
 *
 * THIS IS THE ONE M1 RULE THAT USES ROUND TWO. `roundTwoBudget` is 1, and the
 * placeholder's 0 was a value to set rather than a limit to work around: the
 * ruleset carries no `round_two_budget` field, `test/registry.test.ts`
 * compares no such field, and the placeholder comment said in as many words
 * that the implementing agent sets it. One slot is enough because at most one
 * of these two hops can arise in a scan, and neither ever leads to a third:
 *
 * - the `Sitemap` record in `robots.txt` names a document at a URL the
 *   conventional path did not already fetch (`docs/FIXTURE_CATALOG.md` case
 *   `map-002`), which ADR-0002 section 1 names as one of the three
 *   discovered-resource cases in M1;
 * - the conventional document is a `sitemapindex`, and one child is followed
 *   to establish that the index resolves to a real sitemap (`map-003`).
 *
 * The MVP does not crawl. One child, chosen by document order, and no
 * recursion into a child that is itself an index.
 *
 * WHAT EACH ASSERTION MEANS. The ruleset declares no parameters and authorizes
 * no excerpt for any of the three, so every outcome below carries an empty
 * `params`, exactly as `web.discovery.robots` does.
 *
 * - `sitemap.xml` (normative). "Validate the sitemap or sitemap-index root,
 *   namespace, URL scope, encoding, and protocol limits against the Sitemaps
 *   protocol." Here that is: an XML media type, a well-formed document, a
 *   `urlset` or `sitemapindex` root in the sitemap namespace, UTF-8 bytes, at
 *   least one entry, a `<loc>` in every entry, no more than the protocol's
 *   50,000 entries, and, for an index, a followed child that is itself a
 *   valid `urlset`. Its stated "URL scope" dimension is reported through
 *   `sitemap.canonical` instead; the reason is under that assertion below.
 * - `sitemap.directive` (normative). "When discovery starts from a Sitemap
 *   record in robots.txt, parse its absolute URL and fetch that document
 *   before claiming sitemap conformance." This is about the record: it must
 *   be an absolute URL and it must name something retrievable. Whether that
 *   document is a valid sitemap is `sitemap.xml`'s question, so `map-004`'s
 *   malformed body is reported once and not twice.
 *
 *   A conditional obligation that never arises is `satisfied` and not
 *   `not-present`, which is ADR-0002 section 5's rule and its
 *   `content-signals.conflicting-declaration` precedent. So a target with a
 *   sitemap and no `Sitemap` record reports `satisfied` here. It cannot
 *   report `not-present` beside two evaluated outcomes -- that mixture is an
 *   enumerated contract violation -- and it cannot be omitted, because every
 *   declared assertion needs exactly one outcome.
 * - `sitemap.canonical` (recommended). "Use canonical, absolute URLs and keep
 *   last-modified data truthful when it is supplied." Every `<loc>` must
 *   begin with a scheme, stay under 2,048 characters and name the same origin
 *   as the target, and every `<lastmod>` present must be a W3C Datetime.
 *   Truthfulness of a timestamp is not observable and is not claimed.
 *
 *   Same-origin scope sits here rather than under `sitemap.xml` on purpose.
 *   The protocol's rule is same *host* and protocol, a rule may not construct
 *   a `URL` (ADR-0002 section 12), and the lexical origin-prefix test below
 *   is therefore stricter than the source: a sitemap listing the `https` form
 *   of an `http` target would be flagged. Under a recommended assertion that
 *   costs a `warning`; under the normative one it would have been a false
 *   `fail`, and this project does not trade a false `fail` for coverage.
 *
 * RETRIEVAL SEMANTICS, applied to both the conventional path and any
 * discovered document:
 *
 * - `2xx` is the only class evaluated;
 * - `4xx` means that document is not there. Where `robots.txt` also declares
 *   no `Sitemap` record, the mechanism is not deployed at all and every
 *   assertion goes `not-present` together, which is not a failure: the
 *   Sitemaps protocol is opt-in and `.claude/rules/standards.md` says missing
 *   optional material is not `fail`;
 * - `5xx`, a `3xx` the same-origin redirect policy would not follow, a
 *   transport error and a truncated body are all `indeterminate`;
 * - a parse the scanner **refused** -- fixture `sec-008`'s `DOCTYPE`, or any
 *   bound in `docs/THREAT_MODEL.md` section 19.3 -- is `indeterminate` and
 *   never `violated`. That budget is ours, not the publisher's, and
 *   ADR-0003 section 2 states the distinction directly. A document the
 *   scanner did parse and found *wrong* is `violated`, which is `map-004`.
 *
 * WHAT THIS RULE CANNOT DO, recorded rather than worked around. It never
 * resolves a relative URL, because `context.resolve()` does not exist and a
 * rule may not construct a `URL`. That is not a gap for `map-006`, where the
 * relative `Sitemap: /nested.xml` **is** the failure and `/nested.xml` is
 * therefore never requested. It is a gap for a `sitemapindex` whose child
 * `<loc>` is relative: that child is not followed, `sitemap.canonical`
 * records the relative value as a violation, and `sitemap.xml` reports
 * `indeterminate` rather than guessing what the index meant.
 */

/** Rule-local, and never evidence ids (ADR-0002 section 8). */
const ROBOTS_ID = "robots";
const ROOT_ID = "sitemap-root";
const DISCOVERED_ID = "sitemap-discovered";

const XML = "sitemap.xml";
const DIRECTIVE = "sitemap.directive";
const CANONICAL = "sitemap.canonical";

/** The conventional location, which is the only path this rule guesses. */
const SITEMAP_PATH = "/sitemap.xml";

/**
 * The Sitemaps protocol names no media type, so this is an interpretation and
 * is stated in one place. RFC 7303 registers `application/xml` and `text/xml`
 * for XML documents and the `+xml` structured suffix for XML-based formats,
 * and those three shapes are the minimum that lets `map-005`'s `text/html`
 * not-found page fail rather than be parsed for a sitemap it does not have.
 */
const SITEMAP_ACCEPT = "application/xml";

/** The `Sitemap` extension field, lowercased as the robots parser hands it. */
const SITEMAP_FIELD = "sitemap";

function outcome(
  assertion: string,
  kind: OutcomeKind,
  observationRefs: readonly string[],
): AssertionOutcome {
  return { assertion, kind, params: {}, observationRefs };
}

/** Every assertion at once, for the whole-mechanism verdicts. */
function uniform(
  kind: OutcomeKind,
  observationRefs: readonly string[],
): AssertionOutcomes {
  return {
    kind: "outcomes",
    outcomes: [
      outcome(XML, kind, observationRefs),
      outcome(DIRECTIVE, kind, observationRefs),
      outcome(CANONICAL, kind, observationRefs),
    ],
  };
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

type RobotsReading =
  /** Retrieval or parsing left the question open. */
  | { readonly kind: "unknown" }
  /** robots.txt is absent, or carries no `Sitemap` record. */
  | { readonly kind: "absent" }
  /** At least one record is not an absolute URL. */
  | { readonly kind: "relative" }
  | { readonly kind: "absolute"; readonly url: string; readonly line: number };

/**
 * Reads the `Sitemap` records out of the shared robots parse.
 *
 * The observation and the memo key both come from `src/parsers/robots.ts`, so
 * this rule shares the one `/robots.txt` dispatch and the one parse with
 * `web.discovery.robots`, `web.policy.ai-crawler` and
 * `web.policy.content-signals` rather than issuing a second fetch.
 *
 * A refused parse is `unknown` and never a violation: RFC 9309 section 2.5
 * makes the parsing limit the crawler's own.
 */
function readRobots(context: RoundContext<unknown>): RobotsReading {
  const observation = context.observation(ROBOTS_ID);
  if (observation.kind !== "http" || observation.outcome.kind === "error") {
    return { kind: "unknown" };
  }
  const response = observation.outcome;
  if (response.status >= 400 && response.status <= 499) {
    return { kind: "absent" };
  }
  if (response.status < 200 || response.status > 299 || response.truncated) {
    return { kind: "unknown" };
  }

  const parsed = context.memo<ParsedRobots>(PARSED_ROBOTS_MEMO_KEY, () =>
    parseRobots(response.body),
  );
  if (parsed.refusedBy !== null) return { kind: "unknown" };

  const records = parsed.extensions.filter(
    (record) => record.field === SITEMAP_FIELD,
  );
  if (records.length === 0) return { kind: "absent" };
  // One defective record is enough. A target that publishes an absolute and a
  // relative record has not met the requirement, and following the good one
  // would report a pass over the top of the defect.
  if (records.some((record) => !isAbsoluteUrl(record.value))) {
    return { kind: "relative" };
  }
  const first = records[0];
  if (first === undefined) return { kind: "absent" };
  return { kind: "absolute", url: first.value, line: first.line };
}

// ---------------------------------------------------------------------------
// Sitemap documents
// ---------------------------------------------------------------------------

interface DocumentReading {
  /** The rule-local observation id this reading came from. */
  readonly id: string;
  readonly retrieval: "unknown" | "absent" | "present";
  /** The URL the engine actually requested, or `null` for a refused request. */
  readonly requestUrl: string | null;
  readonly wrongMediaType: boolean;
  /** `null` unless the response was a `2xx` carrying an XML media type. */
  readonly parse: SitemapParse | null;
}

/**
 * RFC 9110 section 8.3.1 media type of a response, essence only.
 *
 * A representation with no `Content-Type` does not declare that it is XML, so
 * it is treated as the wrong type rather than sniffed. `docs/THREAT_MODEL.md`
 * section 19.1: target bytes are not sniffed into an executable format, and
 * `.claude/rules/standards.md`: a `2xx` does not by itself prove support.
 */
function isXmlMediaType(
  headers: ReadonlyMap<string, readonly string[]>,
): boolean {
  const field = headers.get("content-type")?.[0];
  if (field === undefined) return false;
  const media = parseMediaType(field);
  if (media === null) return false;
  return (
    media.essence === "application/xml" ||
    media.essence === "text/xml" ||
    media.subtype.endsWith("+xml")
  );
}

function readDocument(
  context: RoundContext<unknown>,
  id: string,
): DocumentReading {
  const observation = context.observation(id);
  if (observation.kind !== "http") {
    return {
      id,
      retrieval: "unknown",
      requestUrl: null,
      wrongMediaType: false,
      parse: null,
    };
  }
  const requestUrl = observation.request.url;
  const unparsed = (
    retrieval: "unknown" | "absent" | "present",
    wrongMediaType = false,
  ): DocumentReading => ({
    id,
    retrieval,
    requestUrl,
    wrongMediaType,
    parse: null,
  });

  if (observation.outcome.kind === "error") return unparsed("unknown");
  const response = observation.outcome;
  if (response.status >= 400 && response.status <= 499) {
    return unparsed("absent");
  }
  if (response.status < 200 || response.status > 299) {
    return unparsed("unknown");
  }
  // A truncated body is a prefix, and a prefix of a valid sitemap is not
  // evidence either way, so it is retrieved but never parsed.
  if (response.truncated) return unparsed("present");
  if (!isXmlMediaType(response.headers)) return unparsed("present", true);
  return {
    id,
    retrieval: "present",
    requestUrl,
    wrongMediaType: false,
    parse: parseSitemapXml(response.body),
  };
}

/** The structural verdict on one retrieved document. */
type Structure =
  | { readonly kind: "unknown" }
  | { readonly kind: "absent" }
  | { readonly kind: "violated" }
  | {
      readonly kind: "urlset" | "sitemapindex";
      readonly document: SitemapDocument;
    };

function structureOf(reading: DocumentReading): Structure {
  if (reading.retrieval !== "present") return { kind: reading.retrieval };
  if (reading.wrongMediaType) return { kind: "violated" };
  const parse = reading.parse;
  // A truncated body reaches here with no parse: the bytes we hold are a
  // prefix, and a prefix of a valid sitemap is not evidence either way.
  if (parse === null) return { kind: "unknown" };

  switch (parse.kind) {
    case "refused":
      return { kind: "unknown" };
    case "malformed":
    case "other-root":
      return { kind: "violated" };
    case "urlset":
    case "sitemapindex":
      break;
  }

  const document = parse.document;
  if (document.namespace !== SITEMAP_NAMESPACE) return { kind: "violated" };
  if (document.invalidUtf8) return { kind: "violated" };
  if (document.entryCount === 0) return { kind: "violated" };
  if (document.entryCount > PROTOCOL_MAX_ENTRIES) return { kind: "violated" };
  if (document.entries.some((entry) => entry.loc === null)) {
    return { kind: "violated" };
  }
  return { kind: parse.kind, document };
}

/**
 * The `<loc>` of the first entry of a `sitemapindex`, when it is a URL this
 * rule may ask the engine to authorize.
 *
 * `null` covers every reason not to follow one, and each of them is reported
 * rather than retried: the root is not an index, the index is empty, or the
 * child is relative and this rule does not resolve URLs.
 */
function firstIndexChild(structure: Structure): string | null {
  if (structure.kind !== "sitemapindex") return null;
  const loc = structure.document.entries[0]?.loc ?? null;
  if (loc === null || !isAbsoluteUrl(loc)) return null;
  return loc;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

interface Evaluation {
  readonly robots: RobotsReading;
  /**
   * The document discovery names: the one the `Sitemap` record declares when
   * there is an absolute record, and the conventional path otherwise. When
   * the record is absolute these are the same document by construction, which
   * is why `sitemap.directive` reads its retrieval from here.
   */
  readonly effective: DocumentReading;
  /** The followed child of an index root, or `null` when none was followed. */
  readonly child: DocumentReading | null;
}

/**
 * This reads the declared document's **retrieval** and never its contents.
 *
 * The obligation is "parse its absolute URL and fetch that document", so a
 * `2xx` discharges it whatever the bytes turn out to be. Whether those bytes
 * are a valid sitemap is `sitemap.xml`'s question, and reading the parse here
 * would report `map-004`'s one defect as two findings.
 */
function directiveOutcome(
  robots: RobotsReading,
  retrieval: DocumentReading["retrieval"],
): OutcomeKind {
  switch (robots.kind) {
    case "unknown":
      return "indeterminate";
    // The obligation is conditional on a record existing. With none, it is
    // met vacuously (ADR-0002 section 5).
    case "absent":
      return "satisfied";
    case "relative":
      return "violated";
    case "absolute":
      switch (retrieval) {
        case "present":
          return "satisfied";
        // An absolute record naming nothing retrievable has not been met.
        case "absent":
          return "violated";
        case "unknown":
          return "indeterminate";
      }
  }
}

function xmlOutcome(
  effective: Structure,
  child: Structure | null,
): OutcomeKind {
  switch (effective.kind) {
    case "unknown":
    case "absent":
      return "indeterminate";
    case "violated":
      return "violated";
    case "urlset":
      return "satisfied";
    case "sitemapindex":
      break;
  }
  // An index is only as good as what it resolves to. `null` is the honest
  // answer where no child could be followed within budget.
  if (child === null) return "indeterminate";
  switch (child.kind) {
    case "urlset":
      return "satisfied";
    case "violated":
      return "violated";
    // A child that is itself an index is not followed: the MVP does not
    // recurse, and no source read here forbids the nesting outright.
    default:
      return "indeterminate";
  }
}

/**
 * Every `<loc>` and `<lastmod>` this rule actually saw.
 *
 * `origin` is `TargetDescriptor.origin`, which the engine has already
 * canonicalized, so the comparison is a prefix test on a canonical string and
 * not a URL parse.
 */
function canonicalOutcome(
  documents: readonly SitemapDocument[],
  origin: string,
): OutcomeKind {
  if (documents.length === 0) return "indeterminate";
  let truncatedView = false;
  for (const document of documents) {
    if (document.entryCount > document.entries.length) truncatedView = true;
    for (const entry of document.entries) {
      const loc = entry.loc;
      // A missing `<loc>` is a structural defect and `sitemap.xml` reports it.
      if (loc !== null) {
        if (!isAbsoluteUrl(loc)) return "violated";
        if (loc.length >= PROTOCOL_MAX_LOC_LENGTH) return "violated";
        if (!isSameOrigin(loc, origin)) return "violated";
      }
      if (entry.lastmod !== null && !isW3cDatetime(entry.lastmod)) {
        return "violated";
      }
    }
  }
  return truncatedView ? "indeterminate" : "satisfied";
}

function isSameOrigin(loc: string, origin: string): boolean {
  if (loc.length < origin.length) return false;
  if (loc.slice(0, origin.length).toLowerCase() !== origin) return false;
  const next = loc.charCodeAt(origin.length);
  return Number.isNaN(next) || next === 0x2f || next === 0x3f;
}

function evaluate(evaluation: Evaluation, origin: string): AssertionOutcomes {
  const { robots, effective, child } = evaluation;
  const effectiveStructure = structureOf(effective);
  const childStructure = child === null ? null : structureOf(child);

  const refs: string[] = [ROBOTS_ID, effective.id];
  if (child !== null && child.id !== effective.id) refs.push(child.id);
  refs.sort();

  // ADR-0002 section 5: `not-present` means the mechanism is not deployed, and
  // it is a property of the observation set, so it is all three or none.
  if (effectiveStructure.kind === "absent" && robots.kind === "absent") {
    return uniform("not-present", refs);
  }

  const documents: SitemapDocument[] = [];
  if (
    effectiveStructure.kind === "urlset" ||
    effectiveStructure.kind === "sitemapindex"
  ) {
    documents.push(effectiveStructure.document);
  }
  if (
    childStructure?.kind === "urlset" ||
    childStructure?.kind === "sitemapindex"
  ) {
    documents.push(childStructure.document);
  }

  return {
    kind: "outcomes",
    outcomes: [
      outcome(XML, xmlOutcome(effectiveStructure, childStructure), refs),
      outcome(DIRECTIVE, directiveOutcome(robots, effective.retrieval), refs),
      outcome(CANONICAL, canonicalOutcome(documents, origin), refs),
    ],
  };
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

function sitemapRequest(
  id: string,
  target: HttpObservationRequest["target"],
): HttpObservationRequest {
  return {
    kind: "http",
    id,
    method: "GET",
    target,
    accept: SITEMAP_ACCEPT,
    redirects: "follow-same-origin",
    maxEncodedBytes: SITEMAP_PARSE_LIMITS.maxBytes,
    maxDecodedBytes: SITEMAP_PARSE_LIMITS.maxBytes,
  };
}

interface Discovery {
  /**
   * `declared` replaces the conventional document with the one the `Sitemap`
   * record names; `index-child` adds a child beside it.
   */
  readonly kind: "declared" | "index-child";
  readonly url: string;
  readonly provenance: DiscoveredProvenance;
}

/**
 * The single round-two request, or `null`.
 *
 * `step()` and `finish()` both call this, from the same frozen round-one
 * observations, which is what ADR-0002 section 1 means by a rule needing no
 * continuation state between rounds: `finish()` re-derives which branch it is
 * in rather than being told.
 *
 * The declared document comes first. A `Sitemap` record is the target's own
 * statement about where its sitemap is, and the conventional path is this
 * rule's guess; where the two disagree, the statement wins. Where they agree,
 * round one already fetched it and there is nothing to request.
 */
function discoveryOf(
  robots: RobotsReading,
  root: DocumentReading,
): Discovery | null {
  if (robots.kind === "absolute" && robots.url !== root.requestUrl) {
    return {
      kind: "declared",
      url: robots.url,
      provenance: {
        fromObservation: ROBOTS_ID,
        locator: `robots.txt:${String(robots.line)}`,
      },
    };
  }
  const child = firstIndexChild(structureOf(root));
  if (child === null) return null;
  return {
    kind: "index-child",
    url: child,
    provenance: {
      fromObservation: ROOT_ID,
      locator: "/sitemapindex/sitemap/0/loc",
    },
  };
}

export const sitemapRule: RuleDefinition = {
  apiVersion: 1,
  metadata: {
    id: "web.discovery.sitemap",
    externalCompatibilityId: "sitemap",
    ruleVersion: "0.1.0",
    ruleset: { id: "standard", version: "0.4.0" },
    title: "Sitemap",
    category: "discoverability",
    profiles: ["content", "api", "agent-service", "full"],
    applicability: "applicable",
    modes: ["spec"],
    observationRuntime: ["http"],
    sourceMaturity: "stable",
    implementationStatus: "planned",
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
        id: "sitemaps-protocol",
        title: "Sitemaps XML format",
        url: "https://www.sitemaps.org/protocol.html",
        kind: "industry-protocol",
        status: "final",
        version: "living protocol page",
        verifiedAt: "2026-08-28",
      },
      {
        id: "rfc9309",
        title: "RFC 9309: Robots Exclusion Protocol",
        url: "https://www.rfc-editor.org/rfc/rfc9309",
        kind: "ietf-rfc",
        status: "proposed-standard",
        version: "RFC 9309",
        verifiedAt: "2026-08-28",
      },
    ],
    assertions: [
      {
        id: "sitemap.xml",
        mode: "spec",
        requirementClass: "normative",
        sourceRefs: [{ sourceId: "sitemaps-protocol" }],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "sitemap.directive",
        mode: "spec",
        requirementClass: "normative",
        sourceRefs: [
          { sourceId: "sitemaps-protocol" },
          { sourceId: "rfc9309", section: "2.2.4" },
        ],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "sitemap.canonical",
        mode: "spec",
        requirementClass: "recommended",
        sourceRefs: [{ sourceId: "sitemaps-protocol" }],
        params: {},
        excerptAuthorized: false,
      },
    ],
    roundTwoBudget: 1,
  },
  defaultOptions: {},
  plan(): readonly ObservationRequest[] {
    return [
      // The shared observation of `docs/TEST_STRATEGY.md` section 6, built by
      // the robots parser so that four rules canonicalize onto one dispatch.
      robotsObservationRequest(ROBOTS_ID),
      sitemapRequest(ROOT_ID, { kind: "origin-path", path: SITEMAP_PATH }),
    ];
  },
  step(context: RoundContext<unknown>): RequestBatch | AssertionOutcomes {
    const robots = readRobots(context);
    const root = readDocument(context, ROOT_ID);
    const discovery = discoveryOf(robots, root);

    if (discovery !== null) {
      return {
        kind: "requests",
        requests: [
          sitemapRequest(DISCOVERED_ID, {
            kind: "discovered",
            url: discovery.url,
            provenance: discovery.provenance,
          }),
        ],
      };
    }

    return evaluate(
      { robots, effective: root, child: null },
      context.target.origin,
    );
  },
  finish(context: RoundContext<unknown>): AssertionOutcomes {
    const robots = readRobots(context);
    const root = readDocument(context, ROOT_ID);
    const followed = readDocument(context, DISCOVERED_ID);

    // `finish()` runs only after `step()` returned a batch, so exactly one of
    // these two shapes is this scan's.
    const evaluation: Evaluation =
      discoveryOf(robots, root)?.kind === "declared"
        ? { robots, effective: followed, child: null }
        : { robots, effective: root, child: followed };

    return evaluate(evaluation, context.target.origin);
  },
};
