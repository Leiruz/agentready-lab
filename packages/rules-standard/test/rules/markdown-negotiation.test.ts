import type {
  ObservationRequest,
  ProbeObservation,
  RoundContext,
} from "@agentready-lab/core";
import type {
  CannedHttpResult,
  RuleContractInput,
  RuleContractRun,
} from "@agentready-lab/testkit";
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
import { describe, expect, it } from "vitest";

import { markdownNegotiationRule } from "../../src/rules/markdown-negotiation.js";

/**
 * `web.content.markdown-negotiation` against the rule contract harness of
 * `docs/TEST_STRATEGY.md` section 6.
 *
 * The six cases of `docs/FIXTURE_CATALOG.md` section 8 are reproduced here as
 * contract cases rather than waiting for the M2 fixture host, so the rule's
 * verdicts are pinned to the catalog now. They are named `md-001` to `md-006`
 * so that the fixture and the contract case can be compared line by line when
 * the fixtures land.
 *
 * `sec-006` is the case this rule exists to prove: an `Accept: text/html`
 * observation and an `Accept: text/markdown` observation of one URL must never
 * deduplicate. The harness keys its routes with `canonicalRequestKey`, the
 * engine's own key, so a deduplication defect here shows up as one request and
 * one evidence entry rather than as a route that happens to be reused.
 */

const PAGE_URL = "http://127.0.0.1:8787/";

const HTML_BODY = [
  "<!doctype html>",
  "<html><head><title>Valid Agent Site</title></head>",
  "<body><h1>Valid Agent Site</h1>",
  "<p>Ships a Markdown representation.</p></body></html>",
].join("");

const MARKDOWN_BODY =
  "# Valid Agent Site\n\nShips a Markdown representation.\n";

const FINDING_CODES = [
  "markdown.fidelity",
  "markdown.media-type",
  "markdown.negotiation",
  "markdown.vary",
];

function htmlRepresentation(): CannedHttpResult {
  return respond({
    headers: { "content-type": "text/html; charset=utf-8" },
    body: HTML_BODY,
  });
}

function markdownRepresentation(): CannedHttpResult {
  return respond({
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      vary: "Accept",
    },
    body: MARKDOWN_BODY,
  });
}

function planOf(): readonly ObservationRequest[] {
  return markdownNegotiationRule.plan({
    mode: "spec",
    profile: { id: "content", version: "0.1.0" },
    target: DEFAULT_TARGET,
    options: {},
  });
}

/**
 * The planned request carrying `accept`.
 *
 * Selected by `Accept` and not by index, so a `plan()` that returned one
 * representation, or returned them in the other order, fails here by name
 * instead of quietly routing the wrong canned response.
 */
function requestFor(
  requests: readonly ObservationRequest[],
  accept: string,
): ObservationRequest {
  const found = requests.find(
    (request) => request.kind === "http" && request.accept === accept,
  );
  if (found === undefined) {
    throw new Error(`plan() returned no request with Accept: ${accept}`);
  }
  return found;
}

interface Representations {
  readonly html?: CannedHttpResult;
  readonly markdown?: CannedHttpResult;
}

async function scan(
  representations: Representations = {},
): Promise<RuleContractRun> {
  const transport = new InMemoryTransport();
  const input: RuleContractInput = {
    rule: markdownNegotiationRule,
    transport,
  };
  const context = planningContextOf(input);
  const requests = planOf();

  transport.routeObservation(
    requestFor(requests, "text/html"),
    context,
    representations.html ?? htmlRepresentation(),
  );
  transport.routeObservation(
    requestFor(requests, "text/markdown"),
    context,
    representations.markdown ?? markdownRepresentation(),
  );
  return await runRuleContract(input);
}

function statusOf(run: RuleContractRun, code: string): string {
  const finding = run.findings.find((entry) => entry.code === code);
  if (finding === undefined) {
    throw new Error(`${run.ruleId} reported no finding ${code}`);
  }
  return finding.status;
}

describe("plan", () => {
  it("issues two round-one requests for one page, differing only in Accept", () => {
    const requests = planOf();

    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.kind)).toEqual(["http", "http"]);
    const accepts = requests.map((request) =>
      request.kind === "http" ? request.accept : "",
    );
    expect(accepts).toEqual(["text/html", "text/markdown"]);
    expect(new Set(accepts).size).toBe(2);
    for (const request of requests) {
      expect(request.kind).toBe("http");
      if (request.kind !== "http") continue;
      expect(request.method).toBe("GET");
      expect(request.target).toEqual({ kind: "page" });
      expect(request.redirects).toBe("follow-same-origin");
    }
  });

  it("reserves no round-two budget, because neither request discovers a URL", () => {
    expect(markdownNegotiationRule.metadata.roundTwoBudget).toBe(0);
  });
});

