import { describe, expect, it } from "vitest";

import { applyUrlPolicy } from "../src/index.js";

/**
 * `docs/THREAT_MODEL.md` sections 11 and 27.1.
 *
 * Section 27.1's list is split across this file and `network-policy.test.ts`
 * on purpose, because the two halves fail for different reasons and a test
 * that does not distinguish them would pass for the wrong one. A `gopher:`
 * URL is refused by the URL policy. `http://2130706433/` is not: it is a
 * perfectly well-formed HTTP URL, and what stops it is that the WHATWG parser
 * canonicalizes it to `127.0.0.1` and the address and origin policies then get
 * to see a normal loopback address. Section 11 says exactly that: "IP
 * classification must occur after canonical parsing so none of these bypass
 * the address policy."
 */

function reasonFor(raw: string): string {
  const result = applyUrlPolicy(raw);
  return result.kind === "rejected" ? result.reason.code : "accepted";
}

describe("scheme policy", () => {
  it.each([
    ["file:///etc/passwd", "prohibited-scheme"],
    ["gopher://127.0.0.1/", "prohibited-scheme"],
    ["ftp://127.0.0.1/", "prohibited-scheme"],
    ["data:text/plain,hello", "prohibited-scheme"],
    ["javascript:alert(1)", "prohibited-scheme"],
    ["ws://127.0.0.1/", "prohibited-scheme"],
  ])("refuses %s", (raw, code) => {
    expect(reasonFor(raw)).toBe(code);
  });

  it("accepts only absolute URLs", () => {
    expect(reasonFor("/robots.txt")).toBe("invalid-url");
    expect(reasonFor("//127.0.0.1/robots.txt")).toBe("invalid-url");
    expect(reasonFor("127.0.0.1/robots.txt")).toBe("invalid-url");
  });
});

describe("credentials in the authority", () => {
  it.each([
    "http://user:pass@example.com/",
    "http://user@example.com/",
    "http://example.com@127.0.0.1/",
    "http://:pass@127.0.0.1/",
    "http://us%65r@127.0.0.1/",
    "http://user:p%40ss@127.0.0.1/",
  ])("refuses %s", (raw) => {
    expect(reasonFor(raw)).toBe("credentials-in-url");
  });

  it("refuses userinfo even when a root dot would rebuild the authority", () => {
    // The root-dot normalization re-parses the URL, and a rebuild drops
    // userinfo. Judging credentials only after that rebuild would let this
    // through, which is why the check runs on the first parse.
    expect(reasonFor("http://user@localhost./")).toBe("credentials-in-url");
  });
});

describe("hostile syntax", () => {
  it("refuses raw control characters that the parser would silently strip", () => {
    // The WHATWG parser removes tab, CR and LF from its input before parsing,
    // so `http://127.0.0.1\r\n.evil/` would parse as a different host than a
    // reader of the string expects.
    expect(reasonFor("http://127.0.0.1/\r\nX-Injected: 1")).toBe("invalid-url");
    expect(reasonFor("http://127.0.0.1/\tpath")).toBe("invalid-url");
    expect(reasonFor("http://127.0.0.1/\u0000")).toBe("invalid-url");
    expect(reasonFor("http://127.0.0.1/\u001B[31m")).toBe("invalid-url");
    expect(reasonFor("http://127.0.0.1/\u007F")).toBe("invalid-url");
  });

  it("refuses invalid Unicode", () => {
    expect(reasonFor("http://127.0.0.1/\ud800")).toBe("invalid-url");
  });

  it("refuses an IPv6 zone identifier", () => {
    expect(reasonFor("http://[fe80::1%25eth0]/")).toBe("invalid-url");
    expect(reasonFor("http://[fe80::1%eth0]/")).toBe("invalid-url");
  });

  it("refuses an empty host and a malformed port", () => {
    expect(reasonFor("http://")).toBe("invalid-url");
    expect(reasonFor("http://:8080/")).toBe("invalid-url");
    expect(reasonFor("http://127.0.0.1:0/")).toBe("unsafe-port");
    expect(reasonFor("http://127.0.0.1:99999/")).toBe("invalid-url");
    expect(reasonFor("http://127.0.0.1:http/")).toBe("invalid-url");
  });

  it("refuses a URL over 2,048 UTF-8 bytes", () => {
    const long = `http://127.0.0.1/${"a".repeat(2048)}`;
    expect(reasonFor(long)).toBe("invalid-url");
    // Counted in UTF-8 bytes, not code units: a two-byte character costs two.
    const multibyte = `http://127.0.0.1/${"é".repeat(1030)}`;
    expect(reasonFor(multibyte)).toBe("invalid-url");
  });
});

