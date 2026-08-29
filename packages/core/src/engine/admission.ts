import { ConfigurationError } from "../model/contract-violation.js";
import type { ObservationFailure } from "../model/observation-error.js";
import type { DiscoveredRejection } from "../model/observation.js";
import { MAX_EVIDENCE_ENTRIES } from "./scan-budget.js";

/**
 * ADR-0005 sections 2, 4 and 5. Which observation is denied is decided before
 * the first socket opens, and an evidence id is not a reservation.
 *
 * Those are two separate numbering schemes and conflating them was the defect
 * this file exists to avoid. A reservation is an anonymous unit of capacity,
 * held before any round-two URL exists. An evidence id names a concrete
 * canonical request. One is known earlier than the other, so they cannot share
 * a numbering.
 */

export interface ResolvedHttpRequest {
  readonly kind: "http";
  readonly method: "GET" | "HEAD";
  readonly url: string;
  readonly headers: ReadonlyMap<string, readonly string[]>;
  readonly redirects: "follow-same-origin" | "reject";
  readonly maxRedirects: number;
  readonly maxEncodedBytes: number;
  readonly maxDecodedBytes: number;
}

export interface ResolvedDnsRequest {
  readonly kind: "dns";
  readonly name: string;
  readonly recordType: string;
}

/** A discovered request the ADR-0002 section 7 origin policy refused. */
export interface RefusedRequest {
  readonly kind: "refused";
  readonly raw: string;
  readonly reason: DiscoveredRejection;
}

export type ResolvedRequest =
  ResolvedHttpRequest | ResolvedDnsRequest | RefusedRequest;

export interface PlannedObservation {
  readonly evidenceId: string;
  readonly key: string;
  readonly request: ResolvedRequest;
  /**
   * `null` means dispatch it. Anything else is materialized immediately as an
   * error observation and no socket is opened for it.
   */
  readonly failure: ObservationFailure | null;
}

interface PendingObservation {
  readonly key: string;
  readonly request: ResolvedRequest;
  readonly failure: ObservationFailure | null;
}

function evidenceId(ordinal: number): string {
  // ADR-0005 section 5: `ev-` plus a three-digit zero-padded decimal, which is
  // what keeps the lexical sort equal to the numeric one.
  return `ev-${String(ordinal).padStart(3, "0")}`;
}

/**
 * Accumulates one round's canonical plan, then freezes it and numbers it.
 *
 * Deduplication is per round, as ADR-0005 section 4 and ADR-0002 section 8
 * both state, so the key map is cleared at each round boundary. That is the
 * literal reading of both decisions and it keeps the reservation accounting
 * exactly as ADR-0005 section 2 describes: a round-two request draws from its
 * rule's own reserved capacity whether or not round one happened to fetch the
 * same URL.
 */
export class ObservationPlanner {
  #assigned = 0;
  #pending: PendingObservation[] = [];
  #byKey = new Map<string, number>();

  beginRound(): void {
    this.#pending = [];
    this.#byKey.clear();
  }

  /**
   * Places one request into this round's plan and returns the index of the
   * canonical entry it landed on.
   *
   * `reserve` is called only when the key is new, and only its return value
   * decides admission. Every rule-local id that canonicalizes onto an existing
   * key becomes an alias for it and reserves nothing, which is why the shared
   * robots observation costs one slot and not three.
   */
  place(
    key: string,
    request: ResolvedRequest,
    reserve: () => boolean,
    refusal: ObservationFailure | null,
  ): number {
    const existing = this.#byKey.get(key);
    if (existing !== undefined) return existing;

    const index = this.#pending.length;
    if (refusal !== null) {
      // A refused request never becomes a request, so it reserves no slot.
      this.#pending.push({ key, request, failure: refusal });
    } else if (reserve()) {
      this.#pending.push({ key, request, failure: null });
    } else {
      this.#pending.push({
        key,
        request,
        failure: { code: "request-slot-budget-exceeded", phase: "policy" },
      });
    }
    this.#byKey.set(key, index);
    return index;
  }

  /**
   * ADR-0005 section 4: once the round's plan is stable, evidence ids are
   * assigned in that order, continuing the sequence from the previous round.
   *
   * The numbering is a separate pass rather than a counter incremented inside
   * `place` so that the ordering property is visible in one place: nothing is
   * renumbered, because a round's plan is frozen before the next round's rules
   * run.
   */
  sealRound(): readonly PlannedObservation[] {
    const sealed = this.#pending.map((entry) => {
      this.#assigned += 1;
      if (this.#assigned > MAX_EVIDENCE_ENTRIES) {
        throw new ConfigurationError(
          "evidence-ceiling-exceeded",
          `the plan needs more than ${String(MAX_EVIDENCE_ENTRIES)} evidence entries, which the fixed-width ev-NNN form cannot express (ADR-0005 section 5)`,
        );
      }
      return {
        evidenceId: evidenceId(this.#assigned),
        key: entry.key,
        request: entry.request,
        failure: entry.failure,
      };
    });
    this.#pending = [];
    this.#byKey.clear();
    return sealed;
  }
}

/**
 * The whole-scan request-slot pool, drawn down in stable registry order.
 *
 * ADR-0005 section 2: when the plan exceeds the budget, the requests later in
 * that stable order are denied. Registry order is therefore a scarce-resource
 * priority order, which is a real editorial responsibility on the registry and
 * not an implementation detail.
 */
export class RequestSlotPool {
  #remaining: number;

  constructor(maxRequests: number) {
    this.#remaining = maxRequests;
  }

  get remaining(): number {
    return this.#remaining;
  }

  /** Takes one slot if any is left. Returns whether it was granted. */
  take(): boolean {
    if (this.#remaining <= 0) return false;
    this.#remaining -= 1;
    return true;
  }

  /**
   * Reserves up to `count` anonymous slots for one rule's round two.
   *
   * Reserved-but-unused capacity is not returned to the pool during the run.
   * Returning it would make a later rule's capacity depend on when an earlier
   * rule finished, which is completion order back in the report.
   */
  reserve(count: number): number {
    const granted = Math.min(count, this.#remaining);
    this.#remaining -= granted;
    return granted;
  }
}
