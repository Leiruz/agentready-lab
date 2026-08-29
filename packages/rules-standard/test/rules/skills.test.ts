import type {
  AnyRuleDefinition,
  AssertionOutcome,
  HttpObservation,
  ObservationRequest,
  PlanInput,
  ProbeObservation,
  RoundContext,
} from "@agentready-lab/core";
import { RuleContractViolation } from "@agentready-lab/core";
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
  isSkillDescription,
  isSkillDigest,
  isSkillName,
  isSkillType,
  isUriReference,
} from "../../src/data/agent-skills-v0.2.0.js";
import type { JsonSafeObject } from "../../src/parsers/json-safe.js";
import { isJsonObject, parseJsonSafe } from "../../src/parsers/json-safe.js";
import { analyzeSkillsIndex, skillsRule } from "../../src/rules/skills.js";

/**
 * `docs/FIXTURE_CATALOG.md` section 12, cases `skl-001` to `skl-007`, driven
 * through `runScan` by the rule contract harness of
 * `docs/TEST_STRATEGY.md` section 6, plus pure units for each grammar.
 *
 * THE BODIES HERE ARE NOT THE ONES `apps/fixtures-worker` SERVES, and that is
 * a defect in the fixture worker rather than in this file. Its base fixture
 * was written before `specs/sources.v0.yaml` pinned the draft -- every case
 * carries a `SKILLS_SHAPE_UNPINNED` todo saying so -- and it uses a
 * `.invalid` placeholder `$schema`, spells the digest member `sha256` with a
 * bare hex value rather than `digest` with a `sha256:` prefix, and uses the
 * type `skill`, which v0.2.0 does not define. Under the pinned draft that
 * document is not a v0.2.0 index, so `skl-001` against it is `fail` and not
 * the `pass` the catalog states. `the fixture worker's own base index` below
 * proves that, so the disagreement is localized and visible rather than
 * hidden by a rule that accepts both spellings.
 *
 * `skl-005` used to disagree with the pinned draft in the same way, and no
 * longer does. The catalog and the fixture described it as "not an absolute
 * HTTP(S) URL where the pinned draft requires one" and overrode the entry
 * `url` with a path-absolute reference, which the draft's URL Resolution
 * section permits: a `url` "may be" path-absolute, absolute, or relative, and
 * `/.well-known/agent-skills/code-review/SKILL.md` is one of its own examples.
 * That override passed. Both now describe what the catalog's purpose column
 * always named ("URL validation without fetching"), and the fixture overrides
 * the `url` with a reference that is not a valid RFC 3986 URI-reference. The
 * `skl-005` block below holds both halves: the malformed reference fails, and
 * the path-absolute one the fixture used to carry still passes.
 */

const ORIGIN = DEFAULT_TARGET.origin;
const INDEX_URL = `${ORIGIN}/.well-known/agent-skills/index.json`;
const LEGACY_URL = `${ORIGIN}/.well-known/skills/index.json`;
const ARTIFACT_PATH = "/.well-known/agent-skills/artifacts/hello-world.txt";
const JSON_TYPE = "application/json; charset=utf-8";

/** `specs/sources.v0.yaml`, `agent-skills-discovery-v0.2.0`. */
const SCHEMA = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";

/** Lowercase hexadecimal SHA-256, 64 characters, with the `sha256:` prefix. */
const HEX64 =
  "d6b0ef741083cc4990cde3e429bf7af9fde657c96350ea405a548a7686232fda";
const DIGEST = `sha256:${HEX64}`;

const ALL_ASSERTIONS = ["skills.digest", "skills.entry", "skills.path-schema"];

const PLAN_INPUT: PlanInput<unknown> = {
  mode: "spec",
  profile: { id: "agent-service", version: "0.1.0" },
  target: DEFAULT_TARGET,
  options: {},
};

function entry(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    name: "hello-world",
    type: "skill-md",
    description: "A fixed fixture skill that does nothing.",
    url: `${ORIGIN}${ARTIFACT_PATH}`,
    digest: DIGEST,
    ...overrides,
  };
}

function indexBody(
  entries: readonly Record<string, unknown>[],
  options: { readonly schema?: string | null } = {},
): string {
  const schema = options.schema === undefined ? SCHEMA : options.schema;
  return JSON.stringify(
    schema === null
      ? { skills: entries }
      : { $schema: schema, skills: entries },
  );
}

