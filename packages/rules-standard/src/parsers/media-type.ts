/**
 * RFC 9110 section 8.3.1 media types, parsed from a `Content-Type` field value.
 *
 * OWNERSHIP: written for `web.content.markdown-negotiation` and shared with
 * `web.discovery.sitemap`, `web.discovery.api-catalog`,
 * `agent.discovery.skills` and `web.discovery.robots` (`src/parsers/index.ts`).
 * A consumer imports it and does not modify it.
 *
 * THE ONE THING THIS MODULE MUST NOT DO is decide a media type from the bytes
 * of a body. `docs/FIXTURE_CATALOG.md` case `md-005` serves Markdown bytes
 * labelled `text/plain` and must fail: the label is the claim under test, and
 * a parser that sniffed would turn a real conformance failure into a pass. So
 * this module takes a field value and nothing else, and there is no entry
 * point that accepts a body.
 *
 * The input is hostile (`docs/THREAT_MODEL.md`). The scanner below is a single
 * forward pass over a length-capped string with no regular expression and no
 * backtracking, so its cost is linear in a bounded input by construction
 * rather than by review.
 */

/**
 * The longest field value considered. A `Content-Type` beyond this is not a
 * media type this project needs to understand, so it is refused rather than
 * truncated: a truncated parse would silently drop parameters.
 */
export const MAX_MEDIA_TYPE_LENGTH = 1024;

/** RFC 9110 section 5.6.6 places no cap on `parameters`. This does. */
export const MAX_MEDIA_TYPE_PARAMETERS = 16;

export interface MediaTypeParameter {
  /** Lowercased: RFC 9110 section 8.3.1 makes parameter names case-insensitive. */
  readonly name: string;
  /**
   * As written, with every `quoted-pair` unescaped. Case is preserved because
   * RFC 9110 section 8.3.1 makes parameter values case-sensitive unless the
   * parameter's own definition says otherwise, which is a per-parameter fact
   * this module does not know.
   */
  readonly value: string;
}

export interface MediaType {
  /** Lowercased. */
  readonly type: string;
  /** Lowercased. */
  readonly subtype: string;
  /** `type/subtype`, lowercased. The value to compare against. */
  readonly essence: string;
  readonly parameters: readonly MediaTypeParameter[];
}

/** RFC 9110 section 5.6.2 `tchar`. */
function isTchar(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x21 ||
    (code >= 0x23 && code <= 0x27) ||
    code === 0x2a ||
    code === 0x2b ||
    code === 0x2d ||
    code === 0x2e ||
    code === 0x5e ||
    code === 0x5f ||
    code === 0x60 ||
    code === 0x7c ||
    code === 0x7e
  );
}

/** RFC 9110 section 5.6.4 `qdtext`, including `obs-text`. */
function isQdtext(code: number): boolean {
  return (
    code === 0x09 ||
    code === 0x20 ||
    code === 0x21 ||
    (code >= 0x23 && code <= 0x5b) ||
    (code >= 0x5d && code <= 0x7e) ||
    (code >= 0x80 && code <= 0xff)
  );
}

/** RFC 9110 section 5.6.4 `quoted-pair`, including `obs-text`. */
function isQuotedPairChar(code: number): boolean {
  return (
    code === 0x09 ||
    (code >= 0x20 && code <= 0x7e) ||
    (code >= 0x80 && code <= 0xff)
  );
}

const SOLIDUS = 0x2f;
const SEMICOLON = 0x3b;
const EQUALS = 0x3d;
const DQUOTE = 0x22;
const BACKSLASH = 0x5c;

/**
 * A cursor over one field value.
 *
 * A class rather than closures over a shared `let`, because every read has to
 * advance the same offset, and a second offset is the bug this shape cannot
 * have.
 */
class FieldScanner {
  readonly #field: string;
  #at = 0;

  constructor(field: string) {
    this.#field = field;
  }

  /**
   * A method and not a getter: TypeScript narrows a property access and keeps
   * the narrowing across the intervening `#at` mutations, which makes a
   * correct second end-of-input check read as a constant condition. A call
   * expression is never narrowed.
   */
  atEnd(): boolean {
    return this.#at >= this.#field.length;
  }

  peek(): number {
    return this.#field.charCodeAt(this.#at);
  }

  /** Consumes one character if it is `code`. */
  eat(code: number): boolean {
    if (this.atEnd() || this.peek() !== code) return false;
    this.#at += 1;
    return true;
  }

