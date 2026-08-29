import { describe, expect, it } from "vitest";

import {
  classifyAddress,
  isDeniedInPublicProfile,
  sameAddress,
} from "../src/index.js";
import type { AddressClass } from "../src/index.js";

/**
 * `docs/THREAT_MODEL.md` section 12.1, and `.claude/rules/security.md`'s
 * required adversarial coverage: "loopback, private, link-local, multicast,
 * unspecified, reserved, and metadata destinations across IPv4 and IPv6" plus
 * "IPv4-mapped IPv6, alternative numeric forms".
 *
 * The classifier is table-driven because the failure mode it guards against is
 * a range that quietly reads as public. Section 12.1's rule is that
 * "conservative over-blocking is preferable to treating an unknown range as
 * public", so the two `public` rows below are as load-bearing as the denials:
 * without them a classifier that denied everything would pass this file.
 */

function classOf(text: string): AddressClass | "not-an-address" {
  const result = classifyAddress(text);
  return result.kind === "address" ? result.addressClass : "not-an-address";
}

describe("IPv4 classification", () => {
  it.each<[string, AddressClass]>([
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["10.0.0.1", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.168.1.1", "private"],
    ["169.254.169.254", "link-local"],
    ["100.64.0.1", "carrier-grade-nat"],
    ["100.100.100.200", "carrier-grade-nat"],
    ["0.0.0.0", "unspecified"],
    ["224.0.0.1", "multicast"],
    ["239.255.255.255", "multicast"],
    ["255.255.255.255", "broadcast"],
    ["192.0.0.1", "reserved"],
    ["192.0.2.1", "documentation"],
    ["198.51.100.1", "documentation"],
    ["203.0.113.1", "documentation"],
    ["198.18.0.1", "benchmarking"],
    ["198.19.255.255", "benchmarking"],
    ["192.88.99.1", "reserved"],
    ["240.0.0.1", "reserved"],
    ["8.8.8.8", "public"],
    ["93.184.216.34", "public"],
    ["172.32.0.1", "public"],
  ])("classifies %s as %s", (address, expected) => {
    expect(classOf(address)).toBe(expected);
  });
});

describe("IPv6 classification", () => {
  it.each<[string, AddressClass]>([
    ["::1", "loopback"],
    ["0:0:0:0:0:0:0:1", "loopback"],
    ["::", "unspecified"],
    ["fe80::1", "link-local"],
    ["febf::1", "link-local"],
    ["fc00::1", "unique-local"],
    ["fd00::1", "unique-local"],
    ["ff02::1", "multicast"],
    ["2001:db8::1", "documentation"],
    ["3fff::1", "documentation"],
    ["2001:2::1", "benchmarking"],
    ["2001::1", "reserved"],
    ["2002::1", "reserved"],
    ["100::1", "reserved"],
    ["5f00::1", "reserved"],
    ["2606:4700:4700::1111", "public"],
    ["2001:4860:4860::8888", "public"],
  ])("classifies %s as %s", (address, expected) => {
    expect(classOf(address)).toBe(expected);
  });

  it("keeps the brackets of a serialized IPv6 host out of the decision", () => {
    expect(classOf("[::1]")).toBe("loopback");
  });
});

describe("transition forms are judged by the IPv4 they carry", () => {
  it.each<[string, AddressClass]>([
    ["::ffff:127.0.0.1", "loopback"],
    ["::ffff:7f00:1", "loopback"],
    ["::ffff:10.0.0.1", "private"],
    ["::ffff:169.254.169.254", "link-local"],
    ["::ffff:93.184.216.34", "public"],
    ["::127.0.0.1", "loopback"],
    ["64:ff9b::7f00:1", "loopback"],
    ["64:ff9b::169.254.169.254", "link-local"],
    ["64:ff9b::808:808", "public"],
  ])("classifies %s as %s", (address, expected) => {
    expect(classOf(address)).toBe(expected);
  });

  it("reports the embedded IPv4 so a caller can say which range matched", () => {
    const result = classifyAddress("[::ffff:7f00:1]");
    expect(result.kind).toBe("address");
    if (result.kind !== "address") return;
    expect(result.embeddedIpv4).toBe("127.0.0.1");
  });
});

describe("values the classifier refuses to read", () => {
  it.each([
    "localhost",
    "example.com",
    "metadata.google.internal",
    "",
    // Alternative numeric spellings never reach the classifier: the WHATWG
    // parser canonicalizes them first (see url-policy.test.ts). If one does
    // arrive, section 12.1 requires "any value the classifier cannot parse
    // unambiguously" to be denied, so it must not read as an address here.
    "0177.0.0.1",
    "2130706433",
    "0x7f000001",
    "127.1",
    "999.1.1.1",
    "127.0.0.1.5",
    "fe80::1%eth0",
    "::1::2",
    "1:2:3:4:5:6:7",
  ])("refuses to classify %s", (text) => {
    expect(classOf(text)).toBe("not-an-address");
  });
});

describe("the public-profile predicate", () => {
  it("admits only global unicast", () => {
    expect(isDeniedInPublicProfile("public")).toBe(false);
    for (const denied of [
      "loopback",
      "private",
      "unique-local",
      "link-local",
      "carrier-grade-nat",
      "unspecified",
      "multicast",
      "broadcast",
      "documentation",
      "benchmarking",
      "reserved",
    ] as const) {
      expect(isDeniedInPublicProfile(denied)).toBe(true);
    }
  });
});

describe("peer comparison", () => {
  it("sees through spelling and the IPv4-mapped wrapper", () => {
    // A dual-stack listener reports `::ffff:127.0.0.1` for a connection the
    // policy selected as `127.0.0.1`. Raw string equality would fail closed on
    // a correct connection, which is a false alarm, not a defence.
    expect(sameAddress("::1", "0:0:0:0:0:0:0:1")).toBe(true);
    expect(sameAddress("127.0.0.1", "::ffff:127.0.0.1")).toBe(true);
    expect(sameAddress("127.0.0.1", "127.0.0.1")).toBe(true);
  });

  it("still separates different addresses and unparsable text", () => {
    expect(sameAddress("127.0.0.1", "127.0.0.2")).toBe(false);
    expect(sameAddress("::1", "::2")).toBe(false);
    expect(sameAddress("127.0.0.1", "localhost")).toBe(false);
    expect(sameAddress("localhost", "localhost")).toBe(false);
  });
});
