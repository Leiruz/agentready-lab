import { describe, expect, it } from "vitest";

import type {
  OutcomeKind,
  RequirementClass,
  RuleStatus,
} from "../src/index.js";
import {
  RULE_STATUS_PRECEDENCE,
  RuleContractViolation,
  deriveRuleStatus,
  findingStatus,
} from "../src/index.js";

/**
 * ADR-0002 section 5. The core derives every status.
 *
 * The two branches the first revision got wrong are the two this file pins
 * down: zero outcomes must throw rather than return a plausible
 * `not-applicable`, and several `not-applicable` findings must be accepted
 * rather than treated as a mixture.
 */

const ALL_STATUSES: readonly RuleStatus[] = [
  "fail",
  "unable-to-check",
  "unsupported-runtime",
  "warning",
  "pass",
  "not-applicable",
];

describe("findingStatus", () => {
  it.each([
    ["satisfied", "normative", "pass"],
    ["satisfied", "advisory", "pass"],
    ["not-present", "normative", "not-applicable"],
    ["indeterminate", "normative", "unable-to-check"],
    ["violated", "normative", "fail"],
    ["violated", "compatibility", "fail"],
    ["violated", "recommended", "warning"],
    ["violated", "advisory", "warning"],
  ] satisfies readonly (readonly [
    OutcomeKind,
    RequirementClass,
    RuleStatus,
  ])[])("maps %s + %s to %s", (outcome, requirementClass, expected) => {
    expect(findingStatus(outcome, requirementClass)).toBe(expected);
  });

  it("cannot turn a recommended violation into a fail", () => {
    // The single largest gap the previous design left between what the project
    // promises about `fail` and what its types could enforce.
    expect(findingStatus("violated", "recommended")).not.toBe("fail");
    expect(findingStatus("violated", "advisory")).not.toBe("fail");
  });
});

describe("deriveRuleStatus", () => {
  it.each(ALL_STATUSES)("returns %s for a single %s finding", (status) => {
    expect(deriveRuleStatus([status])).toBe(status);
  });

  it("applies the fixed precedence to all 15 unordered pairs", () => {
    const evaluated = ALL_STATUSES.filter(
      (status) => status !== "not-applicable",
    );
    const pairs: [RuleStatus, RuleStatus][] = [];
    for (let left = 0; left < ALL_STATUSES.length; left += 1) {
      for (let right = left + 1; right < ALL_STATUSES.length; right += 1) {
        const first = ALL_STATUSES[left];
        const second = ALL_STATUSES[right];
        if (first === undefined || second === undefined) continue;
        pairs.push([first, second]);
      }
    }
    expect(pairs).toHaveLength(15);

    for (const [first, second] of pairs) {
      const mixesInapplicable =
        (first === "not-applicable") !== (second === "not-applicable");
      if (mixesInapplicable) {
        // A mixture is the one pair shape that is rejected rather than ranked.
        expect(() => deriveRuleStatus([first, second])).toThrow(
          RuleContractViolation,
        );
        continue;
      }
      const expected = RULE_STATUS_PRECEDENCE.find(
        (status) => status === first || status === second,
      );
      expect(deriveRuleStatus([first, second])).toBe(expected);
      // Order must not matter: precedence, not arrival.
      expect(deriveRuleStatus([second, first])).toBe(expected);
    }
    expect(evaluated).toHaveLength(5);
  });

  it("accepts several not-applicable findings", () => {
    // `sig-006` serves no Content Signals declaration at all, so all four
    // spec assertions of `web.policy.content-signals` are inapplicable
    // together. The first revision turned that expected result into a crash.
    expect(
      deriveRuleStatus([
        "not-applicable",
        "not-applicable",
        "not-applicable",
        "not-applicable",
      ]),
    ).toBe("not-applicable");
  });

  it("rejects a mixture of not-applicable and an evaluated status", () => {
    expect(() => deriveRuleStatus(["not-applicable", "pass"])).toThrow(
      /not-applicable cannot coexist/,
    );
  });

  it("throws for zero outcomes rather than returning a status", () => {
    // A rule that fell through its own branches must not be
    // indistinguishable from a rule that correctly found nothing to check.
    expect(() => deriveRuleStatus([])).toThrow(RuleContractViolation);
    try {
      deriveRuleStatus([]);
    } catch (error) {
      expect(error).toBeInstanceOf(RuleContractViolation);
      expect((error as RuleContractViolation).code).toBe("no-outcomes");
      expect((error as RuleContractViolation).exitCode).toBe(4);
    }
  });

  it("throws for a status outside the precedence list", () => {
    // The defensive branch after the loop. `RULE_STATUS_PRECEDENCE` is data,
    // and data can lose a member without the compiler noticing, so the branch
    // is exercised here with a value the type system would otherwise forbid.
    const bogus = "invented" as RuleStatus;
    expect(() => deriveRuleStatus([bogus])).toThrow(/unknown finding status/);
  });
});
