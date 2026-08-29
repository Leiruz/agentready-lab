import { MAX_URL_BYTES } from "@agentready-lab/core";
import type { TransportReason } from "@agentready-lab/core";

/**
 * URL parsing, canonicalization and policy, `docs/THREAT_MODEL.md` section 11.
 *
 * One WHATWG parser decides the policy question and produces the string that
 * is actually put on the wire. Section 11's first sentence is the whole design
 * constraint: "Never validate with a regex or RFC parser and then send the
 * original string to a differently behaving client." So `CanonicalTarget`
 * carries every field the connector needs, all of them derived from the same
 * parse, and the caller's original string is used for nothing afterwards.
 *
 * The checks that cannot be expressed as "ask the parser" are the ones the
 * parser is too forgiving about. It silently strips tab, CR and LF from its
 * input before parsing, so a raw control character has to be refused before it
 * is handed over; and it accepts a length no specification bounds, so the
 * 2,048-byte limit is applied first.
 */

/** Everything the connector and the policy need, from one parse. */
export interface CanonicalTarget {
  /** Canonical absolute URL, fragment removed. */
  readonly href: string;
  /** Canonical serialized origin, `scheme://host[:non-default-port]`. */
  readonly origin: string;
  readonly protocol: "http:" | "https:";
  /** Lowercase, IDNA-converted, root dot removed. Brackets kept for IPv6. */
  readonly hostname: string;
  /** The exact `Host` field value: hostname plus a non-default port. */
  readonly hostHeader: string;
  /** Always explicit: the scheme default when the URL omitted one. */
  readonly port: number;
  /** Request-target for the wire: path plus query, never a fragment. */
  readonly requestPath: string;
  /** `docs/THREAT_MODEL.md` section 11: fragments are removed and reported. */
  readonly fragmentIgnored: boolean;
}

export type UrlPolicyResult =
  | { readonly kind: "url"; readonly target: CanonicalTarget }
  | { readonly kind: "rejected"; readonly reason: TransportReason };

const DEFAULT_PORTS: Readonly<Record<string, number>> = {
  "http:": 80,
  "https:": 443,
};

/** C0 controls, DEL, and the C1 range. */
// eslint-disable-next-line no-control-regex
const RAW_CONTROL = /[\u0000-\u001F\u007F-\u009F]/;

