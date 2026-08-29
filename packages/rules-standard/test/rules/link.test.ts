import type {
  CannedHttpResult,
  RespondInit,
  RuleContractRun,
} from "@agentready-lab/testkit";
import {
  InMemoryTransport,
  expectEvidenceResolves,
  expectFindingCodes,
  expectGate,
  expectRequests,
  expectRequirementClasses,
  expectStatus,
  failure,
  respond,
  runRuleContract,
} from "@agentready-lab/testkit";
import type {
  HttpObservation,
  PlanInput,
  RoundContext,
  TargetDescriptor,
} from "@agentready-lab/core";
import { describe, expect, it } from "vitest";

import { linkRule } from "../../src/rules/link.js";

/**
 * `web.discovery.link` against the six `docs/FIXTURE_CATALOG.md` section 7
 * cases, driven through `runScan` rather than a reimplementation of it.
 *
 * Every status below is derived by `findingStatus` and `deriveRuleStatus` in
 * the core, from the outcome kind and the class pinned in the ruleset. The rule
 * reports outcomes; nothing here lets it choose a status.
 *
 * `lnk-001` and `lnk-002` are served here both as a header map with repeated
 * field values and as one comma-joined value. The catalog notes that the
 * fixture Worker cannot serve the first shape, because a normalized `Response`
 * folds repeated field lines, and that the raw-socket harness which can is a
 * separate layer. What this suite fixes is that the rule is correct for either
 * shape when it is handed one.
 */

const PAGE_URL = "http://127.0.0.1:8787/";
const REDIRECTED_URL = "http://127.0.0.1:8787/docs/";

const TARGET: TargetDescriptor = {
  requestedUrl: PAGE_URL,
  pageUrl: PAGE_URL,
  origin: "http://127.0.0.1:8787",
  scope: "local",
  networkProfile: "local-loopback",
};

/** The one request this rule plans, which `expectRequests` verifies. */
const PAGE_REQUEST = {
  url: PAGE_URL,
  method: "GET",
  accept: "text/html",
} as const;

/** Findings arrive sorted by code (`buildFindings`), so this order is fixed. */
const ALL_THREE = [
  "links.agent-useful",
  "links.parse",
  "links.relation",
] as const;

function linkResponse(
  link: string | readonly string[],
  effectiveUrl?: string,
): CannedHttpResult {
  const init: RespondInit = {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", link },
    body: "<!doctype html><title>fixture</title>",
  };
  if (effectiveUrl === undefined) return respond(init);
  return respond({
    ...init,
    effectiveUrl,
    redirects: [{ status: 308, location: effectiveUrl, decision: "followed" }],
  });
}

async function runLink(
  response: CannedHttpResult,
  options?: Readonly<Record<string, unknown>>,
): Promise<RuleContractRun> {
  const transport = new InMemoryTransport();
  transport.route({ url: PAGE_URL, accept: "text/html" }, response);
  return await runRuleContract({
    rule: linkRule,
    transport,
    ...(options === undefined ? {} : { options }),
  });
}

function statusesOf(run: RuleContractRun): readonly (readonly string[])[] {
  return run.findings.map((finding) => [finding.code, finding.status]);
}

describe("plan", () => {
  it("requests the page once, as HTML", () => {
    // ADR-0005 section 2's canonical `GET /` with `Accept: text/html`, which is
    // also the HTML representation `web.content.markdown-negotiation` requests,
    // so the two deduplicate onto one transport call. The byte caps say "I
    // lower no limit", which is what keeps the two canonical keys equal.
    const input: PlanInput<unknown> = {
      mode: "spec",
      profile: { id: "content", version: "0.1.0" },
      target: TARGET,
      options: linkRule.defaultOptions,
    };
    expect(linkRule.plan(input)).toStrictEqual([
      {
        kind: "http",
        id: "page",
        method: "GET",
        target: { kind: "page" },
        accept: "text/html",
        redirects: "follow-same-origin",
        maxEncodedBytes: Number.MAX_SAFE_INTEGER,
        maxDecodedBytes: Number.MAX_SAFE_INTEGER,
      },
    ]);
  });

  it("reserves no round-two budget, because it dereferences nothing", () => {
    expect(linkRule.metadata.roundTwoBudget).toBe(0);
  });
});

