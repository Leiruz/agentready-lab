import type {
  NetworkPolicyIdentity,
  NetworkProfileId,
  TransportReason,
} from "@agentready-lab/core";

import { classifyAddress } from "./ip-policy.js";
import { applyUrlPolicy } from "./url-policy.js";
import type { CanonicalTarget } from "./url-policy.js";

/**
 * Network-profile authorization, `docs/THREAT_MODEL.md` section 9 and
 * invariant SEC-LOCAL-01.
 *
 * ## Why `ci-public` is a type that cannot be built
 *
 * `docs/ROADMAP.md` M1 requires that "the `ci-public` profile exits as an
 * unsupported/configuration condition and makes no public connection", and M3
 * is the milestone that earns it. The obvious way to satisfy that is an early
 * `if` in the fetcher. This file does not do that, because an `if` is one
 * deletion away from a public egress path and nothing else would notice.
 *
 * Instead, `LocalLoopbackPolicy` is the only policy type in the package, its
 * `id` is the literal type `"local-loopback"`, and `createNodeTransport`
 * accepts nothing else. There is no value of any type that carries
 * `"ci-public"` and can reach a connector, so the guarantee is a property of
 * the type system rather than of a branch someone has to keep.
 *
 * The class is deliberate too. Its constructor is private and its fields are
 * `#private`, which makes the type nominal: an object literal cannot satisfy
 * it, so a policy for a non-loopback origin cannot be forged either. Every
 * instance came through `LocalLoopbackPolicy.forTarget`, which is the one
 * place the loopback checks live.
 */

/**
 * The `policy.version` of the canonical report for this profile.
 *
 * No accepted decision pins a value. It is declared here, next to the rules it
 * names, so that a change to those rules has an obvious place to record
 * itself.
 */
export const LOCAL_LOOPBACK_POLICY_VERSION = "0.1.0";

export type PolicyResult =
  | { readonly kind: "policy"; readonly policy: LocalLoopbackPolicy }
  /**
   * The profile exists in the vocabulary and this build cannot serve it. The
   * caller maps this to `ConfigurationError`'s exit code 2; the transport does
   * not throw, and no connector is reachable from here.
   */
  | {
      readonly kind: "unsupported-profile";
      readonly profile: Exclude<NetworkProfileId, "local-loopback">;
      readonly detail: string;
    }
  /** The origin itself is not an acceptable `local-loopback` target. */
  | {
      readonly kind: "rejected";
      readonly reason: TransportReason;
      readonly detail: string;
    };

export type AuthorizationResult =
  | {
      readonly kind: "authorized";
      /** The IP literal the socket must use. */
      readonly address: string;
      readonly family: 4 | 6;
    }
  | { readonly kind: "blocked"; readonly reason: TransportReason };

/** Which vocabulary a refusal is phrased in: an entry target, or a hop. */
type Stage = "target" | "redirect";

export class LocalLoopbackPolicy {
  readonly id = "local-loopback" as const;
  readonly version: string = LOCAL_LOOPBACK_POLICY_VERSION;
  readonly sameOriginDiscovery = true as const;

  readonly #origin: string;
  readonly #protocol: "http:" | "https:";
  readonly #hostname: string;
  readonly #port: number;
  readonly #address: string;
  readonly #family: 4 | 6;

  private constructor(target: CanonicalTarget, address: string, family: 4 | 6) {
    this.#origin = target.origin;
    this.#protocol = target.protocol;
    this.#hostname = target.hostname;
    this.#port = target.port;
    this.#address = address;
    this.#family = family;
  }

  /**
   * The one constructor of a `local-loopback` policy.
   *
   * M1 accepts only an IP literal that classifies as loopback. A name such as
   * `localhost` is refused, and that is a deliberate narrowing rather than an
   * oversight: resolving a name would put `/etc/hosts`, NSS and a DNS answer
   * inside the loopback boundary, and `docs/THREAT_MODEL.md` section 12.2
   * requires that behaviour to be "explicit and covered by tests rather than
   * inherited accidentally". M3 owns the resolver path; until then the profile
   * that ships is the one whose destination needs no resolution at all.
   */
  static forTarget(rawUrl: string): PolicyResult {
    const parsed = applyUrlPolicy(rawUrl);
    if (parsed.kind === "rejected") {
      return {
        kind: "rejected",
        reason: parsed.reason,
        detail: "the target URL did not pass the URL policy",
      };
    }

    const target = parsed.target;
    const classified = classifyAddress(target.hostname);
    if (classified.kind !== "address") {
      return {
        kind: "rejected",
        reason: { code: "unsafe-address", phase: "dns" },
        detail:
          "local-loopback requires a loopback IP literal; a host name would need name resolution, which M1 does not perform",
      };
    }
    if (classified.addressClass !== "loopback") {
      return {
        kind: "rejected",
        reason: { code: "unsafe-address", phase: "dns" },
        detail: "local-loopback permits only a loopback address",
      };
    }

    return {
      kind: "policy",
      policy: new LocalLoopbackPolicy(
        target,
        classified.canonical,
        classified.family,
      ),
    };
  }