/** `skl-001`, and the base every other case is a single change away from. */
const VALID_INDEX = indexBody([entry()]);

function planned(): readonly ObservationRequest[] {
  return skillsRule.plan(PLAN_INPUT);
}

function contractInput(rule: AnyRuleDefinition): RuleContractInput {
  return {
    rule,
    transport: new InMemoryTransport(),
    // The rule is not in the `content` profile. `agent-service` is one of the
    // two it declares, and a profile it is absent from would resolve to no
    // result at all.
    profile: "agent-service",
  };
}

/**
 * Serves one canned answer at each of the two well-known paths and runs the
 * whole scan.
 */
async function scanWith(
  rule: AnyRuleDefinition,
  index: CannedHttpResult,
  legacy: CannedHttpResult = respond({ status: 404 }),
): ReturnType<typeof runRuleContract> {
  const input = contractInput(rule);
  const context = planningContextOf(input);
  const requests = planned();
  const answers = [index, legacy];
  requests.forEach((request, position) => {
    const answer = answers[position];
    if (answer === undefined) throw new Error("unplanned observation");
    input.transport.routeObservation(request, context, answer);
  });
  return runRuleContract(input);
}

async function scan(
  index: CannedHttpResult,
  legacy: CannedHttpResult = respond({ status: 404 }),
): ReturnType<typeof runRuleContract> {
  return scanWith(skillsRule, index, legacy);
}

function served(body: string, contentType = JSON_TYPE): CannedHttpResult {
  return respond({ headers: { "content-type": contentType }, body });
}

