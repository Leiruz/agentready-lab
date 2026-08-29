import { findingStatus } from "@agentready-lab/core";
import type {
  MessageTemplates,
  OutcomeKind,
  RequirementClass,
  RuleStatus,
} from "@agentready-lab/core";
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

import { CONTENT_SIGNAL_PARSE_LIMITS } from "../../src/parsers/content-signals.js";
import {
  ROBOTS_PARSE_LIMITS,
  robotsObservationRequest,
} from "../../src/parsers/robots.js";
import { contentSignalsRule } from "../../src/rules/content-signals.js";
import { robotsRule } from "../../src/rules/robots.js";

/**
 * `web.policy.content-signals` against the real engine.
 *
 * `docs/FIXTURE_CATALOG.md` section 10's six cases, as rewritten by ADR-0009,
 * are the six `describe` blocks below. Each asserts the **per-finding** status
 * and not only the derived rule status: precedence makes `warning` swallow
 * `pass`, so a test that only checked the rule status would keep passing after
 * a guard that decides one assertion was deleted.
 *
 * The last two blocks are the negative half, and they are the point of the
 * file as much as the fixtures are. ADR-0009 retired this rule's only
 * normative assertion after two adversarial review rounds caught two separate
 * attempts to manufacture one. "No assertion is normative" and "no input
 * reaches `fail`" are therefore executable here, so a later contributor
 * reintroducing either has to delete a test that names the decision.
 */

const COVERAGE = "content-signals.coverage";
const EFFECT = "content-signals.effect";
const CONFLICTING = "content-signals.conflicting-declaration";
const UNRECOGNIZED = "content-signals.unrecognized-vocabulary";

const ROBOTS_URL = "http://127.0.0.1:8787/robots.txt";

/** Every assertion id, in the order `sig-006` pins them. */
const ASSERTIONS = [COVERAGE, EFFECT, CONFLICTING, UNRECOGNIZED] as const;

const OUTCOME_KINDS: readonly OutcomeKind[] = [
  "satisfied",
  "violated",
  "not-present",
  "indeterminate",
];

/**
 * `apps/fixtures-worker/src/cases/base/valid-agent-site-v1.ts`, reproduced.
 *
 * The two extension records sit above the first `User-agent` line, which is
 * the placement the fixture base chose precisely so that no REP group owns
 * them: ADR-0009 forbids inventing a placement rule, and `bot-006` removes the
 * wildcard group entirely. A group-scoped reading would make `sig-004`'s
 * conflict invisible, so this document is the discriminating one.
 */
