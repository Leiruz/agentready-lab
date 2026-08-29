import { describe, expect, it } from "vitest";

import type { DiscoveredUrlPolicy } from "../src/index.js";
import {
  CREDENTIAL_SHAPED_QUERY_PARAMS,
  MAX_URL_BYTES,
  authorizeDiscoveredUrl,
} from "../src/index.js";

/**
 * ADR-0002 section 7, plus the `local-loopback` scope rule in
 * `.claude/rules/security.md`.
 *
 * "The rule does not decide whether a discovered URL is authorized. It says
 * where the URL came from, and the engine decides." Every rejection category
 * the ADR enumerates has a case here, which is what its own security-test
 * requirement asks for.
 */

const POLICY: DiscoveredUrlPolicy = {
  authorizedOrigin: "http://127.0.0.1:8787",
  authorizedPort: "8787",
};

function decide(
  url: string,
  provenanceResolved = true,
): ReturnType<typeof authorizeDiscoveredUrl> {
  return authorizeDiscoveredUrl(url, provenanceResolved, POLICY);
}

describe("authorized", () => {
  it("accepts a same-origin URL with resolved provenance", () => {
    expect(decide("http://127.0.0.1:8787/sitemap-1.xml")).toStrictEqual({
      kind: "authorized",
      url: "http://127.0.0.1:8787/sitemap-1.xml",
    });
  });

  it("accepts a harmless query and canonicalizes the path", () => {
    expect(decide("http://127.0.0.1:8787/a%2fb?page=2")).toStrictEqual({
      kind: "authorized",
      url: "http://127.0.0.1:8787/a%2Fb?page=2",
    });
  });
});

describe("rejections", () => {
  it("rejects unresolved provenance before looking at the URL", () => {
    expect(decide("http://127.0.0.1:8787/ok", false)).toStrictEqual({
      kind: "rejected",
      reason: "unknown-provenance",
    });
  });

  it.each([
    ["malformed", "not a url"],
    ["fragment", "http://127.0.0.1:8787/a#frag"],
    ["userinfo", "http://user:pass@127.0.0.1:8787/a"],
    ["forbidden-scheme", "file:///etc/passwd"],
    ["forbidden-port", "http://127.0.0.1:9999/a"],
    ["cross-origin", "http://localhost:8787/a"],
    ["unsafe-query", "http://127.0.0.1:8787/a?access_token=secret"],
  ])("rejects %s", (reason, url) => {
    expect(decide(url)).toStrictEqual({ kind: "rejected", reason });
  });

  it("rejects a different loopback spelling under local-loopback", () => {
    // `.claude/rules/security.md`: `local-loopback` permits only the exact
    // developer-supplied loopback origin, so `localhost` is cross-origin even
    // though it usually resolves to the same address.
    expect(decide("http://localhost:8787/a").kind).toBe("rejected");
    expect(decide("http://[::1]:8787/a").kind).toBe("rejected");
  });

  it("rejects a URL longer than the raw-input bound", () => {
    const long = `http://127.0.0.1:8787/${"a".repeat(MAX_URL_BYTES)}`;
    expect(decide(long)).toStrictEqual({
      kind: "rejected",
      reason: "malformed",
    });
  });

  it.each(CREDENTIAL_SHAPED_QUERY_PARAMS)(
    "refuses rather than redacts a %s query parameter",
    (name) => {
      // ADR-0002 section 7: "the request is refused rather than redacted,
      // because a redacted request is still a request that transmits the
      // secret".
      expect(decide(`http://127.0.0.1:8787/a?${name}=x`)).toStrictEqual({
        kind: "rejected",
        reason: "unsafe-query",
      });
    },
  );

  it("matches a credential parameter name case-insensitively", () => {
    expect(decide("http://127.0.0.1:8787/a?API_KEY=x").kind).toBe("rejected");
  });
});

describe("default-port origins", () => {
  it("accepts the default port only when the target uses it", () => {
    const policy: DiscoveredUrlPolicy = {
      authorizedOrigin: "https://example.invalid",
      authorizedPort: "",
    };
    expect(
      authorizeDiscoveredUrl("https://example.invalid/a", true, policy).kind,
    ).toBe("authorized");
    expect(
      authorizeDiscoveredUrl("https://example.invalid:8443/a", true, policy),
    ).toStrictEqual({ kind: "rejected", reason: "forbidden-port" });
  });

  it("rejects an http URL against an https origin on the same host", () => {
    const policy: DiscoveredUrlPolicy = {
      authorizedOrigin: "https://example.invalid",
      authorizedPort: "",
    };
    // Port "" matches for `http:` too, so this is the case that proves the
    // origin check is not redundant with the port check.
    expect(
      authorizeDiscoveredUrl("http://example.invalid/a", true, policy),
    ).toStrictEqual({ kind: "rejected", reason: "cross-origin" });
  });
});
