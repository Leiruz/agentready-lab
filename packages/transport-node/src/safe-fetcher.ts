import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";

import { sha256Hex } from "@agentready-lab/core";
import type {
  HttpTransportRequest,
  HttpTransportResult,
  RedirectFact,
  Transport,
  TransportReason,
} from "@agentready-lab/core";

import { discardBody, readBoundedBody } from "./bounded-body.js";
import type { ByteStream } from "./bounded-body.js";
import {
  Deadline,
  MAX_REDIRECT_HOPS,
  MAX_RESPONSE_HEADER_BYTES,
  MAX_RESPONSE_HEADER_COUNT,
  resolveByteCaps,
  systemClock,
} from "./budget.js";
import type { Clock } from "./budget.js";
import { sameAddress } from "./ip-policy.js";
import type { LocalLoopbackPolicy } from "./network-policy.js";
import { isRedirectStatus, isUpgradeStatus, planNextHop } from "./redirects.js";
import { PinnedResolver } from "./resolver.js";
import { applyUrlPolicy } from "./url-policy.js";
import type { CanonicalTarget } from "./url-policy.js";

/**
 * The `SafeFetcher` of `docs/THREAT_MODEL.md` section 10, and the Node
 * connector it drives.
 *
 * ## Why `node:http` and not `fetch`
 *
 * Section 17 requires the transport to "expose/count wire bytes rather than
 * relying solely on an auto-decompressing Fetch implementation" and to "never
 * enable Node's `insecureHTTPParser`". Section 12.3 requires the validated
 * address to be "supplied directly to the connector". `fetch`/undici gives
 * none of those directly: it decodes before the caller sees a byte, it owns
 * its own connection pool, and its parser settings are not part of the request
 * API. `node:http` takes `lookup`, `maxHeaderSize`, `insecureHTTPParser`, an
 * agent this module owns, and hands over an undecoded stream. It also adds no
 * dependency.
 *
 * ## Nothing here throws
 *
 * ADR-0003 and section 26: "Raw exceptions do not cross the transport
 * boundary." Every failure below is a `TransportReason` value. The exception
 * text of a library call is never read, never wrapped and never forwarded, so
 * a raw URL or hostname inside an `Error` message has no path into a result;
 * only a fixed `code` symbol from a closed vocabulary is ever inspected.
 */

/** `docs/THREAT_MODEL.md` section 18: a fixed identifying `User-Agent`. */
export const DEFAULT_USER_AGENT = "AgentReady-Lab/0.0.0";

/** Section 17: `identity` by default, and M1 decodes nothing else. */
export const REQUEST_ACCEPT_ENCODING = "identity";

/**
 * The only caller-influenced request header.
 *
 * Section 18: `Host` comes from the canonical URL, `Accept` from rule-owned
 * constants, and "no caller-supplied arbitrary headers are accepted". An
 * allowlist rather than a denylist, so a header nobody thought of is absent by
 * default instead of present until someone remembers to ban it. `cookie`,
 * `authorization` and `proxy-authorization` are unreachable by construction.
 */
const REQUEST_HEADER_ALLOWLIST: ReadonlySet<string> = new Set(["accept"]);

/** Printable US-ASCII plus horizontal tab: RFC 9110 field-value material. */
const UNSAFE_HEADER_VALUE = /[^\t -~]/;

export interface ConnectionAttempt {
  readonly protocol: "http:" | "https:";
  readonly method: "GET" | "HEAD";
  /** The pinned IP literal. The socket connects here and nowhere else. */
  readonly address: string;
  readonly port: number;
  /** Canonical hostname: `Host`, SNI and certificate identity, never the IP. */
  readonly hostname: string;
  readonly hostHeader: string;
  readonly requestPath: string;
  readonly headers: readonly (readonly [string, string])[];
  readonly lookup: LookupFunction;
  readonly connectTimeoutMs: number;
  readonly deadlineMs: number;
}

