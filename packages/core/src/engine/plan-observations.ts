import { RuleContractViolation } from "../model/contract-violation.js";
import type { ObservationFailure } from "../model/observation-error.js";
import type {
  DiscoveredProvenance,
  ObservationRequest,
} from "../model/observation.js";
import type { AnyRuleDefinition, TargetDescriptor } from "../model/rule.js";
import type { NetworkProfileId } from "../model/status.js";
import type {
  ObservationPlanner,
  PlannedObservation,
  RequestSlotPool,
  ResolvedRequest,
} from "./admission.js";
import { authorizeDiscoveredUrl, canonicalUrl } from "./canonical-url.js";
import { canonicalRequestKey } from "./dedup-key.js";
import type { NetworkBudget } from "./scan-budget.js";
import { claimRequestId } from "./validate-outcomes.js";

/**
 * ADR-0002 sections 1 and 8, and ADR-0005 section 2. The two engine-driven
 * rounds, planned before anything is dispatched.
 *
 * Round one is every selected rule's `plan()`, walked in stable registry order
 * and in each rule's declaration order. The whole of it exists before the
 * first socket opens, which is what makes the M0 criterion "invalid
 * configuration performs no transport call" and the shared robots observation
 * possible at all. Round two is the single follow-up batch a rule may return
 * from `step()`; there is no third round.
 */

export interface PlanningContext {
  readonly target: TargetDescriptor;
  readonly budget: NetworkBudget;
  readonly networkProfile: NetworkProfileId;
}

/** Per-rule state that spans both rounds. */
export interface RuleRuntimeState {
  readonly ruleId: string;
  /** ADR-0002 section 8: request ids are unique per rule for the whole scan. */
  readonly claimedIds: Set<string>;
  /** Rule-local request id to the evidence id it canonicalized onto. */
  readonly aliases: Map<string, string>;
  /** Anonymous round-two capacity, reserved during the round-one walk. */
  roundTwoSlots: number;
}

export function createRuleState(ruleId: string): RuleRuntimeState {
  return {
    ruleId,
    claimedIds: new Set<string>(),
    aliases: new Map<string, string>(),
    roundTwoSlots: 0,
  };
}

/**
 * Answers whether a rule-local id names a completed, non-error observation
 * belonging to that same rule. ADR-0002 section 7's first rejection.
 */
export type ProvenanceResolver = (
  state: RuleRuntimeState,
  provenance: DiscoveredProvenance,
) => boolean;

export interface PlannableRule {
  readonly definition: AnyRuleDefinition;
  readonly state: RuleRuntimeState;
  readonly requests: readonly ObservationRequest[];
}

/**
 * A rule may lower a limit and may never raise one (ADR-0004 section 9).
 *
 * A value that is not a whole non-negative number is treated as "no request",
 * not as a request for something larger: a `NaN` reaching the dedup key would
 * make the key unequal to itself, and a negative cap would be a smaller number
 * that means nothing.
 */
function effectiveLimit(requested: number, ceiling: number): number {
  if (!Number.isInteger(requested) || requested < 0) return ceiling;
  return Math.min(requested, ceiling);
}

function targetHost(target: TargetDescriptor): string {
  const parsed = URL.parse(target.origin);
  return parsed === null ? "" : parsed.hostname;
}

interface Resolution {
  readonly request: ResolvedRequest;
  readonly key: string;
  readonly refusal: ObservationFailure | null;
}

/**
 * Turns one rule-declared request into the canonical request the engine will
 * dispatch, or into a typed refusal.
 *
 * The rule does not decide whether a discovered URL is authorized. It says
 * where the URL came from, and the engine decides (ADR-0002 section 7).
 *
 * `state` and `provenanceResolver` are optional because they are read on
 * exactly one code path: deciding whether a *discovered* URL or DNS name has
 * acceptable provenance. A `page`, `origin-path`, `target-host` or
 * `target-host-prefixed` request never consults either, so a caller that only
 * wants the canonical key for one of those had to fabricate a rule state to
 * satisfy the signature. Omitting them is fail-closed rather than permissive:
 * with no resolver there is nothing that can vouch for a discovered URL, so
 * provenance reads as unresolved and the request is refused exactly as an
 * unknown-provenance one is.
 */
