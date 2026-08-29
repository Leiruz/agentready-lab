/**
 * `@agentready-lab/transport-node`: the only package permitted to open a
 * socket to a target, and therefore the security boundary of the project
 * (`docs/THREAT_MODEL.md` invariant SEC-ARCH-02).
 *
 * M1 ships one network profile, `local-loopback`, and it is exact-origin:
 * only the scheme, host and port the developer supplied, for the first request
 * and for every redirect. `ci-public` is unimplemented and, more than that, is
 * not a policy object this package can construct, so no code path leads from
 * it to a connector. See `network-policy.ts` for why that is a type and not an
 * `if`.
 */
export const TRANSPORT_NODE_PACKAGE_VERSION = "0.0.0";

export { applyUrlPolicy } from "./url-policy.js";
export type { CanonicalTarget, UrlPolicyResult } from "./url-policy.js";

export {
  classifyAddress,
  isDeniedInPublicProfile,
  sameAddress,
} from "./ip-policy.js";
export type {
  AddressClass,
  AddressClassification,
  ClassifiedAddress,
} from "./ip-policy.js";

export {
  LOCAL_LOOPBACK_POLICY_VERSION,
  LocalLoopbackPolicy,
  createNetworkPolicy,
} from "./network-policy.js";
export type { AuthorizationResult, PolicyResult } from "./network-policy.js";

export { PinnedResolver } from "./resolver.js";
export type { PinnedAddress } from "./resolver.js";

export { isRedirectStatus, isUpgradeStatus, planNextHop } from "./redirects.js";
export type { HopDecision, HopInput } from "./redirects.js";

export { discardBody, readBoundedBody } from "./bounded-body.js";
export type { BoundedBodyResult, ByteStream } from "./bounded-body.js";

export {
  Deadline,
  MAX_REDIRECT_HOPS,
  MAX_RESPONSE_HEADER_BYTES,
  MAX_RESPONSE_HEADER_COUNT,
  byteCapReason,
  resolveByteCaps,
  systemClock,
} from "./budget.js";
export type { ByteCapInput, ByteCaps, Clock } from "./budget.js";

/**
 * `nodeExchange` and the wire types it speaks are deliberately absent.
 *
 * The connector takes a pinned address, a port and a `lookup` and hands them
 * to `http.request`. It is the one function in the package that opens a
 * socket, and it asks no policy first, because every check happens above it.
 * Exporting it would therefore publish a fully typed path around
 * `createNodeTransport`: a caller could build a `PinnedResolver` for
 * `169.254.169.254` and call the connector directly, with no
 * `LocalLoopbackPolicy` and no URL or network authorization anywhere in the
 * call. It stays package-internal, and so do `ConnectionAttempt`,
 * `WireExchange`, `ExchangeResult` and `OpenExchange`, which exist only to
 * describe it. This package's own tests reach them by module path.
 */
export {
  DEFAULT_USER_AGENT,
  REQUEST_ACCEPT_ENCODING,
  buildRequestHeaders,
  checkResponseFraming,
  classifyRequestError,
  createNodeTransport,
  tlsOptionsFor,
} from "./safe-fetcher.js";
export type { NodeTransportOptions } from "./safe-fetcher.js";