describe("lnk-001: several Link field lines, one of them agent-useful", () => {
  it("passes when the field arrives as repeated field lines", async () => {
    const run = await runLink(
      linkResponse([
        '</openapi.json>; rel="service-desc"; type="application/json"',
        '</style.css>; rel="stylesheet"',
      ]),
    );
    expectStatus(run, "pass");
    expectGate(run, "enforced");
    expectFindingCodes(run, ALL_THREE);
    expectEvidenceResolves(run);
    expectRequests(run, [PAGE_REQUEST]);
  });

  it("passes when the same field arrives combined into one value", async () => {
    const run = await runLink(
      linkResponse(
        '</openapi.json>; rel="service-desc"; type="application/json", </style.css>; rel="stylesheet"',
      ),
    );
    expectStatus(run, "pass");
    expectFindingCodes(run, ALL_THREE);
  });

  it("accepts an agent-useful relation beside others in one rel", async () => {
    const run = await runLink(
      linkResponse('</about>; rel="canonical describedby"'),
    );
    expectStatus(run, "pass");
  });
});

describe("lnk-002: a quoted title containing a comma", () => {
  it("passes rather than reading the title as a list separator", async () => {
    const run = await runLink(
      linkResponse('</about>; rel="describedby"; title="Foo, Bar"'),
    );
    expectStatus(run, "pass");
    expectFindingCodes(run, ALL_THREE);
  });

  it("still fails a malformed element that follows a quoted comma", async () => {
    // The anti-naive-split case in the other direction: a comma inside quotes
    // must not hide the syntax error that comes after it.
    const run = await runLink(
      linkResponse(
        '</about>; rel="describedby"; title="Foo, Bar", /b; rel=next',
      ),
    );
    expectStatus(run, "fail");
  });
});

describe("lnk-003: a relative target and a redirect", () => {
  it("passes with a relative target after a same-origin redirect", async () => {
    const run = await runLink(
      linkResponse('<./openapi.json>; rel="service-desc"', REDIRECTED_URL),
    );
    expectStatus(run, "pass");
    expectFindingCodes(run, ALL_THREE);
  });

  it("takes the resolution base from the effective URL, not the requested one", async () => {
    // The only half of RFC 8288 target resolution this rule can perform is
    // choosing the base, because core exposes no resolver. `anchor` is where
    // that choice becomes observable: section 3.2 moves a link's context to its
    // anchor, and an anchor naming the effective URL is still this page.
    const run = await runLink(
      linkResponse(
        `<./openapi.json>; rel="service-desc"; anchor="${REDIRECTED_URL}"`,
        REDIRECTED_URL,
      ),
    );
    expectStatus(run, "pass");
  });

  it("does not credit a link anchored to the URL the page redirected away from", async () => {
    const run = await runLink(
      linkResponse(
        `<./openapi.json>; rel="service-desc"; anchor="${PAGE_URL}"`,
        REDIRECTED_URL,
      ),
    );
    expectStatus(run, "warning");
  });

  it("treats an empty anchor as this page, per RFC 3986 section 5.4", async () => {
    const run = await runLink(
      linkResponse(
        '<./openapi.json>; rel="service-desc"; anchor=""',
        REDIRECTED_URL,
      ),
    );
    expectStatus(run, "pass");
  });
});

