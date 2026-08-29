/**
 * RFC 8288 `Link` field parsing, for `web.discovery.link`.
 *
 * Owned by the link rule (`src/parsers/index.ts`). Pure, synchronous, plain
 * data in and plain data out.
 *
 * WHY THIS IS A HAND-WRITTEN SCANNER AND NOT A REGEX.
 *
 * `docs/THREAT_MODEL.md` section 20 requires every regex over hostile text to
 * be bounded and reviewed for pathological backtracking. The `Link` grammar is
 * a nested list (a comma list of link-values, each a semicolon list of
 * parameters, each parameter value either a token or a quoted string with
 * escapes), and a regex for it needs nested quantifiers over overlapping
 * character classes, which is the exact shape that backtracks catastrophically
 * on a crafted prefix. The reviewed profile of this module is therefore the
 * strongest one available: **it contains no regex at all**, over target text or
 * anything else, so there is no backtracking to reason about. Character class
 * membership is decided by explicit range comparisons below.
 *
 * The scanner is single-pass. `index` never decreases and every iteration of
 * every loop either advances it or leaves the loop, so the work is linear in
 * the input length and the input length is bounded before the first character
 * is read.
 *
 * WHY SPLITTING ON COMMAS IS WRONG. A quoted parameter may contain a comma
 * (`title="Foo, Bar"`), so a comma is a list separator only outside a quoted
 * string. The scanner learns that by construction: it reaches a comma only from
 * the parameter loop, which has already consumed any quoted string whole.
 *
 * WHY AN UNCLOSED QUOTE IS A FAILURE. RFC 8288 Appendix B is explicitly a
 * liberal parser and returns the links it managed to read. Appendix B is
 * informative; the ABNF in section 3 is the grammar, and a field value with an
 * unterminated `quoted-string` does not match it. Returning a prefix would let
 * a target hide a link behind an unclosed quote and still be reported as
 * parsed, so the whole field parse fails and the rule reports that.
 */

/** Why a field value did not match the RFC 8288 section 3 grammar. */
export type LinkSyntaxError =
  /** A list element did not begin with `<`. */
  | "expected-link-target"
  /** A `<` was never closed by a `>`. */
  | "unterminated-link-target"
  /** A `;` was not followed by a parameter name. */
  | "expected-parameter-name"
  /** A `"` was never closed. */
  | "unterminated-quoted-string"
  /** An `=` was not followed by a token or a quoted string. */
  | "expected-parameter-value"
  /** A link-value was followed by something other than `;`, `,` or the end. */
  | "expected-parameter-delimiter";

/** Which bound stopped the parse. Not a syntax verdict about the target. */
export type LinkParserLimit = "field-value-count" | "field-length";

/**
 * `docs/THREAT_MODEL.md` section 16's "response header count", reused as the
 * ceiling on repeated `Link` field lines.
 */
export const MAX_LINK_FIELD_VALUES = 100;

/**
 * `docs/THREAT_MODEL.md` section 16's 32 KiB "response header block", reused as
 * the ceiling on the total `Link` text this parser will read.
 *
 * Both bounds are defence in depth rather than a behaviour change: a transport
 * honouring section 16 cannot deliver a header block that exceeds either, so
 * neither can fire against a conforming transport. They exist so that this
 * module is bounded on its own, without depending on its caller.
 */
export const MAX_LINK_FIELD_CHARS = 32768;

export interface LinkParam {
  /** Lowercased, because RFC 8288 section 3 case-normalizes parameter names. */
  readonly name: string;
  /**
   * The unquoted, unescaped value, or `null` for a parameter written with no
   * `=` at all. The ABNF makes the value optional:
   * `link-param = token BWS [ "=" BWS ( token / quoted-string ) ]`.
   */
  readonly value: string | null;
}

/**
 * One relation type from a `rel` parameter, classified by RFC 8288 section 2.1.
 *
 * `registered` is a `reg-rel-type`, lowercased because section 3.3 compares
 * registered relation types case-insensitively. `extension` is an
 * `ext-rel-type`, which is a URI and is kept verbatim. `invalid` is neither,
 * and is what separates this from the substring search the rule must not do.
 */
export interface LinkRelation {
  readonly kind: "registered" | "extension" | "invalid";
  readonly value: string;
}

