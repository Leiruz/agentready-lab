import type { RuleStatus } from "@agentready-lab/core";
import {
  DEFAULT_TARGET,
  InMemoryTransport,
  expectEvidenceResolves,
  expectFindingCodes,
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
  RuleContractRun,
} from "@agentready-lab/testkit";
import { describe, expect, it } from "vitest";

import { robotsObservationRequest } from "../../src/parsers/robots.js";
import { SITEMAP_NAMESPACE } from "../../src/parsers/sitemap-xml.js";
import { robotsRule } from "../../src/rules/robots.js";
import { sitemapRule } from "../../src/rules/sitemap.js";

/**
 * `web.discovery.sitemap` against the real engine.
 *
 * `docs/FIXTURE_CATALOG.md` section 6's six cases are the six `describe`
 * blocks below. The bodies are the ones
 * `apps/fixtures-worker/src/cases/sitemap.ts` serves, with `{{origin}}`
 * resolved to the loopback fixture origin; they are duplicated rather than
 * imported because `apps/fixtures-worker` is not a dependency of this package
 * and must not become one.
 *
 * Three properties this file exists to hold, none of which the rule status
 * alone would catch:
 *
 * - the **per-finding** table, because precedence puts `fail` ahead of
 *   everything and a rule status would keep passing after a guard was deleted;
 * - the **exact request list**, because this is the only M1 rule that issues a
 *   round-two request, and "one more hop than intended" is invisible in a
 *   verdict;
 * - the **shared** `/robots.txt` observation, which
 *   `docs/TEST_STRATEGY.md` section 6 requires and which a rule that wrote its
 *   own robots request would silently double.
 */

const ORIGIN = DEFAULT_TARGET.origin;
const ROBOTS_URL = `${ORIGIN}/robots.txt`;
const SITEMAP_URL = `${ORIGIN}/sitemap.xml`;
const FROM_ROBOTS_URL = `${ORIGIN}/sitemap-from-robots.xml`;
const CHILD_URL = `${ORIGIN}/sitemap-child.xml`;
const NESTED_URL = `${ORIGIN}/nested.xml`;

const XML_TYPE = "application/xml; charset=utf-8";
const PLAIN_TYPE = "text/plain; charset=utf-8";
const HTML_TYPE = "text/html; charset=utf-8";

/** `apps/fixtures-worker/src/cases/base/valid-agent-site-v1.ts`. */
function robotsTxt(sitemap: string | null): string {
  return [
    "# AgentReady Lab known-good base origin.",
    "# robots.txt is crawler guidance, not access control.",
    ...(sitemap === null ? [] : [`Sitemap: ${sitemap}`]),
    "Content-Signal: search=yes, ai-input=yes, ai-train=no",
    "",
    "User-agent: *",
    "Allow: /",
    "Disallow: /private/",
    "",
    "User-agent: GPTBot",
    "Allow: /",
    "",
  ].join("\n");
}

function urlsetXml(...locations: readonly string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<urlset xmlns="${SITEMAP_NAMESPACE}">`,
    ...locations.flatMap((loc) => [
      "  <url>",
      `    <loc>${loc}</loc>`,
      "    <lastmod>2026-08-28</lastmod>",
      "  </url>",
    ]),
    "</urlset>",
    "",
  ].join("\n");
}

function sitemapIndexXml(...children: readonly string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<sitemapindex xmlns="${SITEMAP_NAMESPACE}">`,
    ...children.flatMap((loc) => [
      "  <sitemap>",
      `    <loc>${loc}</loc>`,
      "    <lastmod>2026-08-28</lastmod>",
      "  </sitemap>",
    ]),
    "</sitemapindex>",
    "",
  ].join("\n");
}

/** `map-004`: an unclosed `<loc>`. Nothing else about it changes. */
const MALFORMED_SITEMAP = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  `<urlset xmlns="${SITEMAP_NAMESPACE}">`,
  "  <url>",
  `    <loc>${ORIGIN}/`,
  "  </url>",
  "</urlset>",
  "",
].join("\n");

