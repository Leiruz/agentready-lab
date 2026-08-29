import type { AnyRuleDefinition, RuleStatus } from "@agentready-lab/core";
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
  AI_CRAWLER_TOKENS_V0,
  AI_CRAWLER_TOKEN_NAMES_V0,
} from "../../src/data/ai-crawler-tokens.v0.js";
import { robotsObservationRequest } from "../../src/parsers/robots.js";
import { aiCrawlerRule } from "../../src/rules/ai-crawler.js";
import { robotsRule } from "../../src/rules/robots.js";

/**
 * `web.policy.ai-crawler` against the real engine.
 *
 * `docs/FIXTURE_CATALOG.md` section 9's six cases are the six `describe`
 * blocks below, each asserting the **per-finding** status rather than only the
 * derived rule status. Rule status precedence puts `warning` above `pass`, so
 * a test that checked the rule status alone would keep passing after a guard
 * that decides one assertion was deleted.
 *
 * The catalog's other two columns are not asserted here and cannot be. It
 * expects `bot-003` to record the source group and `bot-006` the default
 * decision, and the ruleset declares `params: []` for all three assertions, so
 * no report field can hold either. They are asserted at the unit tier in
 * `ai-crawler-matching.test.ts`, on `effectiveAccess`, which returns both. The
 * `compat:` column is a different mode with no assertion ids of its own, which
 * the ruleset records as an open gap.
 */

const ROBOTS_URL = "http://127.0.0.1:8787/robots.txt";

/** `bot-001`. The configured token's own group allows the tested path. */
const EXPLICIT_ALLOW = [
  "User-agent: GPTBot",
  "Disallow: /private/",
  "Allow: /docs/",
  "",
].join("\n");

/** `bot-002`. The configured token's own group disallows it. */
const EXPLICIT_DISALLOW = ["User-agent: GPTBot", "Disallow: /", ""].join("\n");

/** `bot-003`. A wildcard group, and no more specific one. */
const WILDCARD_ALLOW = ["User-agent: *", "Allow: /", ""].join("\n");

/** `bot-004`. The wildcard disallows; the specific group allows. */
const WILDCARD_DISALLOW_SPECIFIC_ALLOW = [
  "User-agent: *",
  "Disallow: /",
  "",
  "User-agent: ClaudeBot",
  "Allow: /",
  "",
].join("\n");

/** `bot-005`. One token, two groups, and the longer Allow is in the second. */
const SPLIT_GROUPS = [
  "User-agent: ClaudeBot",
  "Disallow: /research/",
  "",
  "User-agent: ClaudeBot",
  "Allow: /research/public/",
  "",
].join("\n");

/** `bot-006`. Neither the token's group nor a wildcard group is present. */
const UNRELATED_GROUP_ONLY = ["User-agent: ExampleBot", "Disallow: /", ""].join(
  "\n",
);

function plainText(body: string, init: { truncated?: boolean } = {}) {
  return respond({
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
    body,
    ...(init.truncated === undefined ? {} : { truncated: init.truncated }),
  });
}

interface Options {
  readonly tokens?: readonly string[];
  readonly path?: string;
  readonly alsoRegister?: readonly AnyRuleDefinition[];
}

/** One route for the one request the rule plans, keyed the way core keys it. */
function scenario(result: CannedHttpResult, options: Options = {}) {
  const transport = new InMemoryTransport();
  const input: RuleContractInput = {
    rule: aiCrawlerRule,
    transport,
    alsoRegister: options.alsoRegister ?? [],
    options: {
      crawlerTokens: options.tokens ?? ["GPTBot"],
      testedPath: options.path ?? "/",
    },
  };
  transport.routeObservation(
    robotsObservationRequest("robots"),
    planningContextOf(input),
    result,
  );
  return input;
}

async function run(
  result: CannedHttpResult,
  options: Options = {},
): Promise<RuleContractRun> {
  return await runRuleContract(scenario(result, options));
}

function expectFindingStatuses(
  contractRun: RuleContractRun,
  expected: Readonly<Record<string, RuleStatus>>,
): void {
  const actual = Object.fromEntries(
    contractRun.findings.map((finding) => [finding.code, finding.status]),
  );
  expect(actual).toEqual(expected);
}

/** The two assertions that do not move with the access decision. */
const PARSED_AND_CITED = {
  "ai-rules.rep-parse": "pass",
  "ai-rules.token-source": "pass",
} as const satisfies Readonly<Record<string, RuleStatus>>;

