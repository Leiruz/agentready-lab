import net from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  NetworkSentinelError,
  callerPackageFromStack,
  expectNoConnections,
  installNetworkSentinel,
  isLoopbackHost,
  openConnectionCanary,
} from "../../src/index.js";
import type { SentinelHandle } from "../../src/index.js";

/**
 * This file lives in `test/loopback/` because it opens real loopback sockets,
 * and because it cannot run under the `deny-all` setup file at all.
 *
 * Sentinel installs nest: an inner install captures whatever the outer one put
 * in place and calls through to it. So a `loopback-only` install inside a
 * `deny-all` one refuses even a loopback connection, and `openConnectionCanary`
 * cannot bind, because `Server#listen` with a host argument goes through
 * `dns.lookup`. Both are asserted below rather than left as folklore, and both
 * are why `vitest.config.ts` must route this directory to the loopback tier.
 */
let installed: SentinelHandle | undefined;

afterEach(() => {
  installed?.restore();
  installed = undefined;
});

function connect(host: string, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("error", reject);
  });
}

describe("deny-all", () => {
  it("replaces fetch with a stub that names the API and the tier", () => {
    installed = installNetworkSentinel("deny-all");

    // Synchronously, and not as a rejected promise: a rejection can be
    // swallowed by a floating call and still leave the suite green.
    expect(() => fetch("http://example.invalid/")).toThrow(
      NetworkSentinelError,
    );
    expect(() => fetch("http://example.invalid/")).toThrow(
      /called fetch\(\).*deny-all network sentinel/s,
    );
    expect(installed.blocked.map((attempt) => attempt.api)).toStrictEqual([
      "fetch()",
      "fetch()",
    ]);
    expect(installed.blocked[0]?.target).toBe("http://example.invalid/");
  });

  it("refuses a loopback socket too", async () => {
    const canary = await openConnectionCanary();
    try {
      installed = installNetworkSentinel("deny-all");
      await expect(connect(canary.host, canary.port)).rejects.toThrow(
        NetworkSentinelError,
      );
      installed.restore();
      installed = undefined;
      expectNoConnections(canary);
    } finally {
      await canary.close();
    }
  });

  it("patches the module-level entry points it can reach", () => {
    installed = installNetworkSentinel("deny-all");

    expect(installed.patched).toContain("net.Socket#connect");
    expect(installed.patched).toContain("http.request");
    expect(installed.patched).toContain("dns.lookup");
    expect(installed.patched).toContain("fetch");
  });

  it("restores every replaced binding", () => {
    const beforeFetch = globalThis.fetch;
    // Identity comparison only; the reference below is never called.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const beforeConnect = net.Socket.prototype.connect;

    const handle = installNetworkSentinel("deny-all");
    expect(globalThis.fetch).not.toBe(beforeFetch);
    handle.restore();

    expect(globalThis.fetch).toBe(beforeFetch);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(net.Socket.prototype.connect).toBe(beforeConnect);
    expect(handle.patched).toStrictEqual([]);
  });
});

describe("loopback-only", () => {
  it("lets a loopback connection through and counts it on the canary", async () => {
    const canary = await openConnectionCanary();
    try {
      installed = installNetworkSentinel("loopback-only");
      await connect(canary.host, canary.port);
      installed.restore();
      installed = undefined;

      expect(canary.connections).toBe(1);
      expect(() => {
        expectNoConnections(canary);
      }).toThrow(/1 connection/);
    } finally {
      await canary.close();
    }
  });

  // 192.0.2.0/24 is TEST-NET-1 (RFC 5737) and is never routed, so a guard that
  // failed open here would hang rather than connect. These assert a
  // *synchronous* refusal for that reason: an unrefused call is a 21-second
  // connect timeout, not a fast failure.
  //
  // Every entry point below normalizes its arguments and calls
  // `socket.connect([options, listener])` with one array argument. The first
  // version of the destination check read `host` off that array, found none,
  // defaulted to `localhost` and admitted all three.
  it.each([
    [
      "net.connect(options)",
      (): unknown => net.connect({ host: "192.0.2.1", port: 80 }),
    ],
    ["net.connect(port, host)", (): unknown => net.connect(80, "192.0.2.1")],
    [
      "net.createConnection(options)",
      (): unknown => net.createConnection({ host: "192.0.2.1", port: 80 }),
    ],
    [
      "socket.connect(options)",
      (): unknown => new net.Socket().connect({ host: "192.0.2.1", port: 80 }),
    ],
  ])("refuses %s to a non-loopback destination", (_name, open) => {
    installed = installNetworkSentinel("loopback-only");

    expect(open).toThrow(NetworkSentinelError);
    expect(installed.blocked[0]?.target).toBe("192.0.2.1");
  });

  it("still refuses a fetch to a destination that is not loopback", () => {
    installed = installNetworkSentinel("loopback-only");

    expect(() => fetch("https://example.invalid/")).toThrow(
      NetworkSentinelError,
    );
  });

  it("leaves the Node module entry points alone so real sockets work", () => {
    installed = installNetworkSentinel("loopback-only");

    expect(installed.patched).toContain("net.Socket#connect");
    expect(installed.patched).not.toContain("http.request");
    expect(installed.patched).not.toContain("dns.lookup");
  });
});

