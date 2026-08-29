import type {
  AssertionOutcome,
  HttpObservation,
  ObservationRequest,
  PlanInput,
  ProbeObservation,
  RoundContext,
} from "@agentready-lab/core";
import {
  DEFAULT_TARGET,
  InMemoryTransport,
  expectEvidenceResolves,
  expectFindingCodes,
  expectGate,
  expectRequests,
  expectRequirementClasses,
  expectSerialDispatch,
  expectStatus,
  failure,
  planningContextOf,
  respond,
  runRuleContract,
} from "@agentready-lab/testkit";
import type {
  CannedHttpResult,
  RuleContractInput,
} from "@agentready-lab/testkit";
import { describe, expect, it } from "vitest";

import {
  analyzeApiCatalog,
  apiCatalogRule,
} from "../../src/rules/api-catalog.js";

/**
 * `docs/FIXTURE_CATALOG.md` section 11, cases `api-001` to `api-006`, driven
 * through `runScan` by the rule contract harness of
 * `docs/TEST_STRATEGY.md` section 6.
 *
 * The bodies are the ones `apps/fixtures-worker/src/cases/api-catalog.ts`
 * serves, with `{{origin}}` already resolved to the loopback fixture origin.
 * They are duplicated rather than imported because `apps/fixtures-worker` is
 * not a dependency of this package and must not become one.
 *
 * TWO EXPECTATIONS HERE DISAGREE WITH THE FIXTURE CATALOG, deliberately.
 * `api-001` and `api-002` are stated as `spec: pass`; they are `warning`,
 * because RFC 9727 section 4.2 recommends a `profile` parameter on the
 * `Content-Type` and the base fixture serves none. The catalog's stated status
 * did not anticipate the recommendation, which
 * `apps/fixtures-worker/src/cases/shared.ts` already records as
 * `API_PROFILE_UNPINNED`. The `PROFILED` cases below prove the rule reaches
 * `pass` the moment a catalog advertises the profile URI the RFC names, which
 * is what localizes the defect to the fixture rather than to this rule.
 */

const ORIGIN = DEFAULT_TARGET.origin;
const CATALOG_URL = `${ORIGIN}/.well-known/api-catalog`;
const LINKSET = "application/linkset+json";
const PROFILED = `${LINKSET}; profile="https://www.rfc-editor.org/info/rfc9727"`;

const PLAN_INPUT: PlanInput<unknown> = {
  mode: "spec",
  profile: { id: "api", version: "0.1.0" },
  target: DEFAULT_TARGET,
  options: {},
};

/** `apps/fixtures-worker/src/cases/base/valid-agent-site-v1.ts`. */
const BASE_CATALOG = JSON.stringify({
  linkset: [
    {
      anchor: `${ORIGIN}/api/orders`,
      "service-desc": [
        {
          href: `${ORIGIN}/openapi.json`,
          type: "application/openapi+json",
        },
      ],
    },
  ],
});

/** `api-002`. */
const TWO_CONTEXTS = JSON.stringify({
  linkset: [
    {
      anchor: `${ORIGIN}/api/orders`,
      "service-desc": [{ href: `${ORIGIN}/openapi.json` }],
    },
    {
      anchor: `${ORIGIN}/api/inventory`,
      "service-desc": [{ href: `${ORIGIN}/openapi.json` }],
    },
  ],
});

/** `api-004`. A missing closing brace on the first link object. */
const MALFORMED_JSON = `{
  "linkset": [
    {
      "anchor": "${ORIGIN}/api/orders",
      "service-desc": [
        { "href": "${ORIGIN}/openapi.json"
      ]
    }
  ]
}
`;

/** `api-005`. */
const EMPTY_LINKSET = '{"linkset":[]}';

/** `api-006`. No anchor, and `describedby` is not a link to an API endpoint. */
const NO_ANCHOR_NO_API_RELATION = JSON.stringify({
  linkset: [{ describedby: [{ href: `${ORIGIN}/`, type: "text/html" }] }],
});

const ALL_ASSERTIONS = [
  "api-catalog.discovery",
  "api-catalog.linkset",
  "api-catalog.profile",
  "api-catalog.relations",
];

function planned(): ObservationRequest {
  const request = apiCatalogRule.plan(PLAN_INPUT)[0];
  if (request === undefined) {
    throw new Error("web.discovery.api-catalog planned no request");
  }
  return request;
}

