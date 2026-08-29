import { format, resolveConfig } from "prettier";
import { parseDocument } from "yaml";

/**
 * The `specs/` to TypeScript projection, as a pure function over text.
 *
 * WHY A GENERATED MODULE AND NOT A RUNTIME LOADER. `ScanInput` needs an
 * assertion set, a source ledger, a message template per assertion and outcome
 * kind, and a remediation entry per assertion, and every one of them is pinned
 * data that lives in `specs/*.yaml`. Reading those files at scan time would
 * need a YAML parser and a filesystem. `yaml` is a devDependency, adding it as
 * a runtime dependency would put a parser for a format with aliases and tags
 * inside the scan path, and a filesystem read would stop the packages working
 * in a Worker or a browser at all.
 *
 * So the projection happens once, here, at `pnpm specs:canonicalise` time, and
 * its output is committed. That makes it exactly the same kind of artifact as
 * `specs/*.canonical.json` and the `PROJECT_STATUS.md` table: generated,
 * committed, and held current by `pnpm specs:validate`, which recomputes it
 * and fails on a difference. A drifted module fails CI rather than shipping.
 *
 * WHAT IT DOES NOT PROJECT. `specs/checks.v0.yaml`. ADR-0008 makes the
 * snapshot "never read at scan time", and `ExternalSnapshotRef` is required in
 * `compat` mode and refused in every other. No rule declares a compat
 * assertion, so a `compat` scan cannot report anything; supplying the
 * reference would replace that honest refusal with one that failed later and
 * less clearly.
 *
 * PRECONDITION. `validateRegistry` has run over the same text and reported no
 * issues. Every read below therefore throws on a shape it did not expect
 * rather than skipping it: an unvalidated field reaching a generated module
 * silently is the failure this ordering exists to prevent.
 */

export interface PinnedArtifactsInput {
  readonly rulesetYaml: string;
  readonly ledgerYaml: string;
  readonly remediationYaml: string;
  readonly templatesYaml: string;
  /** `sha256:<hex>` over the canonical ruleset projection, from `seal`. */
  readonly rulesetDigest: string;
}

/** The repository path of the committed module, relative to the root. */
export const PINNED_ARTIFACTS_FILE =
  "packages/rules-standard/src/generated/pinned-artifacts.ts";

class ProjectionError extends Error {}

function fail(what: string): never {
  throw new ProjectionError(
    `${PINNED_ARTIFACTS_FILE}: ${what}. specs/ must validate before it is projected`,
  );
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${what} is not a mapping`);
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${what} is not a sequence`);
  return value as readonly unknown[];
}

function text(value: unknown, what: string): string {
  if (typeof value !== "string") fail(`${what} is not a string`);
  return value;
}

function optionalText(value: unknown, what: string): string | undefined {
  return value === undefined ? undefined : text(value, what);
}

function parse(yamlText: string, file: string): Record<string, unknown> {
  const document = parseDocument(yamlText, { uniqueKeys: true });
  if (document.errors.length > 0 || document.warnings.length > 0) {
    fail(`${file} did not parse cleanly`);
  }
  return record(document.toJS({ maxAliasCount: 100 }), file);
}

// ---------------------------------------------------------------------------
// Emission
//
// Values are printed as TypeScript expressions and the whole file is then run
// through the repository's own Prettier configuration, so the committed module
// satisfies `prettier --check` by construction rather than by a formatting
// convention this file would have to reimplement.
// ---------------------------------------------------------------------------

function quote(value: string): string {
  return JSON.stringify(value);
}

function entries(rows: readonly string[]): string {
  return `[${rows.join(",")}]`;
}

interface ProjectedAssertion {
  readonly ruleId: string;
  readonly id: string;
  readonly requirementClass: string;
  readonly sourceRefs: readonly { source: string; section?: string }[];
  readonly params: readonly {
    name: string;
    kind: string;
    required: boolean;
    allowedValues?: readonly string[];
  }[];
  readonly excerptAuthorized: boolean;
  readonly deferred?: { adr: string; reason: string; until: string };
}