const NOT_FOUND_HTML = [
  "<!doctype html>",
  '<html lang="en">',
  '<head><meta charset="utf-8"><title>Not found</title></head>',
  "<body><h1>Not found</h1><p>No such page.</p></body>",
  "</html>",
  "",
].join("\n");

const BASE_SITEMAP = urlsetXml(`${ORIGIN}/`, `${ORIGIN}/openapi.json`);

function xml(body: string): CannedHttpResult {
  return respond({ status: 200, headers: { "content-type": XML_TYPE }, body });
}

function notFound(): CannedHttpResult {
  return respond({
    status: 404,
    headers: { "content-type": HTML_TYPE },
    body: NOT_FOUND_HTML,
  });
}

interface Scenario {
  /** The `Sitemap` record value, `null` to omit it. */
  readonly sitemap?: string | null;
  /** A whole replacement for the `/robots.txt` result. */
  readonly robots?: CannedHttpResult;
  /** Results by absolute URL, for every sitemap document served. */
  readonly documents?: Readonly<Record<string, CannedHttpResult>>;
  readonly alsoRegister?: RuleContractInput["alsoRegister"];
}

function scenario(spec: Scenario): RuleContractInput {
  const transport = new InMemoryTransport();
  const input: RuleContractInput = {
    rule: sitemapRule,
    transport,
    ...(spec.alsoRegister === undefined
      ? {}
      : { alsoRegister: spec.alsoRegister }),
  };

  // Registered through the robots parser's own request builder, so the route
  // key is the one four rules canonicalize onto rather than a restatement.
  transport.routeObservation(
    robotsObservationRequest("robots"),
    planningContextOf(input),
    spec.robots ??
      respond({
        status: 200,
        headers: { "content-type": PLAIN_TYPE },
        body: robotsTxt(
          spec.sitemap === undefined ? SITEMAP_URL : spec.sitemap,
        ),
      }),
  );

  for (const [url, result] of Object.entries(spec.documents ?? {})) {
    transport.route({ url, accept: "application/xml" }, result);
  }
  return input;
}

async function run(spec: Scenario): Promise<RuleContractRun> {
  return await runRuleContract(scenario(spec));
}

/** The status of each named finding. `expectStatus` cannot see these. */
function expectFindingStatuses(
  contractRun: RuleContractRun,
  expected: Readonly<Record<string, RuleStatus>>,
): void {
  const actual = Object.fromEntries(
    contractRun.findings.map((finding) => [finding.code, finding.status]),
  );
  expect(actual).toEqual(expected);
}

describe("the rule's shape", () => {
  it("reserves exactly one round-two slot", () => {
    expect(sitemapRule.metadata.roundTwoBudget).toBe(1);
  });

  it("declares the three ruleset assertions and their classes", async () => {
    const contractRun = await run({
      documents: { [SITEMAP_URL]: xml(BASE_SITEMAP) },
    });
    expectFindingCodes(contractRun, [
      "sitemap.canonical",
      "sitemap.directive",
      "sitemap.xml",
    ]);
    expectRequirementClasses(contractRun, {
      "sitemap.xml": "normative",
      "sitemap.directive": "normative",
      "sitemap.canonical": "recommended",
    });
    expectEvidenceResolves(contractRun);
    expectSerialDispatch(contractRun.transport);
  });
});