export interface ParsedLink {
  /**
   * The raw `URI-Reference` between the angle brackets, exactly as served.
   *
   * Never resolved. RFC 8288 section 3 resolves a relative target against the
   * context URI per RFC 3986 section 5, and a rule may not construct a URL.
   */
  readonly target: string;
  /** First occurrence per name. RFC 8288 sections 3.3 and 3.4 ignore the rest. */
  readonly params: readonly LinkParam[];
  /**
   * The relation types of the first `rel` parameter, split on RWS.
   *
   * Empty when `rel` is absent or carries no value, which RFC 8288 section 3.3
   * forbids. The parser records the absence; the rule decides what it means.
   */
  readonly relations: readonly LinkRelation[];
}

export type LinkFieldResult =
  | { readonly kind: "parsed"; readonly links: readonly ParsedLink[] }
  | {
      readonly kind: "malformed";
      readonly error: LinkSyntaxError;
      /** Which field value failed, and where in it. */
      readonly fieldIndex: number;
      readonly offset: number;
    }
  | { readonly kind: "bounded"; readonly limit: LinkParserLimit };

const TOKEN_PUNCTUATION = "!#$%&'*+-.^_`|~";

function isAlpha(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/**
 * RFC 7230 `tchar`.
 *
 * The empty-string guard is load-bearing rather than defensive:
 * `String.prototype.charAt` returns `""` past the end of the input and
 * `"...".includes("")` is `true`, so without it every scan would run off the
 * end of its field value.
 */
function isTokenChar(ch: string): boolean {
  if (ch === "") return false;
  return isAlpha(ch) || isDigit(ch) || TOKEN_PUNCTUATION.includes(ch);
}

/** RFC 7230 OWS and BWS are the same characters. */
function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t";
}

/** RFC 8288 `reg-rel-type = LOALPHA *( LOALPHA / DIGIT / "." / "-" )`. */
function isRegisteredRelationType(lowercased: string): boolean {
  if (lowercased === "") return false;
  if (!(lowercased.charAt(0) >= "a" && lowercased.charAt(0) <= "z")) {
    return false;
  }
  for (let index = 1; index < lowercased.length; index += 1) {
    const ch = lowercased.charAt(index);
    const allowed =
      (ch >= "a" && ch <= "z") || isDigit(ch) || ch === "." || ch === "-";
    if (!allowed) return false;
  }
  return true;
}

/**
 * RFC 8288 `ext-rel-type = URI`, tested by its scheme.
 *
 * A scheme is all that can be checked here without a URL parser, and it is
 * enough to separate an extension relation type from a name that is neither a
 * URI nor a registered relation type. RFC 3986 permits an empty path, so
 * `example:` is a URI and is accepted.
 */
function hasUriScheme(value: string): boolean {
  const colon = value.indexOf(":");
  if (colon <= 0) return false;
  if (!isAlpha(value.charAt(0))) return false;
  for (let index = 1; index < colon; index += 1) {
    const ch = value.charAt(index);
    const allowed =
      isAlpha(ch) || isDigit(ch) || ch === "+" || ch === "-" || ch === ".";
    if (!allowed) return false;
  }
  return true;
}

function classifyRelation(token: string): LinkRelation {
  const lowercased = token.toLowerCase();
  if (isRegisteredRelationType(lowercased)) {
    return { kind: "registered", value: lowercased };
  }
  if (hasUriScheme(token)) return { kind: "extension", value: token };
  return { kind: "invalid", value: token };
}

/** RFC 8288 section 3.3 separates relation types with RWS. */
function relationsOf(params: readonly LinkParam[]): readonly LinkRelation[] {
  // An absent `rel` and a valueless `rel` are both "no relation types", and
  // both are what RFC 8288 section 3.3 forbids. The rule decides that; here
  // they are one case.
  const rel = params.find((param) => param.name === "rel")?.value ?? null;
  if (rel === null) return [];
  const relations: LinkRelation[] = [];
  let token = "";
  for (let index = 0; index <= rel.length; index += 1) {
    const ch = rel.charAt(index);
    if (ch === "" || isWhitespace(ch)) {
      if (token !== "") relations.push(classifyRelation(token));
      token = "";
      continue;
    }
    token += ch;
  }
  return relations;
}

/**
 * One `Link` field value: `#link-value`, which RFC 7230 section 7 lets carry
 * empty elements.
 */
