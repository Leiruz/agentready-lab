import { Validator } from "@cfworker/json-schema";
import type { Schema } from "@cfworker/json-schema";

/**
 * JSON Schema Draft 2020-12 validation.
 *
 * This lives in `packages/core` and not in `scripts/` because
 * `@cfworker/json-schema` is declared by this package (it interprets schemas
 * rather than compiling them with `new Function`, so it runs in workerd as
 * well as Node.js). A script that imported it directly would be using an
 * undeclared dependency, which is exactly what
 * `test/boundaries/package-boundaries.test.ts` exists to prevent.
 */

/** One schema violation, in Draft 2020-12 "basic" output terms. */
export interface SchemaViolation {
  readonly keyword: string;
  readonly keywordLocation: string;
  readonly instanceLocation: string;
  readonly error: string;
}

/**
 * Validates `instance` against `schema` as Draft 2020-12 and returns every
 * violation.
 *
 * Short-circuiting is off. A maintainer editing a 1395-line registry needs to
 * see all of its errors in one run; stopping at the first one turns a review
 * into a sequence of round trips.
 *
 * NOTE ON `format`. Under Draft 2020-12 `format` is an annotation, not an
 * assertion, unless the format-assertion vocabulary is declared. This library
 * does not implement that vocabulary and instead asserts every `format` it
 * recognizes, unconditionally. That is more validation than the draft
 * promises, and it is not a substitute for an explicit check: it is a property
 * of this dependency at this version, it covers only the formats in the
 * library's own table, and it will not, for example, notice that a `date` is
 * in the future or that a `uri` is `http:`. Callers that need a format
 * enforced must enforce it themselves.
 */
export function validateAgainstSchema(
  instance: unknown,
  schema: unknown,
): readonly SchemaViolation[] {
  // The cast is the boundary between "text someone parsed" and the library's
  // own type. `Schema` is an open interface with an index signature, so there
  // is no narrower type to land on and no check to defer to.
  const validator = new Validator(schema as Schema, "2020-12", false);
  const result = validator.validate(instance);
  return result.errors.map((unit) => ({
    keyword: unit.keyword,
    keywordLocation: unit.keywordLocation,
    instanceLocation: unit.instanceLocation,
    error: unit.error,
  }));
}
