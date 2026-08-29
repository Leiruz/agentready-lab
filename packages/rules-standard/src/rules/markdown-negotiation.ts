import type {
  AssertionOutcome,
  AssertionOutcomes,
  HttpObservation,
  ObservationRequest,
  OutcomeKind,
  RoundContext,
  RuleDefinition,
} from "@agentready-lab/core";

import { isMediaType } from "../parsers/media-type.js";

const HTML_OBSERVATION = "html";
const MARKDOWN_OBSERVATION = "markdown";

/**
 * The two `Accept` values, fixed rather than configurable.
 *
 * `text/html` is the value ADR-0005 section 1's request table gives the HTML
 * probe, so this rule and `web.discovery.link` share one dispatch for it, and
 * `text/markdown` is the value the same table gives the Markdown probe. No
 * repository document defines a per-profile `Accept`, so an option here would
 * be configuration nothing configures.
 */
const HTML_ACCEPT = "text/html";
const MARKDOWN_ACCEPT = "text/markdown";

const TEXT_HTML = "text/html";
const TEXT_MARKDOWN = "text/markdown";

/**
 * "No cap of this rule's own", so `effectiveLimit` in
 * `packages/core/src/engine/plan-observations.ts` applies the whole-scan
 * ceiling.
 *
 * A number chosen here instead would be a second, lower cap, and the byte
 * limits are part of the canonical request key (ADR-0005 section 3): the HTML
 * probe would stop sharing a dispatch with `web.discovery.link`. The body this
 * rule actually reads is bounded at the point of reading, below.
 */
const SCAN_CEILING = -1;

/**
 * `web.content.markdown-negotiation`. Registry ordinal 5
 * (`specs/checks.v0.yaml`).
 *
 * Every metadata value is read from `specs/ruleset.standard.v0.yaml` at
 * `ruleset_version` 0.4.0 and `specs/sources.v0.yaml` at
 * `source_ledger_version` 0.4.0, under the ADR-0002 section 10 mapping.
 * `test/registry.test.ts` re-reads both files and compares, so a value edited
 * here without the spec is a test failure rather than a silent divergence.
 *
 * THE INVARIANT THIS RULE EXISTS TO EXERCISE. `plan()` returns two round-one
 * requests for the same page that differ only in `Accept`, and they must not
 * deduplicate onto one dispatch (ADR-0005 section 3, fixture `sec-006`). Both
 * are round one because neither depends on the other's answer, so
 * `roundTwoBudget` stays 0 and `step()` returns outcomes.
 *
 * WHAT IS NOT DECIDED HERE. The four assertions declare no parameters and
 * authorize no excerpt (`specs/ruleset.standard.v0.yaml`), so every outcome
 * below carries `params: {}`. Prose, requirement class, status and citations
 * are all derived by `packages/core` from the pinned ruleset; this file
 * chooses only an `OutcomeKind` per assertion and the observations that back
 * it.
 */