  /** RFC 9110 section 5.6.3 `OWS`. */
  skipOws(): void {
    while (!this.atEnd() && (this.peek() === 0x20 || this.peek() === 0x09)) {
      this.#at += 1;
    }
  }

  /** RFC 9110 section 5.6.2 `token`. Empty when no `tchar` is present. */
  readToken(): string {
    const start = this.#at;
    while (!this.atEnd() && isTchar(this.peek())) this.#at += 1;
    return this.#field.slice(start, this.#at);
  }

  /**
   * RFC 9110 section 5.6.4 `quoted-string`, with the surrounding quotes
   * removed and every `quoted-pair` unescaped. `null` when the string is
   * unterminated or holds a character the grammar forbids.
   *
   * The caller has already established that the next character is `"`.
   */
  readQuotedString(): string | null {
    this.#at += 1;
    let value = "";
    while (!this.atEnd()) {
      const code = this.peek();
      if (code === DQUOTE) {
        this.#at += 1;
        return value;
      }
      if (code === BACKSLASH) {
        this.#at += 1;
        if (this.atEnd() || !isQuotedPairChar(this.peek())) return null;
        value += this.#field[this.#at] ?? "";
        this.#at += 1;
        continue;
      }
      if (!isQdtext(code)) return null;
      value += this.#field[this.#at] ?? "";
      this.#at += 1;
    }
    return null;
  }
}

/**
 * Parses one `Content-Type` field value. `null` for anything that is not
 * exactly one well-formed media type.
 *
 * Refusing trailing content is what makes `text/markdown, text/html` a parse
 * failure rather than `text/markdown`. A sender that combined two field lines
 * into one is not saying which representation it sent, and taking the first is
 * guessing.
 */
export function parseMediaType(field: string): MediaType | null {
  if (field.length === 0 || field.length > MAX_MEDIA_TYPE_LENGTH) return null;

  const scanner = new FieldScanner(field);
  scanner.skipOws();
  const type = scanner.readToken();
  if (type === "") return null;
  if (!scanner.eat(SOLIDUS)) return null;
  const subtype = scanner.readToken();
  if (subtype === "") return null;

  const parameters: MediaTypeParameter[] = [];
  for (;;) {
    scanner.skipOws();
    if (scanner.atEnd()) break;
    // RFC 9110 section 5.6.6: `parameters = *( OWS ";" OWS [ parameter ] )`.
    // Anything that is not a `;` here is trailing content, not a parameter.
    if (!scanner.eat(SEMICOLON)) return null;
    scanner.skipOws();
    // The grammar makes the parameter after a `;` optional, so a field ending
    // in `;` and a field holding `;;` are both well formed.
    if (scanner.atEnd()) break;
    if (scanner.peek() === SEMICOLON) continue;

    const name = scanner.readToken();
    if (name === "") return null;
    // No whitespace is permitted around `=` (RFC 9110 section 5.6.6), so no
    // `skipOws` belongs on either side of it.
    if (!scanner.eat(EQUALS)) return null;
    let value: string | null;
    if (!scanner.atEnd() && scanner.peek() === DQUOTE) {
      value = scanner.readQuotedString();
    } else {
      const token = scanner.readToken();
      value = token === "" ? null : token;
    }
    if (value === null) return null;
    if (parameters.length >= MAX_MEDIA_TYPE_PARAMETERS) return null;
    parameters.push({ name: name.toLowerCase(), value });
  }

  const lowerType = type.toLowerCase();
  const lowerSubtype = subtype.toLowerCase();
  return {
    type: lowerType,
    subtype: lowerSubtype,
    essence: `${lowerType}/${lowerSubtype}`,
    parameters,
  };
}

/**
 * Whether a field value names exactly `essence`, ignoring parameters.
 *
 * `text/markdown`, `text/markdown; charset=utf-8` and `TEXT/MARKDOWN` all
 * answer true for `"text/markdown"`; `text/html` and `text/plain` do not.
 */
export function isMediaType(
  field: string | undefined,
  essence: string,
): boolean {
  if (field === undefined) return false;
  return parseMediaType(field)?.essence === essence.toLowerCase();
}

/**
 * The first parameter named `name`, or `undefined`. Names are matched
 * lowercased, as RFC 9110 section 8.3.1 requires.
 */
export function mediaTypeParameter(
  mediaType: MediaType,
  name: string,
): string | undefined {
  const wanted = name.toLowerCase();
  return mediaType.parameters.find((parameter) => parameter.name === wanted)
    ?.value;
}
