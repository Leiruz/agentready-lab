import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "../src/run.js";
import { configPath, testEnvironment } from "./support/environment.js";
import type { Canary, NetworkDeny } from "./support/network-canary.js";
import { denyNetwork, openCanary } from "./support/network-canary.js";

/**
 * `docs/ROADMAP.md` M1: "The `ci-public` profile exits as an
 * unsupported/configuration condition and makes no public connection."
 *
 * Four independent statements, because the criterion has two halves and the
 * second one is the half a passing exit code does not prove:
 *
 * - the exit code is 2 and the message says why;
 * - the connection canary accepted nothing, and its own URL is the target, so
 *   a leaked connection would have had somewhere to land;
 * - no DNS, socket, HTTP, HTTPS or TLS entry point was called at all;
 * - the transport was never even constructed, so the refusal is above
 *   `packages/transport-node` rather than inside it.
 */

describe("--network-profile ci-public", () => {
  let canary: Canary;
  let deny: NetworkDeny;

  beforeEach(async () => {
    canary = await openCanary();
    deny = denyNetwork();
  });

  afterEach(async () => {
    deny.restore();
    await canary.close();
  });

  it("refuses the flag and opens nothing", async () => {
    const { environment, probe } = testEnvironment({
      argv: ["check", `${canary.origin}/`, "--network-profile", "ci-public"],
    });

    const result = await runCli(environment);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "--network-profile ci-public is not implemented in this build",
    );
    expect(result.stderr).toContain("docs/ROADMAP.md M3 owns it");
    expect(result.stderr).toContain("--network-profile local-loopback");

    expect(canary.connections).toBe(0);
    expect(deny.attempts).toStrictEqual([]);
    expect(probe.factoryCalls).toBe(0);
    expect(probe.httpCalls).toBe(0);
  });

  it("refuses it from the configuration file too, opening nothing", async () => {
    // `docs/ARCHITECTURE.md` section 10's own example sets this value, so the
    // documented configuration is one of the inputs this has to refuse.
    const { environment, probe } = testEnvironment({
      argv: ["check", `${canary.origin}/`],
      files: {
        [configPath()]: '{"network":{"profile":"ci-public"}}',
      },
    });

    const result = await runCli(environment);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("ci-public is not implemented");
    expect(canary.connections).toBe(0);
    expect(deny.attempts).toStrictEqual([]);
    expect(probe.factoryCalls).toBe(0);
  });

  it("lets a flag override a ci-public file setting back to local-loopback", async () => {
    const { environment } = testEnvironment({
      argv: [
        "check",
        `${canary.origin}/`,
        "--network-profile",
        "local-loopback",
      ],
      files: { [configPath()]: '{"network":{"profile":"ci-public"}}' },
    });

    const result = await runCli(environment);

    // It gets past the profile refusal and stops on the pinned artifacts,
    // which is how far a loopback target reaches in this build.
    expect(result.stderr).not.toContain("ci-public");
    expect(result.exitCode).toBe(2);
    // Still nothing on the wire: the scan is refused before a request.
    expect(canary.connections).toBe(0);
    expect(deny.attempts).toStrictEqual([]);
  });

  it("does not connect to a loopback target either, while the scan is refused", async () => {
    const { environment, probe } = testEnvironment({
      argv: ["check", `${canary.origin}/robots.txt`],
    });

    const result = await runCli(environment);

    expect(result.exitCode).toBe(2);
    expect(canary.connections).toBe(0);
    expect(deny.attempts).toStrictEqual([]);
    // The transport object is built, because a policy exists for a loopback
    // origin. It is never asked for anything.
    expect(probe.factoryCalls).toBe(1);
    expect(probe.httpCalls).toBe(0);
  });
});