describe("map-001: a conventional root sitemap", () => {
  it("passes, and asks for robots.txt and /sitemap.xml exactly once each", async () => {
    const contractRun = await run({
      documents: { [SITEMAP_URL]: xml(BASE_SITEMAP) },
    });

    expectStatus(contractRun, "pass");
    expectFindingStatuses(contractRun, {
      "sitemap.xml": "pass",
      "sitemap.directive": "pass",
      "sitemap.canonical": "pass",
    });
    expectRequests(contractRun, [
      { url: ROBOTS_URL, accept: "text/plain" },
      { url: SITEMAP_URL, accept: "application/xml" },
    ]);
  });

  /**
   * The base fixture's `robots.txt` names the conventional path, so the record
   * exists, is absolute and points at the document round one already holds.
   * `sitemap.directive` is `satisfied` and not `not-present`: ADR-0002
   * section 5 forbids mixing `not-present` with an evaluated outcome and
   * forbids omitting a declared assertion, and a conditional obligation that
   * is met vacuously is `satisfied`.
   */
  it("does not re-fetch a Sitemap record that names the path it already read", async () => {
    const contractRun = await run({
      sitemap: SITEMAP_URL,
      documents: { [SITEMAP_URL]: xml(BASE_SITEMAP) },
    });
    expect(contractRun.transport.urls).toEqual([ROBOTS_URL, SITEMAP_URL]);
  });

  it("still passes when robots.txt declares no Sitemap record at all", async () => {
    const contractRun = await run({
      sitemap: null,
      documents: { [SITEMAP_URL]: xml(BASE_SITEMAP) },
    });
    expectStatus(contractRun, "pass");
    expectFindingStatuses(contractRun, {
      "sitemap.xml": "pass",
      "sitemap.directive": "pass",
      "sitemap.canonical": "pass",
    });
  });
});

describe("map-002: discovery through the robots.txt Sitemap record", () => {
  const documents = {
    [SITEMAP_URL]: notFound(),
    [FROM_ROBOTS_URL]: xml(urlsetXml(`${ORIGIN}/`)),
  };

  it("passes through exactly one round-two request", async () => {
    const contractRun = await run({ sitemap: FROM_ROBOTS_URL, documents });

    expectStatus(contractRun, "pass");
    expectFindingStatuses(contractRun, {
      "sitemap.xml": "pass",
      "sitemap.directive": "pass",
      "sitemap.canonical": "pass",
    });
    expectRequests(contractRun, [
      { url: ROBOTS_URL, accept: "text/plain" },
      { url: SITEMAP_URL, accept: "application/xml" },
      { url: FROM_ROBOTS_URL, accept: "application/xml" },
    ]);
    expectSerialDispatch(contractRun.transport);
  });

  it("fails the directive when the declared document is not there", async () => {
    const contractRun = await run({
      sitemap: FROM_ROBOTS_URL,
      documents: { [SITEMAP_URL]: notFound(), [FROM_ROBOTS_URL]: notFound() },
    });
    expectStatus(contractRun, "fail");
    expectFindingStatuses(contractRun, {
      "sitemap.xml": "unable-to-check",
      "sitemap.directive": "fail",
      "sitemap.canonical": "unable-to-check",
    });
  });
});

describe("map-003: a sitemap index with one bounded child", () => {
  it("follows the child, and only the child", async () => {
    const contractRun = await run({
      documents: {
        [SITEMAP_URL]: xml(sitemapIndexXml(CHILD_URL)),
        [CHILD_URL]: xml(urlsetXml(`${ORIGIN}/`)),
      },
    });

    expectStatus(contractRun, "pass");
    expectFindingStatuses(contractRun, {
      "sitemap.xml": "pass",
      "sitemap.directive": "pass",
      "sitemap.canonical": "pass",
    });
    expectRequests(contractRun, [
      { url: ROBOTS_URL, accept: "text/plain" },
      { url: SITEMAP_URL, accept: "application/xml" },
      { url: CHILD_URL, accept: "application/xml" },
    ]);
  });

  /**
   * The MVP does not crawl. A second child is a second hop, and
   * `roundTwoBudget` is 1, so a rule that returned both would exit 4 rather
   * than quietly widening the scan.
   */
  it("follows one child of a multi-child index and leaves the rest alone", async () => {
    const second = `${ORIGIN}/sitemap-child-2.xml`;
    const contractRun = await run({
      documents: {
        [SITEMAP_URL]: xml(sitemapIndexXml(CHILD_URL, second)),
        [CHILD_URL]: xml(urlsetXml(`${ORIGIN}/`)),
        [second]: xml(urlsetXml(`${ORIGIN}/b`)),
      },
    });

    expect(contractRun.transport.urls).toEqual([
      ROBOTS_URL,
      SITEMAP_URL,
      CHILD_URL,
    ]);
    expect(contractRun.transport.urls).not.toContain(second);
    expectStatus(contractRun, "pass");
  });

  it("fails when the index resolves to a document that is not a sitemap", async () => {
    const contractRun = await run({
      documents: {
        [SITEMAP_URL]: xml(sitemapIndexXml(CHILD_URL)),
        [CHILD_URL]: respond({
          status: 200,
          headers: { "content-type": HTML_TYPE },
          body: NOT_FOUND_HTML,
        }),
      },
    });
    expectStatus(contractRun, "fail");
    expectFindingStatuses(contractRun, {
      "sitemap.xml": "fail",
      "sitemap.directive": "pass",
      "sitemap.canonical": "pass",
    });
  });

  it("cannot follow a relative child, and says so instead of resolving it", async () => {
    const contractRun = await run({
      documents: { [SITEMAP_URL]: xml(sitemapIndexXml("/sitemap-child.xml")) },
    });

    expect(contractRun.transport.urls).toEqual([ROBOTS_URL, SITEMAP_URL]);
    expectFindingStatuses(contractRun, {
      "sitemap.xml": "unable-to-check",
      "sitemap.directive": "pass",
      // A relative `<loc>` is exactly what the recommended assertion is about.
      "sitemap.canonical": "warning",
    });
  });
});

