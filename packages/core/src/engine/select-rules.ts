import { ConfigurationError } from "../model/contract-violation.js";
import type { AnyRuleDefinition } from "../model/rule.js";
import type {
  ObservationRuntime,
  ProfileId,
  ResultGate,
} from "../model/status.js";

/**
 * ADR-0004. Selection, applicability, and the selector grammar.
 *
 * The decision's first sentence is the one to keep in view: profile membership
 * grants selection, and `applicability` governs what the *absence* of the
 * mechanism means. They are two different questions, and conflating them is
 * what made three of the eight M1 rules unreachable in the blueprint.
 */

const RULE_ID = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/;
const NAMESPACE_GLOB = /^(?:[a-z][a-z0-9-]*\.)+\*$/;
const ATTRIBUTE_NAME = /^[a-z][a-z0-9-]*$/;

type Selector =
  | { readonly kind: "rule-id"; readonly value: string }
  | { readonly kind: "namespace"; readonly prefix: string }
  | { readonly kind: "category"; readonly value: string }
  | { readonly kind: "profile"; readonly value: string };

function invalid(element: string, why: string): never {
  throw new ConfigurationError(
    "invalid-selector",
    `selector element ${JSON.stringify(element)} ${why}`,
  );
}

function parseSelector(element: string): Selector {
  if (element === "") {
    invalid(
      element,
      "is empty; an empty, doubled or trailing comma is refused",
    );
  }
  if (element !== element.toLowerCase()) {
    // This is also what refuses the camelCase external compatibility id.
    // `.claude/rules/standards.md`: native selectors use `rule_id` only.
    invalid(element, "contains an uppercase character");
  }
  if (element.startsWith("@category:")) {
    const name = element.slice("@category:".length);
    if (!ATTRIBUTE_NAME.test(name)) invalid(element, "is not a category name");
    return { kind: "category", value: name };
  }
  if (element.startsWith("@profile:")) {
    const name = element.slice("@profile:".length);
    if (!ATTRIBUTE_NAME.test(name)) invalid(element, "is not a profile name");
    return { kind: "profile", value: name };
  }
  if (element.includes("*")) {
    if (!NAMESPACE_GLOB.test(element)) {
      invalid(
        element,
        "is not a namespace glob; `*` is permitted only as the final component",
      );
    }
    return { kind: "namespace", prefix: element.slice(0, -1) };
  }
  if (!RULE_ID.test(element)) {
    // `web.discovery.robots@0.1.0` lands here: `--ruleset` already pins
    // versions, so a version suffix is not part of the M1 grammar.
    invalid(element, "is not a rule id, namespace glob, category or profile");
  }
  return { kind: "rule-id", value: element };
}

/**
 * Resolves one selector list against the pinned registry.
 *
 * A zero-match glob is exit 2 rather than an empty set, because a typo that
 * silently runs fewer rules in CI is worse than a broken build. A repeated
 * element is accepted and idempotent.
 */
export function resolveSelectors(
  selectorList: string,
  registry: readonly AnyRuleDefinition[],
): ReadonlySet<string> {
  const matched = new Set<string>();
  for (const element of selectorList.split(",")) {
    const selector = parseSelector(element);
    const hits = registry.filter((rule) => {
      switch (selector.kind) {
        case "rule-id":
          return rule.metadata.id === selector.value;
        case "namespace":
          return rule.metadata.id.startsWith(selector.prefix);
        case "category":
          return rule.metadata.category === selector.value;
        case "profile":
          return (rule.metadata.profiles as readonly string[]).includes(
            selector.value,
          );
      }
    });
    if (hits.length === 0) {
      invalid(element, "matches no rule in the pinned ruleset");
    }
    for (const rule of hits) matched.add(rule.metadata.id);
  }
  return matched;
}

/**
 * Why a selected rule will not be invoked, when it will not be.
 *
 * ADR-0002 section 5: a rule the core resolved before `plan()` never reaches
 * `deriveRuleStatus` and is not covered by the zero-outcome violation.
 */
export type RuleResolution =
  "invoke" | "unsupported-runtime" | "commerce-endpoint-absent";

export interface SelectedRule {
  readonly rule: AnyRuleDefinition;
  readonly gate: ResultGate;
  readonly resolution: RuleResolution;
}

export interface SelectionInput {
  /** The pinned registry, already in stable registry order. */
  readonly registry: readonly AnyRuleDefinition[];
  readonly profile: ProfileId;
  /** A selector list, or `undefined` for no `--include`. */
  readonly include?: string;
  readonly exclude?: string;
  /** Which observation runtimes the composed transport can actually serve. */
  readonly availableRuntimes: readonly ObservationRuntime[];
  /** ADR-0004 section 2: `commerce-endpoint-required` needs one. */
  readonly commerceEndpointConfigured: boolean;
}

export function selectRules(input: SelectionInput): readonly SelectedRule[] {
  if (input.profile === "commerce") {
    throw new ConfigurationError(
      "commerce-profile-unavailable",
      "--profile commerce is refused in M1 for two reasons: the commerce rules are M6 work (ADR-0001 section 5), and the profiles arrays in specs/checks.v0.yaml do not implement the profile that docs/IMPLEMENTATION_SPEC.md section 7 describes (ADR-0004 section 10)",
    );
  }

  const seen = new Set<string>();
  for (const rule of input.registry) {
    if (seen.has(rule.metadata.id)) {
      throw new ConfigurationError(
        "duplicate-rule-id",
        `the registry declares ${rule.metadata.id} more than once`,
      );
    }
    seen.add(rule.metadata.id);
  }

  const included =
    input.include === undefined
      ? new Set<string>()
      : resolveSelectors(input.include, input.registry);
  const excluded =
    input.exclude === undefined
      ? new Set<string>()
      : resolveSelectors(input.exclude, input.registry);

  for (const rule of input.registry) {
    if (!included.has(rule.metadata.id)) continue;
    if (rule.metadata.implementationStatus === "planned") {
      throw new ConfigurationError(
        "include-unimplemented-rule",
        `--include names ${rule.metadata.id}, whose implementation_status is planned (ADR-0004 section 6)`,
      );
    }
  }

  const selected: SelectedRule[] = [];
  for (const rule of input.registry) {
    const inProfile = rule.metadata.profiles.includes(input.profile);
    if (!inProfile && !included.has(rule.metadata.id)) continue;
    // `--exclude` always wins, and a rule named by both is excluded without
    // an error (ADR-0004 section 6).
    if (excluded.has(rule.metadata.id)) continue;

    selected.push({
      rule,
      gate:
        rule.metadata.applicability === "informational"
          ? "informational"
          : "enforced",
      resolution: resolutionOf(rule, input),
    });
  }
  return selected;
}

function resolutionOf(
  rule: AnyRuleDefinition,
  input: SelectionInput,
): RuleResolution {
  const missingRuntime = rule.metadata.observationRuntime.some(
    (runtime) => !input.availableRuntimes.includes(runtime),
  );
  // ADR-0002 section 5: `unsupported-runtime` is produced only by the core
  // capability check, before `plan()` is called. No rule can return it, and a
  // rule whose runtime is unavailable is never `fail`.
  if (missingRuntime) return "unsupported-runtime";
  if (
    rule.metadata.applicability === "commerce-endpoint-required" &&
    !input.commerceEndpointConfigured
  ) {
    return "commerce-endpoint-absent";
  }
  return "invoke";
}
