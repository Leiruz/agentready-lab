// Ambient globals that `packages/core` is allowed to use.
//
// `packages/rules-standard` deliberately does NOT include this file. ADR-0002
// requires a compile-time guarantee that `AbortSignal`, `URL`, `fetch` and
// `process` are unresolvable in the rule package, and rules never construct a
// URL: they call `context.resolve()`, which core implements. `URL` is a pure
// parser with no I/O, no clock and no randomness, so core may hold it without
// weakening the invariant, but granting it to rules would weaken exactly the
// assertion that matters.
//
// Both packages compile with `"lib": ["ES2023"]` and `"types": []`, which
// is what makes `fetch`, `process`, `require`, `setTimeout`, `Buffer` and
// `window` undeclared identifiers there (docs/ARCHITECTURE.md section 4). That
// leaves no declaration for `URL`, which is not part of any ES lib but is a
// global in every runtime this project targets: Node.js 24, workerd, and the
// browser. `@cfworker/json-schema` also refers to it from its public types.
//
// The fix is an explicit allow-list, not `"lib": ["DOM"]`. Adding DOM would
// re-declare `fetch`, `window`, `setTimeout` and the rest in one move and
// silently delete the invariant. Anything added to this file is a deliberate
// widening of the runtime-neutral surface and should be justified against the
// URL Standard or an equivalent specification implemented by every target
// runtime.

interface URLSearchParams extends Iterable<[string, string]> {
  readonly size: number;
  append(name: string, value: string): void;
  delete(name: string, value?: string): void;
  get(name: string): string | null;
  getAll(name: string): string[];
  has(name: string, value?: string): boolean;
  set(name: string, value: string): void;
  sort(): void;
  toString(): string;
  forEach(
    callback: (value: string, key: string, parent: URLSearchParams) => void,
  ): void;
  entries(): IterableIterator<[string, string]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
}

declare const URLSearchParams: {
  prototype: URLSearchParams;
  new (
    init?: string | string[][] | Record<string, string> | URLSearchParams,
  ): URLSearchParams;
};

/** https://url.spec.whatwg.org/#url-class */
interface URL {
  hash: string;
  host: string;
  hostname: string;
  href: string;
  readonly origin: string;
  password: string;
  pathname: string;
  port: string;
  protocol: string;
  search: string;
  readonly searchParams: URLSearchParams;
  username: string;
  toJSON(): string;
  toString(): string;
}

declare const URL: {
  prototype: URL;
  new (url: string | URL, base?: string | URL): URL;
  canParse(url: string | URL, base?: string | URL): boolean;
  parse(url: string | URL, base?: string | URL): URL | null;
};

// ---------------------------------------------------------------------------
// Added for `packages/core/src/schema/`. RFC 8785 section 3.2.4 makes UTF-8
// part of the canonicalization algorithm, and the ruleset digest in
// docs/IMPLEMENTATION_SPEC.md section 13 needs SHA-256 over those bytes.
//
// Both are declared here rather than reached for through `node:crypto` or
// `Buffer`, which core may not import. `TextEncoder` is WHATWG Encoding and
// `crypto.subtle.digest` is W3C WebCrypto; Node.js 24, workerd and browsers
// all implement both as globals.

/** https://encoding.spec.whatwg.org/#textencoder */
interface TextEncoder {
  readonly encoding: "utf-8";
  encode(input?: string): Uint8Array;
  encodeInto(
    source: string,
    destination: Uint8Array,
  ): { read: number; written: number };
}

declare const TextEncoder: {
  prototype: TextEncoder;
  new (): TextEncoder;
};

/**
 * https://w3c.github.io/webcrypto/#subtlecrypto-interface
 *
 * Narrowed to `digest`, and to the one algorithm this project uses. Widening
 * it means deciding that core may encrypt, sign, or generate keys, which is a
 * decision with a threat model attached and not a typing convenience.
 */
interface SubtleCrypto {
  digest(
    algorithm: "SHA-256",
    data: ArrayBuffer | ArrayBufferView,
  ): Promise<ArrayBuffer>;
}

/** https://w3c.github.io/webcrypto/#crypto-interface */
interface Crypto {
  readonly subtle: SubtleCrypto;
}

// `var` and not `const`: only a `var` declaration in a global script becomes a
// property of `typeof globalThis`, and `globalThis.crypto` is how core reaches
// it without assuming a bare identifier is in scope. This is the same shape
// `lib.dom.d.ts` uses.
// eslint-disable-next-line no-var
declare var crypto: Crypto;