describe("map-004: malformed sitemap XML", () => {
  it("fails on the document and reports the record once, not twice", async () => {
    const contractRun = await run({
      documents: { [SITEMAP_URL]: xml(MALFORMED_SITEMAP) },
    });

    expectStatus(contractRun, "fail");
    expectFindingStatuses(contractRun, {
      "sitemap.xml": "fail",
      "sitemap.directive": "pass",
      "sitemap.canonical": "unable-to-check",
    });
    expectRequests(contractRun, [{ url: ROBOTS_URL }, { url: SITEMAP_URL }]);
  });
});

describe("map-005: the sitemap path returns the not-found page", () => {
  it("fails on the media type without parsing the body", async () => {
    const contractRun = await run({
      documents: {
        [SITEMAP_URL]: respond({
          status: 200,
          headers: { "content-type": HTML_TYPE },
          body: NOT_FOUND_HTML,
        }),
      },
    });

    expectStatus(contractRun, "fail");
    expectFindingStatuses(contractRun, {
      "sitemap.xml": "fail",
      "sitemap.directive": "pass",
      "sitemap.canonical": "unable-to-check",
    });
  });

  it("fails a 200 that declares no media type at all", async () => {
    const contractRun = await run({
      documents: {
        [SITEMAP_URL]: respond({ status: 200, body: BASE_SITEMAP }),
      },
    });
    expectFindingStatuses(contractRun, {
      "sitemap.xml": "fail",
      "sitemap.directive": "pass",
      "sitemap.canonical": "unable-to-check",
    });
  });

  it.each(["application/xml", "text/xml", "application/rss+xml"])(
    "accepts %s as an XML representation",
    async (contentType) => {
      const contractRun = await run({
        documents: {
          [SITEMAP_URL]: respond({
            status: 200,
            headers: { "content-type": contentType },
            body: BASE_SITEMAP,
          }),
        },
      });
      expectStatus(contractRun, "pass");
    },
  );
});