describe("lnk-004: an unclosed quoted parameter", () => {
  it("fails links.parse", async () => {
    const run = await runLink(
      linkResponse('</openapi.json>; rel="service-desc"; title="unclosed'),
    );
    expectStatus(run, "fail");
    expectFindingCodes(run, ALL_THREE);
    expectRequirementClasses(run, {
      "links.parse": "normative",
      "links.relation": "normative",
      "links.agent-useful": "advisory",
    });
    expect(statusesOf(run)).toStrictEqual([
      ["links.agent-useful", "unable-to-check"],
      ["links.parse", "fail"],
      ["links.relation", "unable-to-check"],
    ]);
  });

  it("does not answer the relation question it never reached", async () => {
    // A malformed field is not evidence that the relations are wrong, and a
    // `violated` there would be a verdict nothing computed.
    const run = await runLink(linkResponse("<https://example.invalid/a"));
    expectStatus(run, "fail");
    expect(statusesOf(run)).toStrictEqual([
      ["links.agent-useful", "unable-to-check"],
      ["links.parse", "fail"],
      ["links.relation", "unable-to-check"],
    ]);
  });
});

describe("lnk-005: valid syntax exposing only rel=stylesheet", () => {
  it("satisfies the syntax assertions and warns about usefulness", async () => {
    const run = await runLink(linkResponse('</style.css>; rel="stylesheet"'));
    expectStatus(run, "warning");
    expectFindingCodes(run, ALL_THREE);
    expect(statusesOf(run)).toStrictEqual([
      ["links.agent-useful", "warning"],
      ["links.parse", "pass"],
      ["links.relation", "pass"],
    ]);
  });

  it("keeps links.agent-useful advisory and cited only to the policy", () => {
    // ADR-0010 section 3, prohibitions 1 and 2: no `fail` may rest on this
    // project's own opinion, and an assertion's citations are either entirely
    // project-policy or entirely external. A rule declaring this `normative`
    // would be an `assertion-class-escalated` contract violation before it ran.
    const declared = linkRule.metadata.assertions.find(
      (assertion) => assertion.id === "links.agent-useful",
    );
    expect(declared?.requirementClass).toBe("advisory");
    expect(declared?.sourceRefs).toStrictEqual([
      { sourceId: "agentready-lab-agent-useful-relations", section: "2" },
    ]);
  });

  it("warns rather than failing for an anchored agent-useful relation", async () => {
    const run = await runLink(
      linkResponse(
        '</openapi.json>; rel="service-desc"; anchor="https://elsewhere.invalid/x"',
      ),
    );
    expectStatus(run, "warning");
  });
});

describe("lnk-006: no Link field at all", () => {
  it("is not-applicable, because an absent optional mechanism is not a failure", async () => {
    const run = await runLink(
      respond({
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: "<!doctype html><title>no links</title>",
      }),
    );
    expectStatus(run, "not-applicable");
    expectFindingCodes(run, ALL_THREE);
    expect(run.findings.map((finding) => finding.status)).toStrictEqual([
      "not-applicable",
      "not-applicable",
      "not-applicable",
    ]);
  });
});

describe("relation interpretation", () => {
  it("fails a link-value with no rel, which RFC 8288 section 3.3 requires", async () => {
    const run = await runLink(linkResponse('</about>; title="no rel"'));
    expectStatus(run, "fail");
    expect(statusesOf(run)).toStrictEqual([
      ["links.agent-useful", "warning"],
      ["links.parse", "pass"],
      ["links.relation", "fail"],
    ]);
  });

  it("fails a relation name that is neither registered nor a URI", async () => {
    const run = await runLink(linkResponse('</about>; rel="service_desc"'));
    expectStatus(run, "fail");
  });

  it("accepts an extension relation URI", async () => {
    const run = await runLink(
      linkResponse(
        '</a>; rel="https://example.invalid/rel/x", </b>; rel="service-desc"',
      ),
    );
    expectStatus(run, "pass");
  });

  it("does not match an allowlisted relation by substring", async () => {
    // "rather than a substring search": `service-description` is a different
    // registered relation name, not `service-desc`.
    const run = await runLink(linkResponse('</a>; rel="service-description"'));
    expectStatus(run, "warning");
  });
});