export function resolveObservationRequest(
  request: ObservationRequest,
  context: PlanningContext,
  state?: RuleRuntimeState,
  provenanceResolver?: ProvenanceResolver,
): Resolution {
  const scope = context.target.scope;
  const profile = context.networkProfile;
  const vouched = (provenance: DiscoveredProvenance): boolean =>
    state !== undefined && provenanceResolver?.(state, provenance) === true;

  if (request.kind === "dns") {
    const host = targetHost(context.target);
    let name: string;
    if (request.name.kind === "target-host") {
      name = host;
    } else if (request.name.kind === "target-host-prefixed") {
      name = `${request.name.prefix}.${host}`;
    } else {
      if (!vouched(request.name.provenance)) {
        return {
          request: {
            kind: "refused",
            raw: request.name.name,
            reason: "unknown-provenance",
          },
          key: canonicalRequestKey({
            kind: "rejected",
            raw: request.name.name,
            reason: "unknown-provenance",
          }),
          refusal: { code: "invalid-url", phase: "policy" },
        };
      }
      name = request.name.name;
    }
    const resolved: ResolvedRequest = {
      kind: "dns",
      name,
      recordType: request.recordType,
    };
    return {
      request: resolved,
      key: canonicalRequestKey({
        kind: "dns",
        name,
        recordType: request.recordType,
        scope,
        networkProfile: profile,
      }),
      refusal: null,
    };
  }

  let url: string | null;
  if (request.target.kind === "page") {
    url = canonicalUrl(context.target.pageUrl);
  } else if (request.target.kind === "origin-path") {
    url = canonicalUrl(`${context.target.origin}${request.target.path}`);
  } else {
    const origin = URL.parse(context.target.origin);
    const decision = authorizeDiscoveredUrl(
      request.target.url,
      vouched(request.target.provenance),
      {
        authorizedOrigin: origin === null ? "" : origin.origin,
        authorizedPort: origin === null ? "" : origin.port,
      },
    );
    if (decision.kind === "rejected") {
      return {
        request: {
          kind: "refused",
          raw: request.target.url,
          reason: decision.reason,
        },
        key: canonicalRequestKey({
          kind: "rejected",
          raw: request.target.url,
          reason: decision.reason,
        }),
        // ADR-0002 section 7: a rejected request becomes an error observation
        // with the public code `url-policy-blocked`, which is what
        // `invalid-url` projects to (ADR-0003 section 4).
        refusal: { code: "invalid-url", phase: "policy" },
      };
    }
    url = decision.url;
  }

  if (url === null) {
    return {
      request: { kind: "refused", raw: "", reason: "malformed" },
      key: canonicalRequestKey({
        kind: "rejected",
        raw: "",
        reason: "malformed",
      }),
      refusal: { code: "invalid-url", phase: "policy" },
    };
  }

  const headers = new Map<string, readonly string[]>([
    ["accept", [request.accept]],
  ]);
  const maxEncodedBytes = effectiveLimit(
    request.maxEncodedBytes,
    context.budget.maxEncodedResponseBytes,
  );
  const maxDecodedBytes = effectiveLimit(
    request.maxDecodedBytes,
    context.budget.maxDecodedResponseBytes,
  );

  const resolved: ResolvedRequest = {
    kind: "http",
    method: request.method,
    url,
    headers,
    redirects: request.redirects,
    maxRedirects: context.budget.maxRedirects,
    maxEncodedBytes,
    maxDecodedBytes,
  };

  return {
    request: resolved,
    key: canonicalRequestKey({
      kind: "http",
      method: request.method,
      url,
      representationHeaders: headers,
      redirects: request.redirects,
      maxRedirects: context.budget.maxRedirects,
      maxEncodedBytes,
      maxDecodedBytes,
      scope,
      networkProfile: profile,
    }),
    refusal: null,
  };
}

function placeAll(
  rules: readonly PlannableRule[],
  context: PlanningContext,
  planner: ObservationPlanner,
  provenanceResolver: ProvenanceResolver,
  reserve: (rule: PlannableRule) => boolean,
  afterRule?: (rule: PlannableRule) => void,
): readonly PlannedObservation[] {
  planner.beginRound();
  const placements: { rule: PlannableRule; localId: string; index: number }[] =
    [];

  for (const rule of rules) {
    for (const request of rule.requests) {
      claimRequestId(rule.state.ruleId, rule.state.claimedIds, request.id);
      const resolution = resolveObservationRequest(
        request,
        context,
        rule.state,
        provenanceResolver,
      );
      const index = planner.place(
        resolution.key,
        resolution.request,
        () => reserve(rule),
        resolution.refusal,
      );
      placements.push({ rule, localId: request.id, index });
    }
    afterRule?.(rule);
  }

  const sealed = planner.sealRound();
  for (const placement of placements) {
    const entry = sealed[placement.index];
    if (entry === undefined) continue;
    placement.rule.state.aliases.set(placement.localId, entry.evidenceId);
  }
  return sealed;
}

/**
 * ADR-0005 section 2, steps 1 to 6.
 *
 * Each rule's round-two capacity is reserved in this same walk, from the same
 * total, so one rule's discovery activity can never consume another rule's
 * capacity. Reserving it here rather than when round two arrives is what makes
 * the whole allocation a function of the plan instead of a race.
 */
export function planRoundOne(
  rules: readonly PlannableRule[],
  context: PlanningContext,
  planner: ObservationPlanner,
  pool: RequestSlotPool,
  provenanceResolver: ProvenanceResolver,
): readonly PlannedObservation[] {
  return placeAll(
    rules,
    context,
    planner,
    provenanceResolver,
    () => pool.take(),
    (rule) => {
      rule.state.roundTwoSlots = pool.reserve(
        Math.max(0, rule.definition.metadata.roundTwoBudget),
      );
    },
  );
}

/**
 * ADR-0002 section 5: a round-two batch larger than `roundTwoBudget` is a
 * contract violation and exits 4. It is not silently truncated, because a
 * truncated batch produces a report that looks complete.
 */
export function planRoundTwo(
  rules: readonly PlannableRule[],
  context: PlanningContext,
  planner: ObservationPlanner,
  provenanceResolver: ProvenanceResolver,
): readonly PlannedObservation[] {
  for (const rule of rules) {
    const budget = rule.definition.metadata.roundTwoBudget;
    if (rule.requests.length > budget) {
      throw new RuleContractViolation(
        "round-two-budget-exceeded",
        `${rule.state.ruleId} returned ${String(rule.requests.length)} round-two requests against a roundTwoBudget of ${String(budget)}`,
      );
    }
  }
  return placeAll(rules, context, planner, provenanceResolver, (rule) => {
    if (rule.state.roundTwoSlots <= 0) return false;
    rule.state.roundTwoSlots -= 1;
    return true;
  });
}
