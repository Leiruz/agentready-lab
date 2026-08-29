import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { buildRequestHeaders, checkResponseFraming } from "../src/index.js";
import type { CanonicalTarget } from "../src/index.js";
import { applyUrlPolicy } from "../src/index.js";

// Each case here runs the TypeScript compiler over the package, which is
// legitimately slow rather than hung: about 1s locally and past vitest's 5s
// default on a cold CI runner. The timeout is raised for the whole block so a
// slow machine reports a real result instead of a spurious failure.
const COMPILE_PROBE_TIMEOUT_MS = 30_000;

/**
 * The two invariants that are properties of the source rather than of a run.
 *
 * `docs/THREAT_MODEL.md` section 14 says ambient proxy variables "cannot alter
 * target traffic" (SEC-NET-04). A behavioural test can show that one request
 * ignored `HTTP_PROXY`; only reading the source can show that there is no code
 * that could ever read it. The same argument applies to
 * `NODE_TLS_REJECT_UNAUTHORIZED`, to `insecureHTTPParser`, and to a `fetch`
 * that would bypass the connector entirely.
 */

const sourceDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
);

/**
 * Comments are stripped before the scan.
 *
 * Several of the names below appear in this package's prose precisely because
 * the code refuses to honour them, and a check that could not tell a comment
 * from a call would either fail on the documentation or force the
 * documentation to stop naming what it protects against. Transpiling with
 * `removeComments` is the parser's own answer to which is which.
 */
function sourceFiles(): readonly {
  name: string;
  text: string;
  code: string;
}[] {
  return readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => {
      const text = readFileSync(path.join(sourceDir, entry.name), "utf8");
      return {
        name: entry.name,
        text,
        code: ts.transpileModule(text, {
          compilerOptions: {
            removeComments: true,
            target: ts.ScriptTarget.ES2023,
            module: ts.ModuleKind.ESNext,
          },
        }).outputText,
      };
    });
}

const files = sourceFiles();

