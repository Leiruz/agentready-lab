import {
  ConfigurationError,
  RuleContractViolation,
} from "../model/contract-violation.js";
import type {
  AssertionDeclaration,
  AssertionOutcome,
  FindingParam,
  FindingParamKind,
  RuleMetadata,
} from "../model/rule.js";
import type {
  InterpretationMode,
  OutcomeKind,
  RequirementClass,
} from "../model/status.js";

/**
 * ADR-0002 sections 5 and 6. The enumerated contract violations, checked.
 *
 * Every check here answers the same question in a different place: can a rule
 * make the report say something the pinned ruleset does not authorize? The
 * answers are meant to be dull. A rule cannot name an assertion the ruleset
 * does not declare, cannot claim a stronger requirement class than the ruleset
 * assigned, cannot omit the assertion it would have failed, cannot put a value
 * into a template slot the assertion did not declare, and cannot carry an
 * excerpt without authorization.
 */

/**
 * ADR-0002 section 6's M1 grammars. `excerpt` has none because a bounded
 * sanitized excerpt is target text by definition; its control is
 * `excerptAuthorized` plus the 256-character cap.
 */
const PARAM_GRAMMAR: Readonly<Record<FindingParamKind, RegExp | null>> = {
  count: null,
  "http-status": null,
  excerpt: null,
  token: /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/,
  "header-name": /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/,
  "media-type":
    /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,127}\/[!#$%&'*+.^_`|~0-9A-Za-z-]{1,127}$/,
  // Printable ASCII only, minus space, "#", "?" and DEL.
  "origin-path": /^\/[!-"$->@-~]{0,1024}$/,
  // RFC 6901, with "/" and "~" escaped as the standard requires.
  "json-pointer": /^(?:\/(?:[!-.0-}]|~[01])*){0,32}$/,
};

export function validateOutcomeParams(
  declaration: AssertionDeclaration,
  params: Readonly<Record<string, FindingParam>>,
): void {
  for (const [name, param] of Object.entries(params)) {
    const spec = declaration.params[name];
    if (spec === undefined) {
      throw new RuleContractViolation(
        "undeclared-parameter",
        `${declaration.id} declares no parameter ${name}`,
      );
    }
    if (param.kind !== spec.kind) {
      throw new RuleContractViolation(
        "parameter-kind-mismatch",
        `${declaration.id} parameter ${name} must be ${spec.kind}`,
      );
    }
    if (param.kind === "excerpt" && !declaration.excerptAuthorized) {
      throw new RuleContractViolation(
        "unauthorized-excerpt",
        `${declaration.id} is not authorized to carry an excerpt`,
      );
    }
    switch (param.kind) {
      case "count":
      case "http-status": {
        if (!Number.isInteger(param.value) || param.value < 0) {
          throw new RuleContractViolation(
            "parameter-grammar",
            `${declaration.id} parameter ${name} is not a whole count`,
          );
        }
        break;
      }
      default: {
        const grammar = PARAM_GRAMMAR[param.kind];
        if (grammar !== null && !grammar.test(param.value)) {
          throw new RuleContractViolation(
            "parameter-grammar",
            `${declaration.id} parameter ${name} fails its grammar`,
          );
        }
        if (
          spec.allowedValues !== undefined &&
          !spec.allowedValues.includes(param.value)
        ) {
          throw new RuleContractViolation(
            "parameter-not-allowed-value",
            `${declaration.id} parameter ${name} is outside its allowed values`,
          );
        }
        break;
      }
    }
  }
  for (const [name, spec] of Object.entries(declaration.params)) {
    if (spec.required && params[name] === undefined) {
      throw new RuleContractViolation(
        "missing-required-parameter",
        `${declaration.id} requires parameter ${name}`,
      );
    }
  }
}

/** The pinned ruleset's declaration for one assertion, with its owning rule. */
export interface RulesetAssertion extends AssertionDeclaration {
  readonly ruleId: string;
}

const CLASS_STRENGTH: Readonly<Record<RequirementClass, number>> = {
  advisory: 1,
  recommended: 2,
  normative: 3,
  // Not comparable with the three above: ADR-0002 section 9 keeps the
  // compatibility identifier space apart so a compatibility verdict can never
  // be read as a specification verdict. Ordering it against them would be the
  // merge that section forbids, so it is only ever compared with itself.
  compatibility: 0,
};

/**
 * The assertion declarations of the pinned ruleset, keyed by rule and id.
 *
 * The engine reads classes, citations, parameter schemas and excerpt
 * authorization from **here** and never from `RuleMetadata`. A rule's own copy
 * is validated against this and then not used, which is what ADR-0002
 * section 5 means by "the class is loaded from the pinned ruleset".
 */
