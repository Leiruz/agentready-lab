import { describe, expect, it } from "vitest";

import {
  LocalLoopbackPolicy,
  applyUrlPolicy,
  createNetworkPolicy,
  createNodeTransport,
} from "../src/index.js";
import type { CanonicalTarget } from "../src/index.js";
import {
  createConnectorSpy,
  loopbackPolicy,
  makeRequest,
} from "./support/loopback.js";

/**
 * `docs/THREAT_MODEL.md` sections 9 and 27.1, and `docs/ROADMAP.md` M1's
 * criterion that "the `ci-public` profile exits as an
 * unsupported/configuration condition and makes no public connection".
 */

function targetFor(raw: string): CanonicalTarget {
  const result = applyUrlPolicy(raw);
  if (result.kind !== "url") throw new Error(`unparsable target ${raw}`);
  return result.target;
}

describe("profile selection", () => {
  it.each(["ci-public", "hosted-public"] as const)(
    "%s is unsupported and yields no policy object",
    (profile) => {
      for (const url of [
        "http://127.0.0.1:8080/",
        "https://example.com/",
        "http://93.184.216.34/",
      ]) {
        const result = createNetworkPolicy(profile, url);
        expect(result.kind).toBe("unsupported-profile");
        if (result.kind !== "unsupported-profile") return;
        expect(result.profile).toBe(profile);
      }
    },
  );

  it("has no constructor that yields a non-loopback policy", () => {
    // The structural half of the same guarantee. `LocalLoopbackPolicy` is the
    // only policy type in the package and its `id` is a literal type, so a
    // `ci-public` policy is not a value that exists. This asserts the runtime
    // consequence: whatever `createNetworkPolicy` returns as a policy is a
    // loopback one.
    const result = createNetworkPolicy("local-loopback", "http://127.0.0.1:1/");
    expect(result.kind).toBe("policy");
    if (result.kind !== "policy") return;
    expect(result.policy).toBeInstanceOf(LocalLoopbackPolicy);
    expect(result.policy.id).toBe("local-loopback");
  });
});

describe("what may be a local-loopback target", () => {
  it("accepts an exact IPv4 loopback origin", () => {
    const policy = loopbackPolicy("http://127.0.0.1:8080/anything");
    expect(policy.origin).toBe("http://127.0.0.1:8080");
    expect(policy.address).toBe("127.0.0.1");
    expect(policy.family).toBe(4);
  });

  it("accepts an exact IPv6 loopback origin", () => {
    const policy = loopbackPolicy("http://[::1]:8080/");
    expect(policy.origin).toBe("http://[::1]:8080");
    expect(policy.address).toBe("::1");
    expect(policy.family).toBe(6);
  });

  it.each([
    ["http://localhost:8080/", "unsafe-address"],
    ["http://metadata.google.internal/", "unsafe-address"],
    ["http://10.0.0.1:8080/", "unsafe-address"],
    ["http://169.254.169.254/", "unsafe-address"],
    ["http://100.100.100.200/", "unsafe-address"],
    ["http://[fc00::1]/", "unsafe-address"],
    ["http://93.184.216.34/", "unsafe-address"],
    ["http://user@127.0.0.1/", "credentials-in-url"],
    ["ftp://127.0.0.1/", "prohibited-scheme"],
    ["http://127.0.0.1:0/", "unsafe-port"],
  ])("refuses %s", (url, code) => {
    const result = createNetworkPolicy("local-loopback", url);
    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.reason.code).toBe(code);
  });
});

