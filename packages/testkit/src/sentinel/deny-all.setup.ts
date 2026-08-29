import { installNetworkSentinel } from "./network-sentinel.js";

/**
 * Vitest `setupFiles` entry for every suite that must not touch the network.
 *
 * `docs/TEST_STRATEGY.md` section 2.4. Installed for the whole worker and
 * never removed: a test that restores it is a test that can leave the next one
 * unprotected.
 */
installNetworkSentinel("deny-all");