/** Serves one canned answer at the well-known path and runs the whole scan. */
async function scan(
  result: CannedHttpResult,
): ReturnType<typeof runRuleContract> {
  const transport = new InMemoryTransport();
  const input: RuleContractInput = {
    rule: apiCatalogRule,
    transport,
    // The rule is not in the `content` profile. `api` is one of the three it
    // declares, and a profile it is absent from would resolve to no result.
    profile: "api",
  };
  transport.routeObservation(planned(), planningContextOf(input), result);
  return runRuleContract(input);
}

function served(body: string, contentType: string): CannedHttpResult {
  return respond({ headers: { "content-type": contentType }, body });
}

describe("the request it makes", () => {
  it("asks for the RFC 9727 well-known path as a linkset, once", async () => {
    const run = await scan(served(BASE_CATALOG, LINKSET));
    expectRequests(run, [{ url: CATALOG_URL, method: "GET", accept: LINKSET }]);
    expectSerialDispatch(run.transport);
    expectGate(run, "enforced");
    expectEvidenceResolves(run);
  });
});

describe("api-001: a valid catalog", () => {
  it("passes every normative assertion", async () => {
    const run = await scan(served(BASE_CATALOG, LINKSET));
    expectFindingCodes(run, ALL_ASSERTIONS);
    expect(statusesOf(run)).toEqual({
      "api-catalog.discovery": "pass",
      "api-catalog.linkset": "pass",
      "api-catalog.relations": "pass",
      // RFC 9727 section 4.2's SHOULD, which the base fixture does not follow.
      "api-catalog.profile": "warning",
    });
    expectRequirementClasses(run, {
      "api-catalog.discovery": "normative",
      "api-catalog.linkset": "normative",
      "api-catalog.relations": "normative",
      "api-catalog.profile": "recommended",
    });
  });

  it("is warning, not the pass docs/FIXTURE_CATALOG.md section 11 states", async () => {
    expectStatus(await scan(served(BASE_CATALOG, LINKSET)), "warning");
  });

  it("passes once the profile parameter RFC 9727 section 4.2 names is served", async () => {
    const run = await scan(served(BASE_CATALOG, PROFILED));
    expectStatus(run, "pass");
    expect(statusesOf(run)["api-catalog.profile"]).toBe("pass");
  });

  it("never derives fail from the recommended assertion", async () => {
    const run = await scan(served(BASE_CATALOG, LINKSET));
    const profile = run.findings.find(
      (finding) => finding.code === "api-catalog.profile",
    );
    expect(profile?.status).toBe("warning");
    expect(run.findings.some((finding) => finding.status === "fail")).toBe(
      false,
    );
  });
});

describe("api-002: two independent API contexts", () => {
  it("resolves both contexts and reports the same four assertions", async () => {
    const run = await scan(served(TWO_CONTEXTS, LINKSET));
    expectFindingCodes(run, ALL_ASSERTIONS);
    expect(statusesOf(run)["api-catalog.relations"]).toBe("pass");
    expectStatus(run, "warning");
  });

  it("passes with the profile parameter, and is order-stable", async () => {
    const first = await scan(served(TWO_CONTEXTS, PROFILED));
    const second = await scan(served(TWO_CONTEXTS, PROFILED));
    expectStatus(first, "pass");
    expect(first.canonicalJson).toBe(second.canonicalJson);
  });
});

describe("api-003: a valid-looking body served as text/html", () => {
  it("fails on the media type and checks nothing downstream", async () => {
    const run = await scan(served(BASE_CATALOG, "text/html; charset=utf-8"));
    expectStatus(run, "fail");
    expect(statusesOf(run)).toEqual({
      "api-catalog.discovery": "fail",
      "api-catalog.linkset": "unable-to-check",
      "api-catalog.relations": "unable-to-check",
      "api-catalog.profile": "unable-to-check",
    });
  });

  it.each([
    ["application/json", "application/json"],
    ["text/plain", "text/plain; charset=utf-8"],
    ["a near miss", "application/linkset"],
    ["a JSON sibling", "application/linkset+json5"],
    ["nothing at all", undefined],
  ])("refuses %s", async (_label, contentType) => {
    const run = await scan(
      contentType === undefined
        ? respond({ body: BASE_CATALOG })
        : served(BASE_CATALOG, contentType),
    );
    expect(statusesOf(run)["api-catalog.discovery"]).toBe("fail");
    expectStatus(run, "fail");
  });

  it("accepts the media type case-insensitively and with parameters", async () => {
    const run = await scan(
      served(BASE_CATALOG, "APPLICATION/Linkset+JSON; charset=utf-8"),
    );
    expect(statusesOf(run)["api-catalog.discovery"]).toBe("pass");
  });
});

