import path from "node:path";

import type {
  AnyRuleDefinition,
  AssertionDeclaration,
  HttpTransportRequest,
  HttpTransportResult,
  ImplementationStatus,
  OutcomeKind,
  ProfileId,
  ReportSource,
  RequirementClass,
  RuleApplicability,
  RulesetAssertion,
  Transport,
} from "@agentready-lab/core";

import type {
  CliEnvironment,
  FileRead,
  PinnedArtifacts,
} from "../../src/environment.js";

/**
 * The test wiring for `CliEnvironment`.
 *
 * Two things it exists to make assertable, both of which are exit-code
 * contract and not decoration:
 *
 * - **that nothing was asked of the transport.** `factoryCalls` counts
 *   constructions and `httpCalls` counts requests, so "an invalid
 *   configuration issues no request" and the stronger "an invalid
 *   configuration does not even build a transport" are two different
 *   assertions with two different numbers behind them;
 * - **that a scan can run at all.** `packages/rules-standard` is entirely
 *   `planned` and no pinned templates or remediation table exists, so an
 *   end-to-end `check` cannot complete against the production wiring. The
 *   registry and the artifacts are injected here instead, which exercises
 *   every line of the composition, `runScan`, both reporters and the exit-code
 *   mapping for real, with the rule behaviour supplied by the test rather than
 *   waited for.
 */

export const TEST_CWD = path.resolve("/agentready-lab-test");

export function configPath(): string {
  return path.join(TEST_CWD, "agentready.config.json");
}

export interface TransportProbe {
  /** How many times `createTransport` was called. */
  factoryCalls: number;
  /** How many HTTP requests the composed transport was asked to issue. */
  httpCalls: number;
  /** Every URL it was asked for, in order. */
  readonly urls: string[];
}

export interface TestEnvironment {
  readonly environment: CliEnvironment;
  readonly probe: TransportProbe;
}

const SOURCE: ReportSource = {
  id: "test-source",
  title: "A pinned source, for tests",
  url: "https://example.invalid/spec",
  kind: "ietf-rfc",
  status: "proposed-standard",
  version: "1",
  verifiedAt: "2026-08-29",
};

export interface FakeRuleSpec {
  readonly id: string;
  readonly outcome: OutcomeKind;
  readonly requirementClass?: RequirementClass;
  readonly applicability?: RuleApplicability;
  readonly implementationStatus?: ImplementationStatus;
  readonly profiles?: readonly ProfileId[];
  readonly category?: string;
}

interface FakeRule {
  readonly definition: AnyRuleDefinition;
  readonly assertion: RulesetAssertion;
}

/**
 * A rule that plans nothing and reports one outcome.
 *
 * Planning zero requests is what keeps this a test of the CLI: the scan runs
 * end to end through `runScan`, `buildReport` and a reporter, and the
 * transport is never asked for anything, so a non-zero `httpCalls` in any test
 * using it is a defect and not a fixture detail.
 */
export function fakeRule(spec: FakeRuleSpec): FakeRule {
  const assertionId = `${spec.id}.one`;
  const requirementClass = spec.requirementClass ?? "normative";
  const declaration: AssertionDeclaration = {
    id: assertionId,
    mode: "spec",
    requirementClass,
    sourceRefs: [{ sourceId: SOURCE.id }],
    params: {},
    excerptAuthorized: false,
  };

  return {
    assertion: { ...declaration, ruleId: spec.id },
    definition: {
      apiVersion: 1,
      metadata: {
        id: spec.id,
        externalCompatibilityId: null,
        ruleVersion: "0.1.0",
        ruleset: { id: "test", version: "0.0.1" },
        title: `fake rule ${spec.id}`,
        category: spec.category ?? "discoverability",
        profiles: spec.profiles ?? ["content", "full"],
        applicability: spec.applicability ?? "applicable",
        modes: ["spec"],
        observationRuntime: ["http"],
        sourceMaturity: "stable",
        implementationStatus: spec.implementationStatus ?? "supported",
        sources: [SOURCE],
        assertions: [declaration],
        roundTwoBudget: 0,
      },
      defaultOptions: {},
      plan: () => [],
      step: () => ({
        kind: "outcomes",
        outcomes: [
          {
            assertion: assertionId,
            kind: spec.outcome,
            params: {},
            observationRefs: [],
          },
        ],
      }),
      finish: () => {
        throw new Error("finish() is unreachable: step() returned outcomes");
      },
    },
  };
}

const OUTCOME_TEMPLATES: Readonly<Record<OutcomeKind, string>> = {
  satisfied: "the mechanism is present and conforms",
  violated: "the mechanism is present and does not conform",
  "not-present": "the mechanism is not deployed",
  indeterminate: "the mechanism could not be evaluated",
};

/** Templates, remediation and a ledger that cover whatever rules are given. */
export function artifactsFor(rules: readonly FakeRule[]): PinnedArtifacts {
  const profileVersions: Record<ProfileId, string> = {
    content: "0.0.1",
    api: "0.0.1",
    "agent-service": "0.0.1",
    commerce: "0.0.1",
    full: "0.0.1",
  };
  return {
    ruleset: {
      id: "test",
      version: "0.0.1",
      digest:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    assertions: rules.map((rule) => rule.assertion),
    sourceLedgerVersion: "0.0.1",
    sourceLedger: new Map([[SOURCE.id, SOURCE]]),
    templates: new Map(
      rules.map((rule) => [rule.assertion.id, OUTCOME_TEMPLATES]),
    ),
    remediation: new Map(
      rules.map((rule) => [
        rule.assertion.id,
        { class: "required-correction" as const, summary: "correct it" },
      ]),
    ),
    profileVersions,
  };
}

export interface EnvironmentOverrides {
  readonly argv?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
  /** Absolute path to contents. An absent path reads as `absent`. */
  readonly files?: Readonly<Record<string, string>>;
  /** Absolute paths that exist and cannot be read. */
  readonly unreadable?: readonly string[];
  readonly registry?: readonly AnyRuleDefinition[];
  readonly pinnedArtifacts?: PinnedArtifacts | undefined;
  /** Canned results, keyed by request URL. Absent URLs fail the test. */
  readonly http?: Readonly<Record<string, HttpTransportResult>>;
}

export function testEnvironment(
  overrides: EnvironmentOverrides = {},
): TestEnvironment {
  const probe: TransportProbe = { factoryCalls: 0, httpCalls: 0, urls: [] };
  const files = overrides.files ?? {};
  const unreadable = new Set(overrides.unreadable ?? []);

  const transport: Transport = {
    http: (request: HttpTransportRequest): Promise<HttpTransportResult> => {
      probe.httpCalls += 1;
      probe.urls.push(request.url);
      const canned = overrides.http?.[request.url];
      return Promise.resolve(
        canned ?? {
          kind: "failure",
          reason: { code: "connection-failed", phase: "connect" },
        },
      );
    },
  };

  return {
    probe,
    environment: {
      argv: overrides.argv ?? [],
      env: overrides.env ?? {},
      cwd: overrides.cwd ?? TEST_CWD,
      readTextFile: (absolutePath): FileRead => {
        if (unreadable.has(absolutePath)) {
          return { kind: "unreadable", detail: "EACCES: permission denied" };
        }
        const text = files[absolutePath];
        return text === undefined ? { kind: "absent" } : { kind: "text", text };
      },
      registry: overrides.registry ?? [],
      pinnedArtifacts: overrides.pinnedArtifacts,
      createTransport: () => {
        probe.factoryCalls += 1;
        return transport;
      },
    },
  };
}