describe("map-006: a relative Sitemap record", () => {
  const documents = {
    [SITEMAP_URL]: notFound(),
    // Served so that a rule which resolved the value would succeed, and the
    // test would still catch it.
    [NESTED_URL]: xml(urlsetXml(`${ORIGIN}/`)),
  };

  it("fails the directive", async () => {
    const contractRun = await run({ sitemap: "/nested.xml", documents });

    expectStatus(contractRun, "fail");
    expectFindingStatuses(contractRun, {
      "sitemap.xml": "unable-to-check",
      "sitemap.directive": "fail",
      "sitemap.canonical": "unable-to-check",
    });
  });

  it("never requests /nested.xml", async () => {
    const contractRun = await run({ sitemap: "/nested.xml", documents });

    expect(contractRun.transport.urls).not.toContain(NESTED_URL);
    expectRequests(contractRun, [{ url: ROBOTS_URL }, { url: SITEMAP_URL }]);
  });

  it("fails an absolute record beside a relative one", async () => {
    const transport = new InMemoryTransport();
    const input: RuleContractInput = { rule: sitemapRule, transport };
    transport.routeObservation(
      robotsObservationRequest("robots"),
      planningContextOf(input),
      respond({
        status: 200,
        headers: { "content-type": PLAIN_TYPE },
        body: [
          `Sitemap: ${FROM_ROBOTS_URL}`,
          "Sitemap: /nested.xml",
          "",
          "User-agent: *",
          "Allow: /",
          "",
        ].join("\n"),
      }),
    );
    transport.route(
      { url: SITEMAP_URL, accept: "application/xml" },
      notFound(),
    );

    const contractRun = await runRuleContract(input);
    expect(contractRun.transport.urls).toEqual([ROBOTS_URL, SITEMAP_URL]);
    expectFindingStatuses(contractRun, {
      "sitemap.xml": "unable-to-check",
      "sitemap.directive": "fail",
      "sitemap.canonical": "unable-to-check",
    });
  });
});

describe("the shared robots observation", () => {
  /**
   * `docs/TEST_STRATEGY.md` section 6: the robots retrieval and its parsed
   * representation are shared. Two rules, one dispatch, one evidence entry.
   */
  it("dispatches /robots.txt once when this rule runs beside web.discovery.robots", async () => {
    const contractRun = await run({
      documents: { [SITEMAP_URL]: xml(BASE_SITEMAP) },
      alsoRegister: [robotsRule],
    });

    const robotsRequests = contractRun.transport.urls.filter(
      (url) => url === ROBOTS_URL,
    );
    expect(robotsRequests).toHaveLength(1);
    expect(contractRun.transport.urls).toEqual([ROBOTS_URL, SITEMAP_URL]);

    const robotsResult = contractRun.report.results.find(
      (result) => result.ruleId === robotsRule.metadata.id,
    );
    expect(robotsResult?.status).toBe("pass");
    expectStatus(contractRun, "pass");
  });
});

describe("absence, refusal and error", () => {
  it("is not-applicable when neither the path nor a record exists", async () => {
    const contractRun = await run({
      sitemap: null,
      documents: { [SITEMAP_URL]: notFound() },
    });

    expectStatus(contractRun, "not-applicable");
    expectFindingStatuses(contractRun, {
      "sitemap.xml": "not-applicable",
      "sitemap.directive": "not-applicable",
      "sitemap.canonical": "not-applicable",
    });
  });

  /**
   * `sec-008` through the rule. A refused parse is a bound of ours
   * (ADR-0003 section 2), so it is `unable-to-check` and never `fail`, and no
   * third request is made for the entity's system identifier.
   */
  it("is unable-to-check on a DOCTYPE with an external entity, and fetches nothing more", async () => {
    const contractRun = await run({
      documents: {
        [SITEMAP_URL]: xml(
          [
            '<?xml version="1.0" encoding="UTF-8"?>',
            `<!DOCTYPE urlset [ <!ENTITY xxe SYSTEM "${NESTED_URL}"> ]>`,
            `<urlset xmlns="${SITEMAP_NAMESPACE}">`,
            "  <url><loc>&xxe;</loc></url>",
            "</urlset>",
            "",
          ].join("\n"),
        ),
        [NESTED_URL]: xml(urlsetXml(`${ORIGIN}/`)),
      },
    });

    expectStatus(contractRun, "unable-to-check");
    expectFindingStatuses(contractRun, {
      "sitemap.xml": "unable-to-check",
      "sitemap.directive": "pass",
      "sitemap.canonical": "unable-to-check",
    });
    expect(contractRun.transport.urls).toEqual([ROBOTS_URL, SITEMAP_URL]);
  });

  it("is unable-to-check on a transport error, which is not a conformance failure", async () => {
    const contractRun = await run({
      documents: { [SITEMAP_URL]: failure("connect-timeout") },
    });
    expectFindingStatuses(contractRun, {
      "sitemap.xml": "unable-to-check",
      "sitemap.directive": "unable-to-check",
      "sitemap.canonical": "unable-to-check",
    });
  });

  it("is unable-to-check on a truncated body", async () => {
    const contractRun = await run({
      documents: {
        [SITEMAP_URL]: respond({
          status: 200,
          headers: { "content-type": XML_TYPE },
          body: BASE_SITEMAP.slice(0, 60),
          truncated: true,
        }),
      },
    });
    expectFindingStatuses(contractRun, {
      "sitemap.xml": "unable-to-check",
      "sitemap.directive": "pass",
      "sitemap.canonical": "unable-to-check",
    });
  });

  it("leaves the directive undecided when robots.txt could not be retrieved", async () => {
    const contractRun = await run({
      robots: failure("connection-failed"),
      documents: { [SITEMAP_URL]: xml(BASE_SITEMAP) },
    });
    expectFindingStatuses(contractRun, {
      "sitemap.xml": "pass",
      "sitemap.directive": "unable-to-check",
      "sitemap.canonical": "pass",
    });
  });
});