function parseFieldValue(value: string, fieldIndex: number): LinkFieldResult {
  const links: ParsedLink[] = [];
  let index = 0;

  const fail = (error: LinkSyntaxError): LinkFieldResult => ({
    kind: "malformed",
    error,
    fieldIndex,
    offset: index,
  });

  const skipWhitespace = (): void => {
    while (isWhitespace(value.charAt(index))) index += 1;
  };

  /** RFC 7230 `quoted-string`. `null` when it is never closed. */
  const readQuotedString = (): string | null => {
    index += 1;
    let unquoted = "";
    while (index < value.length) {
      const ch = value.charAt(index);
      if (ch === '"') {
        index += 1;
        return unquoted;
      }
      if (ch === "\\") {
        // A trailing backslash escapes the closing quote out of existence.
        if (index + 1 >= value.length) return null;
        unquoted += value.charAt(index + 1);
        index += 2;
        continue;
      }
      unquoted += ch;
      index += 1;
    }
    return null;
  };

  for (;;) {
    skipWhitespace();
    while (value.charAt(index) === ",") {
      index += 1;
      skipWhitespace();
    }
    if (index >= value.length) break;

    if (value.charAt(index) !== "<") return fail("expected-link-target");
    index += 1;
    const targetStart = index;
    while (index < value.length && value.charAt(index) !== ">") index += 1;
    if (index >= value.length) return fail("unterminated-link-target");
    const target = value.slice(targetStart, index);
    index += 1;

    const params: LinkParam[] = [];
    const seen = new Set<string>();
    for (;;) {
      skipWhitespace();
      const delimiter = value.charAt(index);
      if (delimiter === "") break;
      if (delimiter === ",") {
        index += 1;
        break;
      }
      if (delimiter !== ";") return fail("expected-parameter-delimiter");
      index += 1;
      skipWhitespace();

      const nameStart = index;
      while (isTokenChar(value.charAt(index))) index += 1;
      if (index === nameStart) return fail("expected-parameter-name");
      const name = value.slice(nameStart, index).toLowerCase();

      skipWhitespace();
      let paramValue: string | null = null;
      if (value.charAt(index) === "=") {
        index += 1;
        skipWhitespace();
        if (value.charAt(index) === '"') {
          const openedAt = index;
          const unquoted = readQuotedString();
          if (unquoted === null) {
            index = openedAt;
            return fail("unterminated-quoted-string");
          }
          paramValue = unquoted;
        } else {
          const valueStart = index;
          while (isTokenChar(value.charAt(index))) index += 1;
          if (index === valueStart) return fail("expected-parameter-value");
          paramValue = value.slice(valueStart, index);
        }
      }

      // RFC 8288 sections 3.3 and 3.4: "occurrences after the first MUST be
      // ignored by parsers". Applied to every parameter name, including
      // `title*`, whose extended value needs no special tokenization: `*` is a
      // `tchar`, so it is an ordinary parameter name here.
      if (!seen.has(name)) {
        seen.add(name);
        params.push({ name, value: paramValue });
      }
    }

    links.push({ target, params, relations: relationsOf(params) });
  }

  return { kind: "parsed", links };
}

/**
 * Parses the `Link` field of one response.
 *
 * `values` is the field as the observation carries it: a repeated header field
 * arrives as several strings, and a normalized one arrives as a single
 * comma-joined string. Both shapes are handled by the same code and produce the
 * same links, because RFC 8288 Appendix B.1 parses each field value
 * independently and concatenates, and a comma-joined value is a `#link-value`
 * list by construction.
 */
export function parseLinkField(values: readonly string[]): LinkFieldResult {
  if (values.length > MAX_LINK_FIELD_VALUES) {
    return { kind: "bounded", limit: "field-value-count" };
  }
  let total = 0;
  for (const value of values) {
    total += value.length;
    if (total > MAX_LINK_FIELD_CHARS) {
      return { kind: "bounded", limit: "field-length" };
    }
  }

  const links: ParsedLink[] = [];
  for (let fieldIndex = 0; fieldIndex < values.length; fieldIndex += 1) {
    const parsed = parseFieldValue(values[fieldIndex] ?? "", fieldIndex);
    if (parsed.kind !== "parsed") return parsed;
    links.push(...parsed.links);
  }
  return { kind: "parsed", links };
}
