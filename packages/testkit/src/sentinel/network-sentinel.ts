import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

/**
 * The no-hidden-network sentinel of `docs/TEST_STRATEGY.md` section 2.4.
 *
 * "Unit, contract, reporter, and ordinary integration jobs run with network
 * access disabled or with global network APIs replaced by a throwing sentinel.
 * A rule calling global `fetch` is a test failure. Only the local-loopback
 * integration job may open sockets, and only to the exact server created by
 * the test."
 *
 * That last sentence is why this is not one global switch. `transport-node` is
 * the package whose entire job is opening sockets, and its own tests need real
 * loopback ones. A single deny-all setting would either break that suite or be
 * turned off for the whole repository, and the second is what actually
 * happens. So there are two tiers and both are exported:
 *
 * - `deny-all` for pure units, parsers, rules, reporters and the core engine.
 *   Nothing may open a socket, by any route.
 * - `loopback-only` for `transport-node` and the local end-to-end suite. A
 *   loopback destination is allowed through to the real implementation and
 *   everything else throws.
 *
 * What the guarantee actually rests on is `net.Socket.prototype.connect`.
 * Every outbound TCP client in Node reaches it: `http.request`, `https`,
 * `tls.connect`, undici and therefore global `fetch`. The module-level
 * functions are patched too, because a stub named `http.request` produces a
 * better failure message than one named `connect`, but a Node version whose
 * ESM named exports do not observe a mutation of the module object would still
 * be caught by the prototype patch. `patched` reports what was actually
 * replaced, so "where the runtime allows it" is an observation and not a hope.
 */

export type SentinelTier = "deny-all" | "loopback-only";

export interface BlockedAttempt {
  readonly api: string;
  readonly target: string;
  readonly caller: string;
}

export interface SentinelHandle {
  readonly tier: SentinelTier;
  /** The APIs this install actually replaced, in install order. */
  readonly patched: readonly string[];
  /** Every refused attempt, in order. */
  readonly blocked: readonly BlockedAttempt[];
  restore(): void;
}

export class NetworkSentinelError extends Error {
  readonly api: string;
  readonly target: string;
  readonly caller: string;

  constructor(api: string, target: string, caller: string, tier: SentinelTier) {
    super(
      `${caller} called ${api}${target === "" ? "" : ` for ${target}`} while the ${tier} network sentinel was installed. ` +
        "docs/TEST_STRATEGY.md section 2.4: unit, contract and reporter tests run with global network APIs replaced by a throwing sentinel. " +
        "Use the in-memory transport from @agentready-lab/testkit instead of real I/O.",
    );
    this.name = "NetworkSentinelError";
    this.api = api;
    this.target = target;
    this.caller = caller;
  }
}

const PACKAGE_FRAME = /[\\/](packages|apps)[\\/]([A-Za-z0-9._-]+)[\\/]/;

/**
 * The workspace package a stack frame belongs to.
 *
 * `docs/TEST_STRATEGY.md` section 2.4 makes "a rule calling global `fetch`" the
 * failure, so the message has to say which package called it. Frames inside
 * this package are skipped, because the first frame is always the stub itself.
 */
export function callerPackageFromStack(stack: string | undefined): string {
  for (const line of (stack ?? "").split("\n").slice(1)) {
    const match = PACKAGE_FRAME.exec(line);
    if (match === null) continue;
    const [, kind, name] = match;
    if (kind === undefined || name === undefined) continue;
    if (kind === "packages" && name === "testkit") continue;
    return `${kind}/${name}`;
  }
  return "an unidentified caller";
}

function callerPackage(): string {
  return callerPackageFromStack(new Error("sentinel").stack);
}

const LOOPBACK_HOSTS = new Set(["localhost", "::1", "0:0:0:0:0:0:0:1"]);

export function isLoopbackHost(host: string): boolean {
  const bare =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const lower = bare.toLowerCase();
  if (LOOPBACK_HOSTS.has(lower)) return true;
  // 127.0.0.0/8, which is what a fixture host on an ephemeral port uses.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lower);
}

function hostOfUrl(raw: string): string {
  const parsed = URL.parse(raw);
  return parsed === null ? raw : parsed.hostname;
}

/**
 * The destination of a `net.Socket.prototype.connect` call.
 *
 * The documented argument forms are `(options)`, `(port, host?, listener?)`
 * and `(path, listener?)`. There is a fourth, undocumented one that matters
 * more than all of them: `net.connect` and `net.createConnection` normalize
 * their arguments and then call `socket.connect(normalized)` with the whole
 * `[options, listener]` array as a single argument, so every ordinary caller
 * arrives in that shape. Reading `host` off the array instead of off the
 * options object inside it yields no host at all, which defaults to
 * `localhost` and lets the loopback tier admit every destination on the
 * Internet. That is what the first version of this function did.
 *
 * An IPC path is not a network destination and is reported as one, so the
 * loopback tier can let it through.
 */
function connectDestination(args: readonly unknown[]): {
  readonly host: string;
  readonly ipc: boolean;
} {
  const first = args[0];
  if (Array.isArray(first)) {
    const inner: readonly unknown[] = first;
    return connectDestination(inner);
  }
  if (typeof first === "string") return { host: first, ipc: true };
  if (typeof first === "number") {
    const second = args[1];
    return {
      host: typeof second === "string" ? second : "localhost",
      ipc: false,
    };
  }
  if (typeof first === "object" && first !== null) {
    const options: Record<string, unknown> = { ...first };
    const path = options["path"];
    if (typeof path === "string") return { host: path, ipc: true };
    const host = options["host"];
    return { host: typeof host === "string" ? host : "localhost", ipc: false };
  }
  return { host: "", ipc: false };
}