/**
 * `finish()` is unreachable through `runScan`: `roundTwoBudget` is 0 and
 * `step()` always returns outcomes, so the engine never opens a second round
 * for this rule. It is still held to the contract in
 * `packages/core/src/model/rule.ts`, because a `finish()` whose contract holds
 * only while nobody calls it is not a contract.
 */
describe("finish", () => {
  const errorObservation = (id: string): ProbeObservation => ({
    kind: "http",
    id,
    request: { method: "GET", url: PAGE_URL, headers: new Map() },
    outcome: {
      kind: "error",
      error: {
        code: "connection-failed",
        phase: "connect",
        message: "connection failed",
        retryable: true,
      },
    },
  });

  const context: RoundContext<unknown> = {
    mode: "spec",
    profile: { id: "content", version: "0.1.0" },
    target: DEFAULT_TARGET,
    options: {},
    observation: (id: string): ProbeObservation => errorObservation(id),
    memo: <T>(_key: string, load: () => T): T => load(),
  };

  it("returns exactly one outcome per declared assertion", () => {
    const finished = markdownNegotiationRule.finish(context);

    expect(finished.kind).toBe("outcomes");
    expect(
      finished.outcomes.map((outcome) => outcome.assertion).sort(),
    ).toEqual(FINDING_CODES);
    expect(
      new Set(finished.outcomes.map((outcome) => outcome.assertion)).size,
    ).toBe(markdownNegotiationRule.metadata.assertions.length);
  });

  it("emits no message and no parameter, because the ruleset declares none", () => {
    const finished = markdownNegotiationRule.finish(context);

    for (const outcome of finished.outcomes) {
      expect(outcome.params).toEqual({});
      expect(Object.hasOwn(outcome, "message")).toBe(false);
      expect(Object.hasOwn(outcome, "status")).toBe(false);
      expect(Object.hasOwn(outcome, "requirementClass")).toBe(false);
    }
  });

  it("agrees with step() on the same round context", () => {
    const stepped = markdownNegotiationRule.step(context);

    expect(stepped).toEqual(markdownNegotiationRule.finish(context));
  });
});

describe("sec-006: representation observations never deduplicate", () => {
  it("dispatches both Accept values and keeps two evidence entries", async () => {
    const run = await scan();

    expectRequests(run, [
      { url: PAGE_URL, accept: "text/html" },
      { url: PAGE_URL, accept: "text/markdown" },
    ]);
    // Two dispatches of one URL, so the property under test is that the
    // engine's own canonical key separated them, not that two calls happened.
    const keys = new Set(run.transport.httpRequests.map((entry) => entry.key));
    expect(keys.size).toBe(2);
    expect(run.evidence).toHaveLength(2);
    expectSerialDispatch(run.transport);
  });
});

describe("docs/FIXTURE_CATALOG.md section 8", () => {
  it("md-001 passes with all four assertions satisfied", async () => {
    const run = await scan();

    expectStatus(run, "pass");
    expectFindingCodes(run, FINDING_CODES);
    expect(run.findings.map((finding) => finding.status)).toEqual([
      "pass",
      "pass",
      "pass",
      "pass",
    ]);
    expectEvidenceResolves(run);
  });

  it("md-002 warns when Vary omits Accept, and keeps the media type satisfied", async () => {
    const run = await scan({
      markdown: respond({
        headers: { "content-type": "text/markdown; charset=utf-8" },
        body: MARKDOWN_BODY,
      }),
    });

    expectStatus(run, "warning");
    expect(statusOf(run, "markdown.vary")).toBe("warning");
    expect(statusOf(run, "markdown.media-type")).toBe("pass");
    expect(statusOf(run, "markdown.negotiation")).toBe("pass");
  });

  it("md-003 fails when the Markdown request is answered with 200 text/html", async () => {
    const run = await scan({
      markdown: respond({
        headers: {
          "content-type": "text/html; charset=utf-8",
          vary: "Accept",
        },
        body: "<h1>Not Markdown</h1>",
      }),
    });

    expectStatus(run, "fail");
    expect(statusOf(run, "markdown.media-type")).toBe("fail");
    // The HTML request was answered correctly, so the negotiation prohibition
    // is not what this case violates.
    expect(statusOf(run, "markdown.negotiation")).toBe("pass");
  });

  it("md-004 fails on 406, while negotiation stays satisfied", async () => {
    const run = await scan({
      markdown: respond({
        status: 406,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          vary: "Accept",
        },
        body: "Not Acceptable",
      }),
    });

    expectStatus(run, "fail");
    // 406 is correct HTTP and is still "this origin has no Markdown
    // representation", which the selected capability profile requires. The two
    // are told apart by the shape of the outcomes: the capability assertion is
    // violated and the negotiation assertion is not.
    expect(statusOf(run, "markdown.media-type")).toBe("fail");
    expect(statusOf(run, "markdown.negotiation")).toBe("pass");
  });

  it("md-005 fails on Markdown bytes labelled text/plain", async () => {
    const run = await scan({
      markdown: respond({
        headers: {
          "content-type": "text/plain; charset=utf-8",
          vary: "Accept",
        },
        body: MARKDOWN_BODY,
      }),
    });

    expectStatus(run, "fail");
    expect(statusOf(run, "markdown.media-type")).toBe("fail");
  });

  it("md-006 passes when a same-origin redirect ends at a valid Markdown representation", async () => {
    const run = await scan({
      markdown: respond({
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          vary: "Accept",
        },
        body: MARKDOWN_BODY,
        effectiveUrl: "http://127.0.0.1:8787/index.md",
        redirects: [
          {
            status: 308,
            location: "http://127.0.0.1:8787/index.md",
            decision: "followed",
          },
        ],
      }),
    });

    expectStatus(run, "pass");
    const markdownEvidence = run.evidence[1];
    expect(markdownEvidence?.kind).toBe("http");
    if (markdownEvidence?.kind !== "http") return;
    expect(markdownEvidence.outcome.kind).toBe("response");
    if (markdownEvidence.outcome.kind !== "response") return;
    // The assertions read the response after the redirect, which is the one
    // the redirect chain ends at.
    expect(markdownEvidence.outcome.redirects).toHaveLength(1);
    expect(markdownEvidence.outcome.status).toBe(200);
  });
});

