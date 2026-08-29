import { ConfigurationError } from "../model/contract-violation.js";

/**
 * The resource budgets of `docs/THREAT_MODEL.md` section 16, and the one rule
 * that governs how they combine.
 *
 * ADR-0004 section 9: "for every security budget in
 * `docs/THREAT_MODEL.md` section 16, the effective value is the **minimum**
 * across all sources. Configuration and rule options may lower a budget and
 * may never raise it. There is no ordering under which a config file widens a
 * security boundary." That is why `lowerBudget` takes a minimum rather than an
 * override: precedence is for choices, and a security ceiling is not one.
 */

export interface NetworkBudget {
  readonly maxRequests: number;
  readonly maxConcurrency: number;
  readonly maxRedirects: number;
  readonly dnsTimeoutMs: number;
  readonly connectTimeoutMs: number;
  readonly perRequestTimeoutMs: number;
  readonly maxEncodedResponseBytes: number;
  readonly maxDecodedResponseBytes: number;
  readonly maxTotalEncodedBytes: number;
  readonly maxTotalDecodedBytes: number;
}

/** `docs/THREAT_MODEL.md` section 16 and `docs/ARCHITECTURE.md` section 10. */
export const DEFAULT_NETWORK_BUDGET: NetworkBudget = {
  maxRequests: 24,
  // ADR-0005 section 1 pins this at 1 for M1. THREAT_MODEL section 16's
  // "Concurrent requests: 2" stays as the ceiling; the minimum-across-sources
  // rule is what makes pinning 1 permitted without a threat-model change.
  maxConcurrency: 1,
  maxRedirects: 5,
  dnsTimeoutMs: 2000,
  connectTimeoutMs: 3000,
  perRequestTimeoutMs: 10000,
  maxEncodedResponseBytes: 1048576,
  maxDecodedResponseBytes: 2097152,
  maxTotalEncodedBytes: 4194304,
  maxTotalDecodedBytes: 8388608,
};

/** ADR-0005 section 5: the fixed-width `ev-NNN` form has a hard ceiling. */
export const MAX_EVIDENCE_ENTRIES = 999;

/** Field-wise minimum. Never a field-wise override. */
export function lowerBudget(
  base: NetworkBudget,
  requested: Partial<NetworkBudget>,
): NetworkBudget {
  const pick = (key: keyof NetworkBudget): number => {
    const asked = requested[key];
    return asked === undefined ? base[key] : Math.min(base[key], asked);
  };
  return {
    maxRequests: pick("maxRequests"),
    maxConcurrency: pick("maxConcurrency"),
    maxRedirects: pick("maxRedirects"),
    dnsTimeoutMs: pick("dnsTimeoutMs"),
    connectTimeoutMs: pick("connectTimeoutMs"),
    perRequestTimeoutMs: pick("perRequestTimeoutMs"),
    maxEncodedResponseBytes: pick("maxEncodedResponseBytes"),
    maxDecodedResponseBytes: pick("maxDecodedResponseBytes"),
    maxTotalEncodedBytes: pick("maxTotalEncodedBytes"),
    maxTotalDecodedBytes: pick("maxTotalDecodedBytes"),
  };
}

/**
 * ADR-0005 section 1. A configuration that asks for concurrency above 1 exits
 * 2 rather than being silently ignored, "because a user who configured
 * concurrency and did not get it should be told".
 *
 * This is deliberately not folded into `lowerBudget`: a minimum would clamp 2
 * to 1 in silence, which is the behaviour the ADR rejects.
 */
export function assertSupportedConcurrency(requested: number): void {
  if (requested !== 1) {
    throw new ConfigurationError(
      "concurrency-unsupported",
      `network.maxConcurrency is ${String(requested)}; ADR-0005 section 1 pins it at 1 for M1, and a higher value is refused rather than clamped`,
    );
  }
}

/**
 * The whole-scan byte budgets, consumed in dispatch order.
 *
 * Serial dispatch is what makes "the scan's remaining bytes" a well-defined
 * number at dispatch time (ADR-0003 section 4), so this holds two counters and
 * no reservation logic at all.
 */
export class ScanByteLedger {
  #remainingEncoded: number;
  #remainingDecoded: number;

  constructor(budget: NetworkBudget) {
    this.#remainingEncoded = budget.maxTotalEncodedBytes;
    this.#remainingDecoded = budget.maxTotalDecodedBytes;
  }

  get remainingEncoded(): number {
    return this.#remainingEncoded;
  }

  get remainingDecoded(): number {
    return this.#remainingDecoded;
  }

  consume(encodedBytes: number, decodedBytes: number): void {
    this.#remainingEncoded = Math.max(0, this.#remainingEncoded - encodedBytes);
    this.#remainingDecoded = Math.max(0, this.#remainingDecoded - decodedBytes);
  }
}