describe("exact-origin authorization", () => {
  const policy = loopbackPolicy("http://127.0.0.1:8080/");

  it("admits another path on the same origin", () => {
    const result = policy.authorize(
      targetFor("http://127.0.0.1:8080/robots.txt"),
      "target",
    );
    expect(result).toStrictEqual({
      kind: "authorized",
      address: "127.0.0.1",
      family: 4,
    });
  });

  it.each([
    ["http://127.0.0.1:8081/", "a different loopback port"],
    ["http://localhost:8080/", "the same address under a different name"],
    ["http://127.0.0.2:8080/", "a different loopback address"],
    ["http://[::1]:8080/", "the IPv6 loopback"],
    ["https://127.0.0.1:8080/", "a scheme change"],
    ["http://10.0.0.1:8080/", "a private LAN address"],
    ["http://169.254.169.254/", "a metadata address"],
  ])("refuses %s (%s)", (url) => {
    const result = policy.authorize(targetFor(url), "target");
    expect(result.kind).toBe("blocked");
  });

  it("phrases a hop refusal as redirect-blocked", () => {
    const result = policy.authorize(
      targetFor("http://127.0.0.1:8081/"),
      "redirect",
    );
    expect(result).toStrictEqual({
      kind: "blocked",
      reason: { code: "redirect-blocked", phase: "redirect" },
    });
  });

  it("compares origins as strings and not as addresses", () => {
    // `sec-004`. `localhost` and `127.0.0.1` are the same machine and a
    // different origin, and the policy is an origin policy.
    const localhostTarget = targetFor("http://localhost:8080/");
    expect(localhostTarget.port).toBe(policy.port);
    expect(policy.authorize(localhostTarget, "target").kind).toBe("blocked");
  });

  it("projects the non-budget half of the report policy", () => {
    expect(policy.toIdentity()).toStrictEqual({
      id: "local-loopback",
      version: "0.1.0",
      allowedSchemes: ["http"],
      allowedPorts: [8080],
      sameOriginDiscovery: true,
    });
  });
});

describe("no socket exists for a refused destination", () => {
  /**
   * `docs/THREAT_MODEL.md` section 27.1: "Each unsafe target must fail before a
   * socket opens." The connector spy is what turns that into a measurement.
   */
  const policy = loopbackPolicy("http://127.0.0.1:44100/");

  it.each([
    "http://127.0.0.1/",
    "http://127.1/",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://0177.0.0.1/",
    "http://%31%32%37.0.0.1/",
    "http://127。0。0。1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[64:ff9b::7f00:1]/",
    "http://[fe80::1%25eth0]/",
    "http://169.254.169.254/",
    "http://100.100.100.200/",
    "http://metadata.google.internal/",
    "http://user:pass@example.com/",
    "http://example.com@127.0.0.1/",
    "file:///etc/passwd",
    "gopher://127.0.0.1/",
    "ftp://127.0.0.1/",
    "data:text/plain,hello",
    "javascript:alert(1)",
    "http://127.0.0.1:44101/",
    "http://localhost:44100/",
    "http://10.0.0.1:44100/",
    "http://192.168.1.1:44100/",
    "http://172.16.0.1:44100/",
    "http://224.0.0.1:44100/",
    "http://0.0.0.0:44100/",
    "http://255.255.255.255:44100/",
    "http://198.18.0.1:44100/",
    "http://192.0.2.1:44100/",
    "http://[fc00::1]:44100/",
    "http://[ff02::1]:44100/",
    "https://127.0.0.1:44100/",
  ])("opens no connection for %s", async (url) => {
    const spy = createConnectorSpy();
    const transport = createNodeTransport({ policy, openExchange: spy.open });

    const result = await transport.http(makeRequest(url));

    expect(spy.attempts).toStrictEqual([]);
    expect(result.kind).toBe("failure");
  });

  it("does open a connection for the exact origin", () => {
    // The control. Without it, a transport that connected to nothing at all
    // would satisfy every case above.
    const spy = createConnectorSpy();
    const transport = createNodeTransport({ policy, openExchange: spy.open });

    return transport
      .http(makeRequest("http://127.0.0.1:44100/robots.txt"))
      .then(() => {
        expect(spy.attempts).toHaveLength(1);
        expect(spy.attempts[0]?.address).toBe("127.0.0.1");
        expect(spy.attempts[0]?.port).toBe(44100);
        expect(spy.attempts[0]?.requestPath).toBe("/robots.txt");
      });
  });
});