describe("each assertion, satisfied and violated", () => {
  it("markdown.media-type is violated when the Markdown representation is absent", async () => {
    const run = await scan({
      markdown: respond({
        status: 404,
        headers: {
          "content-type": "text/html; charset=utf-8",
          vary: "Accept",
        },
        body: "<h1>Not found</h1>",
      }),
    });

    expectStatus(run, "fail");
    expect(statusOf(run, "markdown.media-type")).toBe("fail");
  });

  it("markdown.negotiation is violated when the HTML request is answered with Markdown", async () => {
    const run = await scan({
      html: respond({
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          vary: "Accept",
        },
        body: MARKDOWN_BODY,
      }),
    });

    expectStatus(run, "fail");
    expect(statusOf(run, "markdown.negotiation")).toBe("fail");
    expect(statusOf(run, "markdown.media-type")).toBe("pass");
  });

  it("markdown.vary is satisfied by Vary: *", async () => {
    const run = await scan({
      markdown: respond({
        headers: { "content-type": "text/markdown; charset=utf-8", vary: "*" },
        body: MARKDOWN_BODY,
      }),
    });

    expectStatus(run, "pass");
    expect(statusOf(run, "markdown.vary")).toBe("pass");
  });

  it("markdown.vary is a warning and never a fail", async () => {
    const run = await scan({
      markdown: respond({
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          vary: "Accept-Encoding",
        },
        body: MARKDOWN_BODY,
      }),
    });

    expect(statusOf(run, "markdown.vary")).toBe("warning");
    expectRequirementClasses(run, { "markdown.vary": "recommended" });
    expect(run.findings.some((finding) => finding.status === "fail")).toBe(
      false,
    );
    expectStatus(run, "warning");
  });

  it("markdown.fidelity is violated when the heading and the title are both gone", async () => {
    const run = await scan({
      markdown: respond({
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          vary: "Accept",
        },
        body: "Ships something else entirely.\n",
      }),
    });

    expectStatus(run, "warning");
    expect(statusOf(run, "markdown.fidelity")).toBe("warning");
    expectRequirementClasses(run, { "markdown.fidelity": "advisory" });
  });

  it("markdown.fidelity is satisfied by a setext heading, not only an ATX one", async () => {
    const run = await scan({
      markdown: respond({
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          vary: "Accept",
        },
        body: "Valid Agent Site\n================\n\nShips a Markdown representation.\n",
      }),
    });

    expectStatus(run, "pass");
    expect(statusOf(run, "markdown.fidelity")).toBe("pass");
  });

  it("markdown.fidelity flags no heading loss when the HTML has no heading either", async () => {
    // The proxy asks whether headings present in the HTML survived, not
    // whether the Markdown has headings of its own.
    const run = await scan({
      html: respond({
        headers: { "content-type": "text/html; charset=utf-8" },
        body: "<!doctype html><html><body><p>No heading here.</p></body></html>",
      }),
      markdown: respond({
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          vary: "Accept",
        },
        body: "No heading here.\n",
      }),
    });

    expectStatus(run, "pass");
    expect(statusOf(run, "markdown.fidelity")).toBe("pass");
  });

  it("markdown.fidelity does not compare a title holding an entity", async () => {
    // This proxy decodes no entity, so the title as written is not the title
    // as read and a mismatch would not be evidence of anything.
    const run = await scan({
      html: respond({
        headers: { "content-type": "text/html; charset=utf-8" },
        body: "<!doctype html><html><head><title>Tools &amp; Agents</title></head><body><h1>Tools and Agents</h1></body></html>",
      }),
      markdown: respond({
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          vary: "Accept",
        },
        body: "# Tools and Agents\n",
      }),
    });

    expectStatus(run, "pass");
    expect(statusOf(run, "markdown.fidelity")).toBe("pass");
  });

  it("carries the requirement class the pinned ruleset assigned", async () => {
    const run = await scan();

    expectRequirementClasses(run, {
      "markdown.media-type": "normative",
      "markdown.negotiation": "normative",
      "markdown.vary": "recommended",
      "markdown.fidelity": "advisory",
    });
  });
});

