import { describe, expect, it } from "vitest";
import type { LookupAddress } from "node:dns";

import { PinnedResolver } from "../src/index.js";

/** `docs/THREAT_MODEL.md` sections 12.2 and 12.3. */

interface Answer {
  readonly error: Error | null;
  readonly address: string | LookupAddress[];
  readonly family: number | undefined;
}

function ask(
  resolver: PinnedResolver,
  hostname: string,
  options: { readonly all?: boolean; readonly family?: number } = {},
): Answer {
  let answer: Answer | undefined;
  resolver.lookup(hostname, options, (error, address, family) => {
    answer = { error, address, family };
  });
  if (answer === undefined) throw new Error("lookup did not call back");
  return answer;
}

describe("pinned resolution", () => {
  it("answers only with the addresses the policy already authorized", () => {
    const resolver = new PinnedResolver("preview.test", [
      { address: "127.0.0.1", family: 4 },
    ]);

    expect(ask(resolver, "preview.test")).toStrictEqual({
      error: null,
      address: "127.0.0.1",
      family: 4,
    });
    expect(ask(resolver, "preview.test", { all: true })).toStrictEqual({
      error: null,
      address: [{ address: "127.0.0.1", family: 4 }],
      family: undefined,
    });
  });

  it("refuses a hostname it was not built for", () => {
    // The rebinding case in miniature: the connector asking about a name the
    // policy never approved gets an error, not an answer.
    const resolver = new PinnedResolver("preview.test", [
      { address: "127.0.0.1", family: 4 },
    ]);
    const answer = ask(resolver, "evil.test");
    expect(answer.error).toBeInstanceOf(Error);
    expect(answer.address).toStrictEqual([]);
  });

  it("reports an error through the callback rather than throwing", () => {
    // It runs inside Node's connection machinery, where a synchronous throw
    // would escape every try/catch in this package.
    const resolver = new PinnedResolver("preview.test", []);
    expect(() => ask(resolver, "preview.test")).not.toThrow();
    expect(ask(resolver, "preview.test").error).toBeInstanceOf(Error);
  });

  it("honours a requested family and refuses when none matches", () => {
    const resolver = new PinnedResolver("preview.test", [
      { address: "127.0.0.1", family: 4 },
      { address: "::1", family: 6 },
    ]);
    expect(ask(resolver, "preview.test", { family: 6 }).address).toBe("::1");
    expect(ask(resolver, "preview.test", { family: 4 }).address).toBe(
      "127.0.0.1",
    );

    const v4Only = new PinnedResolver("preview.test", [
      { address: "127.0.0.1", family: 4 },
    ]);
    expect(ask(v4Only, "preview.test", { family: 6 }).error).toBeInstanceOf(
      Error,
    );
  });

  it("records every call so a test can assert there were none", () => {
    const resolver = new PinnedResolver("preview.test", [
      { address: "127.0.0.1", family: 4 },
    ]);
    expect(resolver.callCount).toBe(0);
    ask(resolver, "preview.test");
    ask(resolver, "evil.test");
    expect(resolver.calls).toStrictEqual(["preview.test", "evil.test"]);
    expect(resolver.callCount).toBe(2);
  });
});