describe("bot-001: an explicit group allows the tested path", () => {
  it("passes, and asks the origin root for text/plain exactly once", async () => {
    const contractRun = await run(plainText(EXPLICIT_ALLOW), {
      tokens: ["GPTBot"],
      path: "/docs/guide",
    });

    expectStatus(contractRun, "pass");
    expectFindingCodes(contractRun, [
      "ai-rules.effective-access",
      "ai-rules.rep-parse",
      "ai-rules.token-source",
    ]);
    expectFindingStatuses(contractRun, {
      ...PARSED_AND_CITED,
      "ai-rules.effective-access": "pass",
    });
    expectRequirementClasses(contractRun, {
      "ai-rules.rep-parse": "normative",
      "ai-rules.token-source": "advisory",
      "ai-rules.effective-access": "recommended",
    });
    expectRequests(contractRun, [
      { url: ROBOTS_URL, method: "GET", accept: "text/plain" },
    ]);
    expectSerialDispatch(contractRun.transport);
    expect(expectEvidenceResolves(contractRun).length).toBeGreaterThan(0);
  });

  it("matches the configured token case-insensitively", async () => {
    const contractRun = await run(plainText(EXPLICIT_ALLOW), {
      tokens: ["gptbot"],
      path: "/private/secret",
    });

    // The group is found whatever the configured spelling, so the disallow
    // still applies. A case-sensitive lookup would report `pass` here.
    expectStatus(contractRun, "warning");
  });

  it("is byte-identical across latency profiles", async () => {
    const runs = [];
    for (const profile of latencyProfiles(1)) {
      runs.push(
        await run(
          respond({
            status: 200,
            headers: { "content-type": "text/plain" },
            body: EXPLICIT_ALLOW,
            latencyTicks: profile.ticks[0] ?? 0,
          }),
          { tokens: ["GPTBot"], path: "/docs/guide" },
        ),
      );
    }
    expectDeterministic(runs);
  });
});

describe("bot-002: an explicit group disallows the tested path", () => {
  it("warns, and never fails", async () => {
    const contractRun = await run(plainText(EXPLICIT_DISALLOW), {
      tokens: ["GPTBot"],
      path: "/",
    });

    // RFC 9309 requires nobody to publish an AI-specific group, so a disallow
    // cannot be a normative violation. The ruleset pins the class at
    // `recommended` and the core derives `warning` from `violated`; a rule
    // cannot promote it, and this is the assertion that says so.
    expectStatus(contractRun, "warning");
    expectFindingStatuses(contractRun, {
      ...PARSED_AND_CITED,
      "ai-rules.effective-access": "warning",
    });
    expectRequirementClasses(contractRun, {
      "ai-rules.effective-access": "recommended",
    });
  });

  it("reports the disallow on the access assertion and nowhere else", async () => {
    const contractRun = await run(plainText(EXPLICIT_DISALLOW), {
      tokens: ["GPTBot"],
      path: "/",
    });
    const access = contractRun.findings.find(
      (finding) => finding.code === "ai-rules.effective-access",
    );

    expect(access?.status).toBe("warning");
    // A declared policy is not a protocol defect, so the normative parse
    // assertion is untouched by it.
    expect(
      contractRun.findings.every((finding) => finding.status !== "fail"),
    ).toBe(true);
  });

  it("warns when any one configured token is disallowed", async () => {
    const contractRun = await run(plainText(EXPLICIT_DISALLOW), {
      tokens: ["ClaudeBot", "GPTBot"],
      path: "/",
    });

    // `ClaudeBot` matches no group and is allowed by default; `GPTBot` is not.
    // The assertion is about reachability, so one unreachable token is enough.
    expectStatus(contractRun, "warning");
  });
});

describe("bot-003: a wildcard group allows, with no more specific group", () => {
  it("passes", async () => {
    const contractRun = await run(plainText(WILDCARD_ALLOW), {
      tokens: ["GPTBot"],
      path: "/docs/guide",
    });

    expectStatus(contractRun, "pass");
    expectFindingStatuses(contractRun, {
      ...PARSED_AND_CITED,
      "ai-rules.effective-access": "pass",
    });
  });
});

describe("bot-004: a wildcard disallows and a specific group allows", () => {
  it("passes, because the specific group wins", async () => {
    const contractRun = await run(plainText(WILDCARD_DISALLOW_SPECIFIC_ALLOW), {
      tokens: ["ClaudeBot"],
      path: "/docs/guide",
    });

    expectStatus(contractRun, "pass");
    expectFindingStatuses(contractRun, {
      ...PARSED_AND_CITED,
      "ai-rules.effective-access": "pass",
    });
  });

  it("still applies the wildcard to a token with no group of its own", async () => {
    // The negative control for the case above: without it, "pass" is equally
    // consistent with a resolver that ignores the wildcard group entirely.
    const contractRun = await run(plainText(WILDCARD_DISALLOW_SPECIFIC_ALLOW), {
      tokens: ["GPTBot"],
      path: "/docs/guide",
    });

    expectStatus(contractRun, "warning");
  });
});

