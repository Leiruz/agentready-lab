import { installNetworkSentinel } from "./network-sentinel.js";

/**
 * Vitest `setupFiles` entry for the suites that legitimately open sockets:
 * `packages/transport-node` and the local end-to-end tests.
 *
 * `docs/TEST_STRATEGY.md` section 2.4: "Only the local-loopback integration
 * job may open sockets, and only to the exact server created by the test."
 * The host check here is the first half of that; the exact-origin half is the
 * `local-loopback` network profile's job at scan time.
 */
installNetworkSentinel("loopback-only");
