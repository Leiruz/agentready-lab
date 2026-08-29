/**
 * A purpose-built scanner for Sitemaps protocol documents.
 *
 * OWNERSHIP: written for `web.discovery.sitemap` and consumed by nothing else
 * (`src/parsers/index.ts`).
 *
 * WHY THIS IS HAND WRITTEN. `docs/THREAT_MODEL.md` section 19.3 requires a
 * non-validating streaming parser with DTD processing, external entities and
 * XInclude disabled, no network access, depth capped at 64, bounded nodes and
 * attributes, and early termination once the required evidence is found.
 * Hardening a general XML parser to that list means proving that a large
 * feature surface stays switched off. A scanner that has no DTD subsystem, no
 * entity table and no resolver at all cannot be talked into using one, and the
 * proof is the absence of the code rather than the value of a flag. It also
 * costs no dependency, which `CLAUDE.md` section 5 treats as permanent.
 *
 * HOW EACH SECTION 19.3 REQUIREMENT IS MET.
 *
 * - *Non-validating.* No DTD, schema, ID/IDREF or content model is consulted.
 *   The scanner reports the shape it saw and the rule decides conformance.
 * - *DTD processing disabled.* `<!DOCTYPE` is a refusal (`doctype`) at the
 *   character it is recognized. The internal subset is never scanned, so no
 *   entity declaration is ever read, let alone expanded. Fixture `sec-008`
 *   lands here, and `docs/decisions/0003-transport-error-vocabulary.md`
 *   section 2 makes a refusal `indeterminate` and never `violated`.
 * - *External entities disabled.* The only references honoured are the five
 *   XML predefined entities and numeric character references, which are
 *   defined by the XML grammar itself and resolve to a code point rather than
 *   to a resource. Every other `&name;` is a refusal (`entity`). There is no
 *   entity table to look one up in and no code path that could fetch one.
 * - *XInclude disabled.* An element in the XInclude namespace is a refusal
 *   (`xinclude`) rather than something quietly ignored, so a document that
 *   depends on inclusion is never judged as though the inclusion had happened.
 * - *All network access disabled.* This module imports nothing, and
 *   `packages/rules-standard` compiles with `"lib": ["ES2023"], "types": []`,
 *   so `fetch`, `URL`, `TextDecoder` and `process` are undeclared identifiers
 *   here. `test/boundaries/package-boundaries.test.ts` asserts that.
 * - *Maximum depth 64.* `maxDepth`, enforced before the element is pushed.
 * - *Bounded nodes and attributes.* `maxNodes` over the whole document,
 *   `maxAttributes` per element, `maxNameLength` per name and
 *   `maxValueLength` per attribute value or captured text run.
 * - *Early termination once the required evidence is found.* A root element
 *   that is neither `urlset` nor `sitemapindex` returns immediately: the
 *   required evidence is that this is not a sitemap, and it is complete at the
 *   first tag. Beyond that the scan does run to the end of the bounded body,
 *   because for a document that *is* a sitemap the required evidence includes
 *   well-formedness, and fixture `map-004`'s unclosed element is only
 *   observable at the end. The bound that makes this cheap is `maxBytes`, and
 *   a body over it is refused rather than truncated and judged.
 *
 * WHAT A CALLER MUST BRANCH ON FIRST. `refused` is a bound of ours and a
 * control of ours; it says nothing about the publisher and must become
 * `indeterminate`. `malformed` is a defect of the document. The two are
 * separate kinds precisely so that they cannot be conflated at the call site.
 *
 * HOSTILE INPUT. The scan is a single forward pass over a length-capped
 * string. There is no regular expression anywhere in this module, so there is
 * no backtracking to review, and every bound is enforced before the work it
 * bounds.
 */

/** The one namespace the Sitemaps protocol defines for both root elements. */
export const SITEMAP_NAMESPACE = "http://www.sitemaps.org/schemas/sitemap/0.9";

const XINCLUDE_NAMESPACE = "http://www.w3.org/2001/XInclude";

