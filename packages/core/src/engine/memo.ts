import { RuleContractViolation } from "../model/contract-violation.js";
import { isMemoKey } from "./memo-keys.js";

/**
 * ADR-0002 section 11. Memo values are validated as plain data, then deeply
 * frozen.
 *
 * Order matters and is the whole point of the section. The freezing walk reads
 * every own property, so a getter returning a fresh object on each call would
 * be invoked by the freeze pass and would defeat it silently. Validation
 * therefore runs first and freezing second, and a test asserts that an object
 * with an accessor is rejected before anything is cached.
 */

const PLAIN_PROTOTYPES: readonly unknown[] = [
  Object.prototype,
  Array.prototype,
  null,
];

function reject(message: string): never {
  throw new RuleContractViolation("memo-value-rejected", message);
}

function assertPlainData(value: unknown, seen: Set<object>): void {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value !== "object") {
    // `undefined` lands here, and that is deliberate: canonical JSON cannot
    // distinguish an `undefined` property from an absent one, so the report
    // must not depend on which the parser produced.
    reject(`memo value of type ${typeof value}`);
  }
  if (value === null) {
    return;
  }
  if (seen.has(value)) {
    // A cycle and a plain object appearing twice in one memo value are
    // rejected together, because the walk cannot tell them apart without a
    // second pass and neither is worth one.
    reject("memo value is cyclic or shares a node");
  }
  seen.add(value);
  if (!PLAIN_PROTOTYPES.includes(Object.getPrototypeOf(value))) {
    // A `Map`, `Set`, `Date`, `Uint8Array`, `RegExp`, `Error` or class
    // instance is caught here rather than by a list of banned constructors,
    // so a type nobody thought of is rejected too.
    reject("memo value has a non-plain prototype");
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") {
      reject("memo value has a symbol-keyed property");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      reject("memo value has an accessor property");
    }
    assertPlainData(descriptor.value, seen);
  }
}

export function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }
  return value;
}

/**
 * Validates and freezes one memo value.
 *
 * `Object.isFrozen` short-circuits `deepFreeze` but not `assertPlainData`, so
 * a frozen `Map` is still rejected: validation is a property of the value, not
 * of its freeze state.
 */
export function acceptMemoValue<T>(value: T): T {
  assertPlainData(value, new Set<object>());
  return deepFreeze(value);
}

/**
 * The scan-wide memo cache.
 *
 * One store per scan, shared by every rule, which is what makes
 * `docs/ARCHITECTURE.md` section 7's single parsed robots representation
 * consumed by three rules a single parse rather than three.
 */
export class MemoStore {
  readonly #values = new Map<string, unknown>();

  get<T>(namespacedKey: string, load: () => T): T {
    if (!isMemoKey(namespacedKey)) {
      throw new RuleContractViolation(
        "unknown-memo-key",
        `memo key ${namespacedKey} is not in the compile-time list`,
      );
    }
    if (this.#values.has(namespacedKey)) {
      return this.#values.get(namespacedKey) as T;
    }
    const value = acceptMemoValue(load());
    this.#values.set(namespacedKey, value);
    return value;
  }
}