export const markdownNegotiationRule: RuleDefinition = {
  apiVersion: 1,
  metadata: {
    id: "web.content.markdown-negotiation",
    externalCompatibilityId: "markdownNegotiation",
    ruleVersion: "0.1.0",
    ruleset: { id: "standard", version: "0.4.0" },
    title: "Markdown negotiation",
    category: "content-accessibility",
    profiles: ["content", "api", "agent-service", "full"],
    applicability: "applicable",
    modes: ["spec"],
    observationRuntime: ["http"],
    sourceMaturity: "convention",
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
        id: "cloudflare-markdown-agents",
        title: "Cloudflare Markdown for Agents",
        url: "https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/",
        kind: "vendor-convention",
        status: "convention",
        version: "documentation snapshot 2026-08-28",
        verifiedAt: "2026-08-28",
      },
      {
        id: "rfc7763",
        title: "RFC 7763: The text/markdown Media Type",
        url: "https://www.rfc-editor.org/rfc/rfc7763",
        kind: "ietf-rfc",
        status: "informational-rfc",
        version: "RFC 7763",
        verifiedAt: "2026-08-28",
      },
      {
        id: "rfc9110",
        title: "RFC 9110: HTTP Semantics",
        url: "https://www.rfc-editor.org/rfc/rfc9110",
        kind: "ietf-rfc",
        status: "internet-standard",
        version: "RFC 9110 / STD 97",
        verifiedAt: "2026-08-28",
      },
    ],
    assertions: [
      {
        id: "markdown.media-type",
        mode: "spec",
        requirementClass: "normative",
        sourceRefs: [{ sourceId: "rfc7763", section: "2" }],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "markdown.negotiation",
        mode: "spec",
        requirementClass: "normative",
        sourceRefs: [{ sourceId: "rfc9110" }],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "markdown.vary",
        mode: "spec",
        requirementClass: "recommended",
        sourceRefs: [{ sourceId: "rfc9110", section: "12.5.5" }],
        params: {},
        excerptAuthorized: false,
      },
      {
        id: "markdown.fidelity",
        mode: "spec",
        requirementClass: "advisory",
        sourceRefs: [{ sourceId: "rfc9110" }],
        params: {},
        excerptAuthorized: false,
      },
    ],
    roundTwoBudget: 0,
  },
  defaultOptions: {},
  plan(): readonly ObservationRequest[] {
    return [
      representationRequest(HTML_OBSERVATION, HTML_ACCEPT),
      representationRequest(MARKDOWN_OBSERVATION, MARKDOWN_ACCEPT),
    ];
  },
  step(context): AssertionOutcomes {
    return evaluate(context);
  },
  /**
   * The same evaluation as `step()`.
   *
   * `roundTwoBudget` is 0 and `step()` always returns outcomes, so `runScan`
   * never reaches this. It delegates rather than throwing because the contract
   * in `packages/core/src/model/rule.ts` is that `finish()` returns one
   * outcome per active declared assertion, and a `finish()` that threw would
   * be a rule whose contract holds only while nobody calls it.
   */
  finish(context): AssertionOutcomes {
    return evaluate(context);
  },
};

function representationRequest(id: string, accept: string): ObservationRequest {
  return {
    kind: "http",
    id,
    method: "GET",
    target: { kind: "page" },
    accept,
    // `md-006` is a same-origin redirect ending at a valid Markdown
    // representation, and the effective response is what the assertions read.
    redirects: "follow-same-origin",
    maxEncodedBytes: SCAN_CEILING,
    maxDecodedBytes: SCAN_CEILING,
  };
}

type HttpResponse = Extract<HttpObservation["outcome"], { kind: "response" }>;
type Headers = ReadonlyMap<string, readonly string[]>;

function evaluate(context: RoundContext<unknown>): AssertionOutcomes {
  const html = responseOf(context, HTML_OBSERVATION);
  const markdown = responseOf(context, MARKDOWN_OBSERVATION);
  return {
    kind: "outcomes",
    outcomes: [
      mediaTypeOutcome(markdown),
      negotiationOutcome(html),
      varyOutcome(markdown),
      fidelityOutcome(html, markdown),
    ],
  };
}

/**
 * The response for one of this rule's requests, or `null` when the
 * observation is an error.
 *
 * A transport error is not a conformance failure
 * (`.claude/rules/standards.md`), so every assertion reading a `null` here
 * reports `indeterminate` and the rule resolves to `unable-to-check`.
 */
function responseOf(
  context: RoundContext<unknown>,
  id: string,
): HttpResponse | null {
  const observation = context.observation(id);
  if (observation.kind !== "http") return null;
  return observation.outcome.kind === "response" ? observation.outcome : null;
}

function outcomeOf(
  assertion: string,
  kind: OutcomeKind,
  observationRefs: readonly string[],
): AssertionOutcome {
  return { assertion, kind, params: {}, observationRefs };
}

/**
 * RFC 7763 section 2. The `Accept: text/markdown` request returns
 * `Content-Type: text/markdown`.
 *
 * The label is the whole claim. `md-005` serves Markdown bytes as
 * `text/plain` and must be `violated`, so nothing here looks at the body.
 * Anything other than a `200` carrying `text/markdown` is a violation,
 * including the `406` of `md-004`: `406` is a correct HTTP answer and it is
 * still the answer "this origin has no Markdown representation", which is what
 * the selected capability profile requires. The two are told apart by
 * `markdown.negotiation` staying `satisfied` for the `406` and for a `404`,
 * and by the evidence entry carrying the status.
 */
function mediaTypeOutcome(markdown: HttpResponse | null): AssertionOutcome {
  if (markdown === null) {
    return outcomeOf("markdown.media-type", "indeterminate", [
      MARKDOWN_OBSERVATION,
    ]);
  }
  const served =
    markdown.status === 200 &&
    isMediaType(contentType(markdown.headers), TEXT_MARKDOWN);
  return outcomeOf("markdown.media-type", served ? "satisfied" : "violated", [
    MARKDOWN_OBSERVATION,
  ]);
}

