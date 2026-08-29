import { describe, expect, it } from "vitest";

import type { HttpRequestKeyInput } from "../src/index.js";
import { canonicalRequestKey, canonicalUrl } from "../src/index.js";

/**
 * ADR-0005 section 3 and `docs/ARCHITECTURE.md` section 19.
 *
 * Two of these are M1 acceptance criteria ("two representation-different
 * probes do not deduplicate", "identical probes deduplicate across rules") and
 * two are the defect ADR-0005 was written to close: a key naming a singular
 * "body limit" merges two different safety postures, so the rule that lowered
 * one limit is handed the other rule's response.
 */

function key(overrides: Partial<HttpRequestKeyInput> = {}): string {
  const base: HttpRequestKeyInput = {
    kind: "http",
    method: "GET",
    url: "http://127.0.0.1:8787/robots.txt",
    representationHeaders: new Map([["accept", ["text/plain"]]]),
    redirects: "follow-same-origin",
    maxRedirects: 5,
    maxEncodedBytes: 1048576,
    maxDecodedBytes: 2097152,
    scope: "local",
    networkProfile: "local-loopback",
  };
  return canonicalRequestKey({ ...base, ...overrides });
}

describe("representation", () => {
  it("gives Accept: text/html and Accept: text/markdown two keys", () => {
    const html = key({
      url: "http://127.0.0.1:8787/",
      representationHeaders: new Map([["accept", ["text/html"]]]),
    });
    const markdown = key({
      url: "http://127.0.0.1:8787/",
      representationHeaders: new Map([["accept", ["text/markdown"]]]),
    });

    expect(new Set([html, markdown]).size).toBe(2);
  });

  it("gives four rules asking for /robots.txt one key", () => {
    const keys = ["robots", "ai-crawler", "content-signals", "fourth"].map(() =>
      key(),
    );

    expect(new Set(keys).size).toBe(1);
  });

  it("lowercases header names and trims optional whitespace", () => {
    expect(
      key({ representationHeaders: new Map([["Accept", ["  text/plain  "]]]) }),
    ).toBe(key());
  });
});

describe("safety limits", () => {
  // The defect ADR-0005 section 3 exists to close. Each of these two
  // assertions fails independently if the key carries one merged byte limit.
  it("does not alias requests differing only in maxEncodedBytes", () => {
    expect(key({ maxEncodedBytes: 4096 })).not.toBe(key());
  });

  it("does not alias requests differing only in maxDecodedBytes", () => {
    expect(key({ maxDecodedBytes: 4096 })).not.toBe(key());
  });

  it("separates the two limits rather than summing them", () => {
    // A key that mixed the two would make these equal: both have the same
    // pair of numbers, in the opposite roles.
    expect(key({ maxEncodedBytes: 10, maxDecodedBytes: 20 })).not.toBe(
      key({ maxEncodedBytes: 20, maxDecodedBytes: 10 }),
    );
  });
});

describe("the remaining components", () => {
  const variants: readonly (readonly [string, Partial<HttpRequestKeyInput>])[] =
    [
      ["method", { method: "HEAD" }],
      ["url", { url: "http://127.0.0.1:8787/sitemap.xml" }],
      ["redirect policy", { redirects: "reject" }],
      ["max redirects", { maxRedirects: 2 }],
      ["network scope", { scope: "remote" }],
      ["network profile", { networkProfile: "ci-public" }],
    ];

  it.each(variants)("%s changes the key", (_name, overrides) => {
    expect(key(overrides)).not.toBe(key());
  });

  it("keeps a dns key apart from an http key with the same fields", () => {
    const dns = canonicalRequestKey({
      kind: "dns",
      name: "example.invalid",
      recordType: "TXT",
      scope: "local",
      networkProfile: "local-loopback",
    });
    expect(dns).not.toBe(key());
  });

  it("is stable across two constructions of the same request", () => {
    expect(key()).toBe(key());
  });
});

describe("canonical URL", () => {
  it.each([
    [
      "lowercases the scheme and host",
      "HTTP://ExAmPle.invalid/a",
      "http://example.invalid/a",
    ],
    [
      "removes the scheme's default port",
      "http://example.invalid:80/a",
      "http://example.invalid/a",
    ],
    [
      "keeps a non-default port",
      "http://example.invalid:8787/a",
      "http://example.invalid:8787/a",
    ],
    [
      "normalizes an empty path",
      "http://example.invalid",
      "http://example.invalid/",
    ],
    [
      "uppercases percent-encoding",
      "http://example.invalid/%2fa%ab",
      "http://example.invalid/%2Fa%AB",
    ],
    [
      "removes the fragment",
      "http://example.invalid/a#frag",
      "http://example.invalid/a",
    ],
  ])("%s", (_name, raw, expected) => {
    expect(canonicalUrl(raw)).toBe(expected);
  });

  it("preserves the query byte for byte", () => {
    // The WHATWG serializer re-encodes a raw space in the query; ADR-0005
    // section 3 requires the query preserved exactly, so the raw substring is
    // what reaches the key.
    expect(canonicalUrl("http://example.invalid/a?b c=%2fd")).toBe(
      "http://example.invalid/a?b c=%2fd",
    );
  });

  it("returns null for input the URL parser rejects", () => {
    expect(canonicalUrl("/relative")).toBeNull();
  });

  it("gives two URLs differing only in percent-encoding case one key", () => {
    expect(key({ url: canonicalUrl("http://h.invalid/%2f") ?? "" })).toBe(
      key({ url: canonicalUrl("http://h.invalid/%2F") ?? "" }),
    );
  });
});