export interface WireExchange {
  readonly status: number;
  /** Field name lowercased, value as received, in wire order. */
  readonly rawHeaders: readonly (readonly [string, string])[];
  /** `socket.remoteAddress` captured at connect time, before any response. */
  readonly peerAddress: string | null;
  readonly body: ByteStream;
  destroy(): void;
}

export type ExchangeResult =
  | { readonly kind: "wire"; readonly wire: WireExchange }
  | { readonly kind: "failure"; readonly reason: TransportReason };

/**
 * The seam a test replaces to prove a request was refused before a socket
 * existed. A spy that records its calls and never returns a wire is enough to
 * turn "the policy blocks this" into "zero connections were attempted".
 */
export type OpenExchange = (
  attempt: ConnectionAttempt,
) => Promise<ExchangeResult>;

export interface NodeTransportOptions {
  readonly policy: LocalLoopbackPolicy;
  readonly userAgent?: string;
  readonly openExchange?: OpenExchange;
  readonly clock?: Clock;
}

function failure(reason: TransportReason): HttpTransportResult {
  return { kind: "failure", reason };
}

function errorCodeOf(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { readonly code: unknown }).code)
    : "";
}

/**
 * Connect- and TLS-phase classification.
 *
 * ADR-0003 section 3 requires this to be total, with `connection-failed` as
 * the default branch, "and the classifier having a default branch is what
 * stops an unclassified socket error from escaping as a raw exception".
 */
export function classifyRequestError(error: unknown): TransportReason {
  const code = errorCodeOf(error);
  if (
    code.startsWith("ERR_TLS") ||
    code.startsWith("ERR_SSL") ||
    code.startsWith("ERR_OSSL") ||
    code.includes("CERT") ||
    code === "EPROTO" ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
  ) {
    return { code: "tls-failure", phase: "tls" };
  }
  if (code.startsWith("HPE_")) return { code: "malformed-http", phase: "body" };
  if (code === "ETIMEDOUT") return { code: "timeout", phase: "connect" };
  return { code: "connection-failed", phase: "connect" };
}

/**
 * `docs/THREAT_MODEL.md` sections 14 and 15.
 *
 * `rejectUnauthorized: true` is passed explicitly, which is what makes
 * `NODE_TLS_REJECT_UNAUTHORIZED=0` in the environment inert: the option beats
 * the default the variable changes. No `ca`, `cert`, `key` or `pfx` is set, so
 * no ambient CA bundle or client certificate can attach itself either.
 *
 * SNI carries the canonical hostname, never the pinned IP, so certificate
 * hostname verification checks the name the user asked for. RFC 6066 forbids
 * an IP literal in SNI, so `servername` is omitted when the host is one, and
 * Node then verifies the certificate against `host`, which is that same IP.
 */
export function tlsOptionsFor(hostname: string): {
  readonly rejectUnauthorized: true;
  readonly minVersion: "TLSv1.2";
  readonly servername?: string;
} {
  const base = { rejectUnauthorized: true, minVersion: "TLSv1.2" } as const;
  return /^[0-9.]+$|:/.test(hostname)
    ? base
    : { ...base, servername: hostname };
}

function isSafeHeaderValue(value: string): boolean {
  return value !== "" && !UNSAFE_HEADER_VALUE.test(value);
}

/**
 * The complete request header set. Nothing else is ever sent.
 *
 * Returns `null` when a caller-supplied allowlisted value is not safe field
 * material. Dropping it silently would hand the rule a different
 * representation than it asked for without saying so, and this is a security
 * boundary, so it fails closed instead.
 */
export function buildRequestHeaders(
  target: CanonicalTarget,
  requested: ReadonlyMap<string, readonly string[]>,
  userAgent: string,
): readonly (readonly [string, string])[] | null {
  const headers: [string, string][] = [
    ["host", target.hostHeader],
    ["user-agent", userAgent],
    ["accept-encoding", REQUEST_ACCEPT_ENCODING],
    // No pooled connection survives an observation, so a hostile server cannot
    // hold one open across the scan.
    ["connection", "close"],
  ];

  for (const [rawName, values] of requested) {
    const name = rawName.toLowerCase();
    if (!REQUEST_HEADER_ALLOWLIST.has(name)) continue;
    const value = values.join(", ");
    if (!isSafeHeaderValue(value)) return null;
    headers.push([name, value]);
  }
  return headers;
}