/**
 * RFC 9110 content negotiation: do not return Markdown to an HTML-only
 * request.
 *
 * That prohibition is the half of the ruleset's requirement text that an
 * observation can settle. The other half, "without changing the resource's
 * meaning", is not decidable from two representations and is not asserted
 * here.
 *
 * This reads the HTML observation only, which is what keeps `md-003`
 * (a Markdown request answered with `text/html`) a `markdown.media-type`
 * violation and nothing more, as `docs/FIXTURE_CATALOG.md` section 2.3's
 * manifest for that case declares.
 */
function negotiationOutcome(html: HttpResponse | null): AssertionOutcome {
  if (html === null) {
    return outcomeOf("markdown.negotiation", "indeterminate", [
      HTML_OBSERVATION,
    ]);
  }
  const answeredWithMarkdown = isMediaType(
    contentType(html.headers),
    TEXT_MARKDOWN,
  );
  return outcomeOf(
    "markdown.negotiation",
    answeredWithMarkdown ? "violated" : "satisfied",
    [HTML_OBSERVATION],
  );
}

/**
 * RFC 9110 section 12.5.5. A response selected by `Accept` names `Accept` in
 * `Vary`, so a cache cannot serve one representation for the other.
 *
 * `recommended`, so a violation derives `warning` and never `fail`
 * (`findingStatus`). `md-002` is exactly this case: the Markdown
 * representation is valid, `Vary` omits `Accept`, and the rule is `warning`
 * with `markdown.media-type` still `satisfied`.
 */
function varyOutcome(markdown: HttpResponse | null): AssertionOutcome {
  if (markdown === null) {
    return outcomeOf("markdown.vary", "indeterminate", [MARKDOWN_OBSERVATION]);
  }
  return outcomeOf(
    "markdown.vary",
    varyIncludesAccept(markdown.headers) ? "satisfied" : "violated",
    [MARKDOWN_OBSERVATION],
  );
}

/**
 * A BOUNDED STRUCTURAL PROXY, AND NOT A FIDELITY VERDICT.
 *
 * The ruleset's text for this assertion asks whether "critical headings,
 * links, code, and factual text remain represented without invented content".
 * That is not decidable without a language model, `CLAUDE.md` forbids a model
 * in the verdict path, and the rule's own `interop` caveat in
 * `specs/ruleset.standard.v0.yaml` says "Do not use an LLM as the pass/fail
 * oracle for semantic fidelity". So this does not attempt it.
 *
 * WHAT IT PROVES. Exactly two gross-loss conditions, either of which makes the
 * outcome `violated`:
 *
 *  - the HTML representation contains at least one `<h1>`-`<h6>` element and
 *    the Markdown representation contains no heading at all, in either the ATX
 *    or the setext form;
 *  - the HTML `<title>` text is present, plain, and its bytes do not occur
 *    anywhere in the Markdown representation.
 *
 * WHAT IT DOES NOT PROVE. That the two representations carry the same
 * headings, the same links, the same code, or the same facts; that nothing was
 * invented; or that anything was translated correctly. A `satisfied` outcome
 * means only that neither condition above fired. It is `advisory`, so a
 * violation derives `warning`.
 *
 * KNOWN FALSE POSITIVE. A site whose `<title>` is decorated, as
 * "Page | Site", while the Markdown carries the undecorated heading, trips the
 * title condition. The comparison is deliberately literal rather than
 * heuristic: a similarity threshold invented here would be a fidelity
 * criterion nobody has written down, which ADR-0010 section 6 leaves open.
 *
 * `indeterminate` when there is no HTML representation to compare against,
 * when either body was truncated, or when either body is larger than this
 * proxy reads. `packages/core` requires one outcome for every active declared
 * assertion, so a comparison that cannot be made is reported as not made
 * rather than omitted.
 */