describe("bot-005: two groups share a product token", () => {
  it("passes after combining both groups", async () => {
    const contractRun = await run(plainText(SPLIT_GROUPS), {
      tokens: ["ClaudeBot"],
      path: "/research/public/paper.pdf",
    });

    // The winning Allow is only in the second group, so a first-group-only
    // resolver reports `warning` here.
    expectStatus(contractRun, "pass");
    expectFindingStatuses(contractRun, {
      ...PARSED_AND_CITED,
      "ai-rules.effective-access": "pass",
    });
  });

  it("keeps the shorter disallow for a path the longer allow misses", async () => {
    const contractRun = await run(plainText(SPLIT_GROUPS), {
      tokens: ["ClaudeBot"],
      path: "/research/private/paper.pdf",
    });

    expectStatus(contractRun, "warning");
  });
});

describe("bot-006: no matching group and no wildcard group", () => {
  it("passes on RFC 9309 section 2.2.2's default", async () => {
    const contractRun = await run(plainText(UNRELATED_GROUP_ONLY), {
      tokens: ["GPTBot"],
      path: "/",
    });

    expectStatus(contractRun, "pass");
    expectFindingStatuses(contractRun, {
      ...PARSED_AND_CITED,
      "ai-rules.effective-access": "pass",
    });
  });

  it("does not mistake the unrelated group for the configured token", async () => {
    // The negative control: the same document disallows everything for the
    // token it does name.
    const contractRun = await run(plainText(UNRELATED_GROUP_ONLY), {
      tokens: ["ExampleBot"],
      path: "/",
    });

    expectStatus(contractRun, "warning");
  });
});

describe("the shared robots observation", () => {
  it("issues exactly one /robots.txt request for both rules", async () => {
    // `docs/ROADMAP.md` M1 acceptance: four rules read one observation. The
    // rule under test and `web.discovery.robots` plan the same request through
    // `robotsObservationRequest`, so ADR-0005 section 3's canonical key is
    // identical and the engine dispatches once.
    const input = scenario(plainText(WILDCARD_ALLOW), {
      alsoRegister: [robotsRule],
      tokens: ["GPTBot"],
      path: "/docs/guide",
    });
    const contractRun = await runRuleContract(input);

    expect(input.transport.httpRequests).toHaveLength(1);
    expectRequests(contractRun, [
      { url: ROBOTS_URL, method: "GET", accept: "text/plain" },
    ]);

    // Both rules genuinely ran, so the single request is deduplication and not
    // a rule that was filtered out of the scan.
    const statuses = Object.fromEntries(
      contractRun.report.results.map((result) => [
        result.ruleId,
        result.status,
      ]),
    );
    expect(statuses).toMatchObject({
      "web.discovery.robots": "pass",
      "web.policy.ai-crawler": "pass",
    });

    // One observation, so one evidence entry that both rules' findings cite.
    expect(contractRun.report.evidence).toHaveLength(1);
    expectEvidenceResolves(contractRun);
  });
});

describe("retrieval semantics, read as web.discovery.robots reads them", () => {
  it("is not-applicable on a 404, with every assertion not-present", async () => {
    const contractRun = await run(respond({ status: 404 }));

    // RFC 9309 section 2.3.1.3. `deriveRuleStatus` refuses `not-applicable`
    // beside an evaluated finding, so the advisory dataset assertion cannot
    // pass here even though the dataset is this project's own.
    expectStatus(contractRun, "not-applicable");
    expectFindingStatuses(contractRun, {
      "ai-rules.rep-parse": "not-applicable",
      "ai-rules.token-source": "not-applicable",
      "ai-rules.effective-access": "not-applicable",
    });
  });

  it.each([500, 502, 503, 504])(
    "leaves an unreachable %i undefined rather than absent",
    async (status) => {
      expectStatus(await run(respond({ status })), "unable-to-check");
    },
  );

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

  it("does not evaluate a truncated body", async () => {
    expectStatus(
      await run(plainText(WILDCARD_ALLOW, { truncated: true })),
      "unable-to-check",
    );
  });
});

