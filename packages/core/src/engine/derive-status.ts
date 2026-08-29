import { RuleContractViolation } from "../model/contract-violation.js";
import type {
  OutcomeKind,
  RequirementClass,
  RuleStatus,
} from "../model/status.js";

/**
 * ADR-0002 section 5. The core derives every status; a rule reports only what
 * it observed.
 *
 * This is the single largest gap the previous design left between what the
 * project promises about `fail` and what its types could enforce. A rule that
 * writes its own status can make a recommendation `fail` and can soften a
 * normative violation to `warning`. Here it cannot, under any rule
 * implementation.
 */
export function findingStatus(
  outcome: OutcomeKind,
  requirementClass: RequirementClass,
): RuleStatus {
  switch (outcome) {
    case "satisfied":
      return "pass";
    case "not-present":
      return "not-applicable";
    case "indeterminate":
      return "unable-to-check";
    case "violated":
      switch (requirementClass) {
        case "normative":
        case "compatibility":
          return "fail";
        case "recommended":
        case "advisory":
          return "warning";
      }
  }
}

/** ADR-0002 section 5 and `docs/ARCHITECTURE.md` section 9. */
export const RULE_STATUS_PRECEDENCE = [
  "fail",
  "unable-to-check",
  "unsupported-runtime",
  "warning",
  "pass",
  "not-applicable",
] as const satisfies readonly RuleStatus[];

/**
 * The two branches the first revision of this function got wrong, both
 * rejected in review on 2026-08-29, are the two the tests hold down:
 *
 * - zero outcomes is an enumerated contract violation, not a silent
 *   `not-applicable`. A rule that fell through its own branches, or lost an
 *   outcome to a typo in an assertion id, was otherwise indistinguishable in
 *   the report from a rule that correctly found nothing to check;
 * - several `not-applicable` findings are legitimate and common. Every
 *   `not-present` outcome maps to one, and a rule with four assertions over
 *   one absent mechanism produces four at once. The test is whether the set is
 *   **mixed**, not how long it is.
 */
export function deriveRuleStatus(statuses: readonly RuleStatus[]): RuleStatus {
  if (statuses.length === 0) {
    throw new RuleContractViolation(
      "no-outcomes",
      "an invoked rule returned no outcomes",
    );
  }
  const inapplicable = statuses.filter(
    (status) => status === "not-applicable",
  ).length;
  if (inapplicable !== 0 && inapplicable !== statuses.length) {
    throw new RuleContractViolation(
      "mixed-not-present",
      "not-applicable cannot coexist with an evaluated finding",
    );
  }
  for (const status of RULE_STATUS_PRECEDENCE) {
    if (statuses.includes(status)) {
      return status;
    }
  }
  // Unreachable for a `RuleStatus[]`: the precedence list is declared
  // `satisfies readonly RuleStatus[]` and covers all six members, so the loop
  // above always returns. It stays because the array is data, and data can be
  // edited without the compiler noticing that a member went missing.
  throw new RuleContractViolation("no-outcomes", "unknown finding status");
}