/**
 * Sitemaps protocol, "Sitemap file": a Sitemap "must have no more than 50,000
 * URLs". The same number bounds an index: "Sitemap index files may not list
 * more than 50,000 Sitemaps".
 */
export const PROTOCOL_MAX_ENTRIES = 50_000;

/** Sitemaps protocol, `<loc>`: "must be less than 2,048 characters". */
export const PROTOCOL_MAX_LOC_LENGTH = 2048;

export interface SitemapParseLimits {
  /** Decoded body bytes. A larger document is refused, never truncated. */
  readonly maxBytes: number;
  /** `docs/THREAT_MODEL.md` section 19.3. */
  readonly maxDepth: number;
  readonly maxNodes: number;
  /** Attributes on one element. */
  readonly maxAttributes: number;
  /** UTF-16 code units in one element or attribute name. */
  readonly maxNameLength: number;
  /** UTF-16 code units in one attribute value or one captured text run. */
  readonly maxValueLength: number;
  /** Entries retained. `entryCount` keeps counting past it. */
  readonly maxKeptEntries: number;
}

export const SITEMAP_PARSE_LIMITS: SitemapParseLimits = {
  // The whole-scan per-response decoded ceiling in `DEFAULT_NETWORK_BUDGET`,
  // and far below the protocol's own 50 MB. A document between the two is
  // refused, which section 19.3 states directly: "A document larger than the
  // scan limit produces `unable-to-check` with `budget-exceeded`".
  maxBytes: 2_097_152,
  maxDepth: 64,
  maxNodes: 500_000,
  maxAttributes: 32,
  maxNameLength: 256,
  maxValueLength: 8192,
  maxKeptEntries: PROTOCOL_MAX_ENTRIES,
};

/** A bound or a disabled feature stopped the parse. Ours, not the target's. */
export type SitemapRefusal =
  | "bytes"
  | "depth"
  | "nodes"
  | "attributes"
  | "value-length"
  /** `<!DOCTYPE` was present. The internal subset was never read. */
  | "doctype"
  /** A reference that is neither predefined nor numeric. Never resolved. */
  | "entity"
  | "xinclude";

/** The document is not well-formed XML. A defect of the target. */
export type SitemapMalformed =
  | "no-root"
  | "unclosed-element"
  | "mismatched-end-tag"
  | "trailing-content"
  | "bad-markup"
  | "bad-name"
  | "bad-attribute"
  | "unterminated"
  | "bad-character-reference";

export interface SitemapEntry {
  /** Text of the entry's `loc` child, unescaped and trimmed. */
  readonly loc: string | null;
  /** Text of the entry's `lastmod` child, unescaped and trimmed. */
  readonly lastmod: string | null;
}

export interface SitemapDocument {
  /** Local name of the root element, as written. */
  readonly rootName: string;
  /** The root element's resolved namespace, or `null` when it has none. */
  readonly namespace: string | null;
  /** The body was not well-formed UTF-8 and was decoded with U+FFFD. */
  readonly invalidUtf8: boolean;
  /** Bounded by `maxKeptEntries`. */
  readonly entries: readonly SitemapEntry[];
  /** Every entry element seen, including those `entries` did not retain. */
  readonly entryCount: number;
}

export type SitemapParse =
  | { readonly kind: "urlset"; readonly document: SitemapDocument }
  | { readonly kind: "sitemapindex"; readonly document: SitemapDocument }
  | {
      readonly kind: "other-root";
      readonly rootName: string;
      readonly namespace: string | null;
    }
  | { readonly kind: "malformed"; readonly reason: SitemapMalformed }
  | { readonly kind: "refused"; readonly reason: SitemapRefusal };

interface Decoded {
  readonly text: string;
  readonly valid: boolean;
}

/**
 * UTF-8 decoding, written out because `TextDecoder` does not exist here.
 *
 * The accepted sequences are RFC 3629's, so overlong forms, surrogate halves
 * and code points above U+10FFFF are rejected rather than mapped. A leading
 * byte-order mark is dropped. `valid` is the Sitemaps protocol's "The file
 * itself must be UTF-8 encoded", which a non-fatal decoder would have
 * satisfied silently.
 *
 * `src/parsers/robots.ts` carries an equivalent decoder. It is not exported
 * and this module may not modify that file, so the two coexist; a shared
 * `utf8.ts` is the obvious later consolidation and needs an owner to move it.
 */
