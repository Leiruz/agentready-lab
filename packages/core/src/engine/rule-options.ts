import { ConfigurationError } from "../model/contract-violation.js";
import type {
  EffectiveOptionValue,
  EffectiveRuleOptions,
} from "../model/report.js";

/**
 * ADR-0004 section 8. `rules.options` is the typed per-rule input, and every
 * effective option is recorded, not only the ones that change a request.
 *
 * The reason the second half matters is `web.policy.ai-crawler`: it fetches
 * `/robots.txt` whatever its crawler tokens and tested path are, and computes
 * a different effective access decision for each. Recording only
 * request-changing options would let two reports disagree on `bot-002` with
 * nothing in either one explaining why.
 */

/**
 * Merges a rule's defaults with the user's supplied options.
 *
 * An unknown key is exit 2. The key set of `defaultOptions` is the schema this
 * check has: a rule that publishes a JSON Schema for its options validates
 * shapes and ranges before this, and this catches the one thing a schema
 * cannot, which is a key nobody declared.
 */
export function resolveRuleOptions(
  ruleId: string,
  defaults: Readonly<Record<string, unknown>>,
  supplied: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> {
  if (supplied === undefined) return { ...defaults };
  for (const key of Object.keys(supplied)) {
    if (!Object.hasOwn(defaults, key)) {
      throw new ConfigurationError(
        "unknown-rule-option",
        `${ruleId} declares no option ${key}`,
      );
    }
  }
  return { ...defaults, ...supplied };
}

function optionValue(
  ruleId: string,
  key: string,
  value: unknown,
): EffectiveOptionValue {
  if (typeof value === "boolean") return { kind: "boolean", value };
  if (typeof value === "number" && Number.isInteger(value)) {
    return { kind: "integer", value };
  }
  if (typeof value === "string") return { kind: "string", value };
  if (
    Array.isArray(value) &&
    value.every((item): item is string => typeof item === "string")
  ) {
    return { kind: "string-list", value: [...value] };
  }
  // ADR-0004 section 8: "a schema that cannot be expressed in them is a schema
  // this decision has not seen, and adding a kind is a visible change". So an
  // unrepresentable option is refused rather than serialized as a blob.
  //
  // `{ kind: "redacted" }` is deliberately not produced anywhere. It exists so
  // that a future secret-shaped option does not force a schema change, and no
  // M1 option is secret-shaped, so nothing here can decide that a value is
  // one.
  throw new ConfigurationError(
    "unrepresentable-rule-option",
    `${ruleId} option ${key} is not a boolean, whole number, string or list of strings`,
  );
}

/** Keys sorted, so two runs with the same configuration are byte-identical. */
export function projectEffectiveOptions(
  ruleId: string,
  options: Readonly<Record<string, unknown>>,
): EffectiveRuleOptions {
  const projected: Record<string, EffectiveOptionValue> = {};
  for (const key of Object.keys(options).sort()) {
    projected[key] = optionValue(ruleId, key, options[key]);
  }
  return { ruleId, options: projected };
}