function fidelityOutcome(
  html: HttpResponse | null,
  markdown: HttpResponse | null,
): AssertionOutcome {
  const refs = [HTML_OBSERVATION, MARKDOWN_OBSERVATION];
  const comparable =
    html !== null &&
    markdown !== null &&
    html.status === 200 &&
    markdown.status === 200 &&
    isMediaType(contentType(html.headers), TEXT_HTML) &&
    isMediaType(contentType(markdown.headers), TEXT_MARKDOWN) &&
    scannable(html) &&
    scannable(markdown);
  if (!comparable) {
    return outcomeOf("markdown.fidelity", "indeterminate", refs);
  }

  const source = byteString(html.body);
  const rendered = byteString(markdown.body);
  const lostHeadings =
    countHtmlHeadings(source) > 0 && !hasMarkdownHeading(rendered);
  const title = htmlTitle(source);
  const lostTitle = title !== null && !rendered.includes(title);

  return outcomeOf(
    "markdown.fidelity",
    lostHeadings || lostTitle ? "violated" : "satisfied",
    refs,
  );
}

function contentType(headers: Headers): string | undefined {
  const values = headers.get("content-type");
  // Exactly one, and not the first of several. Two `Content-Type` field lines
  // do not say which representation was sent, and choosing one is guessing.
  return values?.length === 1 ? values[0] : undefined;
}

/** Field lines beyond this many, or longer than this, are not scanned. */
const MAX_VARY_FIELD_LINES = 16;
const MAX_VARY_FIELD_LENGTH = 1024;

/**
 * `Vary: *` counts. RFC 9110 section 12.5.5 makes it the stronger statement:
 * the response is not reusable for a subsequent request at all, so it cannot
 * be reused across `Accept` values either.
 */
function varyIncludesAccept(headers: Headers): boolean {
  const values = headers.get("vary");
  if (values === undefined) return false;
  for (const value of values.slice(0, MAX_VARY_FIELD_LINES)) {
    if (value.length > MAX_VARY_FIELD_LENGTH) continue;
    for (const token of value.split(",")) {
      const normalized = token.trim().toLowerCase();
      if (normalized === "accept" || normalized === "*") return true;
    }
  }
  return false;
}

/** The largest body this proxy reads. Beyond it the comparison is not made. */
const MAX_BODY_SCAN_BYTES = 65536;
const BYTE_STRING_CHUNK = 4096;

function scannable(response: HttpResponse): boolean {
  return !response.truncated && response.body.length <= MAX_BODY_SCAN_BYTES;
}

/**
 * Bytes as one code unit each, which is a byte-preserving mapping and not a
 * character decoding.
 *
 * This package compiles with `"lib": ["ES2023"]` and `"types": []`, so
 * `TextDecoder` is an undeclared identifier here, and that turns out to be the
 * right constraint rather than an obstacle: every comparison below is over
 * ASCII structure or over a byte sequence taken from one response and looked
 * for in another, and both are exact at the byte level. Nothing derived from
 * this string reaches the report.
 */
function byteString(body: Uint8Array): string {
  let text = "";
  for (let at = 0; at < body.length; at += BYTE_STRING_CHUNK) {
    const end = Math.min(at + BYTE_STRING_CHUNK, body.length);
    text += String.fromCharCode(...body.subarray(at, end));
  }
  return text;
}

// Every pattern is anchored and bounded so its cost is linear in an input that
// `scannable` has already capped. `match` resets a global pattern's
// `lastIndex` before it starts, so the two module-level constants hold no
// state between calls.
const HTML_HEADING = /<h[1-6][\s>/]/gi;
const HTML_TITLE = /<title(?:\s[^>]{0,512})?>([^<]{0,512})<\/title>/i;
/** CommonMark section 4.2. */
const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/m;
/**
 * CommonMark section 4.3. A `-` run is also a thematic break and a front
 * matter fence, so this over-recognizes; it is only ever read as evidence that
 * a heading *might* be present, which makes over-recognition the safe
 * direction.
 */
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/m;

function countHtmlHeadings(source: string): number {
  return source.match(HTML_HEADING)?.length ?? 0;
}

function hasMarkdownHeading(rendered: string): boolean {
  return ATX_HEADING.test(rendered) || SETEXT_UNDERLINE.test(rendered);
}

/**
 * The `<title>` text, or `null` when there is none or when it is not plain.
 *
 * A title holding `&` is rejected because this proxy decodes no entity, so the
 * title as written would not be the title as read and the comparison would
 * report a difference that is not one.
 */
function htmlTitle(source: string): string | null {
  const title = HTML_TITLE.exec(source)?.[1]?.trim() ?? "";
  if (title === "" || title.includes("&")) return null;
  return title;
}