describe("sitemap.canonical", () => {
  it("warns on a loc that is not absolute", async () => {
    const contractRun = await run({
      documents: { [SITEMAP_URL]: xml(urlsetXml("/relative")) },
    });
    expectStatus(contractRun, "warning");
    expectFindingStatuses(contractRun, {
      "sitemap.xml": "pass",
      "sitemap.directive": "pass",
      "sitemap.canonical": "warning",
    });
  });

  it("warns on a loc on another origin", async () => {
    const contractRun = await run({
      documents: {
        [SITEMAP_URL]: xml(urlsetXml("http://elsewhere.invalid/a")),
      },
    });
    expectFindingStatuses(contractRun, {
      "sitemap.xml": "pass",
      "sitemap.directive": "pass",
      "sitemap.canonical": "warning",
    });
  });

  it("warns on a lastmod that is not a W3C Datetime", async () => {
    const contractRun = await run({
      documents: {
        [SITEMAP_URL]: xml(
          [
            `<urlset xmlns="${SITEMAP_NAMESPACE}">`,
            `<url><loc>${ORIGIN}/</loc><lastmod>yesterday</lastmod></url>`,
            "</urlset>",
          ].join("\n"),
        ),
      },
    });
    expectFindingStatuses(contractRun, {
      "sitemap.xml": "pass",
      "sitemap.directive": "pass",
      "sitemap.canonical": "warning",
    });
  });

  /** A recommended assertion can never reach `fail` (ADR-0002 section 5). */
  it("never produces a fail, whatever it observes", async () => {
    const contractRun = await run({
      documents: { [SITEMAP_URL]: xml(urlsetXml("/relative")) },
    });
    const canonical = contractRun.findings.find(
      (finding) => finding.code === "sitemap.canonical",
    );
    expect(canonical?.status).not.toBe("fail");
    expect(canonical?.requirementClass).toBe("recommended");
  });
});

describe("sitemap.xml structure", () => {
  it.each([
    [
      "a wrong namespace",
      `<urlset xmlns="http://example.invalid/x"><url><loc>${ORIGIN}/</loc></url></urlset>`,
    ],
    [
      "an entry with no loc",
      `<urlset xmlns="${SITEMAP_NAMESPACE}"><url><lastmod>2026-08-28</lastmod></url></urlset>`,
    ],
    ["an empty urlset", `<urlset xmlns="${SITEMAP_NAMESPACE}"></urlset>`],
    [
      "a root outside the vocabulary",
      `<feed xmlns="${SITEMAP_NAMESPACE}"><entry/></feed>`,
    ],
  ])("fails on %s", async (_case, body) => {
    const contractRun = await run({
      documents: { [SITEMAP_URL]: xml(body) },
    });
    expectStatus(contractRun, "fail");
    expect(
      contractRun.findings.find((finding) => finding.code === "sitemap.xml")
        ?.status,
    ).toBe("fail");
  });
});