function decodeUtf8(bytes: Uint8Array): Decoded {
  const points: number[] = [];
  let valid = true;
  let index =
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
      ? 3
      : 0;

  while (index < bytes.length) {
    const first = bytes[index] ?? 0;
    if (first < 0x80) {
      points.push(first);
      index += 1;
      continue;
    }

    let needed: number;
    let point: number;
    let lowerBound = 0x80;
    let upperBound = 0xbf;
    if (first >= 0xc2 && first <= 0xdf) {
      needed = 1;
      point = first & 0x1f;
    } else if (first >= 0xe0 && first <= 0xef) {
      needed = 2;
      point = first & 0x0f;
      if (first === 0xe0) lowerBound = 0xa0;
      if (first === 0xed) upperBound = 0x9f;
    } else if (first >= 0xf0 && first <= 0xf4) {
      needed = 3;
      point = first & 0x07;
      if (first === 0xf0) lowerBound = 0x90;
      if (first === 0xf4) upperBound = 0x8f;
    } else {
      points.push(0xfffd);
      valid = false;
      index += 1;
      continue;
    }

    let consumed = 0;
    let ok = true;
    while (consumed < needed) {
      const at = index + 1 + consumed;
      const byte = at < bytes.length ? (bytes[at] ?? 0) : -1;
      const low = consumed === 0 ? lowerBound : 0x80;
      const high = consumed === 0 ? upperBound : 0xbf;
      if (byte < low || byte > high) {
        ok = false;
        break;
      }
      point = (point << 6) | (byte & 0x3f);
      consumed += 1;
    }
    if (!ok) {
      points.push(0xfffd);
      valid = false;
      // Advance past the lead byte only, so a truncated sequence followed by
      // a valid one still decodes the valid one.
      index += 1;
      continue;
    }
    points.push(point);
    index += 1 + needed;
  }

  let text = "";
  for (let at = 0; at < points.length; at += 4096) {
    text += String.fromCodePoint(...points.slice(at, at + 4096));
  }
  return { text, valid };
}

const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const SPACE = 0x20;
const QUOTE = 0x22;
const AMPERSAND = 0x26;
const APOSTROPHE = 0x27;
const HYPHEN = 0x2d;
const FULL_STOP = 0x2e;
const SOLIDUS = 0x2f;
const COLON = 0x3a;
const LESS_THAN = 0x3c;
const EQUALS = 0x3d;
const GREATER_THAN = 0x3e;
const QUESTION = 0x3f;
const BANG = 0x21;
const UNDERSCORE = 0x5f;
const MIDDLE_DOT = 0xb7;

/** XML `S`, and only those four. */
function isSpace(code: number): boolean {
  return code === SPACE || code === TAB || code === LF || code === CR;
}

function isAsciiDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function isAsciiLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

/**
 * A deliberately coarse `NameStartChar`.
 *
 * ASCII letters, `_` and `:`, plus every non-ASCII code point. The real
 * production is a long list of Unicode ranges whose only effect here would be
 * to reject exotic names this rule never acts on: the four names it matches
 * (`urlset`, `sitemapindex`, `loc`, `lastmod`) are ASCII, and a name outside
 * the sitemap vocabulary is ignored whether or not it was legal. Being
 * permissive here cannot turn an invalid document into a passing one, because
 * every verdict rests on the names the scanner does recognize.
 */
function isNameStart(code: number): boolean {
  return (
    isAsciiLetter(code) || code === UNDERSCORE || code === COLON || code >= 0x80
  );
}

function isNameChar(code: number): boolean {
  return (
    isNameStart(code) ||
    isAsciiDigit(code) ||
    code === HYPHEN ||
    code === FULL_STOP ||
    code === MIDDLE_DOT
  );
}

/** Resolved namespace bindings in scope. Shared by reference when unchanged. */
interface Scope {
  readonly defaultNamespace: string | null;
  readonly prefixes: ReadonlyMap<string, string>;
}

