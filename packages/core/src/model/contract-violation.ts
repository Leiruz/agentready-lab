/**
 * The two ways a scan stops without producing a verdict, and the exit code
 * each one carries.
 *
 * `docs/IMPLEMENTATION_SPEC.md` section 10.1 fixes the exit codes. Core does
 * not call `process.exit` and cannot: it classifies, and the CLI maps. The
 * `exitCode` field is that mapping, held next to the condition it describes so
 * the two cannot drift.
 */

/**
 * Every enumerated contract violation in ADR-0002 section 5, plus the memo and
 * template violations sections 6 and 11 add.
 *
 * This is a closed union on purpose. "Rejection is an enumerated contract
 * violation" is only true if the enumeration exists somewhere a test can read
 * it, and a free-form message is not that.
 */
export type ContractViolationCode =
  /** An outcome naming an assertion the rule does not declare. */
  | "unknown-assertion"
  /** An assertion declared for a different mode than the active one. */
  | "assertion-mode-mismatch"
  /**
   * A `compatibility` assertion evaluated outside `compat` mode, or a
   * `normative`, `recommended` or `advisory` assertion evaluated in it.
   */
  | "assertion-class-mode-mismatch"
  /** More than one outcome for the same assertion in one run. */
  | "duplicate-assertion-outcome"
  /** A declared assertion for the active mode with no outcome. */
  | "missing-assertion-outcome"
  /** An invoked rule returned zero outcomes. */
  | "no-outcomes"
  /** An outcome set mixing `not-present` with an evaluated outcome kind. */
  | "mixed-not-present"
  /** The rule's metadata claims a stronger class than the ruleset declares. */
  | "assertion-class-escalated"
  /** A `commerce-endpoint-required` rule returned an outcome with no endpoint. */
  | "commerce-endpoint-absent"
  /** A round-two batch larger than `metadata.roundTwoBudget`. */
  | "round-two-budget-exceeded"
  /** A parameter the assertion does not declare. */
  | "undeclared-parameter"
  /** A parameter of the wrong kind. */
  | "parameter-kind-mismatch"
  /** A parameter value failing its kind's grammar. */
  | "parameter-grammar"
  /** A parameter value outside its declared allowlist. */
  | "parameter-not-allowed-value"
  /** A required parameter absent from an outcome. */
  | "missing-required-parameter"
  /** An `excerpt` on an assertion the ruleset does not authorize to carry one. */
  | "unauthorized-excerpt"
  /** A rule-local request id reused anywhere in that rule's scan. */
  | "duplicate-request-id"
  /** A rule-local id naming no request in a completed round. */
  | "unknown-observation-ref"
  /** A memo value that is not acyclic plain data with an approved prototype. */
  | "memo-value-rejected"
  /** A memo key outside the compile-time list. */
  | "unknown-memo-key"
  /** No message template for an assertion and outcome kind. */
  | "missing-message-template"
  /** A template placeholder with no matching parameter. */
  | "missing-template-parameter";

/**
 * ADR-0002 section 5. Exit code 4.
 *
 * A rule broke the contract the core validates. The scan is discarded rather
 * than reported: a report built from a rule that returned nothing, or that
 * omitted the assertion it would have failed, looks plausible and is wrong.
 */
export class RuleContractViolation extends Error {
  readonly exitCode = 4;
  readonly code: ContractViolationCode;

  constructor(code: ContractViolationCode, message: string) {
    super(message);
    this.name = "RuleContractViolation";
    this.code = code;
  }
}

/**
 * Every configuration or pinned-artifact condition that stops a scan before a
 * socket opens.
 *
 * The ruleset-integrity members are here rather than in a class of their own
 * because they have the same consequence for a caller: exit 2, no transport
 * call, and nothing to retry. What separates them is the message.
 */
export type ConfigurationErrorCode =
  /** ADR-0005 section 1: `maxConcurrency` above 1 is refused, never clamped. */
  | "concurrency-unsupported"
  /** ADR-0004 section 10. */
  | "commerce-profile-unavailable"
  /** ADR-0004 section 5: an unknown or malformed selector element. */
  | "invalid-selector"
  /** ADR-0004 section 6: `--include` naming a `planned` rule. */
  | "include-unimplemented-rule"
  /** ADR-0004 section 8: an option key the rule does not declare. */
  | "unknown-rule-option"
  /** ADR-0004 section 8: an option value no `EffectiveOptionValue` kind fits. */
  | "unrepresentable-rule-option"
  /** ADR-0005 section 5: more than 999 reservations. */
  | "evidence-ceiling-exceeded"
  /** Two rules in the registry share a `rule_id`. */
  | "duplicate-rule-id"
  /** ADR-0002 section 6: the assertion declares no authoritative source. */
  | "assertion-sources-unassigned"
  /** A selected rule declares no assertion for the active mode. */
  | "no-assertion-for-mode"
  /** An assertion the rule declares that the pinned ruleset does not. */
  | "assertion-not-in-ruleset"
  /** An assertion `sourceRefs` entry that the source ledger does not resolve. */
  | "unresolved-source-ref"
  /** ADR-0007 section 3: an assertion that can derive `fail` or `warning` and has no remediation entry. */
  | "remediation-missing";

/** Exit code 2. Raised before any transport call, always. */
export class ConfigurationError extends Error {
  readonly exitCode = 2;
  readonly code: ConfigurationErrorCode;

  constructor(code: ConfigurationErrorCode, message: string) {
    super(message);
    this.name = "ConfigurationError";
    this.code = code;
  }
}
