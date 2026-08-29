/**
 * ADR-0003. Two error enumerations, and the total projection between them.
 *
 * The public enum is the only error vocabulary in the canonical report and in
 * every reporter. The internal `ObservationFailure` union is declared here,
 * in core, because `rules-standard` and `transport-node` both depend on core
 * and neither depends on the other, so core is the only package both can
 * import a shared failure type from.
 */

export type TransportPhase =
  | "policy"
  | "dns"
  | "connect"
  | "tls"
  | "request"
  | "redirect"
  | "body"
  | "decode"
  | "parse"
  | "runtime";

/** ADR-0003 section 3. Fifteen members. */
export type PublicErrorCode =
  | "url-policy-blocked"
  | "dns-resolution-failed"
  | "dns-answer-blocked"
  | "connect-timeout"
  | "connection-failed"
  | "tls-failed"
  | "request-timeout"
  | "redirect-limit"
  | "request-budget-exhausted"
  | "resource-budget-exhausted"
  | "response-limit"
  | "decode-failed"
  | "parse-failed"
  | "aborted"
  | "unsupported-runtime";

export interface PublicObservationError {
  readonly code: PublicErrorCode;
  readonly phase: TransportPhase;
  readonly message: string;
  readonly retryable: boolean;
}

/** Raised only by `packages/transport-node`. */
export type TransportReason =
  | { readonly code: "invalid-url"; readonly phase: "policy" }
  | { readonly code: "prohibited-scheme"; readonly phase: "policy" }
  | { readonly code: "credentials-in-url"; readonly phase: "policy" }
  | { readonly code: "unsafe-port"; readonly phase: "policy" }
  | { readonly code: "dns-failure"; readonly phase: "dns" }
  | { readonly code: "dns-timeout"; readonly phase: "dns" }
  | { readonly code: "unsafe-address"; readonly phase: "dns" }
  | { readonly code: "mixed-address-scope"; readonly phase: "dns" }
  | { readonly code: "peer-address-mismatch"; readonly phase: "connect" }
  | { readonly code: "connection-failed"; readonly phase: "connect" }
  | { readonly code: "tls-failure"; readonly phase: "tls" }
  | { readonly code: "redirect-blocked"; readonly phase: "redirect" }
  | { readonly code: "redirect-limit"; readonly phase: "redirect" }
  | {
      readonly code: "timeout";
      readonly phase: "connect" | "request" | "body" | "decode";
    }
  | { readonly code: "malformed-http"; readonly phase: "body" }
  | { readonly code: "response-too-large"; readonly phase: "body" }
  | { readonly code: "decompression-failure"; readonly phase: "decode" }
  | {
      readonly code: "scan-byte-budget-exceeded";
      readonly phase: "body" | "decode";
    };

/** Raised only by a parser in `packages/rules-standard`. */
export type ParserReason =
  | { readonly code: "parse-failure"; readonly phase: "parse" }
  | { readonly code: "parser-budget-exceeded"; readonly phase: "parse" };

/** Raised only by the engine in `packages/core`. */
export type EngineReason =
  | { readonly code: "request-slot-budget-exceeded"; readonly phase: "policy" }
  | { readonly code: "scan-deadline-exceeded"; readonly phase: "runtime" }
  | { readonly code: "caller-cancelled"; readonly phase: "runtime" }
  | { readonly code: "runtime-unsupported"; readonly phase: "runtime" };

export type ObservationFailure = TransportReason | ParserReason | EngineReason;

/**
 * ADR-0003 section 6. The public message is a constant.
 *
 * It is never built from an exception, a Node error code, a header, a body
 * byte, a hostname, or a resolved address. A constant table makes that
 * unbypassable rather than a review item.
 */
const MESSAGES: Readonly<Record<PublicErrorCode, string>> = {
  "url-policy-blocked": "The URL policy refused this request.",
  "dns-resolution-failed": "The host name could not be resolved.",
  "dns-answer-blocked": "The address policy refused the resolved address.",
  "connect-timeout": "The connection attempt timed out.",
  "connection-failed": "The connection failed.",
  "tls-failed": "The TLS handshake failed.",
  "request-timeout": "The request exceeded its elapsed deadline.",
  "redirect-limit": "The redirect limit was reached.",
  "request-budget-exhausted": "The scan request or byte budget is exhausted.",
  "resource-budget-exhausted":
    "A bounded processing budget stopped this observation.",
  "response-limit": "The response exceeded its byte cap.",
  "decode-failed": "The response could not be decoded.",
  "parse-failed": "The parser refused this document.",
  aborted: "The scan was aborted.",
  "unsupported-runtime": "This observation runtime is unavailable.",
};

function blocked(
  code: PublicErrorCode,
  phase: TransportPhase,
): PublicObservationError {
  return { code, phase, message: MESSAGES[code], retryable: false };
}

function transient(
  code: PublicErrorCode,
  phase: TransportPhase,
): PublicObservationError {
  return { code, phase, message: MESSAGES[code], retryable: true };
}

/**
 * ADR-0003 sections 4 and 5. A single exhaustive switch with a `never`-typed
 * default, so a twenty-fifth internal reason without a decided public
 * projection is a compile error rather than a silent hole.
 */
export function toPublicError(
  reason: ObservationFailure,
): PublicObservationError {
  switch (reason.code) {
    case "invalid-url":
    case "prohibited-scheme":
    case "credentials-in-url":
    case "unsafe-port":
      return blocked("url-policy-blocked", "policy");
    case "redirect-blocked":
      return blocked("url-policy-blocked", "redirect");
    case "dns-failure":
    case "dns-timeout":
      return transient("dns-resolution-failed", "dns");
    case "unsafe-address":
    case "mixed-address-scope":
      return blocked("dns-answer-blocked", "dns");
    case "peer-address-mismatch":
      return blocked("dns-answer-blocked", "connect");
    case "connection-failed":
      return transient("connection-failed", "connect");
    case "timeout":
      return reason.phase === "connect"
        ? transient("connect-timeout", "connect")
        : transient("request-timeout", reason.phase);
    case "tls-failure":
      return blocked("tls-failed", "tls");
    case "redirect-limit":
      return blocked("redirect-limit", "redirect");
    case "malformed-http":
      return blocked("decode-failed", "body");
    case "response-too-large":
      return blocked("response-limit", "body");
    case "decompression-failure":
      return blocked("decode-failed", "decode");
    case "scan-byte-budget-exceeded":
      return blocked("request-budget-exhausted", reason.phase);
    case "parse-failure":
      return blocked("parse-failed", "parse");
    case "parser-budget-exceeded":
      return blocked("resource-budget-exhausted", "parse");
    case "request-slot-budget-exceeded":
      return blocked("request-budget-exhausted", "policy");
    case "scan-deadline-exceeded":
    case "caller-cancelled":
      return blocked("aborted", "runtime");
    case "runtime-unsupported":
      return blocked("unsupported-runtime", "runtime");
    default: {
      const unreachable: never = reason;
      throw new Error(
        `unmapped observation failure: ${JSON.stringify(unreachable)}`,
      );
    }
  }
}