describe("canonicalization", () => {
  function targetFor(raw: string) {
    const result = applyUrlPolicy(raw);
    if (result.kind !== "url") {
      throw new Error(`expected ${raw} to be accepted`);
    }
    return result.target;
  }

  it.each([
    ["http://127.0.0.1/", "127.0.0.1"],
    ["http://127.1/", "127.0.0.1"],
    ["http://2130706433/", "127.0.0.1"],
    ["http://0x7f000001/", "127.0.0.1"],
    ["http://0177.0.0.1/", "127.0.0.1"],
    ["http://%31%32%37.0.0.1/", "127.0.0.1"],
    ["http://127。0。0。1/", "127.0.0.1"],
    ["http://127.0.0.1./", "127.0.0.1"],
    ["http://[::1]/", "[::1]"],
    ["http://[::ffff:127.0.0.1]/", "[::ffff:7f00:1]"],
    ["http://[64:ff9b::7f00:1]/", "[64:ff9b::7f00:1]"],
    ["http://169.254.169.254/", "169.254.169.254"],
    ["http://100.100.100.200/", "100.100.100.200"],
    ["http://METADATA.google.INTERNAL/", "metadata.google.internal"],
    ["http://localhost./", "localhost"],
  ])("canonicalizes %s to host %s", (raw, hostname) => {
    expect(targetFor(raw).hostname).toBe(hostname);
  });

  it("removes the fragment and reports that it did", () => {
    const target = targetFor("http://127.0.0.1/a?b=1#frag");
    expect(target.href).toBe("http://127.0.0.1/a?b=1");
    expect(target.requestPath).toBe("/a?b=1");
    expect(target.fragmentIgnored).toBe(true);
  });

  it("makes the port explicit and keeps it out of a default-port origin", () => {
    expect(targetFor("http://127.0.0.1/").port).toBe(80);
    expect(targetFor("https://127.0.0.1/").port).toBe(443);
    expect(targetFor("http://127.0.0.1:80/").origin).toBe("http://127.0.0.1");
    expect(targetFor("http://127.0.0.1:8080/").origin).toBe(
      "http://127.0.0.1:8080",
    );
  });

  it("derives the Host field from the canonical URL", () => {
    expect(targetFor("http://127.0.0.1:8080/x").hostHeader).toBe(
      "127.0.0.1:8080",
    );
    expect(targetFor("http://[::1]:8080/x").hostHeader).toBe("[::1]:8080");
    expect(targetFor("http://127.0.0.1/x").hostHeader).toBe("127.0.0.1");
  });

  it("keeps percent-encoded CR and LF as path data", () => {
    // Section 11: "Percent-encoded CR or LF in a path must remain path data.
    // It must never be decoded and interpolated into a raw HTTP request."
    const target = targetFor("http://127.0.0.1/a%0d%0aX-Injected:%201");
    expect(target.requestPath).toBe("/a%0D%0AX-Injected:%201");
    expect(target.requestPath).not.toContain("\r");
    expect(target.requestPath).not.toContain("\n");
  });

  it("normalizes percent-encoding to uppercase hex, as ADR-0005 section 3 requires", () => {
    expect(targetFor("http://127.0.0.1/%2fa").requestPath).toBe("/%2Fa");
  });

  it("resolves a relative reference against a base with the same parser", () => {
    const result = applyUrlPolicy("/next", "http://127.0.0.1:8080/first");
    expect(result.kind).toBe("url");
    if (result.kind !== "url") return;
    expect(result.target.href).toBe("http://127.0.0.1:8080/next");
  });

  it("applies the whole policy to a relative reference too", () => {
    expect(
      applyUrlPolicy("//user@evil.example/", "http://127.0.0.1:8080/first"),
    ).toStrictEqual({
      kind: "rejected",
      reason: { code: "credentials-in-url", phase: "policy" },
    });
  });
});
