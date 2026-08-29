import {
  MEMO_KEYS,
  MemoStore,
  RuleContractViolation,
} from "@agentready-lab/core";
import type { PublicHttpEvidence, RuleStatus } from "@agentready-lab/core";
import {
  InMemoryTransport,
  REACHABLE_PUBLIC_ERROR_CODES,
  expectDeterministic,
  expectEvidenceResolves,
  expectFindingCodes,
  expectRequests,
  expectRequirementClasses,
  expectSerialDispatch,
  expectStatus,
  failure,
  latencyProfiles,
  planningContextOf,
  respond,
  runRuleContract,
} from "@agentready-lab/testkit";
import type {
  CannedHttpResult,
  RuleContractInput,
  RuleContractRun,
} from "@agentready-lab/testkit";
import { describe, expect, it } from "vitest";

import {
  PARSED_ROBOTS_MEMO_KEY,
  ROBOTS_PARSE_LIMITS,
  robotsObservationRequest,
} from "../../src/parsers/robots.js";
import { robotsRule } from "../../src/rules/robots.js";

/**
 * `web.discovery.robots` against the real engine.
 *
 * `docs/FIXTURE_CATALOG.md` section 5's six cases are the six `describe`
 * blocks below, each asserting the **per-finding** status and not only the
 * derived rule status. That distinction is the whole value of this file: rule
 * status precedence puts `fail` ahead of `pass`, so a test that only checked
 * the rule status would keep passing after a guard that decides one assertion
 * was deleted. Every mutation this suite is meant to catch is caught by the
 * per-finding table.
 */

const ROBOTS_URL = "http://127.0.0.1:8787/robots.txt";
const FINAL_URL = "http://127.0.0.1:8787/robots-final.txt";

const VALID_ROBOTS = [
  "User-agent: *",
  "Disallow: /private/",
  "Allow: /private/public-note",
  "",
].join("\n");

/** `rob-003`: a 200 that carries the site's generic not-found page. */
const NOT_FOUND_PAGE = [
  "<!doctype html>",
  '<html lang="en">',
  "  <head><title>404 - Not found</title></head>",
  "  <body><h1>We could not find that page.</h1></body>",
  "</html>",
].join("\n");

function plainText(body: string, init: { truncated?: boolean } = {}) {
  return respond({
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
    body,
    ...(init.truncated === undefined ? {} : { truncated: init.truncated }),
  });
}

/** One route for the one request the rule plans, keyed the way core keys it. */
function scenario(result: CannedHttpResult): RuleContractInput {
  const transport = new InMemoryTransport();
  const input: RuleContractInput = { rule: robotsRule, transport };
  transport.routeObservation(
    robotsObservationRequest("robots"),
    planningContextOf(input),
    result,
  );
  return input;
}

async function run(result: CannedHttpResult): Promise<RuleContractRun> {
  return await runRuleContract(scenario(result));
}

/**
 * The status of each named finding.
 *
 * `expectStatus` asserts the derived rule status, which precedence can make
 * insensitive to a single assertion. This asserts the assertions.
 */
function expectFindingStatuses(
  contractRun: RuleContractRun,
  expected: Readonly<Record<string, RuleStatus>>,
): void {
  const actual = Object.fromEntries(
    contractRun.findings.map((finding) => [finding.code, finding.status]),
  );
  expect(actual).toEqual(expected);
}

function httpEvidence(contractRun: RuleContractRun): PublicHttpEvidence {
  const entry = contractRun.evidence[0];
  if (entry?.kind !== "http") {
    throw new Error("the scan produced no HTTP evidence");
  }
  return entry;
}