function groupHeaders(
  raw: readonly (readonly [string, string])[],
): ReadonlyMap<string, readonly string[]> {
  const grouped = new Map<string, string[]>();
  for (const [name, value] of raw) {
    const existing = grouped.get(name);
    if (existing === undefined) grouped.set(name, [value]);
    else existing.push(value);
  }
  return grouped;
}

/**
 * `docs/THREAT_MODEL.md` section 17's rejection list, on the response head and
 * before a single body byte is read.
 *
 * RFC 9112 treats `Transfer-Encoding` with `Content-Length` as a smuggling or
 * splitting signal, and the project's answer to that ambiguity is to fail
 * closed rather than to pick the interpretation the RFC prefers.
 */
export function checkResponseFraming(
  status: number,
  raw: readonly (readonly [string, string])[],
): TransportReason | null {
  if (raw.length > MAX_RESPONSE_HEADER_COUNT) {
    return { code: "malformed-http", phase: "body" };
  }
  if (isUpgradeStatus(status)) {
    return { code: "malformed-http", phase: "body" };
  }

  const valuesOf = (name: string): string[] =>
    raw.filter(([field]) => field === name).map(([, value]) => value);

  if (valuesOf("upgrade").length > 0) {
    return { code: "malformed-http", phase: "body" };
  }

  const transferEncoding = valuesOf("transfer-encoding");
  const contentLength = valuesOf("content-length");

  if (transferEncoding.length > 0 && contentLength.length > 0) {
    return { code: "malformed-http", phase: "body" };
  }
  if (
    transferEncoding.some((value) => value.trim().toLowerCase() !== "chunked")
  ) {
    return { code: "malformed-http", phase: "body" };
  }
  if (contentLength.some((value) => !/^[0-9]+$/.test(value.trim()))) {
    return { code: "malformed-http", phase: "body" };
  }
  if (new Set(contentLength.map((value) => value.trim())).size > 1) {
    return { code: "malformed-http", phase: "body" };
  }

  // M1 sends `Accept-Encoding: identity` and implements no decoder, so a
  // content coding is refused rather than decoded. That is section 17's
  // "support only explicitly reviewed encodings" with the reviewed set empty.
  const badEncoding = valuesOf("content-encoding").some(
    (value) => value.trim().toLowerCase() !== "identity",
  );
  if (badEncoding) return { code: "decompression-failure", phase: "decode" };

  return null;
}

