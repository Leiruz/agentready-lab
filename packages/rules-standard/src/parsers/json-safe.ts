/**
 * A bounded JSON reader for hostile bytes, with RFC 6901 locations.
 *
 * OWNERSHIP: written for `web.discovery.api-catalog` and shared with
 * `agent.discovery.skills` (`src/parsers/index.ts`). A consumer imports it and
 * does not modify it.
 *
 * THIS IS NOT `JSON.parse`. `docs/THREAT_MODEL.md` section 19.2 sets limits
 * that `JSON.parse` does not have and cannot be given: a nesting depth of 64,
 * 10,000 object/array nodes, 64 KiB for an individual key or string, explicit
 * handling of duplicate keys, and no unbounded recursive traversal. A
 * `JSON.parse` followed by a validating walk enforces none of them during the
 * parse, so a document that is hostile in exactly those ways has already been
 * materialised by the time the walk could object.
 *
 * The reader below is a single forward pass over the bytes with an explicit
 * stack and no recursion anywhere, so a document nested a million deep costs
 * one comparison and returns `depth-exceeded`. It never calls itself, so it
 * cannot overflow the call stack, which is the property
 * `test/rules/json-safe.test.ts` proves rather than assumes.
 *
 * Bytes rather than a string, because `TextDecoder` is not declared in this
 * package (`"lib": ["ES2023"]` with `"types": []`), and because RFC 9264
 * section 4.2 requires `application/linkset+json` to be encoded in UTF-8, so
 * the encoding is part of what a caller has to check. Outside a string every
 * significant byte of JSON is ASCII; inside one this module decodes and
 * validates UTF-8 itself, and rejects overlong forms, encoded surrogates and
 * out-of-range code points.
 *
 * The result is plain data: objects are built with `Object.create(null)`, so
 * a `__proto__` key could not reach `Object.prototype` even if it were kept,
 * and it is not kept. `null` is one of the prototypes `acceptMemoValue` in
 * `packages/core` accepts, so a result may be memoized unchanged.
 */

export interface JsonSafeObject {
  readonly [key: string]: JsonSafeValue;
}

export type JsonSafeValue =
  null | boolean | number | string | readonly JsonSafeValue[] | JsonSafeObject;

/** `docs/THREAT_MODEL.md` section 19.2. */
export const JSON_SAFE_MAX_DEPTH = 64;
export const JSON_SAFE_MAX_NODES = 10_000;
export const JSON_SAFE_MAX_STRING_BYTES = 65_536;

/**
 * Why a document was refused.
 *
 * The split matters to a caller and is the reason this is an enum rather than
 * a boolean. `syntax` and `invalid-utf8` are properties of the document: the
 * bytes are not a UTF-8 JSON text, which is a conformance fact. The other four
 * are properties of *this reader's budget*: the document may be perfectly
 * valid and simply larger, deeper or more ambiguous than a scanner will look
 * at. `docs/THREAT_MODEL.md` section 19.3 makes that distinction explicitly
 * for XML ("produces `unable-to-check`"), and it applies here for the same
 * reason: a budget a scanner chose is not a defect a target committed.
 */
export type JsonSafeFailureCode =
  | "syntax"
  | "invalid-utf8"
  | "duplicate-key"
  | "depth-exceeded"
  | "node-limit-exceeded"
  | "string-too-long";

export interface JsonSafeFailure {
  readonly ok: false;
  readonly code: JsonSafeFailureCode;
  /**
   * RFC 6901 JSON Pointer to the nearest enclosing location, `""` for the
   * document root. A pointer and not an offset: a byte offset into a hostile
   * body is not something a report can show a reader.
   */
  readonly pointer: string;
}

export interface JsonSafeSuccess {
  readonly ok: true;
  readonly value: JsonSafeValue;
  /** Object and array nodes read, against `JSON_SAFE_MAX_NODES`. */
  readonly nodes: number;
  /** Deepest container nesting reached, against `JSON_SAFE_MAX_DEPTH`. */
  readonly depth: number;
  /**
   * RFC 6901 pointers at which a `__proto__`, `constructor` or `prototype`
   * key was dropped. Non-empty means the document tried something; the value
   * is safe either way.
   */
  readonly neutralizedKeys: readonly string[];
}

