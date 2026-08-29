import type { RedirectFact, TransportReason } from "@agentready-lab/core";

import type {
  AuthorizationResult,
  LocalLoopbackPolicy,
} from "./network-policy.js";
import { applyUrlPolicy } from "./url-policy.js";
import type { CanonicalTarget } from "./url-policy.js";

/**
 * Manual redirect handling, `docs/THREAT_MODEL.md` section 13.
 *
 * Automatic redirects are disabled at the connector, so every hop is a
 * decision this module makes and a fresh request `safe-fetcher.ts` issues. The
 * three properties that matter are all consequences of that:
 *
 * - the full policy runs again on every hop, because the next request is built
 *   from a `CanonicalTarget` this module produced, not from a `Location`
 *   string handed to a client that resolves it its own way;
 * - a hop body is never read, because the caller destroys it before asking for
 *   the next hop; and
 * - `Refresh`, HTML meta-refresh and `103 Early Hints` cannot cause a request,
 *   because nothing here reads them and no other code path can start one.
 *   That last one is worth stating as a structural fact rather than a check:
 *   there is no branch to disable.
 */

/** The five status codes that mean "go somewhere else" for a GET or HEAD. */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);

export function isRedirectStatus(status: number): boolean {
  return REDIRECT_STATUSES.has(status);
}

/**
 * A status that must never be followed or treated as a response.
 *
 * `101` is the switch-protocols handshake, and section 13 requires it, CONNECT
 * tunnels and WebSocket upgrades to be rejected. The MVP sends no `Upgrade`
 * request header, so a `101` here means the server invented one.
 */
export function isUpgradeStatus(status: number): boolean {
  return status === 101;
}

export type HopDecision =
  | {
      readonly kind: "follow";
      readonly target: CanonicalTarget;
      /**
       * The address the next connection is pinned to, from the same policy
       * evaluation that approved the hop. Carried rather than recomputed so
       * that the address the fetcher connects to is provably the address the
       * decision was made about.
       */
      readonly authorization: Extract<
        AuthorizationResult,
        { readonly kind: "authorized" }
      >;
      readonly fact: RedirectFact;
    }
  | {
      readonly kind: "blocked";
      readonly reason: TransportReason;
      readonly fact: RedirectFact;
    };

export interface HopInput {
  readonly policy: LocalLoopbackPolicy;
  /** The canonical URL this hop's response came from. */
  readonly current: CanonicalTarget;
  readonly status: number;
  /** Every `Location` field value, in order. Normally exactly one. */
  readonly locations: readonly string[];
  readonly hopsTaken: number;
  readonly maxHops: number;
  /** Canonical hrefs already requested in this observation, including the first. */
  readonly visited: ReadonlySet<string>;
}

function fact(
  status: number,
  location: string,
  decision: "followed" | "blocked",
): RedirectFact {
  return { status, location, decision };
}

/**
 * Decides one hop.
 *
 * Order is deliberate. The hop limit is checked before the `Location` is even
 * parsed, so a chain that has run out of budget cannot be extended by a
 * malformed target; and the loop check runs last, after the policy has already
 * approved the destination, so a cycle is reported as a cycle rather than
 * shadowed by a policy refusal that happens to fire first.
 */
export function planNextHop(input: HopInput): HopDecision {
  const raw = input.locations[0] ?? "";

  if (input.hopsTaken >= input.maxHops) {
    return {
      kind: "blocked",
      reason: { code: "redirect-limit", phase: "redirect" },
      fact: fact(input.status, raw, "blocked"),
    };
  }

  // Zero `Location` fields on a 3xx is a response with nowhere to go; more
  // than one is two destinations, and picking either is a guess.
  if (input.locations.length !== 1) {
    return {
      kind: "blocked",
      reason: { code: "redirect-blocked", phase: "redirect" },
      fact: fact(input.status, raw, "blocked"),
    };
  }

  const resolved = applyUrlPolicy(raw, input.current.href);
  if (resolved.kind === "rejected") {
    return {
      kind: "blocked",
      reason: { code: "redirect-blocked", phase: "redirect" },
      fact: fact(input.status, raw, "blocked"),
    };
  }
  const target = resolved.target;

  // Section 13: "reject HTTPS-to-HTTP downgrade by default". Under the
  // exact-origin rule this is already unreachable, because a scheme change is
  // an origin change. It is checked anyway so that the rule is stated where a
  // future profile with a wider origin policy will read it.
  if (input.current.protocol === "https:" && target.protocol === "http:") {
    return {
      kind: "blocked",
      reason: { code: "redirect-blocked", phase: "redirect" },
      fact: fact(input.status, target.href, "blocked"),
    };
  }

  const authorized = input.policy.authorize(target, "redirect");
  if (authorized.kind === "blocked") {
    return {
      kind: "blocked",
      reason: authorized.reason,
      fact: fact(input.status, target.href, "blocked"),
    };
  }

  if (input.visited.has(target.href)) {
    return {
      kind: "blocked",
      reason: { code: "redirect-blocked", phase: "redirect" },
      fact: fact(input.status, target.href, "blocked"),
    };
  }

  return {
    kind: "follow",
    target,
    authorization: authorized,
    fact: fact(input.status, target.href, "followed"),
  };
}
