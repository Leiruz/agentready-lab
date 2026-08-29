/**
 * The status, class, mode and profile vocabularies.
 *
 * Every member here is public contract: `.claude/rules/standards.md` fixes the
 * six rule statuses and the three interpretation modes, ADR-0002 section 4
 * fixes the four requirement classes and the four applicability values, and
 * ADR-0004 section 2 fixes the native applicability names.
 */

/** ADR-0002 section 4. */
export type RuleStatus =
  | "pass"
  | "fail"
  | "warning"
  | "not-applicable"
  | "unable-to-check"
  | "unsupported-runtime";

/**
 * ADR-0002 section 4. `compatibility` is a fourth member and not a synonym for
 * `normative`: ADR-0002 section 9 keeps the two identifier spaces apart so a
 * compatibility verdict can never be read as a specification verdict.
 */
export type RequirementClass =
  "normative" | "recommended" | "advisory" | "compatibility";

/**
 * ADR-0002 section 4 names this `InterpretationMode`, and that name is kept
 * rather than shortened to `Mode`: a second exported name for one type is two
 * things that must stay equal and can only disagree.
 */
export type InterpretationMode = "spec" | "compat" | "interop";

export type ObservationRuntime = "http" | "dns" | "browser";

export type ImplementationStatus =
  "planned" | "experimental" | "supported" | "deprecated" | "removed";

/** ADR-0004 section 2: the native names, not the snapshot's published ones. */
export type RuleApplicability =
  "applicable" | "informational" | "optional" | "commerce-endpoint-required";

/** The `profiles` enum of `specs/ruleset.schema.json`. */
export type ProfileId =
  "content" | "api" | "agent-service" | "commerce" | "full";

/**
 * `docs/ARCHITECTURE.md` section 9 keeps `hosted-public` in the report and in
 * `PublicNetworkPolicy.id` although no flag selects it. ADR-0008 section 6
 * records that inconsistency deliberately.
 */
export type NetworkProfileId = "local-loopback" | "ci-public" | "hosted-public";

/**
 * ADR-0002 section 4 removed `hosted-public` from the rule-facing target
 * descriptor, so the two vocabularies are related but not equal.
 */
export type ObservableNetworkProfileId = Exclude<
  NetworkProfileId,
  "hosted-public"
>;

export type NetworkScope = "local" | "remote";

/** ADR-0002 section 4. What a rule reports about one assertion. */
export type OutcomeKind =
  "satisfied" | "violated" | "not-present" | "indeterminate";

/** ADR-0004 section 4. Only an `enforced` result reaches the exit code. */
export type ResultGate = "enforced" | "informational";