export type JsonSafeResult = JsonSafeSuccess | JsonSafeFailure;

/**
 * `docs/THREAT_MODEL.md` section 19.2: "Any merge path must reject or
 * neutralize `__proto__`, `constructor`, and `prototype` keys."
 *
 * Dropped at parse time rather than left for a consumer to filter, because
 * this parser's output is shared and the consumer that forgets is the whole
 * risk. `Object.create(null)` alone would protect this object and not the
 * ordinary one somebody later spreads it into.
 */
const NEUTRALIZED_KEYS: readonly string[] = [
  "__proto__",
  "constructor",
  "prototype",
];

/** RFC 6901 section 3, in the order the standard gives: `~` before `/`. */
export function escapeJsonPointerToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** RFC 6901 section 3. An empty token list is the whole document, `""`. */
export function jsonPointer(tokens: readonly (string | number)[]): string {
  return tokens
    .map(
      (token) =>
        `/${escapeJsonPointerToken(
          typeof token === "number" ? String(token) : token,
        )}`,
    )
    .join("");
}

/**
 * `undefined` is accepted and answers false, because every reader of a parsed
 * document indexes an object and `noUncheckedIndexedAccess` makes that
 * `JsonSafeValue | undefined`. A guard that refused the absent case would put
 * the same `!== undefined` in front of every call site.
 */
export function isJsonObject(
  value: JsonSafeValue | undefined,
): value is JsonSafeObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonArray(
  value: JsonSafeValue | undefined,
): value is readonly JsonSafeValue[] {
  return Array.isArray(value);
}

const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const SPACE = 0x20;
const QUOTE = 0x22;
const PLUS = 0x2b;
const COMMA = 0x2c;
const MINUS = 0x2d;
const DOT = 0x2e;
const ZERO = 0x30;
const NINE = 0x39;
const COLON = 0x3a;
const LBRACKET = 0x5b;
const BACKSLASH = 0x5c;
const RBRACKET = 0x5d;
const LBRACE = 0x7b;
const RBRACE = 0x7d;
const EOF = -1;

interface ArrayFrame {
  readonly kind: "array";
  readonly items: JsonSafeValue[];
}

interface ObjectFrame {
  readonly kind: "object";
  readonly target: Record<string, JsonSafeValue>;
  readonly seen: Set<string>;
  key: string;
  /** Whether the member being read is one of `NEUTRALIZED_KEYS`. */
  drop: boolean;
}

type Frame = ArrayFrame | ObjectFrame;

/** Thrown internally and caught in `parseJsonSafe`; never escapes the module. */
class JsonSafeError extends Error {
  readonly code: JsonSafeFailureCode;

  constructor(code: JsonSafeFailureCode) {
    super(code);
    this.name = "JsonSafeError";
    this.code = code;
  }
}

/**
 * Reads one JSON document from UTF-8 bytes.
 *
 * The state machine has three states and one explicit stack. `value` expects a
 * value to start here, `key` expects a member name, and `settle` holds a
 * finished value that has to be attached to whatever encloses it. Containers
 * push a frame instead of recursing, which is the whole point.
 */
export function parseJsonSafe(bytes: Uint8Array): JsonSafeResult {
  const reader = new JsonSafeReader(bytes);
  try {
    return reader.read();
  } catch (error) {
    if (error instanceof JsonSafeError) {
      return { ok: false, code: error.code, pointer: reader.pointer() };
    }
    throw error;
  }
}