describe("a transport error is not a conformance failure", () => {
  it("reports unable-to-check when the Markdown probe fails to connect", async () => {
    const run = await scan({ markdown: failure("connection-failed") });

    expectStatus(run, "unable-to-check");
    expect(statusOf(run, "markdown.media-type")).toBe("unable-to-check");
    expect(statusOf(run, "markdown.vary")).toBe("unable-to-check");
    expect(statusOf(run, "markdown.fidelity")).toBe("unable-to-check");
    expect(run.findings.some((finding) => finding.status === "fail")).toBe(
      false,
    );
  });

  it.each([
    "connect-timeout",
    "request-timeout",
    "tls-failed",
    "dns-resolution-failed",
    "redirect-limit",
    "response-limit",
  ] as const)("reports unable-to-check on %s", async (code) => {
    const run = await scan({ markdown: failure(code) });

    expectStatus(run, "unable-to-check");
    expect(run.findings.some((finding) => finding.status === "fail")).toBe(
      false,
    );
  });

  it("reports unable-to-check when both probes fail", async () => {
    const run = await scan({
      html: failure("connection-failed"),
      markdown: failure("connection-failed"),
    });

    expectStatus(run, "unable-to-check");
    expect(run.findings.map((finding) => finding.status)).toEqual([
      "unable-to-check",
      "unable-to-check",
      "unable-to-check",
      "unable-to-check",
    ]);
    expectEvidenceResolves(run);
  });

  it("cannot compare fidelity with no HTML representation, and says so", async () => {
    const run = await scan({ html: failure("connection-failed") });

    expectStatus(run, "unable-to-check");
    expect(statusOf(run, "markdown.fidelity")).toBe("unable-to-check");
    expect(statusOf(run, "markdown.negotiation")).toBe("unable-to-check");
    // The Markdown representation was still observed and still judged.
    expect(statusOf(run, "markdown.media-type")).toBe("pass");
    expect(statusOf(run, "markdown.vary")).toBe("pass");
  });
});

describe("hostile representation headers", () => {
  it("refuses two Content-Type field lines rather than taking the first", async () => {
    const run = await scan({
      markdown: respond({
        headers: {
          "content-type": ["text/markdown; charset=utf-8", "text/html"],
          vary: "Accept",
        },
        body: MARKDOWN_BODY,
      }),
    });

    expectStatus(run, "fail");
    expect(statusOf(run, "markdown.media-type")).toBe("fail");
  });

  it("fails a Markdown representation with no Content-Type at all", async () => {
    const run = await scan({
      markdown: respond({ headers: { vary: "Accept" }, body: MARKDOWN_BODY }),
    });

    expectStatus(run, "fail");
    expect(statusOf(run, "markdown.media-type")).toBe("fail");
  });

  it("does not read Accept out of a Vary value that merely contains it", async () => {
    const run = await scan({
      markdown: respond({
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          vary: "Accept-Language, Accept-Encoding",
        },
        body: MARKDOWN_BODY,
      }),
    });

    expect(statusOf(run, "markdown.vary")).toBe("warning");
  });

  it("does not scan an oversized Vary field line", async () => {
    // `docs/THREAT_MODEL.md`: a target-controlled field is bounded before it
    // is split. The bound is fail-closed, so an unscannable line cannot be
    // the thing that satisfies the assertion.
    const run = await scan({
      markdown: respond({
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          vary: `${"Accept-Encoding, ".repeat(200)}Accept`,
        },
        body: MARKDOWN_BODY,
      }),
    });

    expect(statusOf(run, "markdown.vary")).toBe("warning");
  });

  it("does not compare fidelity across a truncated body", async () => {
    const run = await scan({
      markdown: respond({
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          vary: "Accept",
        },
        body: "Ships something else entirely.\n",
        truncated: true,
      }),
    });

    expect(statusOf(run, "markdown.fidelity")).toBe("unable-to-check");
  });
});