describe("nesting", () => {
  it("refuses a loopback connection when loopback-only sits inside deny-all", async () => {
    const canary = await openConnectionCanary();
    const outer = installNetworkSentinel("deny-all");
    try {
      installed = installNetworkSentinel("loopback-only");
      // The inner tier admits the destination and then calls through to the
      // outer tier, which does not. This is why the loopback suites need their
      // own project rather than a nested install inside the unit project.
      await expect(connect(canary.host, canary.port)).rejects.toThrow(
        NetworkSentinelError,
      );
      installed.restore();
      installed = undefined;
      expectNoConnections(canary);
    } finally {
      outer.restore();
      await canary.close();
    }
  });

  it("cannot bind a connection canary under deny-all", async () => {
    const outer = installNetworkSentinel("deny-all");
    try {
      // `Server#listen(port, host)` resolves the host through `dns.lookup`,
      // which deny-all refuses. The canary is a loopback-tier instrument.
      await expect(openConnectionCanary()).rejects.toThrow(
        /called dns\.lookup for 127\.0\.0\.1/,
      );
    } finally {
      outer.restore();
    }
  });
});

describe("caller attribution", () => {
  it.each([
    [
      "    at plan (/repo/packages/rules-standard/src/robots.ts:12:3)",
      "packages/rules-standard",
    ],
    [
      "    at handler (C:\\repo\\packages\\reporters\\src\\json.ts:4:1)",
      "packages/reporters",
    ],
    [
      "    at fetch (file:///repo/apps/fixtures-worker/src/index.ts:9:2)",
      "apps/fixtures-worker",
    ],
  ])("names the calling package for %s", (frame, expected) => {
    expect(callerPackageFromStack(`Error: sentinel\n${frame}`)).toBe(expected);
  });

  it("skips its own frames and reports the first foreign package", () => {
    const stack = [
      "Error: sentinel",
      "    at refuse (/repo/packages/testkit/src/sentinel/network-sentinel.ts:1:1)",
      "    at guardedFetch (/repo/packages/testkit/src/sentinel/network-sentinel.ts:2:1)",
      "    at step (/repo/packages/rules-standard/src/robots.ts:12:3)",
    ].join("\n");

    expect(callerPackageFromStack(stack)).toBe("packages/rules-standard");
  });

  it("says so when no workspace frame is present", () => {
    expect(callerPackageFromStack(undefined)).toBe("an unidentified caller");
    expect(
      callerPackageFromStack("Error: sentinel\n    at node:internal"),
    ).toBe("an unidentified caller");
  });
});

describe("loopback host classification", () => {
  it.each(["127.0.0.1", "127.1.2.3", "localhost", "LOCALHOST", "::1", "[::1]"])(
    "accepts %s",
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each(["example.invalid", "192.0.2.1", "0.0.0.0", "127.example.com", ""])(
    "refuses %s",
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );
});

describe("connection canary", () => {
  it("counts zero when nothing connects", async () => {
    const canary = await openConnectionCanary();
    try {
      expect(canary.connections).toBe(0);
      expect(canary.peers).toStrictEqual([]);
      expect(canary.origin).toBe(
        `http://${canary.host}:${String(canary.port)}`,
      );
      expectNoConnections(canary);
    } finally {
      await canary.close();
    }
  });

  it("counts each accepted connection in order", async () => {
    const canary = await openConnectionCanary();
    try {
      await connect(canary.host, canary.port);
      await connect(canary.host, canary.port);

      expect(canary.connections).toBe(2);
      expect(canary.peers).toHaveLength(2);
    } finally {
      await canary.close();
    }
  });
});