function robotsWithSignal(contentSignal: string | null): string {
  return [
    "# AgentReady Lab known-good base origin.",
    "# robots.txt is crawler guidance, not access control.",
    "Sitemap: http://127.0.0.1:8787/sitemap.xml",
    ...(contentSignal === null ? [] : [`Content-Signal: ${contentSignal}`]),
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

function plainText(body: string, init: { truncated?: boolean } = {}) {
  return respond({
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
    body,
    ...(init.truncated === undefined ? {} : { truncated: init.truncated }),
  });
}

/**
 * Templates that interpolate the one declared parameter, so its value is
 * observable in the report.
 *
 * The placeholder is on **every** outcome kind deliberately.
 * `recognized-token-count` is `required`, so an outcome that stopped carrying
 * it -- `not-present` and `indeterminate` included -- fails these tests twice:
 * once as `missing-required-parameter` in `validateRuleOutcomes` and once as
 * `missing-template-parameter` in `renderMessage`.
 */
function templateFor(
  id: string,
): Readonly<Partial<Record<OutcomeKind, string>>> {
  const suffix =
    id === UNRECOGNIZED ? " with {recognized-token-count} recognized" : "";
  return {
    satisfied: `${id} is satisfied${suffix}`,
    violated: `${id} is violated${suffix}`,
    "not-present": `${id} is not-present${suffix}`,
    indeterminate: `${id} is indeterminate${suffix}`,
  };
}

const COUNT_TEMPLATES: MessageTemplates = new Map(
  ASSERTIONS.map((id) => [id, templateFor(id)]),
);

/** One route for the one request the rule plans, keyed the way core keys it. */
function scenario(result: CannedHttpResult): RuleContractInput {
  const transport = new InMemoryTransport();
  const input: RuleContractInput = {
    rule: contentSignalsRule,
    transport,
    templates: COUNT_TEMPLATES,
  };
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

/** The scan a fixture case describes: a robots.txt with one signal record. */
async function runSignal(
  contentSignal: string | null,
): Promise<RuleContractRun> {
  return await run(plainText(robotsWithSignal(contentSignal)));
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

/**
 * The `recognized-token-count` the unrecognized-vocabulary finding carries.
 *
 * ADR-0009 section 6: `sig-003` and `sig-005` report the same assertion, and
 * this parameter is what separates them. Read from the rendered message, which
 * is the only place a parameter is observable in the report.
 */
function expectRecognizedCount(
  contractRun: RuleContractRun,
  count: number,
): void {
  const finding = contractRun.findings.find(
    (entry) => entry.code === UNRECOGNIZED,
  );

  expect(finding?.message).toContain(`with ${String(count)} recognized`);
}

describe("sig-001: a complete valid declaration", () => {
  it("passes on all four assertions, and asks for /robots.txt once", async () => {
    const contractRun = await runSignal(
      "search=yes, ai-input=yes, ai-train=no",
    );

    expectStatus(contractRun, "pass");
    expectFindingCodes(contractRun, [
      CONFLICTING,
      COVERAGE,
      EFFECT,
      UNRECOGNIZED,
    ]);
    expectFindingStatuses(contractRun, {
      [COVERAGE]: "pass",
      [EFFECT]: "pass",
      [CONFLICTING]: "pass",
      [UNRECOGNIZED]: "pass",
    });
    expectRequests(contractRun, [
      { url: ROBOTS_URL, method: "GET", accept: "text/plain" },
    ]);
    expectSerialDispatch(contractRun.transport);
    expect(expectEvidenceResolves(contractRun).length).toBeGreaterThan(0);
  });

  it("reports all three labels as the recognized-token-count", async () => {
    const contractRun = await runSignal(
      "search=yes, ai-input=yes, ai-train=no",
    );

    expectRecognizedCount(contractRun, 3);
    expectRequirementClasses(contractRun, {
      [COVERAGE]: "recommended",
      [EFFECT]: "advisory",
      [CONFLICTING]: "advisory",
      [UNRECOGNIZED]: "advisory",
    });
  });

  it("is byte-identical across latency profiles", async () => {
    const runs = [];
    for (const profile of latencyProfiles(1)) {
      runs.push(
        await run(
          respond({
            status: 200,
            headers: { "content-type": "text/plain" },
            body: robotsWithSignal("search=yes, ai-input=yes, ai-train=no"),
            latencyTicks: profile.ticks[0] ?? 0,
          }),
        ),
      );
    }
    expectDeterministic(runs);
  });
});

describe("sig-002: a partial declaration", () => {
  it("passes, because omission is the optional case and not a violation", async () => {
    const contractRun = await runSignal("search=yes");

    // ADR-0009 section 6 pins `spec: pass` here. `content-signals.coverage`
    // reports omitted dimensions rather than inferring an unstated policy; a
    // publisher cannot violate that by omitting one, and the ruleset's own
    // delta says "Absence is not a violation of RFC 9309".
    expectStatus(contractRun, "pass");
    expectFindingStatuses(contractRun, {
      [COVERAGE]: "pass",
      [EFFECT]: "pass",
      [CONFLICTING]: "pass",
      [UNRECOGNIZED]: "pass",
    });
    expectRecognizedCount(contractRun, 1);
  });

  it("passes a declaration of any one recognized label", async () => {
    for (const label of ["search", "ai-input", "ai-train"]) {
      expectStatus(await runSignal(`${label}=yes`), "pass");
    }
  });
});

describe("sig-003: only tokens outside the dated compatibility set", () => {
  it("warns on unrecognized-vocabulary and never fails", async () => {
    const contractRun = await runSignal("ai-summarise=yes, ai-index=no");

    // ADR-0009 section 6 replaced this case's `spec: fail`. The three-token
    // set is a dated external heuristic; letting it decide a specification
    // verdict is the error that decision exists to prevent.
    expectStatus(contractRun, "warning");
    expectFindingStatuses(contractRun, {
      [COVERAGE]: "pass",
      [EFFECT]: "pass",
      [CONFLICTING]: "pass",
      [UNRECOGNIZED]: "warning",
    });
    expectRequirementClasses(contractRun, {
      [COVERAGE]: "recommended",
      [EFFECT]: "advisory",
      [CONFLICTING]: "advisory",
      [UNRECOGNIZED]: "advisory",
    });
    expectRecognizedCount(contractRun, 0);
  });

  it("warns on a record that declares nothing at all", async () => {
    // A served record with an empty value is still a deployed mechanism, so
    // this is a warning and not the `not-present` of sig-006.
    const contractRun = await runSignal("");

    expectStatus(contractRun, "warning");
    expectFindingStatuses(contractRun, {
      [COVERAGE]: "pass",
      [EFFECT]: "pass",
      [CONFLICTING]: "pass",
      [UNRECOGNIZED]: "warning",
    });
  });
});

describe("sig-004: one token declared twice with conflicting values", () => {
  it("warns on conflicting-declaration and selects no winner", async () => {
    const contractRun = await runSignal(
      "search=yes, ai-train=yes, ai-train=no",
    );

    expectStatus(contractRun, "warning");
    expectFindingStatuses(contractRun, {
      [COVERAGE]: "pass",
      [EFFECT]: "pass",
      [CONFLICTING]: "warning",
      // Both tokens are recognized, so the ambiguity is the only finding. A
      // conflict does not make the declaration unrecognized.
      [UNRECOGNIZED]: "pass",
    });
    expectRequirementClasses(contractRun, { [CONFLICTING]: "advisory" });
  });

  it("does not report the same token declared twice with one value", async () => {
    const contractRun = await runSignal("ai-train=no, ai-train=no");

    expectFindingStatuses(contractRun, {
      [COVERAGE]: "pass",
      [EFFECT]: "pass",
      [CONFLICTING]: "pass",
      [UNRECOGNIZED]: "pass",
    });
  });
});

describe("sig-005: a known token beside an unknown one", () => {
  it("warns on unrecognized-vocabulary while the known token stays usable", async () => {
    const contractRun = await runSignal("search=yes, ai-summarise=yes");

    expectStatus(contractRun, "warning");
    expectFindingStatuses(contractRun, {
      [COVERAGE]: "pass",
      [EFFECT]: "pass",
      [CONFLICTING]: "pass",
      [UNRECOGNIZED]: "warning",
    });
    // The distinction ADR-0009 section 6 states rather than hides: sig-003 and
    // sig-005 report the same assertion, and the recognized-token-count
    // parameter is what separates them.
    expectRecognizedCount(contractRun, 1);
  });
});

describe("sig-006: no Content Signals declaration", () => {
  it("is not-applicable, with all four assertions not-present together", async () => {
    const contractRun = await runSignal(null);

    // `deriveRuleStatus` refuses `not-applicable` beside an evaluated finding,
    // so a single advisory pass here would be a contract violation rather than
    // a cosmetic difference. The four ids are pinned by the fixture.
    expectStatus(contractRun, "not-applicable");
    expectFindingCodes(contractRun, [
      CONFLICTING,
      COVERAGE,
      EFFECT,
      UNRECOGNIZED,
    ]);
    expectFindingStatuses(contractRun, {
      [COVERAGE]: "not-applicable",
      [EFFECT]: "not-applicable",
      [CONFLICTING]: "not-applicable",
      [UNRECOGNIZED]: "not-applicable",
    });
  });

  it("is not-applicable when no robots.txt is served at all", async () => {
    // RFC 9309 section 2.3.1.3. The declaration lives in that one document, so
    // an unavailable robots.txt is an undeployed mechanism.
    const contractRun = await run(respond({ status: 404 }));

    expectStatus(contractRun, "not-applicable");
    expectFindingStatuses(contractRun, {
      [COVERAGE]: "not-applicable",
      [EFFECT]: "not-applicable",
      [CONFLICTING]: "not-applicable",
      [UNRECOGNIZED]: "not-applicable",
    });
  });
});

describe("the shared /robots.txt observation", () => {
  it("is one request and one parse for this rule and web.discovery.robots", async () => {
    const transport = new InMemoryTransport();
    const input: RuleContractInput = {
      rule: contentSignalsRule,
      transport,
      alsoRegister: [robotsRule],
    };
    transport.routeObservation(
      robotsObservationRequest("robots"),
      planningContextOf(input),
      plainText(robotsWithSignal("search=yes, ai-input=yes, ai-train=no")),
    );

    const contractRun = await runRuleContract(input);

    // ADR-0005 section 3 keys deduplication on the request and not on the
    // rule, so calling `robotsObservationRequest` rather than writing a
    // request literal is what makes this one dispatch instead of two.
    expectRequests(contractRun, [
      { url: ROBOTS_URL, method: "GET", accept: "text/plain" },
    ]);
    expect(contractRun.transport.httpRequests).toHaveLength(1);

    // Both rules reached a verdict from that one observation, which is what
    // makes the single request evidence of sharing rather than of one rule
    // having been filtered out.
    const statuses = new Map(
      contractRun.report.results.map((result) => [
        result.ruleId,
        result.status,
      ]),
    );
    expect(statuses.get("web.policy.content-signals")).toBe("pass");
    expect(statuses.get("web.discovery.robots")).toBe("pass");
  });
});

describe("a bound of ours is never a verdict about the publisher", () => {
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
      expectStatus(await run(respond({ status })), "unable-to-check");
    },
  );

  it("does not evaluate a truncated body", async () => {
    expectStatus(
      await run(plainText(robotsWithSignal("search=yes"), { truncated: true })),
      "unable-to-check",
    );
  });

  it("refuses a robots.txt past the response cap rather than parsing it", async () => {
    const oversized = "#".repeat(ROBOTS_PARSE_LIMITS.maxBytes + 1);

    expectStatus(await run(plainText(oversized)), "unable-to-check");
  });

  it("is unable-to-check when the declaration exceeds its own bound", async () => {
    // A bound that hid an unrecognized token would silently turn a warning
    // into a pass, so a refused reading is indeterminate and never satisfied.
    const records = Array.from(
      { length: CONTENT_SIGNAL_PARSE_LIMITS.maxRecords + 1 },
      () => "Content-Signal: ai-summarise=yes",
    ).join("\n");
    const contractRun = await run(
      plainText(["User-agent: *", "Allow: /", records].join("\n")),
    );

    expectStatus(contractRun, "unable-to-check");
    expectFindingStatuses(contractRun, {
      [COVERAGE]: "unable-to-check",
      [EFFECT]: "unable-to-check",
      [CONFLICTING]: "unable-to-check",
      [UNRECOGNIZED]: "unable-to-check",
    });
  });
});

describe("ADR-0009: the rule has no normative claim, in any mode", () => {
  it("declares exactly the four assertions, and none of them normative", () => {
    const declared = contentSignalsRule.metadata.assertions;

    expect(declared.map((assertion) => assertion.id)).toEqual([...ASSERTIONS]);
    // `content-signals.syntax` is retired outright rather than demoted or
    // renamed. Two review rounds found two different ways to manufacture a
    // normative failure here, and no pinned source supports one: the draft is
    // expired and defines a vocabulary only, the community site is an
    // application shell, and RFC 9309 section 2.2.4 addresses its one MUST to
    // the crawler rather than to the publisher.
    expect(declared.map((assertion) => assertion.requirementClass)).toEqual<
      RequirementClass[]
    >(["recommended", "advisory", "advisory", "advisory"]);
    expect(
      declared.some((assertion) => assertion.requirementClass === "normative"),
    ).toBe(false);
    expect(declared.every((assertion) => assertion.mode === "spec")).toBe(true);
  });

  it("cannot derive fail from any outcome kind on any of its assertions", () => {
    // `findingStatus` is the engine's own derivation, called here rather than
    // reimplemented: a local copy would agree on the day it was written.
    for (const assertion of contentSignalsRule.metadata.assertions) {
      for (const kind of OUTCOME_KINDS) {
        expect(findingStatus(kind, assertion.requirementClass)).not.toBe(
          "fail",
        );
      }
    }
  });

  it("authorizes no excerpt, and declares only the one count parameter", () => {
    // ADR-0009 sections 4 and 5 want the tokens recorded verbatim; the ruleset
    // does not authorize an excerpt parameter yet, so emitting one would be an
    // `unauthorized-excerpt` contract violation.
    for (const assertion of contentSignalsRule.metadata.assertions) {
      expect(assertion.excerptAuthorized).toBe(false);
    }
    const params = contentSignalsRule.metadata.assertions.map((assertion) =>
      Object.keys(assertion.params),
    );
    expect(params).toEqual([[], [], [], ["recognized-token-count"]]);
  });

  it("cites the expired draft on every assertion that names a token set", () => {
    const unrecognized = contentSignalsRule.metadata.assertions.find(
      (assertion) => assertion.id === UNRECOGNIZED,
    );
    const draft = contentSignalsRule.metadata.sources.find(
      (source) => source.id === "content-signals-draft-00",
    );

    expect(unrecognized?.sourceRefs).toEqual([
      { sourceId: "content-signals-draft-00", section: "4" },
    ]);
    // ADR-0009 section 7: a finding may not cite this source without the word
    // expired, and the rule's own copy of the ledger entry carries the status.
    expect(draft?.status).toBe("expired-draft");
  });

  it("reaches no fail on any input this suite can construct", async () => {
    const runs: RuleContractRun[] = [
      await runSignal("search=yes, ai-input=yes, ai-train=no"),
      await runSignal("search=yes"),
      await runSignal("ai-summarise=yes, ai-index=no"),
      await runSignal("search=yes, ai-train=yes, ai-train=no"),
      await runSignal("search=yes, ai-summarise=yes"),
      await runSignal(null),
      await runSignal(""),
      await runSignal("=, ,,="),
      await runSignal("search"),
      await runSignal("ai-train=maybe"),
      await runSignal("<script>alert(1)</script>=yes"),
      await run(respond({ status: 404 })),
      await run(respond({ status: 500 })),
      await run(respond({ status: 200, body: "<!doctype html><html></html>" })),
      await run(failure("connection-failed")),
      await run(plainText(robotsWithSignal("search=yes"), { truncated: true })),
    ];

    for (const contractRun of runs) {
      expect(contractRun.status).not.toBe("fail");
      expect(
        contractRun.findings.map((finding) => finding.status),
      ).not.toContain("fail");
    }
  });

  it("gives the same verdict whatever value a recognized token carries", async () => {
    // ADR-0009 section 5. No assertion produces a verdict about a token's
    // value, so these are one declaration as far as this rule is concerned.
    const kinds = [];
    for (const value of ["yes", "no", "maybe", "YES", "1", ""]) {
      const contractRun = await runSignal(`search=${value}`);
      kinds.push(
        contractRun.findings.map(
          (finding) => `${finding.code}=${finding.status}`,
        ),
      );
    }

    for (const kind of kinds) {
      expect(kind).toEqual(kinds[0]);
    }
  });
});