const ROOT_SCOPE: Scope = {
  defaultNamespace: null,
  prefixes: new Map<string, string>(),
};

interface OpenElement {
  /** The qualified name exactly as written, for end-tag matching. */
  readonly qualifiedName: string;
  readonly scope: Scope;
}

function refused(reason: SitemapRefusal): SitemapParse {
  return { kind: "refused", reason };
}

function malformed(reason: SitemapMalformed): SitemapParse {
  return { kind: "malformed", reason };
}

/**
 * What a text or attribute scan produced.
 *
 * A three-way answer rather than `string | null`, because the two failures are
 * not the same failure: `refused` is this parser declining, and `malformed` is
 * the document being wrong. Collapsing them here would put an XXE attempt and
 * a typo in the same bucket at the one place that can still tell them apart.
 */
type Scanned =
  | { readonly kind: "value"; readonly value: string }
  | { readonly kind: "refused"; readonly reason: SitemapRefusal }
  | { readonly kind: "malformed"; readonly reason: SitemapMalformed };

function scanned(value: string): Scanned {
  return { kind: "value", value };
}

function refuse(reason: SitemapRefusal): Scanned {
  return { kind: "refused", reason };
}

function bad(reason: SitemapMalformed): Scanned {
  return { kind: "malformed", reason };
}

interface MutableEntry {
  loc: string | null;
  lastmod: string | null;
}

/**
 * Scans one sitemap document.
 *
 * The caller has already established that its observation carried a body and
 * that the declared media type is XML. This function knows no HTTP.
 */
