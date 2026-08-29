// Ambient globals that `packages/core` and `packages/rules-standard` are
// allowed to use.
//
// Those two packages compile with `"lib": ["ES2023"]` and `"types": []`, which
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