describe("ai-rules.rep-parse", () => {
  it("fails when the document is not the UTF-8 RFC 9309 section 2.3 requires", async () => {
    // A lone 0x80 continuation byte. The product tokens and path patterns are
    // then matched against U+FFFD rather than against what the publisher
    // wrote, so no faithful group selection exists.
    const body = Uint8Array.from([
      ...new TextEncoder().encode("User-agent: GPT"),
      0x80,
      ...new TextEncoder().encode("Bot\nAllow: /\n"),
    ]);
    const contractRun = await run(
      respond({ status: 200, headers: { "content-type": "text/plain" }, body }),
    );

    expectStatus(contractRun, "fail");
    expectFindingStatuses(contractRun, {
      "ai-rules.rep-parse": "fail",
      "ai-rules.token-source": "pass",
      "ai-rules.effective-access": "pass",
    });
  });

  it("tolerates a malformed line, which belongs to robots.syntax", async () => {
    // RFC 9309 section 2.3.1.5 asks crawlers to parse each line and be
    // lenient, so selecting over the rest is what the RFC prescribes. If this
    // ever reads `fail`, the rule has started re-litigating another rule's
    // assertion.
    const contractRun = await run(
      plainText(
        [
          "this line has no separator",
          "User-agent: GPTBot",
          "Allow: /",
          "",
        ].join("\n"),
      ),
    );

    expectStatus(contractRun, "pass");
  });
});

describe("the pinned token dataset", () => {
  it("carries exactly the tokens the source ledger records", () => {
    expect(AI_CRAWLER_TOKEN_NAMES_V0).toEqual([
      "GPTBot",
      "OAI-SearchBot",
      "ChatGPT-User",
      "Google-Extended",
      "ClaudeBot",
      "Claude-SearchBot",
      "Claude-User",
    ]);
  });

  it("is versioned and dated", () => {
    expect(AI_CRAWLER_TOKENS_V0.version).toBe("0.1.0");
    expect(AI_CRAWLER_TOKENS_V0.verifiedAt).toBe("2026-08-29");
  });

  it("excludes Claude-Web, which no vendor source currently documents", () => {
    // `specs/checks.v0.yaml` names it; that file is the frozen external
    // snapshot and not a vendor source, and the `anthropic-crawlers` ledger
    // entry records the discrepancy and forbids relying on it.
    expect(AI_CRAWLER_TOKEN_NAMES_V0).not.toContain("Claude-Web");
  });

  it("cites only sources ai-rules.token-source is allowed to cite", () => {
    const cited = aiCrawlerRule.metadata.assertions
      .find((assertion) => assertion.id === "ai-rules.token-source")
      ?.sourceRefs.map((ref) => ref.sourceId);

    expect(cited).toEqual([
      "openai-crawlers",
      "google-crawlers",
      "anthropic-crawlers",
    ]);
    for (const entry of AI_CRAWLER_TOKENS_V0.tokens) {
      expect(cited).toContain(entry.sourceId);
    }
  });

  it("is the default token set the rule scans with", () => {
    expect(aiCrawlerRule.defaultOptions).toEqual({
      crawlerTokens: AI_CRAWLER_TOKEN_NAMES_V0,
      testedPath: "/",
    });
  });
});

describe("options", () => {
  it("falls back to the pinned dataset for an unusable crawlerTokens value", async () => {
    // `resolveRuleOptions` validates key names only, so a bare string reaches
    // the rule. `Array.prototype.includes` on it would be a substring search.
    const contractRun = await runRuleContract({
      rule: aiCrawlerRule,
      transport: routed(plainText(EXPLICIT_DISALLOW)),
      options: { crawlerTokens: "GPTBot", testedPath: "/" },
    });

    // The pinned dataset contains GPTBot, so the disallow still applies.
    expectStatus(contractRun, "warning");
  });

  it("falls back to the origin root for a testedPath that is not a path", async () => {
    const contractRun = await runRuleContract({
      rule: aiCrawlerRule,
      transport: routed(plainText(EXPLICIT_DISALLOW)),
      options: { crawlerTokens: ["GPTBot"], testedPath: "docs/guide" },
    });

    expectStatus(contractRun, "warning");
  });

  it("computes no decision at all for an empty token list", async () => {
    const contractRun = await run(plainText(WILDCARD_ALLOW), { tokens: [] });

    // An empty-set "every token is allowed" would be a green verdict over
    // nothing, so the assertion reports that it could not be evaluated.
    expectStatus(contractRun, "unable-to-check");
    expectFindingStatuses(contractRun, {
      ...PARSED_AND_CITED,
      "ai-rules.effective-access": "unable-to-check",
    });
  });
});

/** A transport already carrying the one route, for the option tests above. */
function routed(result: CannedHttpResult): InMemoryTransport {
  const transport = new InMemoryTransport();
  transport.routeObservation(
    robotsObservationRequest("robots"),
    planningContextOf({ rule: aiCrawlerRule, transport }),
    result,
  );
  return transport;
}
