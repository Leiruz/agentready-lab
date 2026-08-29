/**
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 *
 * This is a product contract, not a utility. The bytes this module produces
 * are the bytes of `--format json`, and their SHA-256 is the ruleset digest
 * that `docs/IMPLEMENTATION_SPEC.md` section 13 puts in every report. Two
 * independent implementations of AgentReady Lab must agree on them byte for
 * byte, so the algorithm is the published one and it is tested against the
 * vectors published with it, not against its own output.
 *
 * The four steps of RFC 8785 section 3.2:
 *
 * 1. no whitespace between tokens (section 3.2.1);
 * 2. primitives serialized as ECMAScript does (section 3.2.2);
 * 3. object properties sorted by UTF-16 code unit (section 3.2.3);
 * 4. the result encoded as UTF-8 (section 3.2.4).
 *
 * Step 4 belongs to the caller: this module returns a JavaScript string, and
 * `sha256.ts` is what encodes it. Keeping the two apart means the string form
 * can be written to a file or a terminal without a second encode/decode round
 * trip, and there is exactly one place that decides what UTF-8 means.
 */

/** A value JCS can represent. Arrays and objects are read-only by contract. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * A value was reached that RFC 8785 cannot serialize.
 *
 * `path` is a JSON Pointer (RFC 6901) to the offending value, because the
 * inputs this runs on are 1400-line registries and whole scan reports, and
 * "cannot canonicalize a number" without a location is not an error message.
 */
export class CanonicalJsonError extends Error {
  readonly path: string;

  constructor(message: string, path: string) {
    super(`${message} (at ${path === "" ? "the document root" : path})`);
    this.name = "CanonicalJsonError";
    this.path = path;
  }
}

/**
 * RFC 8785 section 3.2.2.2: the five control characters JSON gives a short
 * escape, plus the two characters that must always be escaped.
 */
const SHORT_ESCAPES = new Map<number, string>([
  [0x08, "\\b"],
  [0x09, "\\t"],
  [0x0a, "\\n"],
  [0x0c, "\\f"],
  [0x0d, "\\r"],
  [0x22, '\\"'],
  [0x5c, "\\\\"],
]);

const HIGH_SURROGATE_FIRST = 0xd800;
const HIGH_SURROGATE_LAST = 0xdbff;
const LOW_SURROGATE_FIRST = 0xdc00;
const LOW_SURROGATE_LAST = 0xdfff;

/**
 * RFC 8785 section 3.2.3: "code units are treated as unsigned integers,
 * independent of locale settings".
 *
 * ECMAScript's `<` on strings is exactly that comparison, which is why this is
 * a two-line function and not a loop over code units. It is deliberately not
 * `localeCompare` (the `french` vector exists to catch that) and deliberately
 * not a code point comparison: for a non-BMP key such as U+1F600, the code
 * unit order puts it before U+FB33 and the code point order puts it after.
 * The `weird` vector and the sorting sample in RFC 8785 section 3.2.3 both
 * turn on that difference.
 */
function compareUtf16CodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** RFC 8785 section 3.2.2.2. */
function serializeString(value: string, path: string): string {
  let out = '"';
  let plainFrom = 0;

  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);

    if (unit >= HIGH_SURROGATE_FIRST && unit <= LOW_SURROGATE_LAST) {
      // Surrogates are never escaped; they are emitted as-is as part of the
      // astral character they encode. But RFC 8785 section 3.2.2.2 requires a
      // compliant implementation to terminate on a lone surrogate, because an
      // unpaired one has no UTF-8 encoding and would silently become U+FFFD
      // somewhere downstream, changing the digest.
      const paired =
        unit <= HIGH_SURROGATE_LAST &&
        value.charCodeAt(index + 1) >= LOW_SURROGATE_FIRST &&
        value.charCodeAt(index + 1) <= LOW_SURROGATE_LAST;
      if (!paired) {
        throw new CanonicalJsonError(
          `lone surrogate U+${unit.toString(16).toUpperCase()} at string index ${String(index)} cannot be canonicalized`,
          path,
        );
      }
      index += 1;
      continue;
    }

    const shortEscape = SHORT_ESCAPES.get(unit);
    if (shortEscape !== undefined) {
      out += value.slice(plainFrom, index) + shortEscape;
      plainFrom = index + 1;
      continue;
    }

    if (unit < 0x20) {
      out += `${value.slice(plainFrom, index)}\\u${unit.toString(16).padStart(4, "0")}`;
      plainFrom = index + 1;
    }
  }

  return `${out}${value.slice(plainFrom)}"`;
}

