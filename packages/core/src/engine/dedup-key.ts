import { canonicalizeJson } from "../schema/canonical-json.js";
import type { NetworkProfileId, NetworkScope } from "../model/status.js";

/**
 * ADR-0005 section 3. The complete canonical request key, in full.
 *
 * The key is what decides both deduplication and slot reservation, so a
 * component missing from it is a component two different requests can differ
 * by while sharing one dispatch. `docs/ARCHITECTURE.md` section 7 previously
 * named a singular "body limit"; `HttpObservationRequest` carries
 * `maxEncodedBytes` **and** `maxDecodedBytes`, so under that key the rule that
 * lowered one limit would have been handed the other rule's larger, or
 * truncated, response. That is a security defect and not a tidiness one, which
 * is why both limits are here and why a test asserts each of them separately.
 *
 * The key is built by canonicalizing a JSON object (RFC 8785) rather than by
 * joining strings with a separator. Concatenation makes the key a function of
 * a separator that can appear inside a component; JCS escapes and length-
 * delimits every string, so no component can impersonate another.
 */

export interface HttpRequestKeyInput {
  readonly kind: "http";
  readonly method: "GET" | "HEAD";
  /** The effective URL from `canonicalUrl`: fragment removed. */
  readonly url: string;
  /**
   * Every representation-affecting request header, field name lowercased.
   * For M1 that set is exactly `accept`; it is modeled as a multi-valued map
   * so that adding a second such header later cannot create a silent
   * collision.
   */
  readonly representationHeaders: ReadonlyMap<string, readonly string[]>;
  readonly redirects: "follow-same-origin" | "reject";
  /** Effective values, after the ADR-0004 section 9 minimum across sources. */
  readonly maxRedirects: number;
  readonly maxEncodedBytes: number;
  readonly maxDecodedBytes: number;
  readonly scope: NetworkScope;
  readonly networkProfile: NetworkProfileId;
}

export interface DnsRequestKeyInput {
  readonly kind: "dns";
  readonly name: string;
  readonly recordType: string;
  readonly scope: NetworkScope;
  readonly networkProfile: NetworkProfileId;
}

/**
 * A discovered request the origin policy refused, keyed so that two rules
 * refused for the same reason on the same URL share one evidence entry.
 *
 * ADR-0005 section 3 defines no key for this case because a refused request is
 * never dispatched and reserves no slot; it still needs an identity, because
 * ADR-0002 section 7 requires it to reach the report as a typed error.
 */
export interface RejectedRequestKeyInput {
  readonly kind: "rejected";
  readonly raw: string;
  readonly reason: string;
}

export type RequestKeyInput =
  HttpRequestKeyInput | DnsRequestKeyInput | RejectedRequestKeyInput;

/**
 * Field name lowercased, entries sorted by name, optional whitespace trimmed,
 * repeated fields kept as an ordered value list.
 */
function normalizeHeaders(
  headers: ReadonlyMap<string, readonly string[]>,
): readonly (readonly [string, readonly string[]])[] {
  return [...headers]
    .map(
      ([name, values]) =>
        [name.toLowerCase(), values.map((value) => value.trim())] as const,
    )
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
}

export function canonicalRequestKey(input: RequestKeyInput): string {
  switch (input.kind) {
    case "http":
      return canonicalizeJson({
        kind: "http",
        method: input.method,
        url: input.url,
        headers: normalizeHeaders(input.representationHeaders).map(
          ([name, values]) => [name, [...values]],
        ),
        redirects: input.redirects,
        maxRedirects: input.maxRedirects,
        maxEncodedBytes: input.maxEncodedBytes,
        maxDecodedBytes: input.maxDecodedBytes,
        scope: input.scope,
        networkProfile: input.networkProfile,
      });
    case "dns":
      return canonicalizeJson({
        kind: "dns",
        name: input.name.toLowerCase(),
        recordType: input.recordType,
        scope: input.scope,
        networkProfile: input.networkProfile,
      });
    case "rejected":
      return canonicalizeJson({
        kind: "rejected",
        raw: input.raw,
        reason: input.reason,
      });
  }
}