describe("the agent-useful allowlist is an option", () => {
  it("defaults to policy 0.1.0's three relations", () => {
    expect(linkRule.defaultOptions).toStrictEqual({
      agentUsefulRelations: ["service-desc", "describedby", "api-catalog"],
    });
  });

  it("records the effective allowlist in the report", async () => {
    const run = await runLink(linkResponse('</style.css>; rel="stylesheet"'));
    expect(
      run.report.effectiveOptions.find(
        (entry) => entry.ruleId === "web.discovery.link",
      )?.options,
    ).toStrictEqual({
      agentUsefulRelations: {
        kind: "string-list",
        value: ["service-desc", "describedby", "api-catalog"],
      },
    });
  });

  it("honours a user-supplied allowlist", async () => {
    const run = await runLink(linkResponse('</style.css>; rel="stylesheet"'), {
      agentUsefulRelations: ["stylesheet"],
    });
    expectStatus(run, "pass");
  });

  it("uses the policy set when the option is not a list of strings", async () => {
    // Nothing validates rule option shapes yet: ADR-0004 section 8's per-rule
    // JSON Schema does not exist, and `resolveRuleOptions` checks key names
    // only. A bare string would turn `Array.prototype.includes` into the
    // substring search this rule forbids, and `"service-desc"` contains
    // `"desc"`.
    const run = await runLink(linkResponse('</a>; rel="desc"'), {
      agentUsefulRelations: "service-desc",
    });
    expectStatus(run, "warning");
  });
});

describe("observation failures are not conformance failures", () => {
  it("is unable-to-check when the page could not be fetched", async () => {
    const run = await runLink(failure("connection-failed"));
    expectStatus(run, "unable-to-check");
    expect(run.findings.map((finding) => finding.status)).toStrictEqual([
      "unable-to-check",
      "unable-to-check",
      "unable-to-check",
    ]);
  });

  it("is unable-to-check when the Link field is past the parser's bound", async () => {
    const run = await runLink(linkResponse("</a>; rel=next, ".repeat(4096)));
    expectStatus(run, "unable-to-check");
  });
});

describe("finish", () => {
  it("evaluates exactly as step does", () => {
    // `runScan` calls `finish` only for a rule whose `step` returned a second
    // request batch, and this one never does, so the two are compared directly
    // rather than through the harness. A `finish` that still threw would be a
    // trap for whoever gives this rule a round two.
    const observation: HttpObservation = {
      kind: "http",
      id: "page",
      request: {
        method: "GET",
        url: PAGE_URL,
        headers: new Map<string, readonly string[]>(),
      },
      outcome: {
        kind: "response",
        status: 200,
        effectiveUrl: REDIRECTED_URL,
        headers: new Map<string, readonly string[]>([
          ["link", ['</style.css>; rel="stylesheet"']],
        ]),
        body: new Uint8Array(0),
        truncated: false,
        encodedBytes: 0,
        decodedBytes: 0,
        bodySha256: "sha256:e3b0c442",
        redirects: [],
      },
    };
    const context: RoundContext<unknown> = {
      mode: "spec",
      profile: { id: "content", version: "0.1.0" },
      target: TARGET,
      options: linkRule.defaultOptions,
      observation: (): HttpObservation => observation,
      memo: (): never => {
        throw new Error("web.discovery.link reads no memo");
      },
    };

    const stepped = linkRule.step(context);
    expect(linkRule.finish(context)).toStrictEqual(stepped);
    expect(stepped).toStrictEqual({
      kind: "outcomes",
      outcomes: [
        {
          assertion: "links.parse",
          kind: "satisfied",
          params: {},
          observationRefs: ["page"],
        },
        {
          assertion: "links.relation",
          kind: "satisfied",
          params: {},
          observationRefs: ["page"],
        },
        {
          assertion: "links.agent-useful",
          kind: "violated",
          params: {},
          observationRefs: ["page"],
        },
      ],
    });
  });
});
