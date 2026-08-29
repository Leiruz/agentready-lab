/**
 * `@agentready-lab/testkit`: the deterministic rule-author test utilities of
 * `docs/ARCHITECTURE.md` section 4.
 *
 * This package is the middle of the three verification tiers in
 * `docs/TEST_STRATEGY.md` section 3. Below it are pure parser units with no
 * transport at all; above it are the fixture-backed integration tests that run
 * against a real loopback origin. This tier is what makes the assertion matrix
 * of section 2.3 reachable: a satisfying case, a violating case, an
 * unavailable or malformed case and a version or mode distinction for every
 * assertion, constructed directly, with no server, no HTTP and no fixture
 * entry.
 *
 * It may use `node:*` because it is a Node test utility, and nothing it
 * exports puts a Node type in a signature a rule or the core would see: the
 * sentinel and the connection canary are the only modules that touch a
 * builtin, and neither returns a Node type.
 */
export const TESTKIT_PACKAGE_VERSION = "0.0.0";

export * from "./determinism/index.js";
export * from "./harness/index.js";
export * from "./sentinel/index.js";
export * from "./transport/index.js";
