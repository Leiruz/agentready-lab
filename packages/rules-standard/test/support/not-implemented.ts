import type {
  AnyRuleDefinition,
  PlanInput,
  RoundContext,
  TargetDescriptor,
} from "@agentready-lab/core";
import { expect } from "vitest";

/**
 * The shared half of `test/not-implemented/`.
 *
 * Nothing here is edited by a rule agent: it is read-only support, and the one
 * file per rule beside it is what an agent deletes. Delete this file too once
 * `test/not-implemented/` is empty.
 *
 * The target below duplicates `DEFAULT_TARGET` from `@agentready-lab/testkit`
 * rather than importing it, because `@agentready-lab/testkit` is not resolvable
 * from `packages/rules-standard`: the package declares only
 * `@agentready-lab/core`, and pnpm links nothing else into its `node_modules`.
 * A rule agent writing a real contract test with the testkit harness has to
 * add the devDependency and reinstall first.
 */

const PLAN_INPUT: PlanInput<unknown> = {
  mode: "spec",
  profile: { id: "full", version: "0.1.0" },
  target: {
    requestedUrl: "http://127.0.0.1:8787/",
    pageUrl: "http://127.0.0.1:8787/",
    origin: "http://127.0.0.1:8787",
    scope: "local",
    networkProfile: "local-loopback",
  } satisfies TargetDescriptor,
  options: {},
};

/**
 * `observation` and `memo` throw because a placeholder reaches neither. A rule
 * that did reach one from here would get a named error rather than a
 * confusing `undefined`.
 */
const ROUND_CONTEXT: RoundContext<unknown> = {
  ...PLAN_INPUT,
  observation() {
    throw new Error("the placeholder harness resolves no observation");
  },
  memo() {
    throw new Error("the placeholder harness holds no memo");
  },
};

/**
 * Asserts that all three rule entry points throw an error naming the rule.
 *
 * A placeholder that returned `satisfied` would be a verdict nothing computed,
 * which is the false claim this project forbids. When the rule is implemented
 * these expectations start failing with "expected function to throw", which is
 * the signal to delete that rule's file in `test/not-implemented/`.
 */
export function expectNotImplemented(rule: AnyRuleDefinition): void {
  const ruleId = rule.metadata.id;

  expect(() => rule.plan(PLAN_INPUT)).toThrow(
    `${ruleId}: plan() is not implemented`,
  );
  expect(() => rule.step(ROUND_CONTEXT)).toThrow(
    `${ruleId}: step() is not implemented`,
  );
  expect(() => rule.finish(ROUND_CONTEXT)).toThrow(
    `${ruleId}: finish() is not implemented`,
  );
}