describe("rob-001: a valid robots.txt", () => {
  it("passes, and asks the origin root for text/plain exactly once", async () => {
    const contractRun = await run(plainText(VALID_ROBOTS));

    expectStatus(contractRun, "pass");
    expectFindingCodes(contractRun, [
      "robots.location",
      "robots.not-authz",
      "robots.syntax",
    ]);
    expectFindingStatuses(contractRun, {
      "robots.location": "pass",
      "robots.syntax": "pass",
      "robots.not-authz": "pass",
    });
    expectRequirementClasses(contractRun, {
      "robots.location": "normative",
      "robots.syntax": "normative",
      "robots.not-authz": "advisory",
    });
    expectRequests(contractRun, [
      { url: ROBOTS_URL, method: "GET", accept: "text/plain" },
    ]);
    expectSerialDispatch(contractRun.transport);
    expect(expectEvidenceResolves(contractRun).length).toBeGreaterThan(0);
  });

  it("is byte-identical across latency profiles", async () => {
    const runs = [];
    for (const profile of latencyProfiles(1)) {
      runs.push(
        await run(
          respond({
            status: 200,
            headers: { "content-type": "text/plain" },
            body: VALID_ROBOTS,
            latencyTicks: profile.ticks[0] ?? 0,
          }),
        ),
      );
    }
    expectDeterministic(runs);
  });
});

describe("rob-002: an actual 404", () => {
  it("is not-applicable, with every assertion not-present together", async () => {
    const contractRun = await run(respond({ status: 404 }));

    // RFC 9309 section 2.3.1.3. The coexistence rule is why `robots.not-authz`
    // is not a pass here: `deriveRuleStatus` refuses `not-applicable` beside an
    // evaluated finding, so an advisory pass would be a contract violation
    // rather than a cosmetic difference.
    expectStatus(contractRun, "not-applicable");
    expectFindingStatuses(contractRun, {
      "robots.location": "not-applicable",
      "robots.syntax": "not-applicable",
      "robots.not-authz": "not-applicable",
    });
  });

  it.each([400, 401, 403, 410, 451, 499])(
    "treats %i as an unavailable robots.txt",
    async (status) => {
      expectStatus(await run(respond({ status })), "not-applicable");
    },
  );
});

describe("rob-003: a soft 404 served as text/html", () => {
  it("fails on the media type, and says so on robots.location", async () => {
    const contractRun = await run(
      respond({
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: NOT_FOUND_PAGE,
      }),
    );

    expectStatus(contractRun, "fail");
    // RFC 9309 section 2.3 fixes the media type at text/plain, so the wrong
    // representation is the location violation. The HTML lines are not RFC
    // 9309 records either, which is the separate syntax violation. Both are
    // asserted: rule status alone cannot tell them apart.
    expectFindingStatuses(contractRun, {
      "robots.location": "fail",
      "robots.syntax": "fail",
      "robots.not-authz": "pass",
    });
  });

  it("fails a 200 that declares no media type at all", async () => {
    const contractRun = await run(respond({ status: 200, body: VALID_ROBOTS }));

    expectFindingStatuses(contractRun, {
      "robots.location": "fail",
      "robots.syntax": "pass",
      "robots.not-authz": "pass",
    });
  });

  it("accepts text/plain with any parameters", async () => {
    const contractRun = await run(
      respond({
        status: 200,
        headers: { "content-type": "TEXT/Plain ;charset=UTF-8" },
        body: VALID_ROBOTS,
      }),
    );

    expectStatus(contractRun, "pass");
  });
});

describe("rob-004: one same-origin redirect to a valid file", () => {
  it("passes and keeps the redirect in evidence", async () => {
    const contractRun = await run(
      respond({
        status: 200,
        headers: { "content-type": "text/plain" },
        body: VALID_ROBOTS,
        effectiveUrl: FINAL_URL,
        redirects: [{ status: 301, location: FINAL_URL, decision: "followed" }],
      }),
    );

    expectStatus(contractRun, "pass");
    const evidence = httpEvidence(contractRun);
    expect(evidence.outcome.kind).toBe("response");
    expect(
      evidence.outcome.kind === "response" ? evidence.outcome.redirects : [],
    ).toEqual([{ status: 301, location: FINAL_URL, decision: "followed" }]);
    expectEvidenceResolves(contractRun);
  });
});

describe("rob-005: a redirect loop over the budget", () => {
  it("is unable-to-check and never fail", async () => {
    const contractRun = await run(failure("redirect-limit"));

    // A transport limit is not a conformance failure. If this ever reads
    // `fail`, the rule has started blaming the publisher for our own budget.
    expectStatus(contractRun, "unable-to-check");
    expectFindingStatuses(contractRun, {
      "robots.location": "unable-to-check",
      "robots.syntax": "unable-to-check",
      "robots.not-authz": "unable-to-check",
    });
  });

  it("suppresses the advisory disclosure rather than passing it", async () => {
    const contractRun = await run(failure("redirect-limit"));
    const notAuthz = contractRun.findings.find(
      (finding) => finding.code === "robots.not-authz",
    );

    // The disclosure is only true of a retrieval that happened. Emitting it as
    // satisfied here would put a green advisory finding beside a scan that
    // observed nothing.
    expect(notAuthz?.status).toBe("unable-to-check");
  });
});