export function parseSitemapXml(
  body: Uint8Array,
  limits: Partial<SitemapParseLimits> = {},
): SitemapParse {
  const bounds: SitemapParseLimits = { ...SITEMAP_PARSE_LIMITS, ...limits };
  if (body.length > bounds.maxBytes) return refused("bytes");

  const decoded = decodeUtf8(body);
  const xml = decoded.text;
  const length = xml.length;

  const stack: OpenElement[] = [];
  const entries: MutableEntry[] = [];
  let entryCount = 0;
  let nodes = 0;
  let rootName = "";
  let rootNamespace: string | null = null;
  let rootKind: "urlset" | "sitemapindex" | null = null;
  let rootClosed = false;
  let sawRoot = false;
  /** The entry open at depth 1, when the root is a sitemap root. */
  let openEntry: MutableEntry | null = null;
  /** Which child of the open entry is capturing text, if any. */
  let capturing: "loc" | "lastmod" | null = null;
  let captured = "";

  let at = 0;

  /** Reads a `Name`, or `null` when the cursor is not on one. */
  const readName = (): string | null => {
    if (at >= length || !isNameStart(xml.charCodeAt(at))) return null;
    const start = at;
    at += 1;
    while (at < length && isNameChar(xml.charCodeAt(at))) at += 1;
    return at - start > bounds.maxNameLength ? null : xml.slice(start, at);
  };

  const skipSpace = (): void => {
    while (at < length && isSpace(xml.charCodeAt(at))) at += 1;
  };

  /**
   * A reference, with the cursor on the `&`.
   *
   * There is no entity table: the five predefined entities are part of the XML
   * grammar and a numeric reference names a code point, so neither can name a
   * resource. Everything else is `refused`, which is a different answer from
   * `malformed` all the way out to the report.
   */
  const readReference = (): Scanned => {
    const end = xml.indexOf(";", at + 1);
    if (end === -1 || end - at > 32) return bad("bad-character-reference");
    const name = xml.slice(at + 1, end);
    at = end + 1;
    switch (name) {
      case "amp":
        return scanned("&");
      case "lt":
        return scanned("<");
      case "gt":
        return scanned(">");
      case "quot":
        return scanned('"');
      case "apos":
        return scanned("'");
      default:
        break;
    }
    if (!name.startsWith("#")) return refuse("entity");
    const hex = name.startsWith("#x") || name.startsWith("#X");
    const digits = name.slice(hex ? 2 : 1);
    if (digits.length === 0 || digits.length > 8) {
      return bad("bad-character-reference");
    }
    for (let index = 0; index < digits.length; index += 1) {
      const code = digits.charCodeAt(index);
      const ok = hex
        ? isAsciiDigit(code) ||
          (code >= 0x41 && code <= 0x46) ||
          (code >= 0x61 && code <= 0x66)
        : isAsciiDigit(code);
      if (!ok) return bad("bad-character-reference");
    }
    const point = Number.parseInt(digits, hex ? 16 : 10);
    if (point < 1 || point > 0x10ffff) return bad("bad-character-reference");
    if (point >= 0xd800 && point <= 0xdfff) {
      return bad("bad-character-reference");
    }
    return scanned(String.fromCodePoint(point));
  };

  /** An attribute value, with the cursor on the opening quote. */
  const readAttributeValue = (): Scanned => {
    const quote = xml.charCodeAt(at);
    if (quote !== QUOTE && quote !== APOSTROPHE) return bad("bad-attribute");
    at += 1;
    let value = "";
    while (at < length) {
      const code = xml.charCodeAt(at);
      if (code === quote) {
        at += 1;
        return scanned(value);
      }
      if (code === LESS_THAN) return bad("bad-attribute");
      if (value.length > bounds.maxValueLength) return refuse("value-length");
      if (code === AMPERSAND) {
        const reference = readReference();
        if (reference.kind !== "value") return reference;
        value += reference.value;
        continue;
      }
      value += xml[at] ?? "";
      at += 1;
    }
    return bad("bad-attribute");
  };

  const appendCaptured = (text: string): boolean => {
    if (captured.length + text.length > bounds.maxValueLength) return false;
    captured += text;
    return true;
  };

  while (at < length) {
    const code = xml.charCodeAt(at);

    if (code !== LESS_THAN) {
      // Character data. Only text inside a captured `loc` or `lastmod` is
      // kept; everything else is scanned and dropped.
      if (code === AMPERSAND) {
        const reference = readReference();
        if (reference.kind === "refused") return refused(reference.reason);
        if (reference.kind === "malformed") return malformed(reference.reason);
        if (capturing !== null && !appendCaptured(reference.value)) {
          return refused("value-length");
        }
        continue;
      }
      if (!isSpace(code) && (rootClosed || stack.length === 0)) {
        return malformed("trailing-content");
      }
      if (capturing !== null && !appendCaptured(xml[at] ?? "")) {
        return refused("value-length");
      }
      at += 1;
      continue;
    }

    const next = at + 1 < length ? xml.charCodeAt(at + 1) : -1;

    // `<?` processing instruction, which includes the XML declaration. Never
    // interpreted: `<?xml-stylesheet?>` names a resource this never fetches.
    if (next === QUESTION) {
      const end = xml.indexOf("?>", at + 2);
      if (end === -1) return malformed("unterminated");
      at = end + 2;
      continue;
    }

    if (next === BANG) {
      if (xml.startsWith("<!--", at)) {
        const end = xml.indexOf("-->", at + 4);
        if (end === -1) return malformed("unterminated");
        at = end + 3;
        continue;
      }
      if (xml.startsWith("<![CDATA[", at)) {
        const end = xml.indexOf("]]>", at + 9);
        if (end === -1) return malformed("unterminated");
        if (capturing !== null && !appendCaptured(xml.slice(at + 9, end))) {
          return refused("value-length");
        }
        at = end + 3;
        continue;
      }
      // `docs/THREAT_MODEL.md` section 19.3: DTD processing is disabled. The
      // internal subset is not scanned, so no entity declaration is read.
      // Fixture `sec-008` stops exactly here.
      if (xml.startsWith("<!DOCTYPE", at)) return refused("doctype");
      return malformed("bad-markup");
    }

    if (next === SOLIDUS) {
      at += 2;
      const name = readName();
      if (name === null) return malformed("bad-name");
      skipSpace();
      if (at >= length || xml.charCodeAt(at) !== GREATER_THAN) {
        return malformed("bad-markup");
      }
      at += 1;
      const open = stack.pop();
      if (open?.qualifiedName !== name) return malformed("mismatched-end-tag");
      if (capturing !== null && stack.length === 2) {
        if (openEntry !== null) {
          const value = captured.trim();
          if (capturing === "loc") openEntry.loc = value;
          else openEntry.lastmod = value;
        }
        capturing = null;
        captured = "";
      }
      if (stack.length === 1) openEntry = null;
      if (stack.length === 0) rootClosed = true;
      continue;
    }

    // A start tag.
    at += 1;
    const qualifiedName = readName();
    if (qualifiedName === null) return malformed("bad-name");
    if (rootClosed || (sawRoot && stack.length === 0)) {
      return malformed("trailing-content");
    }
    nodes += 1;
    if (nodes > bounds.maxNodes) return refused("nodes");
    if (stack.length >= bounds.maxDepth) return refused("depth");

    const parent = stack[stack.length - 1]?.scope ?? ROOT_SCOPE;
    let declaredDefault: string | null = null;
    let declaredPrefixes: Map<string, string> | null = null;
    let attributes = 0;
    let selfClosing = false;

    for (;;) {
      const hadSpace = at < length && isSpace(xml.charCodeAt(at));
      skipSpace();
      if (at >= length) return malformed("unterminated");
      const here = xml.charCodeAt(at);
      if (here === GREATER_THAN) {
        at += 1;
        break;
      }
      if (here === SOLIDUS) {
        at += 1;
        if (at >= length || xml.charCodeAt(at) !== GREATER_THAN) {
          return malformed("bad-markup");
        }
        at += 1;
        selfClosing = true;
        break;
      }
      if (!hadSpace) return malformed("bad-attribute");
      attributes += 1;
      if (attributes > bounds.maxAttributes) return refused("attributes");
      const attributeName = readName();
      if (attributeName === null) return malformed("bad-name");
      skipSpace();
      if (at >= length || xml.charCodeAt(at) !== EQUALS) {
        return malformed("bad-attribute");
      }
      at += 1;
      skipSpace();
      const value = readAttributeValue();
      if (value.kind === "refused") return refused(value.reason);
      if (value.kind === "malformed") return malformed(value.reason);
      if (attributeName === "xmlns") {
        declaredDefault = value.value;
      } else if (attributeName.startsWith("xmlns:")) {
        declaredPrefixes ??= new Map<string, string>(parent.prefixes);
        declaredPrefixes.set(attributeName.slice(6), value.value);
      }
    }

    const scope: Scope =
      declaredDefault === null && declaredPrefixes === null
        ? parent
        : {
            defaultNamespace: declaredDefault ?? parent.defaultNamespace,
            prefixes: declaredPrefixes ?? parent.prefixes,
          };

    const colon = qualifiedName.indexOf(":");
    const localName =
      colon === -1 ? qualifiedName : qualifiedName.slice(colon + 1);
    // An undeclared prefix resolves to no namespace rather than to an error:
    // this parser is non-validating, and an element outside the sitemap
    // namespace is simply not one of the four names it acts on.
    const namespace =
      colon === -1
        ? scope.defaultNamespace
        : (scope.prefixes.get(qualifiedName.slice(0, colon)) ?? null);

    // `docs/THREAT_MODEL.md` section 19.3: XInclude is disabled. Refusing
    // rather than ignoring keeps a document that depends on inclusion from
    // being judged as though the inclusion had happened.
    if (namespace === XINCLUDE_NAMESPACE) return refused("xinclude");

    const depth = stack.length;
    if (depth === 0) {
      sawRoot = true;
      rootName = localName;
      rootNamespace = namespace;
      if (localName === "urlset") rootKind = "urlset";
      else if (localName === "sitemapindex") rootKind = "sitemapindex";
      else {
        // Early termination: the required evidence is that this document is
        // not a sitemap, and it is complete at the first tag.
        return { kind: "other-root", rootName: localName, namespace };
      }
    } else if (
      depth === 1 &&
      namespace === SITEMAP_NAMESPACE &&
      localName === (rootKind === "urlset" ? "url" : "sitemap")
    ) {
      entryCount += 1;
      const entry: MutableEntry = { loc: null, lastmod: null };
      openEntry = entry;
      if (entries.length < bounds.maxKeptEntries) entries.push(entry);
    } else if (
      depth === 2 &&
      openEntry !== null &&
      namespace === SITEMAP_NAMESPACE &&
      (localName === "loc" || localName === "lastmod")
    ) {
      capturing = localName;
      captured = "";
    }

    if (selfClosing) {
      if (depth === 0) rootClosed = true;
      if (depth === 1) openEntry = null;
      if (depth === 2) capturing = null;
      continue;
    }
    stack.push({ qualifiedName, scope });
  }

  if (stack.length > 0) return malformed("unclosed-element");
  if (!sawRoot || rootKind === null) return malformed("no-root");

  const document: SitemapDocument = {
    rootName,
    namespace: rootNamespace,
    invalidUtf8: !decoded.valid,
    entries: entries.map((entry) => ({
      loc: entry.loc,
      lastmod: entry.lastmod,
    })),
    entryCount,
  };
  return rootKind === "urlset"
    ? { kind: "urlset", document }
    : { kind: "sitemapindex", document };
}