describe("the source cannot read the ambient environment", () => {
  it("covers every module the package ships", () => {
    expect(files.map((file) => file.name).sort()).toStrictEqual([
      "bounded-body.ts",
      "budget.ts",
      "index.ts",
      "ip-policy.ts",
      "network-policy.ts",
      "redirects.ts",
      "resolver.ts",
      "safe-fetcher.ts",
      "url-policy.ts",
    ]);
  });

  it.each(files.map((file) => file.name))(
    "%s reads no environment variable",
    (name) => {
      const code = files.find((file) => file.name === name)?.code ?? "";
      expect(code).not.toContain("process.env");
      expect(code).not.toContain("HTTP_PROXY");
      expect(code).not.toContain("HTTPS_PROXY");
      expect(code).not.toContain("ALL_PROXY");
      expect(code).not.toContain("NO_PROXY");
      expect(code).not.toContain("NODE_TLS_REJECT_UNAUTHORIZED");
    },
  );

  it.each(files.map((file) => file.name))(
    "%s opens no connection except through the connector",
    (name) => {
      const code = files.find((file) => file.name === name)?.code ?? "";
      expect(code).not.toContain("undici");
      expect(code).not.toMatch(/\bfetch\s*\(/);
      // `node:dns` would be a second resolution path beside the pinned one.
      expect(code).not.toMatch(/from "node:dns"/);
    },
  );
});

describe("the parser and TLS settings are pinned in the source", () => {
  const fetcher = files.find((file) => file.name === "safe-fetcher.ts")?.code;

  it("disables the lenient HTTP parser explicitly", () => {
    // The default is already `false`. Passing it anyway is what makes the
    // setting greppable and makes a change to it show up in a diff.
    expect(fetcher).toContain("insecureHTTPParser: false");
    expect(fetcher).not.toContain("insecureHTTPParser: true");
  });

  it("never weakens certificate verification", () => {
    for (const file of files) {
      expect(file.code).not.toContain("rejectUnauthorized: false");
      expect(file.code).not.toContain("checkServerIdentity");
    }
    expect(fetcher).toContain("rejectUnauthorized: true");
  });

  it("bounds the response header block at the parser", () => {
    expect(fetcher).toContain("maxHeaderSize: MAX_RESPONSE_HEADER_BYTES");
  });
});

describe("response framing checks, independent of what Node also catches", () => {
  // The integration cases in `safe-fetcher.test.ts` assert the outcome, and
  // llhttp rejects some of these before this function runs. Calling it
  // directly is what proves the check is live rather than dead code shadowed
  // by the parser.
  it("accepts an ordinary response", () => {
    expect(
      checkResponseFraming(200, [
        ["content-type", "text/plain"],
        ["content-length", "5"],
      ]),
    ).toBeNull();
  });

  it.each<[string, readonly (readonly [string, string])[]]>([
    [
      "Transfer-Encoding with Content-Length",
      [
        ["transfer-encoding", "chunked"],
        ["content-length", "5"],
      ],
    ],
    [
      "conflicting Content-Length values",
      [
        ["content-length", "5"],
        ["content-length", "6"],
      ],
    ],
    ["a non-numeric Content-Length", [["content-length", "5, 6"]]],
    ["an unsupported transfer coding", [["transfer-encoding", "gzip"]]],
    ["an upgrade header", [["upgrade", "websocket"]]],
  ])("refuses %s", (_label, headers) => {
    expect(checkResponseFraming(200, headers)).toStrictEqual({
      code: "malformed-http",
      phase: "body",
    });
  });

  it("refuses more than a hundred header fields", () => {
    const headers = Array.from(
      { length: 101 },
      (_value, index) => [`x-pad-${String(index)}`, "1"] as const,
    );
    expect(checkResponseFraming(200, headers)).toStrictEqual({
      code: "malformed-http",
      phase: "body",
    });
    expect(checkResponseFraming(200, headers.slice(0, 100))).toBeNull();
  });

  it("refuses a 101 even if it arrives as an ordinary response", () => {
    expect(checkResponseFraming(101, [])).toStrictEqual({
      code: "malformed-http",
      phase: "body",
    });
  });

  it.each(["gzip", "br", "deflate", "GZIP", "gzip, br"])(
    "refuses the %s content coding",
    (coding) => {
      expect(
        checkResponseFraming(200, [["content-encoding", coding]]),
      ).toStrictEqual({ code: "decompression-failure", phase: "decode" });
    },
  );

  it("permits an explicit identity coding", () => {
    expect(
      checkResponseFraming(200, [["content-encoding", "identity"]]),
    ).toBeNull();
  });
});

describe(
  "the request header allowlist",
  { timeout: COMPILE_PROBE_TIMEOUT_MS },
  () => {
    function target(): CanonicalTarget {
      const result = applyUrlPolicy("http://127.0.0.1:8080/x");
      if (result.kind !== "url") throw new Error("unreachable");
      return result.target;
    }

    it("emits four fixed fields plus an allowlisted Accept", () => {
      expect(
        buildRequestHeaders(
          target(),
          new Map([["accept", ["text/html"]]]),
          "UA/1",
        ),
      ).toStrictEqual([
        ["host", "127.0.0.1:8080"],
        ["user-agent", "UA/1"],
        ["accept-encoding", "identity"],
        ["connection", "close"],
        ["accept", "text/html"],
      ]);
    });

    it("drops every header outside the allowlist", () => {
      const headers = buildRequestHeaders(
        target(),
        new Map([
          ["authorization", ["Bearer x"]],
          ["cookie", ["a=b"]],
          ["proxy-authorization", ["Basic x"]],
          ["x-forwarded-for", ["10.0.0.1"]],
        ]),
        "UA/1",
      );
      expect(headers?.map(([name]) => name)).toStrictEqual([
        "host",
        "user-agent",
        "accept-encoding",
        "connection",
      ]);
    });

    it("fails closed on an unsafe allowlisted value rather than dropping it", () => {
      expect(
        buildRequestHeaders(
          target(),
          new Map([["accept", ["text/html\r\nX-Injected: 1"]]]),
          "UA/1",
        ),
      ).toBeNull();
    });
  },
);

/**
 * The `ci-public` guarantee is a type, so the test for it has to be a compile.
 *
 * `docs/ROADMAP.md` M1 requires that the profile "exits as an
 * unsupported/configuration condition and makes no public connection".
 * `network-policy.test.ts` shows that `createNetworkPolicy` refuses it at
 * runtime. This block shows the stronger property that motivated the design:
 * there is no value a caller can write, cast-free, that would carry a
 * `ci-public` policy into `createNodeTransport`, and no way to forge a
 * loopback policy for an address the checks never saw.
 */
function typeErrorsIn(probeSource: string): readonly string[] {
  const configPath = path.join(path.dirname(sourceDir), "tsconfig.json");
  const configFile = ts.readConfigFile(
    configPath,
    ts.sys.readFile.bind(ts.sys),
  );
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath),
  );

  const probePath = path.join(sourceDir, "policy.probe.ts");
  const isProbe = (fileName: string): boolean =>
    path.resolve(fileName) === probePath;

  const options = { ...parsed.options, noEmit: true, composite: false };
  const host = ts.createCompilerHost(options, true);
  const readSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, createNew) =>
    isProbe(fileName)
      ? ts.createSourceFile(fileName, probeSource, languageVersion, true)
      : readSourceFile(fileName, languageVersion, onError, createNew);

  const program = ts.createProgram({
    rootNames: [probePath],
    options,
    host,
  });

  return program
    .getSemanticDiagnostics()
    .filter(({ file }) => file !== undefined && isProbe(file.fileName))
    .map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
    );
}