function declaredContentLength(
  headers: ReadonlyMap<string, readonly string[]>,
): number | null {
  const value = headers.get("content-length")?.[0];
  if (value === undefined) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** IPv6 hostnames are serialized with brackets; a socket wants them without. */
function bareHostname(target: CanonicalTarget): string {
  const host = target.hostname;
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/** The real connector. Everything above it is policy; this is the socket. */
export const nodeExchange: OpenExchange = (attempt) =>
  new Promise<ExchangeResult>((resolve) => {
    let settled = false;
    let peerAddress: string | null = null;
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

    const clearTimers = (): void => {
      if (connectTimer !== undefined) clearTimeout(connectTimer);
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    };
    const settle = (result: ExchangeResult): void => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve(result);
    };

    const headers: Record<string, string> = {};
    for (const [name, value] of attempt.headers) headers[name] = value;

    const secure = attempt.protocol === "https:";
    // A fresh agent per exchange. `docs/THREAT_MODEL.md` section 10:
    // "Connection pools must not be shared across tenants or unrelated scans."
    const agent = secure
      ? new https.Agent({ keepAlive: false, maxSockets: 1 })
      : new http.Agent({ keepAlive: false, maxSockets: 1 });

    const base = {
      host: attempt.address,
      port: attempt.port,
      path: attempt.requestPath,
      method: attempt.method,
      headers,
      // `Host` is built from the canonical URL above; letting Node derive it
      // would put the pinned IP in the field instead of the hostname.
      setHost: false,
      insecureHTTPParser: false,
      maxHeaderSize: MAX_RESPONSE_HEADER_BYTES,
      lookup: attempt.lookup,
      agent,
    };

    const request = secure
      ? https.request({ ...base, ...tlsOptionsFor(attempt.hostname) })
      : http.request(base);

    connectTimer = setTimeout(() => {
      request.destroy();
      settle({
        kind: "failure",
        reason: { code: "timeout", phase: "connect" },
      });
    }, attempt.connectTimeoutMs);

    deadlineTimer = setTimeout(() => {
      request.destroy();
      settle({
        kind: "failure",
        reason: { code: "timeout", phase: "request" },
      });
    }, attempt.deadlineMs);

    request.on("socket", (socket) => {
      const capture = (): void => {
        peerAddress = socket.remoteAddress ?? null;
      };
      const connected = (): void => {
        if (connectTimer !== undefined) clearTimeout(connectTimer);
        connectTimer = undefined;
      };
      if (socket.connecting) {
        socket.once("connect", capture);
      } else {
        capture();
      }
      if (secure) socket.once("secureConnect", connected);
      else if (socket.connecting) socket.once("connect", connected);
      else connected();
    });

    // Section 13: reject upgrade and tunnel semantics rather than following
    // them. Node routes `101` here instead of to `response`, so this listener
    // is the only place it can be caught.
    request.on("upgrade", (_res, socket) => {
      socket.destroy();
      request.destroy();
      settle({
        kind: "failure",
        reason: { code: "malformed-http", phase: "body" },
      });
    });

    request.on("error", (error: unknown) => {
      settle({ kind: "failure", reason: classifyRequestError(error) });
    });

    request.on("response", (response) => {
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      deadlineTimer = undefined;

      // A destroyed response can emit `error` with no listener, which would
      // become an unhandled exception outside every try/catch in this package.
      response.on("error", () => undefined);

      const pairs: (readonly [string, string])[] = [];
      const flat = response.rawHeaders;
      for (let index = 0; index + 1 < flat.length; index += 2) {
        pairs.push([(flat[index] ?? "").toLowerCase(), flat[index + 1] ?? ""]);
      }

      settle({
        kind: "wire",
        wire: {
          status: response.statusCode ?? 0,
          rawHeaders: pairs,
          peerAddress: peerAddress ?? response.socket.remoteAddress ?? null,
          body: response,
          destroy: () => {
            response.destroy();
            request.destroy();
          },
        },
      });
    });

    request.end();
  });

interface FetchContext {
  readonly policy: LocalLoopbackPolicy;
  readonly openExchange: OpenExchange;
  readonly userAgent: string;
  readonly clock: Clock;
}

/** Steps 1 to 14 of the section 10 state machine, in that order. */
async function runHttp(
  context: FetchContext,
  request: HttpTransportRequest,
): Promise<HttpTransportResult> {
  const caps = resolveByteCaps(request);
  const deadline = new Deadline(request.requestTimeoutMs, context.clock);
  const maxHops = Math.min(request.maxRedirects, MAX_REDIRECT_HOPS);

  const parsed = applyUrlPolicy(request.url);
  if (parsed.kind === "rejected") return failure(parsed.reason);

  let target = parsed.target;
  const firstAuthorization = context.policy.authorize(target, "target");
  if (firstAuthorization.kind === "blocked") {
    return failure(firstAuthorization.reason);
  }
  let authorization = firstAuthorization;

  const visited = new Set<string>([target.href]);
  const redirects: RedirectFact[] = [];

  for (let hop = 0; ; hop += 1) {
    if (deadline.expired) {
      return failure({ code: "timeout", phase: "request" });
    }

    const headers = buildRequestHeaders(
      target,
      request.headers,
      context.userAgent,
    );
    if (headers === null)
      return failure({ code: "invalid-url", phase: "policy" });

    // Built per hop from the address this hop's own policy evaluation
    // approved. Never called for an IP literal, and a test asserts that.
    const resolver = new PinnedResolver(bareHostname(target), [
      { address: authorization.address, family: authorization.family },
    ]);

    const exchange = await context.openExchange({
      protocol: target.protocol,
      method: request.method,
      address: authorization.address,
      port: target.port,
      hostname: bareHostname(target),
      hostHeader: target.hostHeader,
      requestPath: target.requestPath,
      headers,
      lookup: resolver.lookup,
      connectTimeoutMs: Math.min(
        request.connectTimeoutMs,
        deadline.remainingMs,
      ),
      deadlineMs: deadline.remainingMs,
    });
    if (exchange.kind === "failure") return failure(exchange.reason);
    const wire = exchange.wire;

    // Section 12.3, step 10: "Confirm the connected peer equals the selected
    // canonical address." An absent peer address is a comparison that cannot
    // be made, and an unverifiable connection fails closed.
    if (
      wire.peerAddress === null ||
      !sameAddress(wire.peerAddress, authorization.address)
    ) {
      wire.destroy();
      return failure({ code: "peer-address-mismatch", phase: "connect" });
    }

    const framing = checkResponseFraming(wire.status, wire.rawHeaders);
    if (framing !== null) {
      wire.destroy();
      return failure(framing);
    }

    const responseHeaders = groupHeaders(wire.rawHeaders);
    // A HEAD response may declare the length of a body it does not send, so
    // the early `Content-Length` check would reject a zero-byte response.
    const declared =
      request.method === "HEAD" ? null : declaredContentLength(responseHeaders);

    if (isRedirectStatus(wire.status)) {
      const locations = responseHeaders.get("location") ?? [];

      if (request.redirects === "reject") {
        // Not a hop: the 3xx is the observation, and the rule asked to see it.
        const body = await readBoundedBody(wire.body, caps, declared, deadline);
        wire.destroy();
        if (body.kind === "failure") return failure(body.reason);
        return {
          kind: "response",
          status: wire.status,
          effectiveUrl: target.href,
          headers: responseHeaders,
          body: body.bytes,
          truncated: false,
          encodedBytes: body.encodedBytes,
          decodedBytes: body.decodedBytes,
          bodySha256: await sha256Hex(body.bytes),
          redirects: [
            {
              status: wire.status,
              location: locations[0] ?? "",
              decision: "blocked",
            },
          ],
        };
      }

      discardBody(wire.body);
      wire.destroy();

      const decision = planNextHop({
        policy: context.policy,
        current: target,
        status: wire.status,
        locations,
        hopsTaken: hop,
        maxHops,
        visited,
      });
      if (decision.kind === "blocked") return failure(decision.reason);

      redirects.push(decision.fact);
      target = decision.target;
      authorization = decision.authorization;
      visited.add(target.href);
      continue;
    }

    const body = await readBoundedBody(wire.body, caps, declared, deadline);
    wire.destroy();
    if (body.kind === "failure") return failure(body.reason);

    return {
      kind: "response",
      status: wire.status,
      effectiveUrl: target.href,
      headers: responseHeaders,
      body: body.bytes,
      truncated: false,
      encodedBytes: body.encodedBytes,
      decodedBytes: body.decodedBytes,
      bodySha256: await sha256Hex(body.bytes),
      redirects,
    };
  }
}

/**
 * The `Transport` implementation.
 *
 * There is no `dns` method: `transportCapabilities` derives the runtimes from
 * the methods present, so a `dns` rule resolves to `unsupported-runtime`
 * before `plan()` runs rather than failing at dispatch (ADR-0002 section 4).
 *
 * The `catch` is the last line of the never-throw contract. It records
 * nothing about the exception, because ADR-0003 section 6 keeps every public
 * message a constant and a library exception can carry a raw URL.
 */
export function createNodeTransport(options: NodeTransportOptions): Transport {
  const context: FetchContext = {
    policy: options.policy,
    openExchange: options.openExchange ?? nodeExchange,
    userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
    clock: options.clock ?? systemClock,
  };

  return {
    http: async (request) => {
      try {
        return await runHttp(context, request);
      } catch {
        return failure({ code: "connection-failed", phase: "connect" });
      }
    },
  };
}