  /** The canonical serialized origin every hop is compared against. */
  get origin(): string {
    return this.#origin;
  }

  get protocol(): "http:" | "https:" {
    return this.#protocol;
  }

  get hostname(): string {
    return this.#hostname;
  }

  get port(): number {
    return this.#port;
  }

  /** The pinned IP literal. For a literal target this equals the hostname. */
  get address(): string {
    return this.#address;
  }

  get family(): 4 | 6 {
    return this.#family;
  }

  /**
   * Origin comparison is string equality on the canonical serialized origin,
   * not address equality.
   *
   * That is the whole reason `sec-004` blocks a `127.0.0.1` to `localhost`
   * redirect on the same port even though both name the same machine: the user
   * supplied one origin, and an origin is a scheme, a host and a port, not the
   * address a host happens to have. Comparing addresses instead would make
   * every name that resolves to loopback a valid substitute for every other.
   */
  authorize(target: CanonicalTarget, stage: Stage): AuthorizationResult {
    const blocked = (reason: TransportReason): AuthorizationResult =>
      stage === "redirect"
        ? {
            kind: "blocked",
            reason: { code: "redirect-blocked", phase: "redirect" },
          }
        : { kind: "blocked", reason };

    if (target.protocol !== this.#protocol) {
      return blocked({ code: "prohibited-scheme", phase: "policy" });
    }
    if (target.port !== this.#port) {
      return blocked({ code: "unsafe-port", phase: "policy" });
    }
    if (target.origin !== this.#origin) {
      return blocked({ code: "unsafe-address", phase: "dns" });
    }

    // Defence in depth behind the origin comparison, and measured to be
    // exactly that. Mutation testing showed that deleting the origin
    // comparison alone changes no test result, and that deleting the pinned
    // address comparison alone changes none either: for a profile whose host
    // is always an IP literal the two are independent complete guards, and
    // only removing both lets `127.0.0.2` and `[::1]` through. Neither is
    // therefore dead code, and neither is load-bearing on its own. Both are
    // kept because `docs/THREAT_MODEL.md` section 12.3 requires every
    // connection, redirect target and discovered resource to repeat the
    // policy, and because a profile that resolves names will separate them.
    const classified = classifyAddress(target.hostname);
    if (classified.kind !== "address") {
      return blocked({ code: "unsafe-address", phase: "dns" });
    }
    if (classified.addressClass !== "loopback") {
      return blocked({ code: "unsafe-address", phase: "dns" });
    }
    if (classified.canonical !== this.#address) {
      return blocked({ code: "unsafe-address", phase: "dns" });
    }

    return {
      kind: "authorized",
      address: classified.canonical,
      family: classified.family,
    };
  }

  /** The non-budget half of `policy` in the canonical report. */
  toIdentity(): NetworkPolicyIdentity {
    return {
      id: this.id,
      version: this.version,
      allowedSchemes: [this.#protocol === "https:" ? "https" : "http"],
      allowedPorts: [this.#port],
      sameOriginDiscovery: this.sameOriginDiscovery,
    };
  }
}

/**
 * The profile-selection entry point.
 *
 * Every profile other than `local-loopback` returns `unsupported-profile`, and
 * no branch of this function can produce a policy object for one, because no
 * such object exists to produce.
 */
export function createNetworkPolicy(
  profile: NetworkProfileId,
  rawUrl: string,
): PolicyResult {
  if (profile === "local-loopback")
    return LocalLoopbackPolicy.forTarget(rawUrl);
  return {
    kind: "unsupported-profile",
    profile,
    detail:
      profile === "ci-public"
        ? "the ci-public network profile is unimplemented; docs/ROADMAP.md M3 owns it, and this build has no policy object that could reach a public destination"
        : "the hosted-public network profile is not selectable by any flag; docs/ARCHITECTURE.md section 9 keeps it in the report vocabulary only",
  };
}