function projectAssertions(
  ruleset: Record<string, unknown>,
): readonly ProjectedAssertion[] {
  const projected: ProjectedAssertion[] = [];
  for (const rawRule of list(ruleset["rules"], "rules")) {
    const rule = record(rawRule, "a rule");
    const ruleId = text(rule["rule_id"], "rule_id");
    const spec = record(rule["spec"], `${ruleId} spec`);
    for (const raw of list(spec["requirements"], `${ruleId} requirements`)) {
      const requirement = record(raw, `a requirement of ${ruleId}`);
      const id = text(requirement["id"], `a requirement id of ${ruleId}`);

      const sourceRefs = list(
        requirement["source_refs"] ?? [],
        `${id} source_refs`,
      ).map((rawRef) => {
        const ref = record(rawRef, `${id} source_refs entry`);
        const section = optionalText(ref["section"], `${id} section`);
        return {
          source: text(ref["source"], `${id} source`),
          ...(section === undefined ? {} : { section }),
        };
      });

      const params = list(requirement["params"] ?? [], `${id} params`).map(
        (rawParam) => {
          const param = record(rawParam, `${id} params entry`);
          const allowed = param["allowed_values"];
          return {
            name: text(param["name"], `${id} param name`),
            kind: text(param["kind"], `${id} param kind`),
            required: param["required"] === true,
            ...(allowed === undefined
              ? {}
              : {
                  allowedValues: list(allowed, `${id} allowed_values`).map(
                    (value) => text(value, `${id} allowed value`),
                  ),
                }),
          };
        },
      );

      const rawDeferred = requirement["deferred"];
      const deferred =
        rawDeferred === undefined
          ? undefined
          : (() => {
              const deferral = record(rawDeferred, `${id} deferred`);
              return {
                adr: text(deferral["adr"], `${id} deferred.adr`),
                reason: text(deferral["reason"], `${id} deferred.reason`),
                until: text(deferral["until"], `${id} deferred.until`),
              };
            })();

      projected.push({
        ruleId,
        id,
        requirementClass: text(requirement["strength"], `${id} strength`),
        sourceRefs,
        params,
        excerptAuthorized: requirement["excerpt_authorized"] === true,
        ...(deferred === undefined ? {} : { deferred }),
      });
    }
  }
  return projected;
}

function emitAssertion(assertion: ProjectedAssertion): string {
  const sourceRefs = assertion.sourceRefs.map(
    (ref) =>
      `{sourceId:${quote(ref.source)}${
        ref.section === undefined ? "" : `,section:${quote(ref.section)}`
      }}`,
  );
  const params = assertion.params.map(
    (param) =>
      `${quote(param.name)}:{kind:${quote(param.kind)},required:${String(
        param.required,
      )}${
        param.allowedValues === undefined
          ? ""
          : `,allowedValues:${entries(param.allowedValues.map(quote))}`
      }}`,
  );
  const deferred =
    assertion.deferred === undefined
      ? ""
      : `,deferred:{adr:${quote(assertion.deferred.adr)},reason:${quote(
          assertion.deferred.reason,
        )},until:${quote(assertion.deferred.until)}}`;
  return (
    `{ruleId:${quote(assertion.ruleId)},id:${quote(assertion.id)},mode:"spec",` +
    `requirementClass:${quote(assertion.requirementClass)},` +
    `sourceRefs:${entries(sourceRefs)},params:{${params.join(",")}},` +
    `excerptAuthorized:${String(assertion.excerptAuthorized)}${deferred}}`
  );
}

function emitSourceLedger(ledger: Record<string, unknown>): string {
  const rows = list(ledger["sources"], "sources").map((raw) => {
    const source = record(raw, "a ledger source");
    const id = text(source["id"], "a source id");
    // ADR-0010 section 1 gives a project-policy source a repository `document`
    // and forbids it a `url`, while `ReportSource.url` in packages/core is
    // required and has no `document`. The repository path goes into `url`,
    // which is what `packages/rules-standard/src/rules/link.ts` already does
    // for the same source and records as unresolved: fabricating an https URL
    // would be provenance a reader would take for somebody else's, and
    // dropping the entry would hide a source a rule rests on.
    const locator = source["url"] ?? source["document"];
    const version = optionalText(source["version"], `${id} version`);
    return `[${quote(id)},{id:${quote(id)},title:${quote(
      text(source["title"], `${id} title`),
    )},url:${quote(text(locator, `${id} url or document`))},kind:${quote(
      text(source["kind"], `${id} kind`),
    )},status:${quote(text(source["status"], `${id} status`))}${
      version === undefined ? "" : `,version:${quote(version)}`
    },verifiedAt:${quote(text(source["verified_at"], `${id} verified_at`))}}]`;
  });
  return entries(rows);
}

function emitTemplates(templates: Record<string, unknown>): string {
  const rows = list(templates["entries"], "template entries").map((raw) => {
    const entry = record(raw, "a template entry");
    const assertion = text(entry["assertion"], "a template assertion");
    const messages = record(entry["messages"], `${assertion} messages`);
    const fields = Object.entries(messages).map(
      ([kind, message]) =>
        `${quote(kind)}:${quote(text(message, `${assertion} ${kind}`))}`,
    );
    return `[${quote(assertion)},{${fields.join(",")}}]`;
  });
  return entries(rows);
}