describe("rob-006: a valid group among comments, blanks and unknown fields", () => {
  it("passes without interpreting the unknown fields", async () => {
    const document = [
      "# Crawl policy for example.invalid",
      "",
      "Sitemap: http://127.0.0.1:8787/sitemap.xml",
      "",
      "User-agent: *   # everyone",
      "Disallow: /admin/",
      "Content-Signal: search=yes, ai-train=no",
      "Allow: /admin/help",
      "",
      "Crawl-delay: 10",
      "\tUser-agent: ExampleBot",
      "Disallow:",
      "# trailing comment, and no final newline",
    ].join("\r\n");

    const contractRun = await run(plainText(document));

    expectStatus(contractRun, "pass");
    expectFindingStatuses(contractRun, {
      "robots.location": "pass",
      "robots.syntax": "pass",
      "robots.not-authz": "pass",
    });
  });
});

describe("transport failures never become conformance failures", () => {
  it.each(REACHABLE_PUBLIC_ERROR_CODES)(
    "maps %s to unable-to-check",
    async (code) => {
      const contractRun = await run(failure(code));

      expectStatus(contractRun, "unable-to-check");
      expect(
        contractRun.findings.every(
          (finding) => finding.status === "unable-to-check",
        ),
      ).toBe(true);
    },
  );

  it.each([500, 502, 503, 504])(
    "leaves an unreachable %i undefined rather than absent",
    async (status) => {
      // RFC 9309 section 2.3.1.4: unreachable is not the same condition as
      // section 2.3.1.3's unavailable, so this is not `not-applicable`.
      expectStatus(await run(respond({ status })), "unable-to-check");
    },
  );

  it("cannot evaluate a 3xx the redirect policy did not follow", async () => {
    expectStatus(
      await run(
        respond({
          status: 302,
          headers: { location: "https://elsewhere.invalid/robots.txt" },
          redirects: [
            {
              status: 302,
              location: "https://elsewhere.invalid/robots.txt",
              decision: "blocked",
            },
          ],
        }),
      ),
      "unable-to-check",
    );
  });
});

describe("bounded input", () => {
  it("refuses a robots.txt past the response cap rather than parsing it", async () => {
    const oversized = "#".repeat(ROBOTS_PARSE_LIMITS.maxBytes + 1);
    const contractRun = await run(plainText(oversized));

    // The rule asks for at most `ROBOTS_PARSE_LIMITS.maxBytes`, so the
    // transport stops first and the parser is never handed the document.
    expectStatus(contractRun, "unable-to-check");
  });

  it("does not evaluate a truncated body", async () => {
    const contractRun = await run(plainText(VALID_ROBOTS, { truncated: true }));

    expectStatus(contractRun, "unable-to-check");
  });
});

describe("the shared memo value", () => {
  it("is on the closed key list in packages/core", () => {
    expect(MEMO_KEYS).toContain(PARSED_ROBOTS_MEMO_KEY);
  });

  it("survives the real memo and reaches the rule frozen", async () => {
    // ADR-0002 section 11 validates and freezes every memo value, and this
    // rule is the one that produces `agentready-lab/parsed-robots/v1`. If the
    // shape is wrong the scan throws `memo-value-rejected` here rather than
    // shipping a value three other rules cannot rely on.
    const contractRun = await run(plainText(VALID_ROBOTS));
    expectStatus(contractRun, "pass");
  });

  it("rejects a non-plain shape under the same key, so the test has teeth", () => {
    // The negative control for the test above. Without it, "the scan passed"
    // is equally consistent with a validator that accepts everything.
    const store = new MemoStore();

    expect(() =>
      store.get(PARSED_ROBOTS_MEMO_KEY, () => ({ at: new Date(0) })),
    ).toThrow(RuleContractViolation);
  });
});