describe("api-004: malformed JSON at the correct media type", () => {
  it("fails the linkset assertion and cannot judge the relations", async () => {
    const run = await scan(served(MALFORMED_JSON, LINKSET));
    expectStatus(run, "fail");
    expect(statusesOf(run)).toEqual({
      "api-catalog.discovery": "pass",
      "api-catalog.linkset": "fail",
      "api-catalog.relations": "unable-to-check",
      "api-catalog.profile": "warning",
    });
  });

  it("treats a parser budget as unable-to-check, not as a violation", async () => {
    // A document within every other limit and 65 containers deep. The target
    // has broken no requirement; this scanner declined to look that far.
    const deep = `{"linkset":${"[".repeat(64)}${"]".repeat(64)}}`;
    const run = await scan(served(deep, LINKSET));
    expect(statusesOf(run)["api-catalog.linkset"]).toBe("unable-to-check");
    expectStatus(run, "unable-to-check");
  });
});

describe("api-005: an empty linkset array", () => {
  it("fails on api-catalog.relations and not on the serialization", async () => {
    const run = await scan(served(EMPTY_LINKSET, LINKSET));
    expectStatus(run, "fail");
    expect(statusesOf(run)).toEqual({
      "api-catalog.discovery": "pass",
      // RFC 9264 section 4.2.1 is satisfied: an empty array is a well-formed
      // link set. RFC 9727 section 4.1 is not.
      "api-catalog.linkset": "pass",
      "api-catalog.relations": "fail",
      "api-catalog.profile": "warning",
    });
  });

  it("locates the empty array precisely", () => {
    expect(analyzeApiCatalog(LINKSET, bytes(EMPTY_LINKSET))).toMatchObject({
      relations: "violated",
      pointer: "/linkset",
    });
  });
});

describe("api-006: an entry with no anchor and no API relation", () => {
  it("fails on api-catalog.relations", async () => {
    const run = await scan(served(NO_ANCHOR_NO_API_RELATION, LINKSET));
    expectStatus(run, "fail");
    expect(statusesOf(run)).toEqual({
      "api-catalog.discovery": "pass",
      "api-catalog.linkset": "pass",
      "api-catalog.relations": "fail",
      "api-catalog.profile": "warning",
    });
  });

  it("computes the precise JSON Pointer the catalog asks for", () => {
    expect(
      analyzeApiCatalog(LINKSET, bytes(NO_ANCHOR_NO_API_RELATION)),
    ).toMatchObject({ relations: "violated", pointer: "/linkset/0" });
  });

  it("carries no parameter, because the ruleset declares none", async () => {
    // The pointer above is exact and unreportable: every assertion of this
    // rule declares `params: []` in specs/ruleset.standard.v0.yaml, and
    // `validateOutcomeParams` rejects an undeclared parameter. If this ever
    // starts failing, the ruleset assigned the parameter and the rule should
    // start sending it.
    const outcomes = stepOutcomes(
      contextFor(httpObservation(NO_ANCHOR_NO_API_RELATION, LINKSET)),
    );
    expect(outcomes.map((outcome) => outcome.params)).toEqual([{}, {}, {}, {}]);
    const run = await scan(served(NO_ANCHOR_NO_API_RELATION, LINKSET));
    expect(run.findings.map((finding) => finding.message)).toEqual([
      "api-catalog.discovery is satisfied",
      "api-catalog.linkset is satisfied",
      "api-catalog.profile is violated",
      "api-catalog.relations is violated",
    ]);
  });
});

describe("the RFC 9727 section 4.1 relation semantics", () => {
  it.each([
    [
      "an anchored endpoint with service-desc (Appendix A.1)",
      {
        linkset: [
          { anchor: "https://a.example/api", "service-desc": [{ href: "x" }] },
        ],
      },
      "satisfied",
    ],
    [
      "an anchored endpoint with service-doc only",
      {
        linkset: [
          { anchor: "https://a.example/api", "service-doc": [{ href: "x" }] },
        ],
      },
      "satisfied",
    ],
    [
      "bookmark items (Appendix A.2)",
      {
        linkset: [
          {
            anchor: "https://a.example/.well-known/api-catalog",
            item: [{ href: "x" }],
          },
        ],
      },
      "satisfied",
    ],
    [
      "a nested catalog (section 4.3)",
      { linkset: [{ "api-catalog": [{ href: "x" }] }] },
      "satisfied",
    ],
    [
      "one qualifying entry beside a non-qualifying one",
      {
        linkset: [
          { describedby: [{ href: "x" }] },
          { anchor: "https://a.example/api", status: [{ href: "x" }] },
        ],
      },
      "satisfied",
    ],
    [
      "service relations with no anchor to name the endpoint",
      { linkset: [{ "service-desc": [{ href: "x" }] }] },
      "violated",
    ],
    [
      "an anchor with an empty relation array",
      { linkset: [{ anchor: "https://a.example/api", "service-desc": [] }] },
      "violated",
    ],
    [
      "an anchor with no relation at all",
      { linkset: [{ anchor: "https://a.example/api" }] },
      "violated",
    ],
  ])("reads %s as %s", (_label, document, expected) => {
    expect(
      analyzeApiCatalog(LINKSET, bytes(JSON.stringify(document))).relations,
    ).toBe(expected);
  });
});