/**
 * Whether a `<loc>` value is an absolute URI reference.
 *
 * Sitemaps protocol, `<loc>`: "This URL must begin with the protocol (such as
 * http)". This is the RFC 3986 `scheme ":"` test and nothing more: a rule may
 * not construct a `URL` (ADR-0002 section 12), and a lexical test is what
 * separates fixture `map-006`'s `/nested.xml` from an absolute value without
 * pretending to have parsed one.
 */
export function isAbsoluteUrl(value: string): boolean {
  const colon = value.indexOf(":");
  if (colon < 1) return false;
  if (!isAsciiLetter(value.charCodeAt(0))) return false;
  for (let index = 1; index < colon; index += 1) {
    const code = value.charCodeAt(index);
    const ok =
      isAsciiLetter(code) ||
      isAsciiDigit(code) ||
      code === 0x2b ||
      code === HYPHEN ||
      code === FULL_STOP;
    if (!ok) return false;
  }
  return true;
}

/**
 * Whether a `<lastmod>` value is a W3C Datetime.
 *
 * Sitemaps protocol, `<lastmod>`: "in W3C Datetime format. This format allows
 * you to omit the time portion, if desired, and use YYYY-MM-DD." The accepted
 * shapes are checked positionally rather than with a pattern, so there is no
 * regular expression over target text to review for backtracking.
 */