class JsonSafeReader {
  readonly #bytes: Uint8Array;
  readonly #path: (string | number)[] = [];
  readonly #stack: Frame[] = [];
  readonly #neutralized: string[] = [];
  #at = 0;
  #nodes = 0;
  #depth = 0;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
  }

  /** The RFC 6901 pointer for wherever the reader currently is. */
  pointer(): string {
    return jsonPointer(this.#path);
  }

  read(): JsonSafeResult {
    // RFC 8259 section 8.1 permits a parser to ignore a leading byte order
    // mark. Refusing one would report a real catalog as malformed.
    if (
      this.#byte(0) === 0xef &&
      this.#byte(1) === 0xbb &&
      this.#byte(2) === 0xbf
    ) {
      this.#at = 3;
    }

    const value = this.#readDocument();
    this.#skipWhitespace();
    if (this.#peek() !== EOF) throw new JsonSafeError("syntax");
    return {
      ok: true,
      value,
      nodes: this.#nodes,
      depth: this.#depth,
      neutralizedKeys: this.#neutralized,
    };
  }

  #readDocument(): JsonSafeValue {
    let state: "value" | "key" | "settle" = "value";
    let pending: JsonSafeValue = null;

    for (;;) {
      if (state === "value") {
        this.#skipWhitespace();
        const byte = this.#peek();
        if (byte === LBRACE || byte === LBRACKET) {
          this.#at += 1;
          this.#openContainer(byte === LBRACE);
          this.#skipWhitespace();
          const closer = byte === LBRACE ? RBRACE : RBRACKET;
          if (this.#peek() === closer) {
            this.#at += 1;
            pending = this.#closeContainer();
            state = "settle";
          } else if (byte === LBRACE) {
            state = "key";
          } else {
            this.#path.push(0);
          }
          continue;
        }
        pending = this.#readScalar();
        state = "settle";
        continue;
      }

      if (state === "key") {
        this.#skipWhitespace();
        if (this.#peek() !== QUOTE) throw new JsonSafeError("syntax");
        const key = this.#readString();
        const frame = this.#top();
        if (frame.kind !== "object") throw new JsonSafeError("syntax");
        // Recorded before the drop decision, so two `__proto__` members are a
        // duplicate rather than two silent removals.
        if (frame.seen.has(key)) {
          this.#path.push(key);
          throw new JsonSafeError("duplicate-key");
        }
        frame.seen.add(key);
        frame.key = key;
        frame.drop = NEUTRALIZED_KEYS.includes(key);
        this.#path.push(key);
        if (frame.drop) this.#neutralized.push(this.pointer());
        this.#skipWhitespace();
        if (this.#peek() !== COLON) throw new JsonSafeError("syntax");
        this.#at += 1;
        state = "value";
        continue;
      }

      const frame = this.#stack.at(-1);
      if (frame === undefined) return pending;

      if (frame.kind === "array") {
        frame.items.push(pending);
      } else if (!frame.drop) {
        frame.target[frame.key] = pending;
      }

      this.#skipWhitespace();
      const byte = this.#peek();
      if (byte === COMMA) {
        this.#at += 1;
        if (frame.kind === "array") {
          this.#path[this.#path.length - 1] = frame.items.length;
          state = "value";
        } else {
          this.#path.pop();
          state = "key";
        }
        continue;
      }
      if (byte === (frame.kind === "array" ? RBRACKET : RBRACE)) {
        this.#at += 1;
        this.#path.pop();
        pending = this.#closeContainer();
        state = "settle";
        continue;
      }
      throw new JsonSafeError("syntax");
    }
  }

  #openContainer(isObject: boolean): void {
    this.#nodes += 1;
    if (this.#nodes > JSON_SAFE_MAX_NODES) {
      throw new JsonSafeError("node-limit-exceeded");
    }
    if (this.#stack.length >= JSON_SAFE_MAX_DEPTH) {
      throw new JsonSafeError("depth-exceeded");
    }
    this.#stack.push(
      isObject
        ? {
            kind: "object",
            target: Object.create(null) as Record<string, JsonSafeValue>,
            seen: new Set<string>(),
            key: "",
            drop: false,
          }
        : { kind: "array", items: [] },
    );
    this.#depth = Math.max(this.#depth, this.#stack.length);
  }

  #closeContainer(): JsonSafeValue {
    const frame = this.#stack.pop();
    if (frame === undefined) throw new JsonSafeError("syntax");
    return frame.kind === "array" ? frame.items : frame.target;
  }

  #top(): Frame {
    const frame = this.#stack.at(-1);
    if (frame === undefined) throw new JsonSafeError("syntax");
    return frame;
  }

  #byte(index: number): number {
    return index < this.#bytes.length ? (this.#bytes[index] ?? EOF) : EOF;
  }

  #peek(): number {
    return this.#byte(this.#at);
  }

  /** RFC 8259 section 2 `ws`, and nothing else. */
  #skipWhitespace(): void {
    for (;;) {
      const byte = this.#peek();
      if (byte === SPACE || byte === TAB || byte === LF || byte === CR) {
        this.#at += 1;
        continue;
      }
      return;
    }
  }

  #readScalar(): JsonSafeValue {
    const byte = this.#peek();
    if (byte === QUOTE) return this.#readString();
    if (byte === MINUS || (byte >= ZERO && byte <= NINE)) {
      return this.#readNumber();
    }
    if (this.#eatLiteral("true")) return true;
    if (this.#eatLiteral("false")) return false;
    if (this.#eatLiteral("null")) return null;
    throw new JsonSafeError("syntax");
  }

  #eatLiteral(literal: string): boolean {
    for (let offset = 0; offset < literal.length; offset += 1) {
      if (this.#byte(this.#at + offset) !== literal.charCodeAt(offset)) {
        return false;
      }
    }
    this.#at += literal.length;
    return true;
  }

  /** RFC 8259 section 6. The grammar, checked digit by digit. */
  #readNumber(): number {
    const start = this.#at;
    if (this.#peek() === MINUS) this.#at += 1;
    if (this.#peek() === ZERO) {
      this.#at += 1;
    } else {
      if (!this.#readDigits()) throw new JsonSafeError("syntax");
    }
    if (this.#peek() === DOT) {
      this.#at += 1;
      if (!this.#readDigits()) throw new JsonSafeError("syntax");
    }
    const exponent = this.#peek();
    if (exponent === 0x45 || exponent === 0x65) {
      this.#at += 1;
      const sign = this.#peek();
      if (sign === PLUS || sign === MINUS) this.#at += 1;
      if (!this.#readDigits()) throw new JsonSafeError("syntax");
    }
    let text = "";
    for (let index = start; index < this.#at; index += 1) {
      text += String.fromCharCode(this.#byte(index));
    }
    const parsed = Number(text);
    // `1e999` is well-formed JSON and is not a number this project can carry:
    // `canonicalizeJson` cannot serialize a non-finite value, so a document
    // holding one would make the scan unreportable.
    if (!Number.isFinite(parsed)) throw new JsonSafeError("syntax");
    return parsed;
  }

  #readDigits(): boolean {
    const start = this.#at;
    while (this.#peek() >= ZERO && this.#peek() <= NINE) this.#at += 1;
    return this.#at > start;
  }

  /**
   * RFC 8259 section 7, with UTF-8 validated and the 64 KiB cap of
   * `docs/THREAT_MODEL.md` section 19.2 applied to the *decoded* bytes as they
   * are counted, so an over-long string is refused before it is built.
   */
  #readString(): string {
    this.#at += 1;
    let value = "";
    let utf8Bytes = 0;

    const append = (codePoint: number, width: number): void => {
      utf8Bytes += width;
      if (utf8Bytes > JSON_SAFE_MAX_STRING_BYTES) {
        throw new JsonSafeError("string-too-long");
      }
      value += String.fromCodePoint(codePoint);
    };

    for (;;) {
      const byte = this.#peek();
      if (byte === EOF) throw new JsonSafeError("syntax");
      if (byte === QUOTE) {
        this.#at += 1;
        return value;
      }
      if (byte === BACKSLASH) {
        this.#at += 1;
        const escaped = this.#readEscape();
        append(escaped, utf8Width(escaped));
        continue;
      }
      if (byte < SPACE) throw new JsonSafeError("syntax");
      const decoded = this.#readUtf8();
      append(decoded, utf8Width(decoded));
    }
  }

  /** RFC 8259 section 7 `escape`. Returns the code point it denotes. */
  #readEscape(): number {
    const byte = this.#peek();
    this.#at += 1;
    switch (byte) {
      case QUOTE:
        return 0x22;
      case BACKSLASH:
        return 0x5c;
      case 0x2f:
        return 0x2f;
      case 0x62:
        return 0x08;
      case 0x66:
        return 0x0c;
      case 0x6e:
        return 0x0a;
      case 0x72:
        return 0x0d;
      case 0x74:
        return 0x09;
      case 0x75:
        return this.#readUnicodeEscape();
      default:
        throw new JsonSafeError("syntax");
    }
  }

  /**
   * `\uXXXX`, joining a surrogate pair into one code point.
   *
   * A lone surrogate is refused. RFC 8259 section 8.2 permits one and calls it
   * not interoperable; here it is worse than that. A lone surrogate is not a
   * Unicode scalar value, so it cannot be encoded as UTF-8 at all, and
   * `canonicalizeJson` in `packages/core` terminates on one (RFC 8785 section
   * 3.2.2.2). A body that put one in a value a rule later reported would make
   * the whole scan unserializable.
   */
  #readUnicodeEscape(): number {
    const first = this.#readHex4();
    if (first < 0xd800 || first > 0xdfff) return first;
    if (first > 0xdbff) throw new JsonSafeError("invalid-utf8");
    if (this.#peek() !== BACKSLASH || this.#byte(this.#at + 1) !== 0x75) {
      throw new JsonSafeError("invalid-utf8");
    }
    this.#at += 2;
    const second = this.#readHex4();
    if (second < 0xdc00 || second > 0xdfff) {
      throw new JsonSafeError("invalid-utf8");
    }
    return 0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00);
  }

  #readHex4(): number {
    let value = 0;
    for (let index = 0; index < 4; index += 1) {
      const byte = this.#peek();
      this.#at += 1;
      let digit: number;
      if (byte >= 0x30 && byte <= 0x39) digit = byte - 0x30;
      else if (byte >= 0x41 && byte <= 0x46) digit = byte - 0x37;
      else if (byte >= 0x61 && byte <= 0x66) digit = byte - 0x57;
      else throw new JsonSafeError("syntax");
      value = value * 16 + digit;
    }
    return value;
  }

  /**
   * One UTF-8 sequence, rejecting overlong forms, encoded surrogates and code
   * points above U+10FFFF. The range tests on the second byte are what make
   * `C0 80` and `ED A0 80` failures rather than U+0000 and a lone surrogate.
   */
  #readUtf8(): number {
    const first = this.#peek();
    this.#at += 1;
    if (first < 0x80) return first;

    let width: number;
    let lower: number;
    let upper: number;
    let codePoint: number;
    if (first >= 0xc2 && first <= 0xdf) {
      width = 1;
      lower = 0x80;
      upper = 0xbf;
      codePoint = first & 0x1f;
    } else if (first >= 0xe0 && first <= 0xef) {
      width = 2;
      lower = first === 0xe0 ? 0xa0 : 0x80;
      upper = first === 0xed ? 0x9f : 0xbf;
      codePoint = first & 0x0f;
    } else if (first >= 0xf0 && first <= 0xf4) {
      width = 3;
      lower = first === 0xf0 ? 0x90 : 0x80;
      upper = first === 0xf4 ? 0x8f : 0xbf;
      codePoint = first & 0x07;
    } else {
      throw new JsonSafeError("invalid-utf8");
    }

    for (let index = 0; index < width; index += 1) {
      const byte = this.#peek();
      const min = index === 0 ? lower : 0x80;
      const max = index === 0 ? upper : 0xbf;
      if (byte < min || byte > max) throw new JsonSafeError("invalid-utf8");
      this.#at += 1;
      codePoint = (codePoint << 6) | (byte & 0x3f);
    }
    return codePoint;
  }
}

/** UTF-8 encoded width of one Unicode scalar value. */
function utf8Width(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}