function emitRemediation(remediation: Record<string, unknown>): string {
  const rows = list(remediation["entries"], "remediation entries").map(
    (raw) => {
      const entry = record(raw, "a remediation entry");
      const code = text(entry["finding_code"], "a finding_code");
      // Only `class` and `summary` reach a report (ADR-0007 section 2), and
      // `FindingRemediation` carries exactly those two. `detail` is surfaced
      // by the human reporter from the file, never embedded per finding, so
      // projecting it here would put unbounded prose in every scan's memory
      // for a field no finding carries.
      return `[${quote(code)},{class:${quote(
        text(entry["class"], `${code} class`),
      )},summary:${quote(text(entry["summary"], `${code} summary`))}}]`;
    },
  );
  return entries(rows);
}

const HEADER = `/**
 * GENERATED FILE. Do not edit.
 *
 * Written by \`pnpm specs:canonicalise\` from specs/ruleset.standard.v0.yaml,
 * specs/sources.v0.yaml, specs/remediation.v0.yaml and
 * specs/templates.v0.yaml. \`pnpm specs:validate\` regenerates it and fails on
 * any difference, so an edit here is reverted by CI rather than shipped.
 *
 * It exists so that a scan needs no YAML parser and no filesystem: everything
 * ADR-0007 section 1 requires a report to cite is compiled in. See
 * scripts/lib/pinned-artifacts.ts for why the projection happens at build time
 * and what it deliberately leaves out.
 */
import type {
  FindingRemediation,
  MessageTemplates,
  OutcomeKind,
  ProfileId,
  RemediationTable,
  ReportSource,
  RulesetAssertion,
} from "@agentready-lab/core";
`;

export async function generatePinnedArtifacts(
  input: PinnedArtifactsInput,
): Promise<string> {
  const ruleset = parse(input.rulesetYaml, "specs/ruleset.standard.v0.yaml");
  const ledger = parse(input.ledgerYaml, "specs/sources.v0.yaml");
  const remediation = parse(input.remediationYaml, "specs/remediation.v0.yaml");
  const templates = parse(input.templatesYaml, "specs/templates.v0.yaml");

  const rulesetId = text(ruleset["ruleset_id"], "ruleset_id");
  const rulesetVersion = text(ruleset["ruleset_version"], "ruleset_version");
  const ledgerVersion = text(
    ruleset["source_ledger_version"],
    "source_ledger_version",
  );

  // ADR-0002 section 4's five profile ids. Every one takes the ruleset's own
  // version, because a profile is not a separately authored artifact: it is
  // the per-rule `profiles` lists of this ruleset, so its identity moves
  // exactly when the ruleset's does and never independently. Nothing in
  // specs/ declares a profile version, and inventing a second axis for one
  // would be a version nobody increments.
  const profiles: readonly string[] = [
    "content",
    "api",
    "agent-service",
    "commerce",
    "full",
  ];

  const source = `${HEADER}
/** \`ruleset_id\`, \`ruleset_version\` and the digest of the canonical projection. */
export const PINNED_RULESET = {
  id: ${quote(rulesetId)},
  version: ${quote(rulesetVersion)},
  digest: ${quote(input.rulesetDigest)},
} as const;

/** ADR-0007: the axis a report carries in place of a ledger digest. */
export const PINNED_SOURCE_LEDGER_VERSION = ${quote(ledgerVersion)};

/** \`templates_version\` and \`remediation_version\`, for provenance in a bug report. */
export const PINNED_TEMPLATES_VERSION = ${quote(
    text(templates["templates_version"], "templates_version"),
  )};
export const PINNED_REMEDIATION_VERSION = ${quote(
    text(remediation["remediation_version"], "remediation_version"),
  )};

/**
 * Every assertion the ruleset declares, in ruleset order, including the
 * deferred and the uncited ones. \`RulesetAssertionIndex\` drops a deferred
 * assertion and \`validateRuleAssertions\` refuses a rule whose active
 * assertions cite nothing, so filtering here would move two refusals out of
 * the engine and into a build step.
 */
export const PINNED_ASSERTIONS: readonly RulesetAssertion[] = ${entries(
    projectAssertions(ruleset).map(emitAssertion),
  )};

export const PINNED_SOURCE_LEDGER: ReadonlyMap<string, ReportSource> =
  new Map<string, ReportSource>(${emitSourceLedger(ledger)});

export const PINNED_TEMPLATES: MessageTemplates = new Map<
  string,
  Readonly<Record<OutcomeKind, string>>
>(${emitTemplates(templates)});

export const PINNED_REMEDIATION: RemediationTable = new Map<
  string,
  FindingRemediation
>(${emitRemediation(remediation)});

/** \`profile.version\` in the canonical report, per profile id. */
export const PINNED_PROFILE_VERSIONS: Readonly<Record<ProfileId, string>> = {
${profiles.map((id) => `  ${quote(id)}: ${quote(rulesetVersion)},`).join("\n")}
};
`;

  const options = await resolveConfig(PINNED_ARTIFACTS_FILE);
  return format(source, { ...options, filepath: PINNED_ARTIFACTS_FILE });
}
