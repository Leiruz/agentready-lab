/**
 * `docs/IMPLEMENTATION_SPEC.md` section 10.1. The exit-code contract.
 *
 * Core does not call `process.exit` and cannot (`contract-violation.ts`): it
 * classifies and this package maps. The mapping lives here, in one object, so
 * that a command cannot invent a sixth code and a reader can see all five at
 * once.
 */
export const EXIT = {
  /** Completed with no failure under the selected strictness policy. */
  ok: 0,
  /**
   * Completed, and at least one `enforced` rule failed, or strict mode
   * promoted a warning or an unable result.
   */
  findings: 1,
  /**
   * Invalid arguments, configuration, profile, selector, or an unsupported
   * combination. Always decided before a request is issued.
   */
  configuration: 2,
  /**
   * The scan as a whole could not safely continue.
   *
   * Nothing in this build produces it, and that is a statement about core
   * rather than about this file. `runScan` has no whole-scan deadline, no
   * abort signal and no path that stops a started scan: a transport failure
   * becomes an `unable-to-check` finding (ADR-0003), and an exhausted request
   * budget becomes a refused reservation, not a scan-level stop. The code is
   * declared because the contract enumerates it, and it is left unreachable
   * rather than given an invented trigger, because a 3 that this CLI decided
   * on its own would be a claim about the scan that no component made.
   */
  aborted: 3,
  /**
   * An internal invariant was violated. `RuleContractViolation` carries this
   * code on the class itself, which is the only thing that produces it.
   */
  internal: 4,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