function statusesOf(
  run: Awaited<ReturnType<typeof runRuleContract>>,
): Record<string, string> {
  return Object.fromEntries(
    run.findings.map((finding) => [finding.code, finding.status]),
  );
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** A parsed index, so the unit tests exercise the real reader's output. */
function parsedIndex(body: string): JsonSafeObject {
  const parsed = parseJsonSafe(bytes(body));
  if (!parsed.ok || !isJsonObject(parsed.value)) {
    throw new Error(`the test body is not a JSON object: ${body}`);
  }
  return parsed.value;
}

describe("the requests it makes", () => {
  it("asks for the v0.2 path and the legacy path, once each", async () => {
    const run = await scan(served(VALID_INDEX));
    expectRequests(run, [
      { url: INDEX_URL, method: "GET", accept: "application/json" },
      { url: LEGACY_URL, method: "GET", accept: "application/json" },
    ]);
    expectSerialDispatch(run.transport);
    expectGate(run, "enforced");
    expectEvidenceResolves(run);
  });

  it("never fetches a declared skill artifact", async () => {
    const run = await scan(served(VALID_INDEX));
    expect(
      run.transport.httpRequests.some((request) =>
        request.url.includes(ARTIFACT_PATH),
      ),
    ).toBe(false);
  });
});

describe("skl-001: a valid v0.2.0 index", () => {
  it("passes every normative assertion", async () => {
    const run = await scan(served(VALID_INDEX));
    expectFindingCodes(run, ALL_ASSERTIONS);
    expectStatus(run, "pass");
    expect(statusesOf(run)).toEqual({
      "skills.path-schema": "pass",
      "skills.entry": "pass",
      "skills.digest": "pass",
    });
    expectRequirementClasses(run, {
      "skills.path-schema": "normative",
      "skills.entry": "normative",
      "skills.digest": "normative",
    });
  });

  it("accepts a second valid entry, and is order-stable", async () => {
    const body = indexBody([entry(), entry({ name: "second-skill" })]);
    const first = await scan(served(body));
    const second = await scan(served(body));
    expectStatus(first, "pass");
    expect(first.canonicalJson).toBe(second.canonicalJson);
  });

  it("passes an index that declares no skill at all", () => {
    // The draft states no minimum. An obligation with no entry to break is
    // met, not unmet.
    expect(analyzeSkillsIndex(parsedIndex(indexBody([])))).toEqual({
      pathSchema: "satisfied",
      entry: "satisfied",
      digest: "satisfied",
      pointer: null,
    });
  });

  it("cites only the v0.2 observation when the legacy path was not read", async () => {
    const run = await scan(served(VALID_INDEX));
    const refs = new Set(
      run.findings.flatMap((finding) => finding.evidenceRefs),
    );
    expect(refs.size).toBe(1);
  });
});

describe("skl-002: the index omits $schema", () => {
  it("fails on skills.path-schema and judges nothing downstream", async () => {
    const run = await scan(served(indexBody([entry()], { schema: null })));
    expectStatus(run, "fail");
    expect(statusesOf(run)).toEqual({
      "skills.path-schema": "fail",
      // The draft reads an absent `$schema` as v0.1.0 and says a client SHOULD
      // NOT process an index whose version it does not recognize.
      "skills.entry": "unable-to-check",
      "skills.digest": "unable-to-check",
    });
  });

  it.each([
    ["absent", null, ""],
    [
      "the v0.1.0 identifier",
      "https://schemas.agentskills.io/discovery/0.1.0/schema.json",
      "/$schema",
    ],
    ["an unrelated URI", "https://example.invalid/schema.json", "/$schema"],
    [
      "the pinned value with different case",
      "https://schemas.agentskills.io/DISCOVERY/0.2.0/schema.json",
      "/$schema",
    ],
  ])("refuses %s at %s", (_label, schema, pointer) => {
    expect(
      analyzeSkillsIndex(parsedIndex(indexBody([entry()], { schema }))),
    ).toEqual({
      pathSchema: "violated",
      entry: "indeterminate",
      digest: "indeterminate",
      pointer,
    });
  });

  it("recognizes the pinned identifier and only that", () => {
    expect(analyzeSkillsIndex(parsedIndex(VALID_INDEX)).pathSchema).toBe(
      "satisfied",
    );
  });

  it.each([
    ["no skills member", `{"$schema":${JSON.stringify(SCHEMA)}}`, ""],
    [
      "a skills member that is not an array",
      `{"$schema":${JSON.stringify(SCHEMA)},"skills":{}}`,
      "/skills",
    ],
    [
      "a skills member that is a string",
      `{"$schema":${JSON.stringify(SCHEMA)},"skills":"one"}`,
      "/skills",
    ],
  ])("fails %s at %s", (_label, body, pointer) => {
    expect(analyzeSkillsIndex(parsedIndex(body))).toMatchObject({
      pathSchema: "violated",
      pointer,
    });
  });
});

describe("skl-003: an invalid digest", () => {
  it("fails on skills.digest and on nothing else", async () => {
    const run = await scan(
      served(indexBody([entry({ digest: "SHA1:D6B0EF7410" })])),
    );
    expectStatus(run, "fail");
    expect(statusesOf(run)).toEqual({
      "skills.path-schema": "pass",
      "skills.entry": "pass",
      "skills.digest": "fail",
    });
  });

  it("fails a digest that is correct except for its case", async () => {
    // The realistic mistake, and the one `SHA1:D6B0EF7410` above does not
    // isolate: the right algorithm and the right length, in uppercase hex.
    const run = await scan(
      served(indexBody([entry({ digest: `sha256:${HEX64.toUpperCase()}` })])),
    );
    expectStatus(run, "fail");
    expect(statusesOf(run)["skills.digest"]).toBe("fail");
  });

  it("locates the digest precisely", () => {
    expect(
      analyzeSkillsIndex(parsedIndex(indexBody([entry({ digest: "nope" })]))),
    ).toEqual({
      pathSchema: "satisfied",
      entry: "satisfied",
      digest: "violated",
      pointer: "/skills/0/digest",
    });
  });

  it.each([
    ["the pinned form", DIGEST, true],
    ["a wrong algorithm", `sha1:${HEX64}`, false],
    ["a wrong algorithm with the right length", `sha512:${HEX64}`, false],
    ["no prefix at all", HEX64, false],
    ["an uppercase prefix", `SHA256:${HEX64}`, false],
    ["uppercase hexadecimal", `sha256:${HEX64.toUpperCase()}`, false],
    ["63 hex characters", `sha256:${HEX64.slice(1)}`, false],
    ["65 hex characters", `sha256:${HEX64}a`, false],
    ["a non-hex character", `sha256:${HEX64.slice(1)}g`, false],
    [
      "base64 encoding",
      "sha256:1rDvdBCDzEmQzePkKb96+f3mV8ljUOpAWlSKdoYjL9o=",
      false,
    ],
    ["a leading space", ` sha256:${HEX64}`, false],
    ["a trailing newline", `sha256:${HEX64}\n`, false],
    ["the empty string", "", false],
  ])("reads %s as %s", (_label, digest, expected) => {
    expect(isSkillDigest(digest)).toBe(expected);
  });
});

describe("skl-004: only the legacy path exists", () => {
  it("fails on skills.path-schema, because legacy is not v0.2 conformance", async () => {
    const run = await scan(respond({ status: 404 }), served(VALID_INDEX));
    expectStatus(run, "fail");
    expect(statusesOf(run)).toEqual({
      "skills.path-schema": "fail",
      // The legacy document is not governed by the pinned draft, so its
      // entries are evidence for nothing the v0.2.0 entry rules require.
      "skills.entry": "unable-to-check",
      "skills.digest": "unable-to-check",
    });
  });

  it("fails even when the legacy document is in the current shape", async () => {
    // A legacy path serving a perfectly v0.2.0-shaped index is still the wrong
    // location, which is the whole of what this case is about.
    const run = await scan(respond({ status: 410 }), served(VALID_INDEX));
    expect(statusesOf(run)["skills.path-schema"]).toBe("fail");
  });

  it("cites the legacy observation only where it was read", async () => {
    const run = await scan(respond({ status: 404 }), served(VALID_INDEX));
    const byCode = new Map(
      run.findings.map((finding) => [finding.code, finding.evidenceRefs]),
    );
    expect(byCode.get("skills.path-schema")?.length).toBe(2);
    expect(byCode.get("skills.entry")?.length).toBe(1);
    expectEvidenceResolves(run);
  });

  it("ignores a legacy body that is not a skills index", async () => {
    // A catch-all origin that answers 200 with an SPA shell has not deployed
    // the mechanism at the legacy path, and must not be failed for it.
    for (const body of [
      "<!doctype html><title>404</title>",
      '{"error":"no"}',
    ]) {
      const run = await scan(respond({ status: 404 }), served(body));
      expectStatus(run, "not-applicable");
    }
  });
});

describe("skl-005: an entry URL that is not a valid reference", () => {
  it("fails on skills.entry, and fetches nothing", async () => {
    const run = await scan(
      served(indexBody([entry({ url: "http://exa mple.invalid/skill.md" })])),
    );
    expectStatus(run, "fail");
    expect(statusesOf(run)).toEqual({
      "skills.path-schema": "pass",
      "skills.entry": "fail",
      "skills.digest": "pass",
    });
    expectRequests(run, [{ url: INDEX_URL }, { url: LEGACY_URL }]);
  });

  it("passes a path-absolute url, which the draft explicitly permits", async () => {
    // What the fixture overrode the `url` with before it was corrected. The
    // draft's URL Resolution section says a `url` "may be" path-absolute,
    // absolute, or relative, so the old override could never have produced
    // the fail its own description claimed.
    const run = await scan(served(indexBody([entry({ url: ARTIFACT_PATH })])));
    expectStatus(run, "pass");
  });

  it("computes the precise JSON Pointer the catalog asks for", () => {
    expect(
      analyzeSkillsIndex(
        parsedIndex(indexBody([entry(), entry({ url: "not a url" })])),
      ),
    ).toMatchObject({ entry: "violated", pointer: "/skills/1/url" });
  });

  it("carries no parameter, because the ruleset declares none", () => {
    // The pointer above is exact and unreportable: every assertion of this
    // rule declares `params: []` in specs/ruleset.standard.v0.yaml, and
    // `validateOutcomeParams` rejects an undeclared parameter. If this starts
    // failing, the ruleset assigned the parameter and the rule should send it.
    const outcomes = stepOutcomes(contextFor(httpIndex(VALID_INDEX)));
    expect(outcomes.map((outcome) => outcome.params)).toEqual([{}, {}, {}]);
  });

  it.each([
    ["an absolute URL", `${ORIGIN}${ARTIFACT_PATH}`, true],
    ["a path-absolute reference", ARTIFACT_PATH, true],
    ["a relative reference", "artifacts/hello-world.txt", true],
    ["a dot-segment reference", "../hello-world.txt", true],
    ["a query and fragment", "skill.md?v=1#top", true],
    ["a percent-encoded segment", "/a%20b/skill.md", true],
    ["a port", "https://example.invalid:8443/skill.md", true],
    ["an IPv6 literal", "https://[::1]:8787/skill.md", true],
    // RFC 3986 `relative-ref` permits `path-empty`, so this is syntax the
    // draft allows even though it resolves to the index itself. Nothing here
    // resolves anything, so it is not this assertion's call to make.
    ["the empty string", "", true],
    ["a space", "http://exa mple.invalid/", false],
    ["a raw newline", "https://example.invalid/a\nb", false],
    ["an unencoded angle bracket", "https://example.invalid/<script>", false],
    ["a bare backslash", "https:\\\\example.invalid\\a", false],
    ["a truncated percent escape", "/a%2", false],
    ["a non-hex percent escape", "/a%zz", false],
    ["a raw non-ASCII character", "/café.md", false],
    ["a control character", "/a b", false],
  ])("reads %s as %s", (_label, url, expected) => {
    expect(isUriReference(url)).toBe(expected);
  });

  it("is linear on a hostile authority", () => {
    // A quadratic `[userinfo "@"] host` split is a free denial of service for
    // an index that can put 200k characters in one string. This is a guard on
    // the shape of the grammar, not a benchmark.
    const hostile = `https://${"a@".repeat(20_000)}<`;
    expect(isUriReference(hostile)).toBe(false);
  });
});

describe("skl-006: the v0.2 endpoint is absent", () => {
  it("reports not-applicable, with every assertion agreeing", async () => {
    for (const status of [404, 410]) {
      const run = await scan(respond({ status }), respond({ status }));
      expectStatus(run, "not-applicable");
      expect(
        run.findings.every((finding) => finding.status === "not-applicable"),
      ).toBe(true);
    }
  });

  it("treats a 2xx that is not an index as absence, not as a violation", async () => {
    // `.claude/rules/standards.md`: missing optional material is not `fail`,
    // and a 2xx does not by itself prove support. A catch-all HTML shell at
    // the well-known path is the common shape of this.
    for (const body of [
      "<!doctype html><title>Home</title>",
      '{"error":"not found"}',
      "[]",
      "",
    ]) {
      expectStatus(await scan(served(body)), "not-applicable");
    }
  });

  it("treats a JSON object carrying skills as a deployment", async () => {
    // The discriminator has to admit a broken index, or `skl-002` could never
    // fail: that document has `skills` and no `$schema`.
    const run = await scan(served('{"skills":[]}'));
    expectStatus(run, "fail");
    expect(statusesOf(run)["skills.path-schema"]).toBe("fail");
  });
});

describe("skl-007: artifact bytes that do not match the declared digest", () => {
  it("passes in spec mode, because nothing was fetched", async () => {
    // The index is valid metadata. The mismatch lives in bytes this rule never
    // requests, so reporting anything about it would be a claim nothing
    // observed. `docs/FIXTURE_CATALOG.md` states this split directly.
    const run = await scan(served(VALID_INDEX));
    expectStatus(run, "pass");
    expectRequests(run, [{ url: INDEX_URL }, { url: LEGACY_URL }]);
  });

  it("declares no interop mode and no round-two budget to reach one", () => {
    expect(skillsRule.metadata.modes).toEqual(["spec"]);
    expect(skillsRule.metadata.roundTwoBudget).toBe(0);
  });
});

describe("skills.archive-safety is deferred and produces nothing", () => {
  it("emits exactly three outcomes, not four", () => {
    const outcomes = stepOutcomes(contextFor(httpIndex(VALID_INDEX)));
    expect(outcomes).toHaveLength(3);
    expect(outcomes.map((outcome) => outcome.assertion)).toEqual([
      "skills.path-schema",
      "skills.entry",
      "skills.digest",
    ]);
  });

  it("still declares it, with the ADR-0010 marker", () => {
    const declared = skillsRule.metadata.assertions.find(
      (assertion) => assertion.id === "skills.archive-safety",
    );
    expect(declared?.deferred?.adr).toBe("ADR-0010");
    expect(declared?.sourceRefs).toEqual([]);
  });

  it.each([
    ["a valid index", served(VALID_INDEX), respond({ status: 404 })],
    ["an absent endpoint", respond({ status: 404 }), respond({ status: 404 })],
    [
      "a transport error",
      failure("connection-failed"),
      failure("connection-failed"),
    ],
  ])("produces no finding for it, given %s", async (_label, index, legacy) => {
    const run = await scan(index, legacy);
    expect(run.findingCodes).not.toContain("skills.archive-safety");
    expect(run.findings).toHaveLength(3);
  });

  it("is rejected by the engine if the rule returns a fourth outcome", async () => {
    // The mutation this test defends against: a rule author who reads the
    // declaration list and reports one outcome per declared assertion.
    const mutant: AnyRuleDefinition = {
      ...skillsRule,
      step(context: RoundContext<unknown>) {
        const stepped = skillsRule.step(context);
        if (stepped.kind !== "outcomes") {
          throw new Error("agent.discovery.skills asked for a second round");
        }
        return {
          kind: "outcomes",
          outcomes: [
            ...stepped.outcomes,
            {
              assertion: "skills.archive-safety",
              kind: "satisfied",
              params: {},
              observationRefs: [],
            },
          ],
        };
      },
    };

    let thrown: unknown;
    try {
      await scanWith(mutant, served(VALID_INDEX));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RuleContractViolation);
    expect((thrown as RuleContractViolation).code).toBe(
      "outcome-for-deferred-assertion",
    );
  });
});

describe("the v0.2.0 name grammar", () => {
  it.each([
    ["a single character", "a", true],
    ["a digit", "7", true],
    ["hyphen-joined runs", "hello-world-2", true],
    ["64 characters", "a".repeat(64), true],
    ["the empty string", "", false],
    ["65 characters", "a".repeat(65), false],
    ["a leading hyphen", "-hello", false],
    ["a trailing hyphen", "hello-", false],
    ["consecutive hyphens", "hello--world", false],
    ["a lone hyphen", "-", false],
    ["uppercase", "Hello", false],
    ["an underscore", "hello_world", false],
    ["a dot", "hello.world", false],
    ["a space", "hello world", false],
    ["a slash", "hello/world", false],
    ["a non-ASCII letter", "hellö", false],
    ["a non-ASCII digit", "٠", false],
    ["a trailing newline", "hello\n", false],
  ])("reads %s as %s", (_label, name, expected) => {
    expect(isSkillName(name)).toBe(expected);
  });

  it("fails an entry whose name breaks the grammar", () => {
    expect(
      analyzeSkillsIndex(parsedIndex(indexBody([entry({ name: "Hello" })]))),
    ).toMatchObject({ entry: "violated", pointer: "/skills/0/name" });
  });
});

describe("the v0.2.0 type vocabulary", () => {
  it.each([
    ["skill-md", true],
    ["archive", true],
    // The spelling `apps/fixtures-worker` serves, which v0.2.0 does not define.
    ["skill", false],
    ["Archive", false],
    ["skill-md ", false],
    ["skill_md", false],
    ["", false],
  ])("reads %s as %s", (type, expected) => {
    expect(isSkillType(type)).toBe(expected);
  });

  it("fails an entry with an undefined type", () => {
    expect(
      analyzeSkillsIndex(parsedIndex(indexBody([entry({ type: "skill" })]))),
    ).toMatchObject({ entry: "violated", pointer: "/skills/0/type" });
  });
});

describe("the v0.2.0 description limit", () => {
  it.each([
    ["the empty string", "", true],
    ["1024 characters", "d".repeat(1024), true],
    ["1025 characters", "d".repeat(1025), false],
    // 1024 characters and 2048 UTF-16 code units. The draft says characters.
    ["1024 astral characters", "\u{1f600}".repeat(1024), true],
    ["1025 astral characters", "\u{1f600}".repeat(1025), false],
  ])("reads %s as %s", (_label, description, expected) => {
    expect(isSkillDescription(description)).toBe(expected);
  });

  it("fails an over-long description", () => {
    expect(
      analyzeSkillsIndex(
        parsedIndex(indexBody([entry({ description: "d".repeat(1025) })])),
      ),
    ).toMatchObject({ entry: "violated", pointer: "/skills/0/description" });
  });
});

describe("required entry members", () => {
  /** A base entry with one required member left out. */
  function entryWithout(member: string): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(entry()).filter(([key]) => key !== member),
    );
  }

  it.each([
    ["name", "/skills/0/name"],
    ["type", "/skills/0/type"],
    ["description", "/skills/0/description"],
    ["url", "/skills/0/url"],
  ])("fails an entry with no %s, at %s", (member, pointer) => {
    expect(
      analyzeSkillsIndex(parsedIndex(indexBody([entryWithout(member)]))),
    ).toMatchObject({ entry: "violated", pointer });
  });

  it("fails an entry with no digest, on skills.digest", () => {
    expect(
      analyzeSkillsIndex(parsedIndex(indexBody([entryWithout("digest")]))),
    ).toMatchObject({ digest: "violated", pointer: "/skills/0/digest" });
  });

  it.each([
    ["a number", 42],
    ["null", null],
    ["an array", []],
    ["an object", {}],
  ])("fails a name that is %s", (_label, name) => {
    expect(
      analyzeSkillsIndex(parsedIndex(indexBody([entry({ name })]))),
    ).toMatchObject({ entry: "violated", pointer: "/skills/0/name" });
  });

  it("cannot judge the digest of an entry that is not an object", () => {
    const parsed = parseJsonSafe(
      bytes(`{"$schema":${JSON.stringify(SCHEMA)},"skills":["hello-world"]}`),
    );
    if (!parsed.ok || !isJsonObject(parsed.value)) throw new Error("unparsed");
    expect(analyzeSkillsIndex(parsed.value)).toEqual({
      pathSchema: "satisfied",
      entry: "violated",
      digest: "indeterminate",
      pointer: "/skills/0",
    });
  });

  it("reports the worst verdict across entries and the first pointer", () => {
    const body = indexBody([
      entry(),
      entry({ name: "second-skill", digest: "nope" }),
      entry({ name: "THIRD" }),
    ]);
    expect(analyzeSkillsIndex(parsedIndex(body))).toEqual({
      pathSchema: "satisfied",
      entry: "violated",
      digest: "violated",
      pointer: "/skills/1/digest",
    });
  });
});

