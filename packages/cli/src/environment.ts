import fs from "node:fs";

import type {
  AnyRuleDefinition,
  ExternalSnapshotRef,
  MessageTemplates,
  ProfileId,
  RemediationTable,
  ReportSource,
  RulesetAssertion,
  Transport,
} from "@agentready-lab/core";
import {
  PINNED_ASSERTIONS,
  PINNED_PROFILE_VERSIONS,
  PINNED_REMEDIATION,
  PINNED_RULESET,
  PINNED_SOURCE_LEDGER,
  PINNED_SOURCE_LEDGER_VERSION,
  PINNED_TEMPLATES,
  STANDARD_RULESET,
} from "@agentready-lab/rules-standard";
import type { LocalLoopbackPolicy } from "@agentready-lab/transport-node";
import { createNodeTransport } from "@agentready-lab/transport-node";

/**
 * Everything this package reaches for that is not an argument.
 *
 * `docs/ARCHITECTURE.md` section 4 makes the CLI "argument parsing,
 * configuration and package composition only", and `CLAUDE.md` requires
 * injected transports, clocks and randomness. The seam is a parameter rather
 * than a module-level import for the ordinary reason - the tests need to
 * substitute it - and for one that is specific to this project: the
 * `ci-public` acceptance criterion is "makes no public connection", and a test
 * can only prove that about a transport it was handed.
 */

export type FileRead =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly detail: string };

/**
 * The pinned artifacts a scan cites, none of which the CLI may derive.
 *
 * `ScanInput` needs an assertion set, a source ledger, a message template per
 * assertion and outcome kind, and a remediation entry per assertion that can
 * derive `fail` or `warning`. Every one of them is a claim about what a
 * standard requires, so composing them here would be this package asserting
 * protocol semantics, which its boundary forbids.
 *
 * It would also be circular. `validate-outcomes.ts` states that the engine
 * reads classes, citations, parameter schemas and excerpt authorization "from
 * **here** and never from `RuleMetadata`", and that "a rule's own copy is
 * validated against this and then not used". Building this bundle out of
 * `metadata.assertions` would make that validation compare a rule with itself,
 * so the check would still run and would no longer be able to fail.
 *
 * `specs/` supplies all of it, and it is projected into
 * `packages/rules-standard/src/generated/pinned-artifacts.ts` by
 * `pnpm specs:canonicalise` rather than parsed at run time: `yaml` is a
 * devDependency, and a scan that read a file would not run in a Worker. The
 * generated module is committed and `pnpm specs:validate` fails on a
 * difference, so the artifacts a build ships are the ones `specs/` says.
 *
 * The type stays a parameter rather than a module-level import in
 * `check.ts` because a test needs to substitute one, and because the
 * `undefined` case is still reachable: an embedder can compose a
 * `CliEnvironment` without artifacts, and `check` refuses rather than
 * synthesising them.
 */
export interface PinnedArtifacts {
  readonly ruleset: {
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly assertions: readonly RulesetAssertion[];
  readonly sourceLedgerVersion: string;
  readonly sourceLedger: ReadonlyMap<string, ReportSource>;
  readonly templates: MessageTemplates;
  readonly remediation: RemediationTable;
  /**
   * ADR-0007 section 1: required in `compat` mode and refused in every other.
   * Absent here means `--mode compat` is refused by core, which is the honest
   * outcome while nothing loads `specs/checks.v0.yaml` at run time.
   */
  readonly externalSnapshot?: ExternalSnapshotRef;
  /** `profile.version` in the canonical report, per profile id. */
  readonly profileVersions: Readonly<Record<ProfileId, string>>;
}

export interface CliEnvironment {
  /** The arguments after the program name. */
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  readonly readTextFile: (absolutePath: string) => FileRead;
  /** The pinned registry, in stable registry order. */
  readonly registry: readonly AnyRuleDefinition[];
  readonly pinnedArtifacts: PinnedArtifacts | undefined;
  /**
   * Built only once a `local-loopback` policy exists, which is the point: a
   * policy object is the only thing this signature accepts, and
   * `network-policy.ts` makes `LocalLoopbackPolicy` the only policy type the
   * transport package can construct.
   */
  readonly createTransport: (policy: LocalLoopbackPolicy) => Transport;
}

/**
 * The production bundle, composed and not derived.
 *
 * Every field is read straight out of the generated projection of `specs/`.
 * Nothing here is built from `RuleMetadata`, which is the circularity
 * `validate-outcomes.ts` warns about: the engine validates a rule's own
 * assertion copy against this set, and a set built from that copy would make
 * the check compare a rule with itself.
 *
 * `externalSnapshot` is deliberately absent. ADR-0007 section 1 requires it in
 * `compat` mode and refuses it in every other, and no rule declares a compat
 * assertion, so a `compat` scan has nothing to report either way; supplying
 * the reference would move core's refusal later without making the mode work.
 */
const PINNED_ARTIFACTS: PinnedArtifacts = {
  ruleset: PINNED_RULESET,
  assertions: PINNED_ASSERTIONS,
  sourceLedgerVersion: PINNED_SOURCE_LEDGER_VERSION,
  sourceLedger: PINNED_SOURCE_LEDGER,
  templates: PINNED_TEMPLATES,
  remediation: PINNED_REMEDIATION,
  profileVersions: PINNED_PROFILE_VERSIONS,
};

function readTextFile(absolutePath: string): FileRead {
  try {
    return { kind: "text", text: fs.readFileSync(absolutePath, "utf8") };
  } catch (thrown) {
    const code =
      typeof thrown === "object" && thrown !== null && "code" in thrown
        ? String(thrown.code)
        : "";
    if (code === "ENOENT") return { kind: "absent" };
    return {
      kind: "unreadable",
      detail: thrown instanceof Error ? thrown.message : String(thrown),
    };
  }
}

/**
 * The production wiring.
 *
 * `argv`, `env` and `cwd` are parameters rather than reads of `process`, so
 * that this function is still the only place in the package that names a
 * process global and a caller embedding the CLI does not inherit one.
 */
export function nodeEnvironment(input: {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
}): CliEnvironment {
  return {
    argv: input.argv,
    env: input.env,
    cwd: input.cwd,
    readTextFile,
    registry: STANDARD_RULESET,
    pinnedArtifacts: PINNED_ARTIFACTS,
    createTransport: (policy) => createNodeTransport({ policy }),
  };
}