describe(
  "ci-public is unconstructible, not merely refused",
  { timeout: COMPILE_PROBE_TIMEOUT_MS },
  () => {
    it("compiles the supported path with no diagnostics", () => {
      // The control. Without it every case below would pass just as well if the
      // probe failed to compile for an unrelated reason.
      expect(
        typeErrorsIn(`
        import { createNetworkPolicy, createNodeTransport } from "./index.js";
        const result = createNetworkPolicy("local-loopback", "http://127.0.0.1:8080/");
        if (result.kind === "policy") {
          createNodeTransport({ policy: result.policy });
        }
      `),
      ).toStrictEqual([]);
    });

    it("has no policy value that carries the ci-public id", () => {
      const errors = typeErrorsIn(`
      import { createNodeTransport } from "./index.js";
      createNodeTransport({
        policy: {
          id: "ci-public",
          version: "0.1.0",
          origin: "https://example.com",
          protocol: "https:",
          hostname: "example.com",
          port: 443,
          address: "93.184.216.34",
          family: 4,
          sameOriginDiscovery: true,
          authorize: () => ({ kind: "authorized", address: "93.184.216.34", family: 4 }),
          toIdentity: () => ({
            id: "ci-public",
            version: "0.1.0",
            allowedSchemes: ["https"],
            allowedPorts: [443],
            sameOriginDiscovery: true,
          }),
        },
      });
    `);
      // The literal type is what refuses it: there is no policy shape whose
      // `id` can read "ci-public".
      expect(errors.join(" ")).toContain(
        `Type '"ci-public"' is not assignable to type '"local-loopback"'.`,
      );
    });

    it("has no way to forge a loopback policy for an unchecked destination", () => {
      // The nominal half. `LocalLoopbackPolicy` holds `#private` fields, so an
      // object literal cannot satisfy it however carefully it is shaped, and
      // every instance therefore went through the loopback checks.
      const errors = typeErrorsIn(`
      import { createNodeTransport } from "./index.js";
      createNodeTransport({
        policy: {
          id: "local-loopback",
          version: "0.1.0",
          origin: "http://169.254.169.254",
          protocol: "http:",
          hostname: "169.254.169.254",
          port: 80,
          address: "169.254.169.254",
          family: 4,
          sameOriginDiscovery: true,
          authorize: () => ({ kind: "authorized", address: "169.254.169.254", family: 4 }),
          toIdentity: () => ({
            id: "local-loopback",
            version: "0.1.0",
            allowedSchemes: ["http"],
            allowedPorts: [80],
            sameOriginDiscovery: true,
          }),
        },
      });
    `);
      expect(errors.join(" ")).toContain(
        "missing the following properties from type 'LocalLoopbackPolicy': #origin",
      );
    });

    it("refuses a ci-public policy result even when one is asked for", () => {
      const errors = typeErrorsIn(`
      import { createNetworkPolicy, createNodeTransport } from "./index.js";
      const result = createNetworkPolicy("ci-public", "https://example.com/");
      createNodeTransport({ policy: result.policy });
    `);
      expect(errors.length).toBeGreaterThan(0);
    });
  },
);

/**
 * The connector is the one function that opens a socket, and it asks no
 * policy: every check happens above it. Exporting it, or a way to put another
 * one in its place, would be a typed path around `createNodeTransport` for a
 * caller who wanted `169.254.169.254` and no `LocalLoopbackPolicy` at all.
 */
describe(
  "the entry point publishes no socket of its own",
  { timeout: COMPILE_PROBE_TIMEOUT_MS },
  () => {
    it("exports no value that opens a connection", async () => {
      const entry: Record<string, unknown> = await import("../src/index.js");
      expect(Object.keys(entry)).not.toContain("nodeExchange");
    });

    it("names neither the connector nor the wire vocabulary", () => {
      // One probe rather than five, because each one compiles the package.
      // `ConnectionAttempt` and its relatives are listed too: they exist only to
      // describe the connector, and they are the shape a caller would fill in to
      // hand-write one.
      const errors = typeErrorsIn(`
      import { nodeExchange } from "./index.js";
      import type {
        ConnectionAttempt,
        ExchangeResult,
        OpenExchange,
        WireExchange,
      } from "./index.js";
      void nodeExchange;
      export type Probe = [ConnectionAttempt, ExchangeResult, OpenExchange, WireExchange];
    `).join(" ");
      for (const name of [
        "nodeExchange",
        "ConnectionAttempt",
        "ExchangeResult",
        "OpenExchange",
        "WireExchange",
      ]) {
        expect(errors).toContain(
          `Module '"./index.js"' has no exported member '${name}'.`,
        );
      }
    });

    it("has no way to substitute one through the public factory", () => {
      const errors = typeErrorsIn(`
      import { createNetworkPolicy, createNodeTransport } from "./index.js";
      const result = createNetworkPolicy("local-loopback", "http://127.0.0.1:8080/");
      if (result.kind === "policy") {
        createNodeTransport({
          policy: result.policy,
          openExchange: () => Promise.resolve({
            kind: "failure" as const,
            reason: { code: "connection-failed" as const, phase: "connect" as const },
          }),
        });
      }
    `);
      expect(errors.join(" ")).toContain("openExchange");
    });
  },
);