export function isW3cDatetime(value: string): boolean {
  if (value.length < 4 || value.length > 40) return false;

  const digits = (start: number, count: number): boolean => {
    if (start + count > value.length) return false;
    for (let index = start; index < start + count; index += 1) {
      if (!isAsciiDigit(value.charCodeAt(index))) return false;
    }
    return true;
  };
  const literal = (index: number, character: string): boolean =>
    value[index] === character;

  if (!digits(0, 4)) return false;
  if (value.length === 4) return true;
  if (!literal(4, "-") || !digits(5, 2)) return false;
  if (value.length === 7) return true;
  if (!literal(7, "-") || !digits(8, 2)) return false;
  if (value.length === 10) return true;

  // `YYYY-MM-DDThh:mm` is the shortest form carrying a time, and the W3C
  // profile requires a zone designator alongside one.
  if (!literal(10, "T") || !digits(11, 2)) return false;
  if (!literal(13, ":") || !digits(14, 2)) return false;
  let at = 16;
  if (literal(at, ":")) {
    if (!digits(at + 1, 2)) return false;
    at += 3;
    if (literal(at, ".")) {
      const start = at + 1;
      let end = start;
      while (end < value.length && digits(end, 1)) end += 1;
      if (end === start) return false;
      at = end;
    }
  }
  if (literal(at, "Z")) return at + 1 === value.length;
  if (!literal(at, "+") && !literal(at, "-")) return false;
  return (
    digits(at + 1, 2) &&
    literal(at + 3, ":") &&
    digits(at + 4, 2) &&
    at + 6 === value.length
  );
}