describe("RFC 9264 serialization defects", () => {
  it.each([
    ["a root that is not an object", "[]", ""],
    ["a root with a second member", '{"linkset":[],"extra":1}', ""],
    ["a root with no linkset member", '{"links":[]}', ""],
    ["a linkset that is not an array", '{"linkset":{}}', "/linkset"],
    ["an entry that is not an object", '{"linkset":["a"]}', "/linkset/0"],
    [
      "an anchor that is not a string",
      '{"linkset":[{"anchor":42}]}',
      "/linkset/0/anchor",
    ],
    [
      "a relation whose value is not an array",
      '{"linkset":[{"item":{"href":"x"}}]}',
      "/linkset/0/item",
    ],
    [
      "a link target that is not an object",
      '{"linkset":[{"item":["x"]}]}',
      "/linkset/0/item/0",
    ],
    [
      "a link target with no href",
      '{"linkset":[{"item":[{"type":"text/html"}]}]}',
      "/linkset/0/item/0/href",
    ],
  ])("fails %s at %s", (_label, body, pointer) => {
    expect(analyzeApiCatalog(LINKSET, bytes(body))).toMatchObject({
      discovery: "satisfied",
      linkset: "violated",
      relations: "indeterminate",
      pointer,
    });
  });

  it("permits the empty href RFC 9264 section 4.2.3 requires", () => {
    expect(
      analyzeApiCatalog(LINKSET, bytes('{"linkset":[{"item":[{"href":""}]}]}'))
        .linkset,
    ).toBe("satisfied");
  });
});

describe("the profile parameter of RFC 9727 section 4.2", () => {
  it.each([
    [PROFILED, "satisfied"],
    [
      `${LINKSET}; profile="https://example.invalid/other https://www.rfc-editor.org/info/rfc9727"`,
      "satisfied",
    ],
    [
      `${LINKSET}; PROFILE="https://www.rfc-editor.org/info/rfc9727"`,
      "satisfied",
    ],
    [LINKSET, "violated"],
    [`${LINKSET}; profile="https://example.invalid/other"`, "violated"],
    [`${LINKSET}; charset=utf-8`, "violated"],
    // RFC 9727 section 7.3 registers the `info` URI, not the RFC document URI.
    [
      `${LINKSET}; profile="https://www.rfc-editor.org/rfc/rfc9727"`,
      "violated",
    ],
  ])("reads %s as %s", (contentType, expected) => {
    expect(analyzeApiCatalog(contentType, bytes(BASE_CATALOG)).profile).toBe(
      expected,
    );
  });

  it("refuses an unquoted profile URI as a malformed Content-Type", () => {
    // RFC 9110 section 5.6.6 makes a parameter value a `token` or a
    // `quoted-string`, and neither `:` nor `/` is a `tchar`. So an unquoted
    // URI is not a media type at all, which is a discovery failure rather
    // than a missing profile: the field says nothing reliable about the
    // representation, so nothing downstream is judged.
    const field = `${LINKSET};profile=https://www.rfc-editor.org/info/rfc9727`;
    expect(analyzeApiCatalog(field, bytes(BASE_CATALOG))).toMatchObject({
      discovery: "violated",
      profile: "indeterminate",
    });
  });
});