export class RulesetAssertionIndex {
  readonly #byRule = new Map<string, RulesetAssertion[]>();

  constructor(assertions: readonly RulesetAssertion[]) {
    for (const assertion of assertions) {
      const isCompat = assertion.mode === "compat";
      if (isCompat !== (assertion.requirementClass === "compatibility")) {
        throw new ConfigurationError(
          "assertion-not-in-ruleset",
          `ruleset assertion ${assertion.id} pairs mode ${assertion.mode} with class ${assertion.requirementClass}; ADR-0002 section 9 keeps the two identifier spaces apart`,
        );
      }
      const existing = this.#byRule.get(assertion.ruleId);
      if (existing === undefined) {
        this.#byRule.set(assertion.ruleId, [assertion]);
      } else {
        existing.push(assertion);
      }
    }
  }

  /**
   * The **active** assertions for one rule and mode: declared for that mode
   * and not deferred.
   *
   * ADR-0010 section 4 excludes a deferred assertion from the set every other
   * check in this file works over, which is what makes the marker do
   * something rather than sit in the data. Excluded here rather than at each
   * of the four call sites, because a check that has to remember to skip is
   * one edit away from not skipping.
   */
  forRule(
    ruleId: string,
    mode: InterpretationMode,
  ): readonly RulesetAssertion[] {
    return this.#forMode(ruleId, mode).filter(
      (assertion) => assertion.deferred === undefined,
    );
  }

  /** The complement of `forRule`: declared for the mode, and deferred. */
  deferredForRule(
    ruleId: string,
    mode: InterpretationMode,
  ): readonly RulesetAssertion[] {
    return this.#forMode(ruleId, mode).filter(
      (assertion) => assertion.deferred !== undefined,
    );
  }

  #forMode(
    ruleId: string,
    mode: InterpretationMode,
  ): readonly RulesetAssertion[] {
    return (this.#byRule.get(ruleId) ?? []).filter(
      (assertion) => assertion.mode === mode,
    );
  }

  find(ruleId: string, assertionId: string): RulesetAssertion | undefined {
    return (this.#byRule.get(ruleId) ?? []).find(
      (assertion) => assertion.id === assertionId,
    );
  }
}

/**
 * Checks one rule's declared assertions against the pinned ruleset, before
 * `plan()` is called, and returns the declarations for the active mode.
 *
 * Two of these are exit 2 rather than exit 4, and the split is deliberate. A
 * rule naming an assertion the ruleset does not declare, or an assertion with
 * no authoritative source, is a packaging defect: nothing the target does can
 * change it and no scan of any target could succeed, so it is refused before a
 * socket opens. A rule claiming a stronger class than the ruleset assigned is
 * the rule contradicting the ruleset, which is exit 4.
 */
export function validateRuleAssertions(
  metadata: RuleMetadata,
  index: RulesetAssertionIndex,
  mode: InterpretationMode,
): readonly RulesetAssertion[] {
  for (const declared of metadata.assertions) {
    const pinned = index.find(metadata.id, declared.id);
    if (pinned === undefined) {
      throw new ConfigurationError(
        "assertion-not-in-ruleset",
        `${metadata.id} declares assertion ${declared.id}, which the pinned ruleset does not`,
      );
    }
    if (pinned.mode !== declared.mode) {
      throw new RuleContractViolation(
        "assertion-mode-mismatch",
        `${metadata.id} declares assertion ${declared.id} for mode ${declared.mode}; the ruleset declares it for ${pinned.mode}`,
      );
    }
    if (
      CLASS_STRENGTH[declared.requirementClass] >
      CLASS_STRENGTH[pinned.requirementClass]
    ) {
      throw new RuleContractViolation(
        "assertion-class-escalated",
        `${metadata.id} declares assertion ${declared.id} as ${declared.requirementClass}; the ruleset declares it ${pinned.requirementClass}`,
      );
    }
  }

  // ADR-0010 section 4: `forRule` has already dropped every deferred
  // assertion, so the citation check below never sees one. That is the whole
  // of what unblocks `agent.discovery.skills`, whose fourth assertion has no
  // `source_refs` and is not owed any.
  const active = index.forRule(metadata.id, mode);
  if (active.length === 0) {
    throw new ConfigurationError(
      "no-assertion-for-mode",
      `${metadata.id} has no pinned assertion for mode ${mode}. In compat mode this is the compat_assertions gap that specs/ruleset.standard.v0.yaml records: no accepted decision names a compat assertion id, so no rule can report one`,
    );
  }
  for (const assertion of active) {
    if (assertion.sourceRefs.length === 0) {
      throw new ConfigurationError(
        "assertion-sources-unassigned",
        `assertion ${assertion.id} declares no source_refs. ADR-0002 section 6 requires each assertion to carry its authoritative sources and forbids a rule choosing its own; specs/ruleset.standard.v0.yaml records the gap as a todo`,
      );
    }
  }
  return active;
}