/** A high or low surrogate with no partner: not valid Unicode. */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Anything that would end the request-target early or split the request line.
 * The WHATWG parser percent-encodes all of these, so a hit here means the
 * parse produced something the parser itself would not have accepted back,
 * and the only safe response is to refuse.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE_IN_REQUEST_PATH = /[\u0000-\u0020#]/;

const PERCENT_TRIPLET = /%([0-9a-fA-F]{2})/g;

const encoder = new TextEncoder();

function rejected(reason: TransportReason): UrlPolicyResult {
  return { kind: "rejected", reason };
}

/**
 * ADR-0005 section 3 requires percent-encoding normalized to uppercase hex,
 * and the WHATWG parser does not do it. `packages/core`'s `canonicalUrl`
 * applies the same normalization to the path and to the path only, and this
 * matches it so that a canonical URL the engine computed and a canonical URL
 * the transport computed are the same string.
 */
function normalizePercentEncoding(value: string): string {
  return value.replace(
    PERCENT_TRIPLET,
    (_match, hex: string) => `%${hex.toUpperCase()}`,
  );
}

function isIpv6Literal(hostname: string): boolean {
  return hostname.startsWith("[");
}

/**
 * `docs/THREAT_MODEL.md` section 11: "normalize a trailing DNS root dot for
 * security comparisons". Normalizing it in the canonical form rather than only
 * in the comparison is what stops `http://localhost./` and `http://localhost/`
 * from being one origin to the policy and two to the connector.
 */
function withoutRootDot(hostname: string): string {
  if (isIpv6Literal(hostname)) return hostname;
  if (hostname.length > 1 && hostname.endsWith(".")) {
    return hostname.slice(0, -1);
  }
  return hostname;
}

function toCanonicalTarget(
  parsed: URL,
  fragmentIgnored: boolean,
): UrlPolicyResult {
  const protocol = parsed.protocol;
  if (protocol !== "http:" && protocol !== "https:") {
    return rejected({ code: "prohibited-scheme", phase: "policy" });
  }

  // Checked on the parse result, not on the input text, so a percent-encoded
  // or otherwise disguised userinfo is judged after the parser has decided
  // what it means. `http://example.com@127.0.0.1/` lands here with username
  // `example.com`, which is precisely the confusion the check exists for.
  if (parsed.username !== "" || parsed.password !== "") {
    return rejected({ code: "credentials-in-url", phase: "policy" });
  }

  if (parsed.hostname === "") {
    return rejected({ code: "invalid-url", phase: "policy" });
  }

  // A surviving `%` in the hostname is either an IPv6 zone identifier or a
  // sequence the parser declined to decode. Section 11 rejects zone ids and
  // section 12.1 denies "any value the classifier cannot parse unambiguously".
  if (parsed.hostname.includes("%")) {
    return rejected({ code: "invalid-url", phase: "policy" });
  }

  const defaultPort = DEFAULT_PORTS[protocol] ?? 0;
  const port = parsed.port === "" ? defaultPort : Number(parsed.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return rejected({ code: "unsafe-port", phase: "policy" });
  }

  const path = parsed.pathname === "" ? "/" : parsed.pathname;
  const requestPath = `${normalizePercentEncoding(path)}${parsed.search}`;
  if (UNSAFE_IN_REQUEST_PATH.test(requestPath)) {
    return rejected({ code: "invalid-url", phase: "policy" });
  }

  const hostHeader = parsed.host;
  const origin = `${protocol}//${hostHeader}`;
  const href = `${origin}${requestPath}`;
  if (encoder.encode(href).length > MAX_URL_BYTES) {
    return rejected({ code: "invalid-url", phase: "policy" });
  }

  return {
    kind: "url",
    target: {
      href,
      origin,
      protocol,
      hostname: parsed.hostname,
      hostHeader,
      port,
      requestPath,
      fragmentIgnored,
    },
  };
}

/**
 * Parses and canonicalizes one URL, absolute or relative to `base`.
 *
 * `base` exists for section 13's "resolve `Location` relative to the current
 * canonical URL" and for discovered references. It is a canonical href this
 * function produced earlier, never caller text.
 */
export function applyUrlPolicy(raw: string, base?: string): UrlPolicyResult {
  if (encoder.encode(raw).length > MAX_URL_BYTES) {
    return rejected({ code: "invalid-url", phase: "policy" });
  }
  if (RAW_CONTROL.test(raw) || LONE_SURROGATE.test(raw)) {
    return rejected({ code: "invalid-url", phase: "policy" });
  }

  const parsed = base === undefined ? URL.parse(raw) : URL.parse(raw, base);
  if (parsed === null) {
    return rejected({ code: "invalid-url", phase: "policy" });
  }

  // Credentials are judged on the first parse and not after the root-dot
  // rebuild below, which drops userinfo while rebuilding. Checking only the
  // rebuilt URL would let `http://user@localhost./` through.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return rejected({ code: "prohibited-scheme", phase: "policy" });
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return rejected({ code: "credentials-in-url", phase: "policy" });
  }

  const fragmentIgnored = parsed.hash !== "";

  // The root dot is removed by re-parsing rather than by string surgery, so
  // the value that reaches the policy is still something this one parser
  // produced. If the second parse disagrees, the input is refused instead of
  // trusted.
  const trimmedHost = withoutRootDot(parsed.hostname);
  if (trimmedHost !== parsed.hostname) {
    const port = parsed.port === "" ? "" : `:${parsed.port}`;
    const rebuilt = URL.parse(
      `${parsed.protocol}//${trimmedHost}${port}${parsed.pathname}${parsed.search}`,
    );
    if (rebuilt?.hostname !== trimmedHost) {
      return rejected({ code: "invalid-url", phase: "policy" });
    }
    return toCanonicalTarget(rebuilt, fragmentIgnored);
  }

  return toCanonicalTarget(parsed, fragmentIgnored);
}