describe("conditions that are not conformance failures", () => {
  it("reports an absent catalog as not-applicable, never as fail", async () => {
    for (const status of [404, 410]) {
      const run = await scan(respond({ status }));
      expectStatus(run, "not-applicable");
      expect(
        run.findings.every((finding) => finding.status === "not-applicable"),
      ).toBe(true);
    }
  });

  it.each([500, 503, 301])(
    "reports HTTP %i as unable-to-check",
    async (status) => {
      expectStatus(await scan(respond({ status })), "unable-to-check");
    },
  );

  it("fails a 204, which answers without the representation 6.2 requires", async () => {
    // Not an environmental error: the location answered. RFC 9727 section 6.2
    // says it "MUST support the Linkset [RFC9264] format of
    // application/linkset+json", and a No Content response supports nothing.
    const run = await scan(respond({ status: 204 }));
    expectStatus(run, "fail");
    expect(statusesOf(run)["api-catalog.discovery"]).toBe("fail");
  });

  it.each(["connection-failed", "request-timeout", "response-limit"] as const)(
    "reports the transport error %s as unable-to-check",
    async (code) => {
      expectStatus(await scan(failure(code)), "unable-to-check");
    },
  );

  it("reports a truncated body as unable-to-check", async () => {
    const run = await scan(
      respond({
        headers: { "content-type": LINKSET },
        body: BASE_CATALOG,
        truncated: true,
      }),
    );
    expectStatus(run, "unable-to-check");
  });
});

describe("purity", () => {
  it("plans one bounded GET and returns the same plan every time", () => {
    const first = apiCatalogRule.plan(PLAN_INPUT);
    const second = apiCatalogRule.plan(PLAN_INPUT);
    expect(first).toEqual(second);
    expect(first).toEqual([
      {
        kind: "http",
        id: "well-known-api-catalog",
        method: "GET",
        target: { kind: "origin-path", path: "/.well-known/api-catalog" },
        accept: LINKSET,
        redirects: "follow-same-origin",
        maxEncodedBytes: 262_144,
        maxDecodedBytes: 262_144,
      },
    ]);
  });

  it("returns outcomes synchronously from step, never a request batch", () => {
    const stepped = apiCatalogRule.step(
      contextFor(httpObservation(BASE_CATALOG, LINKSET)),
    );
    expect(stepped.kind).toBe("outcomes");
    expect(stepped).not.toBeInstanceOf(Promise);
  });

  it("makes finish agree with step, since roundTwoBudget is zero", () => {
    const context = contextFor(httpObservation(BASE_CATALOG, LINKSET));
    expect(apiCatalogRule.finish(context)).toEqual(
      apiCatalogRule.step(context),
    );
    expect(apiCatalogRule.metadata.roundTwoBudget).toBe(0);
  });

  it("is indeterminate when handed a DNS observation it never asked for", () => {
    const dns: ProbeObservation = {
      kind: "dns",
      id: "well-known-api-catalog",
      query: { name: "127.0.0.1", recordType: "A" },
      outcome: {
        kind: "answer",
        rcode: "NOERROR",
        records: [],
        dnssec: "insecure",
      },
    };
    const kinds = stepOutcomes(contextFor(dns)).map((outcome) => outcome.kind);
    expect(kinds).toEqual([
      "indeterminate",
      "indeterminate",
      "indeterminate",
      "indeterminate",
    ]);
  });
});

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** `step` is typed to allow a second round; this rule never opens one. */
function stepOutcomes(
  context: RoundContext<unknown>,
): readonly AssertionOutcome[] {
  const stepped = apiCatalogRule.step(context);
  if (stepped.kind !== "outcomes") {
    throw new Error("web.discovery.api-catalog asked for a second round");
  }
  return stepped.outcomes;
}

function statusesOf(
  run: Awaited<ReturnType<typeof runRuleContract>>,
): Record<string, string> {
  return Object.fromEntries(
    run.findings.map((finding) => [finding.code, finding.status]),
  );
}

function httpObservation(body: string, contentType: string): HttpObservation {
  const encoded = bytes(body);
  return {
    kind: "http",
    id: "well-known-api-catalog",
    request: { method: "GET", url: CATALOG_URL, headers: new Map() },
    outcome: {
      kind: "response",
      status: 200,
      effectiveUrl: CATALOG_URL,
      headers: new Map([["content-type", [contentType]]]),
      body: encoded,
      truncated: false,
      encodedBytes: encoded.length,
      decodedBytes: encoded.length,
      bodySha256: "sha256:test",
      redirects: [],
    },
  };
}

/** The rule reaches neither `memo` nor any other observation id. */
function contextFor(observation: ProbeObservation): RoundContext<unknown> {
  return {
    ...PLAN_INPUT,
    observation: (id: string): ProbeObservation => {
      if (id !== observation.id) throw new Error(`unexpected id ${id}`);
      return observation;
    },
    memo: <T>(_key: string, load: () => T): T => load(),
  };
}
