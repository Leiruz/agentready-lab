import { describe, expect, it } from "vitest";

import { runCli } from "../src/run.js";
import type { CommandResult } from "../src/result.js";
import { testEnvironment } from "./support/environment.js";

/**
 * The target URL, and the one refusal a developer will actually hit.
 *
 * `LocalLoopbackPolicy.forTarget` takes an IP literal and nothing else, which
 * is correct and is not discoverable from the refusal the transport package
 * produces. `http://localhost:3000` is what a preview server prints, so the
 * message for it is a tested contract rather than a nicety.
 */

async function check(
  url: string,
): Promise<CommandResult & { readonly httpCalls: number }> {
  const { environment, probe } = testEnvironment({
    argv: ["check", url],
  });
  const result = await runCli(environment);
  return { ...result, httpCalls: probe.httpCalls };
}

describe("localhost", () => {
  it("explains what happened, why, and the exact command to run", async () => {
    const result = await check("http://localhost:3000");

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    // What happened.
    expect(result.stderr).toContain(
      '"localhost" is a host name, and the local-loopback profile accepts only an IP literal',
    );
    // Why, in terms of the boundary rather than of an internal function.
    expect(result.stderr).toContain("hosts file, NSS and a DNS answer");
    expect(result.stderr).toContain("docs/THREAT_MODEL.md section 12.2");
    // The exact command, with the port kept.
    expect(result.stderr).toContain(
      "agentready-lab check http://127.0.0.1:3000/",
    );
    expect(result.httpCalls).toBe(0);
  });

  it("keeps the path and query in the suggested command", async () => {
    const result = await check("http://localhost:8080/a/b?c=d");
    expect(result.stderr).toContain(
      "agentready-lab check http://127.0.0.1:8080/a/b?c=d",
    );
  });

  it("omits the port when the URL used the scheme default", async () => {
    const result = await check("http://localhost/");
    expect(result.stderr).toContain("agentready-lab check http://127.0.0.1/");
  });

  it("keeps the scheme", async () => {
    const result = await check("https://localhost:8443/");
    expect(result.stderr).toContain(
      "agentready-lab check https://127.0.0.1:8443/",
    );
  });

  it("mentions the IPv6 form, which a v6-only listener needs", async () => {
    const result = await check("http://localhost:3000");
    expect(result.stderr).toContain("Use [::1] in place of 127.0.0.1");
  });

  /**
   * `url-policy.ts` normalizes a trailing DNS root dot, so this is the same
   * origin to the policy and has to get the same explanation.
   */
  it("gives the same explanation for a trailing root dot", async () => {
    const result = await check("http://localhost.:3000/");
    expect(result.stderr).toContain(
      "agentready-lab check http://127.0.0.1:3000/",
    );
  });

  it("gives a general name explanation for any other host name", async () => {
    const result = await check("http://example.test:3000/");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      '"example.test" is a host name, and the local-loopback profile accepts only an IP literal',
    );
    // The localhost-specific sentence is not claimed for a name that is not it.
    expect(result.stderr).not.toContain("'localhost' is a name");
    expect(result.stderr).toContain(
      "agentready-lab check http://127.0.0.1:3000/",
    );
  });
});

describe("addresses that are not loopback", () => {
  const CASES: readonly { readonly url: string; readonly says: string }[] = [
    { url: "http://192.168.1.10:3000/", says: "'private'" },
    { url: "http://169.254.169.254/", says: "'link-local'" },
    { url: "http://93.184.216.34/", says: "'public'" },
    { url: "http://[fe80::1]:3000/", says: "'link-local'" },
  ];

  for (const one of CASES) {
    it(`names the address class for ${one.url}`, async () => {
      const result = await check(one.url);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("is not a loopback address");
      expect(result.stderr).toContain(one.says);
      expect(result.stderr).toContain("docs/ROADMAP.md M3");
      expect(result.httpCalls).toBe(0);
    });
  }

  it("accepts the two loopback literals M1 ships", async () => {
    for (const url of ["http://127.0.0.1:3000/", "http://[::1]:3000/"]) {
      const result = await check(url);
      // Past the policy, stopped later on the pinned artifacts.
      expect(result.stderr).not.toContain("loopback address");
      expect(result.stderr).not.toContain("host name");
    }
  });
});

describe("URLs the policy refuses outright", () => {
  const CASES: readonly {
    readonly url: string;
    readonly code: string;
    readonly says: string;
  }[] = [
    {
      url: "file:///etc/passwd",
      code: "prohibited-scheme",
      says: "Only http and https are accepted",
    },
    {
      url: "javascript:alert(1)",
      code: "prohibited-scheme",
      says: "Only http and https are accepted",
    },
    {
      url: "http://user:secret@127.0.0.1:3000/",
      code: "credentials-in-url",
      says: "Credentials are never forwarded to a target",
    },
    {
      url: "http://example.com@127.0.0.1:3000/",
      code: "credentials-in-url",
      says: "Credentials are never forwarded to a target",
    },
    {
      url: "not a url",
      code: "invalid-url",
      says: "did not parse as an absolute URL",
    },
  ];

  for (const one of CASES) {
    it(`refuses ${one.url} as ${one.code}`, async () => {
      const result = await check(one.url);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(one.code);
      expect(result.stderr).toContain(one.says);
      expect(result.httpCalls).toBe(0);
    });
  }

  it("does not echo a credential back in the refusal", async () => {
    const result = await check("http://user:hunter2@127.0.0.1:3000/");
    expect(result.stderr).not.toContain("hunter2");
  });
});