describe("the fixture worker's own base index", () => {
  it("is not a v0.2.0 index under the pinned draft", async () => {
    // `apps/fixtures-worker/src/cases/base/valid-agent-site-v1.ts`, which
    // predates the ledger entry and says so. Three separate defects: an
    // `.invalid` placeholder `$schema`, the member `sha256` with a bare hex
    // value instead of `digest` with a `sha256:` prefix, and the type `skill`.
    // `docs/FIXTURE_CATALOG.md` states `skl-001` as `pass`; against the pinned
    // draft it is `fail`, and the defect is in the fixture.
    const body = JSON.stringify({
      $schema:
        "https://unpinned.invalid/agent-skills-discovery/v0.2.0/index.schema.json",
      skills: [
        {
          name: "hello-world",
          type: "skill",
          description: "A fixed fixture skill that does nothing.",
          url: `${ORIGIN}${ARTIFACT_PATH}`,
          sha256: HEX64,
        },
      ],
    });
    const run = await scan(served(body));
    expectStatus(run, "fail");
    expect(statusesOf(run)["skills.path-schema"]).toBe("fail");
  });
});

describe("conditions that are not conformance failures", () => {
  it.each([500, 503, 301, 204])(
    "does not fail the index on HTTP %i",
    async (status) => {
      const run = await scan(respond({ status }), respond({ status: 404 }));
      expect(run.status).not.toBe("fail");
    },
  );

  it.each([500, 503, 301])(
    "reports index HTTP %i as unable-to-check",
    async (status) => {
      expectStatus(await scan(respond({ status })), "unable-to-check");
    },
  );

  it.each(["connection-failed", "request-timeout", "response-limit"] as const)(
    "reports the transport error %s as unable-to-check",
    async (code) => {
      expectStatus(await scan(failure(code)), "unable-to-check");
    },
  );

  it("cannot decide absence when the legacy probe itself failed", async () => {
    // Without the legacy answer, `skl-004` and `skl-006` are the same
    // observation, so neither verdict is available.
    const run = await scan(
      respond({ status: 404 }),
      failure("request-timeout"),
    );
    expectStatus(run, "unable-to-check");
  });

  it("reports a truncated body as unable-to-check", async () => {
    const run = await scan(
      respond({
        headers: { "content-type": JSON_TYPE },
        body: VALID_INDEX,
        truncated: true,
      }),
    );
    expectStatus(run, "unable-to-check");
  });

  it("treats a parser budget as unable-to-check, not as a violation", async () => {
    // Within every other limit and 65 containers deep. The target has broken
    // no requirement; this scanner declined to look that far.
    const deep = `{"skills":${"[".repeat(64)}${"]".repeat(64)}}`;
    expectStatus(await scan(served(deep)), "unable-to-check");
  });

  it("treats a duplicate key as unable-to-check", async () => {
    // `parseJsonSafe` declines to pick one of two meanings, which is an
    // ambiguity rather than a finding.
    const duplicated = `{"$schema":${JSON.stringify(SCHEMA)},"skills":[],"skills":[]}`;
    expectStatus(await scan(served(duplicated)), "unable-to-check");
  });

  it("never reports fail for a body it could not read for its own reasons", async () => {
    const deep = `{"skills":${"[".repeat(64)}${"]".repeat(64)}}`;
    const run = await scan(served(deep));
    expect(run.findings.some((finding) => finding.status === "fail")).toBe(
      false,
    );
  });
});

