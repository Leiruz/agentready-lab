import type {
  DiscoveredDecision,
  DiscoveredRejection,
} from "../model/observation.js";

/**
 * URL canonicalization and the discovered-URL origin policy.
 *
 * One WHATWG parser decides both the policy question and the string that is
 * actually requested (`docs/THREAT_MODEL.md` section 11: never validate with
 * one parser and send another's output).
 */

/** `docs/THREAT_MODEL.md` section 16: raw target URL, 2,048 UTF-8 bytes. */
export const MAX_URL_BYTES = 2048;

const PERCENT_TRIPLET = /%([0-9a-fA-F]{2})/g;

/**
 * ADR-0005 section 3: percent-encoding normalized to uppercase hex.
 *
 * The WHATWG parser does not do this. `%2f` and `%2F` are the same octet and
 * would otherwise produce two dedup keys for one request.
 */
function normalizePercentEncoding(value: string): string {
  return value.replace(
    PERCENT_TRIPLET,
    (_match, hex: string) => `%${hex.toUpperCase()}`,
  );
}

/**
 * The query substring of the raw input, byte for byte.
 *
 * ADR-0005 section 3 requires the query preserved exactly, and `URL`
 * re-encodes parts of it. The fragment is located first because the first `#`
 * ends the query, and a `?` after it is fragment data.
 */
function rawQueryOf(raw: string): string {
  const fragmentAt = raw.indexOf("#");
  const beforeFragment = fragmentAt === -1 ? raw : raw.slice(0, fragmentAt);
  const queryAt = beforeFragment.indexOf("?");
  return queryAt === -1 ? "" : beforeFragment.slice(queryAt);
}

/**
 * ADR-0005 section 3's effective URL: scheme and host lowercased, the
 * scheme's default port removed, an empty path normalized to `/`,
 * percent-encoding in uppercase hex, the query preserved byte for byte, and
 * the fragment removed.
 *
 * Returns `null` when the input is not an absolute URL the parser accepts.
 * Userinfo is dropped from the returned string, which is why the policy below
 * rejects it explicitly rather than relying on the serialization.
 */
export function canonicalUrl(raw: string): string | null {
  const parsed = URL.parse(raw);
  if (parsed === null) return null;
  const path = parsed.pathname === "" ? "/" : parsed.pathname;
  return `${parsed.protocol}//${parsed.host}${normalizePercentEncoding(path)}${rawQueryOf(raw)}`;
}

/**
 * Query parameter names refused outright on a discovered URL.
 *
 * **No accepted decision supplies this list.** ADR-0002 section 7 requires the
 * refusal ("the request is refused rather than redacted, because a redacted
 * request is still a request that transmits the secret") and
 * `docs/THREAT_MODEL.md` section 20.2 names the credential material, but
 * neither enumerates the parameter names. Refusing every query instead would
 * contradict the same ADR, which goes on to say that surviving query values
 * are redacted in evidence.
 *
 * This list is therefore an implementation choice standing in for a decision
 * that has not been made, and it is exported so a test can read it and a
 * reviewer can find it.
 */
export const CREDENTIAL_SHAPED_QUERY_PARAMS: readonly string[] = [
  "access_token",
  "api_key",
  "apikey",
  "auth",
  "authorization",
  "credential",
  "id_token",
  "key",
  "passwd",
  "password",
  "pwd",
  "refresh_token",
  "secret",
  "session",
  "sig",
  "signature",
  "token",
];

const CREDENTIAL_SET = new Set(CREDENTIAL_SHAPED_QUERY_PARAMS);

function hasCredentialShapedQuery(parsed: URL): boolean {
  for (const [name] of parsed.searchParams) {
    if (CREDENTIAL_SET.has(name.toLowerCase())) return true;
  }
  return false;
}

export interface DiscoveredUrlPolicy {
  /** The one origin a discovered URL may name, already canonical. */
  readonly authorizedOrigin: string;
  /**
   * The authorized origin's port as `URL.port` reports it: the empty string
   * when the scheme's default port is in use.
   */
  readonly authorizedPort: string;
}

/**
 * ADR-0002 section 7. The rule says where the URL came from; the engine
 * decides whether it may be requested.
 *
 * Provenance resolution is the caller's half, because only the caller knows
 * which of that rule's observations completed: pass `provenanceResolved` as
 * `false` when `fromObservation` names nothing, or names an error observation.
 */
export function authorizeDiscoveredUrl(
  raw: string,
  provenanceResolved: boolean,
  policy: DiscoveredUrlPolicy,
): DiscoveredDecision {
  const reject = (reason: DiscoveredRejection): DiscoveredDecision => ({
    kind: "rejected",
    reason,
  });

  if (!provenanceResolved) return reject("unknown-provenance");
  if (new TextEncoder().encode(raw).length > MAX_URL_BYTES) {
    return reject("malformed");
  }
  if (raw.includes("#")) return reject("fragment");

  const parsed = URL.parse(raw);
  if (parsed === null) return reject("malformed");
  if (parsed.username !== "" || parsed.password !== "")
    return reject("userinfo");
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return reject("forbidden-scheme");
  }
  // `docs/THREAT_MODEL.md` section 11 permits only ports 80 and 443 in
  // `ci-public` and names no separate forbidden-port list, so the check that
  // actually binds is equality with the authorized origin's port. Under
  // `local-loopback` this is what makes a different loopback port a rejection
  // rather than a same-host allowance.
  if (parsed.port !== policy.authorizedPort) return reject("forbidden-port");
  if (parsed.origin !== policy.authorizedOrigin) return reject("cross-origin");
  if (hasCredentialShapedQuery(parsed)) return reject("unsafe-query");

  const canonical = canonicalUrl(raw);
  if (canonical === null) return reject("malformed");
  return { kind: "authorized", url: canonical };
}