/**
 * RFC 8785 section 3.2.2.3: ECMAScript `Number::toString`, which is the
 * shortest representation that round-trips through the same IEEE 754 double.
 *
 * `String(value)` is that algorithm, so this function is mostly a guard rather
 * than a reimplementation. The two things it has to add are the rejections the
 * RFC calls for (NaN and Infinity have no JSON form) and negative zero, which
 * `String` renders as `-0` while both JSON and the RFC's Appendix B require
 * `0`.
 */
function serializeNumber(value: number, path: string): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalJsonError(
      `${Number.isNaN(value) ? "NaN" : String(value)} has no JSON representation`,
      path,
    );
  }
  // `Object.is(-0, 0)` is false, so this catches negative zero without a
  // separate `1 / value === -Infinity` trick.
  if (value === 0) return "0";
  return String(value);
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (typeof value !== "object") return typeof value;
  const name: unknown = (value as { constructor?: { name?: unknown } })
    .constructor?.name;
  return typeof name === "string" ? name : "object";
}

/**
 * Rejects anything that is not a JSON object: class instances, `Date`, `Map`,
 * `Set`, `RegExp`, and everything else with its own prototype.
 *
 * Without this check such a value canonicalizes to `{}` — a wrong answer that
 * still produces a digest, which is the worst possible failure mode for this
 * module. `JSON.stringify` has the same hole and papers over it with `toJSON`;
 * JCS operates on parsed JSON data, so there is nothing legitimate to convert.
 */
function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function serializeValue(
  value: unknown,
  path: string,
  ancestors: readonly object[],
): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return serializeNumber(value, path);
    case "string":
      return serializeString(value, path);
    case "object":
      break;
    default:
      // undefined, function, symbol, bigint.
      throw new CanonicalJsonError(
        `${describeType(value)} has no JSON representation`,
        path,
      );
  }

  const objectValue: object = value;

  // YAML aliases can build a cyclic graph, and so can a hand-built report
  // object. Without this check the walk never returns. `ancestors` is an
  // array rather than a Set because it has to shrink again on the way out and
  // its depth is the document's nesting depth, not its size.
  if (ancestors.includes(objectValue)) {
    throw new CanonicalJsonError(
      "circular reference cannot be canonicalized",
      path,
    );
  }
  const nextAncestors = [...ancestors, objectValue];

  if (Array.isArray(objectValue)) {
    const items: readonly unknown[] = objectValue;
    // RFC 8785 section 3.2.3: array element order is never changed.
    const parts = items.map((item, index) =>
      serializeValue(item, `${path}/${String(index)}`, nextAncestors),
    );
    return `[${parts.join(",")}]`;
  }

  if (!isPlainObject(objectValue)) {
    throw new CanonicalJsonError(
      `${describeType(objectValue)} is not JSON data`,
      path,
    );
  }

  const record = objectValue as Record<string, unknown>;
  const keys = Object.keys(record).sort(compareUtf16CodeUnits);
  const parts = keys.map((key) => {
    // RFC 6901 section 3: `~` and `/` are escaped in a JSON Pointer token.
    const pointer = `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    return `${serializeString(key, pointer)}:${serializeValue(record[key], pointer, nextAncestors)}`;
  });
  return `{${parts.join(",")}}`;
}

/**
 * Canonicalizes a JSON value per RFC 8785.
 *
 * Returns the canonical form as a JavaScript string. Encode it with
 * `encodeCanonicalJson` before hashing or writing it.
 *
 * @throws {CanonicalJsonError} if the value contains anything RFC 8785 cannot
 * represent: `NaN`, `Infinity`, `undefined`, a function, a symbol, a `BigInt`,
 * a non-plain object, a lone surrogate, or a cycle.
 */
export function canonicalizeJson(value: unknown): string {
  return serializeValue(value, "", []);
}

/** RFC 8785 section 3.2.4: the canonical form is UTF-8. */
export function encodeCanonicalJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalizeJson(value));
}