describe("purity", () => {
  it("plans two bounded GETs and returns the same plan every time", () => {
    const first = skillsRule.plan(PLAN_INPUT);
    const second = skillsRule.plan(PLAN_INPUT);
    expect(first).toEqual(second);
    expect(first).toEqual([
      {
        kind: "http",
        id: "well-known-agent-skills",
        method: "GET",
        target: {
          kind: "origin-path",
          path: "/.well-known/agent-skills/index.json",
        },
        accept: "application/json",
        redirects: "follow-same-origin",
        maxEncodedBytes: 262_144,
        maxDecodedBytes: 262_144,
      },
      {
        kind: "http",
        id: "well-known-skills-legacy",
        method: "GET",
        target: { kind: "origin-path", path: "/.well-known/skills/index.json" },
        accept: "application/json",
        redirects: "follow-same-origin",
        maxEncodedBytes: 262_144,
        maxDecodedBytes: 262_144,
      },
    ]);
  });

  it("returns outcomes synchronously from step, never a request batch", () => {
    const stepped = skillsRule.step(contextFor(httpIndex(VALID_INDEX)));
    expect(stepped.kind).toBe("outcomes");
    expect(stepped).not.toBeInstanceOf(Promise);
  });

  it("makes finish agree with step, since roundTwoBudget is zero", () => {
    const context = contextFor(httpIndex(VALID_INDEX));
    expect(skillsRule.finish(context)).toEqual(skillsRule.step(context));
  });

  it("is indeterminate when handed a DNS observation it never asked for", () => {
    const dns: ProbeObservation = {
      kind: "dns",
      id: "well-known-agent-skills",
      query: { name: "127.0.0.1", recordType: "A" },
      outcome: {
        kind: "answer",
        rcode: "NOERROR",
        records: [],
        dnssec: "insecure",
      },
    };
    const kinds = stepOutcomes(contextFor(dns)).map((outcome) => outcome.kind);
    expect(kinds).toEqual(["indeterminate", "indeterminate", "indeterminate"]);
  });
});

/** `step` is typed to allow a second round; this rule never opens one. */
function stepOutcomes(
  context: RoundContext<unknown>,
): readonly AssertionOutcome[] {
  const stepped = skillsRule.step(context);
  if (stepped.kind !== "outcomes") {
    throw new Error("agent.discovery.skills asked for a second round");
  }
  return stepped.outcomes;
}

function httpIndex(body: string): HttpObservation {
  const encoded = bytes(body);
  return {
    kind: "http",
    id: "well-known-agent-skills",
    request: { method: "GET", url: INDEX_URL, headers: new Map() },
    outcome: {
      kind: "response",
      status: 200,
      effectiveUrl: INDEX_URL,
      headers: new Map([["content-type", [JSON_TYPE]]]),
      body: encoded,
      truncated: false,
      encodedBytes: encoded.length,
      decodedBytes: encoded.length,
      bodySha256: "sha256:test",
      redirects: [],
    },
  };
}

/**
 * The v0.2 observation only. A body that reaches the legacy probe from here is
 * asking for an observation this context does not hold, and says so.
 */
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