export interface OutcomeValidationInput {
  readonly ruleId: string;
  readonly mode: InterpretationMode;
  /** The pinned **active** declarations for this rule in the active mode. */
  readonly declarations: readonly RulesetAssertion[];
  readonly outcomes: readonly AssertionOutcome[];
  /**
   * The ids this rule's ruleset entry defers for the active mode
   * (`RulesetAssertionIndex.deferredForRule`).
   *
   * Optional because omitting it loses precision rather than protection: a
   * deferred assertion is absent from `declarations` either way, so an outcome
   * for one is still rejected, just as `unknown-assertion` rather than as the
   * more specific `outcome-for-deferred-assertion`.
   */
  readonly deferred?: ReadonlySet<string>;
}

/**
 * ADR-0002 section 5. Every declared assertion for the active mode carries
 * exactly one outcome, and every outcome names a declared assertion.
 *
 * The mixture check on `not-present` is the one that most often reads as too
 * strict, so the reason belongs next to it: `not-present` means the
 * *mechanism* is not deployed, which is a property of the observation set, so
 * every assertion of the rule sees the same answer. An assertion whose own
 * condition never arises inside a mechanism that is deployed reports
 * `satisfied`, because the obligation is met.
 */
export function validateRuleOutcomes(
  input: OutcomeValidationInput,
): ReadonlyMap<string, RulesetAssertion> {
  const declaredById = new Map(
    input.declarations.map((declaration) => [declaration.id, declaration]),
  );
  const seen = new Set<string>();

  for (const outcome of input.outcomes) {
    const declaration = declaredById.get(outcome.assertion);
    if (declaration === undefined) {
      if (input.deferred?.has(outcome.assertion) === true) {
        throw new RuleContractViolation(
          "outcome-for-deferred-assertion",
          `${input.ruleId} reported assertion ${outcome.assertion}, which the pinned ruleset defers under ADR-0010 section 4 and which is therefore never evaluated`,
        );
      }
      throw new RuleContractViolation(
        "unknown-assertion",
        `${input.ruleId} reported assertion ${outcome.assertion}, which it does not declare for mode ${input.mode}`,
      );
    }
    if (
      (input.mode === "compat") !==
      (declaration.requirementClass === "compatibility")
    ) {
      throw new RuleContractViolation(
        "assertion-class-mode-mismatch",
        `${declaration.id} is ${declaration.requirementClass} and was evaluated in ${input.mode} mode`,
      );
    }
    if (seen.has(outcome.assertion)) {
      throw new RuleContractViolation(
        "duplicate-assertion-outcome",
        `${input.ruleId} reported assertion ${outcome.assertion} more than once`,
      );
    }
    seen.add(outcome.assertion);
    validateOutcomeParams(declaration, outcome.params);
  }

  for (const declaration of input.declarations) {
    if (!seen.has(declaration.id)) {
      throw new RuleContractViolation(
        "missing-assertion-outcome",
        `${input.ruleId} declares assertion ${declaration.id} for mode ${input.mode} and reported no outcome for it`,
      );
    }
  }

  const kinds: readonly OutcomeKind[] = input.outcomes.map(
    (outcome) => outcome.kind,
  );
  const absent = kinds.filter((kind) => kind === "not-present").length;
  if (absent !== 0 && absent !== kinds.length) {
    throw new RuleContractViolation(
      "mixed-not-present",
      `${input.ruleId} mixed not-present with an evaluated outcome kind`,
    );
  }

  return declaredById;
}

/**
 * ADR-0002 section 8. `ObservationRequest.id` is unique within one rule for
 * the whole scan, across both rounds.
 *
 * Scan-wide rather than per-round because `context.observation(id)` and
 * `AssertionOutcome.observationRefs` both carry a bare id with no round, and
 * `finish()` can legitimately cite a round-one observation. An id reused
 * across rounds has two answers at exactly the point where the core must pick
 * one.
 */
export function claimRequestId(
  ruleId: string,
  claimed: Set<string>,
  requestId: string,
): void {
  if (claimed.has(requestId)) {
    throw new RuleContractViolation(
      "duplicate-request-id",
      `${ruleId} reused request id ${requestId}; ids are unique within one rule for the whole scan`,
    );
  }
  claimed.add(requestId);
}