interface Installer {
  readonly tier: SentinelTier;
  readonly patched: string[];
  readonly blocked: BlockedAttempt[];
  readonly restores: (() => void)[];
}

function refuse(installer: Installer, api: string, target: string): never {
  const caller = callerPackage();
  installer.blocked.push({ api, target, caller });
  throw new NetworkSentinelError(api, target, caller, installer.tier);
}

/**
 * Replaces one own property, remembering how to put it back.
 *
 * `Object.defineProperty` rather than assignment: some of these live on frozen
 * or accessor-backed objects, and a plain assignment there fails silently in
 * sloppy mode and throws in strict mode. A property that cannot be replaced is
 * left alone and simply does not appear in `patched`.
 */
function replace(
  installer: Installer,
  owner: object,
  name: string,
  label: string,
  value: unknown,
): void {
  const previous = Object.getOwnPropertyDescriptor(owner, name);
  try {
    Object.defineProperty(owner, name, {
      value,
      writable: true,
      configurable: true,
      enumerable: previous?.enumerable ?? false,
    });
  } catch {
    return;
  }
  installer.patched.push(label);
  installer.restores.push(() => {
    if (previous === undefined) {
      Reflect.deleteProperty(owner, name);
    } else {
      Object.defineProperty(owner, name, previous);
    }
  });
}

function installGlobals(installer: Installer): void {
  const originalFetch = globalThis.fetch;

  const guardedFetch = (
    ...args: Parameters<typeof fetch>
  ): Promise<Response> => {
    const [input] = args;
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (installer.tier === "loopback-only" && isLoopbackHost(hostOfUrl(raw))) {
      return originalFetch(...args);
    }
    return refuse(installer, "fetch()", raw);
  };
  replace(installer, globalThis, "fetch", "fetch", guardedFetch);

  // Denied in both tiers. Nothing in this repository has a loopback use for
  // them, and allowing one would mean threading a URL out of a constructor
  // for a capability no package is supposed to have.
  for (const name of ["XMLHttpRequest", "WebSocket", "EventSource"]) {
    const guard = function guardedConstructor(...args: unknown[]): never {
      const [first] = args;
      return refuse(
        installer,
        `new ${name}()`,
        typeof first === "string" ? first : "",
      );
    };
    replace(installer, globalThis, name, name, guard);
  }
}

function installSockets(installer: Installer): void {
  // An unbound reference is the point: the replacement below calls it with an
  // explicit receiver through `Reflect.apply`, which is the only way to reach
  // the original once the prototype property has been replaced. Binding it is
  // impossible, because there is no instance yet.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalConnect = net.Socket.prototype.connect;

  function guardedConnect(this: net.Socket, ...args: unknown[]): net.Socket {
    const destination = connectDestination(args);
    const allowed =
      installer.tier === "loopback-only" &&
      (destination.ipc || isLoopbackHost(destination.host));
    if (!allowed) {
      refuse(installer, "net.Socket#connect", destination.host);
    }
    // `Reflect.apply` keeps `this` bound and needs no cast through the
    // overloaded method signature.
    Reflect.apply(originalConnect, this, args);
    return this;
  }

  replace(
    installer,
    net.Socket.prototype,
    "connect",
    "net.Socket#connect",
    guardedConnect,
  );
}

/**
 * Module-level stubs, for the failure message rather than for the guarantee.
 *
 * Only installed for `deny-all`, where they never have to call through, so
 * nothing here has to reproduce an overloaded Node signature.
 */
function installModuleStubs(installer: Installer): void {
  const stubs: readonly {
    readonly owner: object;
    readonly name: string;
    readonly label: string;
  }[] = [
    { owner: http, name: "request", label: "http.request" },
    { owner: http, name: "get", label: "http.get" },
    { owner: https, name: "request", label: "https.request" },
    { owner: https, name: "get", label: "https.get" },
    { owner: tls, name: "connect", label: "tls.connect" },
    { owner: dns, name: "lookup", label: "dns.lookup" },
    { owner: dns.promises, name: "lookup", label: "dns.promises.lookup" },
    { owner: dns, name: "resolve", label: "dns.resolve" },
    { owner: dns.promises, name: "resolve", label: "dns.promises.resolve" },
  ];

  for (const stub of stubs) {
    const guard = (...args: unknown[]): never => {
      const [first] = args;
      return refuse(
        installer,
        stub.label,
        typeof first === "string" ? first : "",
      );
    };
    replace(installer, stub.owner, stub.name, stub.label, guard);
  }
}

/**
 * Installs one tier and returns the handle that removes it again.
 *
 * Installs nest: each one captures whatever is currently in place, so a test
 * that installs `deny-all` inside a suite already running under it restores to
 * the suite's stub rather than to the real API.
 */
export function installNetworkSentinel(tier: SentinelTier): SentinelHandle {
  const installer: Installer = {
    tier,
    patched: [],
    blocked: [],
    restores: [],
  };

  installGlobals(installer);
  installSockets(installer);
  if (tier === "deny-all") installModuleStubs(installer);

  return {
    tier,
    get patched(): readonly string[] {
      return [...installer.patched];
    },
    get blocked(): readonly BlockedAttempt[] {
      return [...installer.blocked];
    },
    restore(): void {
      // Reverse order, so a nested install unwinds to the state it found.
      for (const undo of [...installer.restores].reverse()) undo();
      installer.restores.length = 0;
      installer.patched.length = 0;
    },
  };
}
