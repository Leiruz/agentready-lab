import { parseDocument } from "yaml";

import { canonicalizeJson } from "../../packages/core/src/schema/canonical-json.js";
import { validateAgainstSchema } from "../../packages/core/src/schema/json-schema.js";
import {
  formatDigest,
  sha256HexOfUtf8,
} from "../../packages/core/src/schema/sha256.js";

/**
 * The `specs/` validator, as a pure function.
 *
 * ADR-0008 replaces one file doing three jobs with three authorities, so this
 * validates all three and the joins between them:
 *
 * - `specs/checks.v0.yaml` is the frozen external compatibility snapshot;
 * - `specs/sources.v0.yaml` is the independent source ledger, and every
 *   `source_refs` identifier in either other file resolves against it;
 * - `specs/ruleset.standard.v0.yaml` is the executable native ruleset.
 *
 * `specs/README.md` "Validation" is the requirement list this implements. It
 * is a pure function over text so that it has exactly two callers and no third
 * behaviour: `scripts/validate-registry.ts` runs it as `pnpm specs:validate`,
 * and the Vitest suite runs it in the merge-blocking `unit` project. A
 * validator that only CI runs gets skipped; one that only a test runs cannot
 * be used to check a work in progress.
 *
 * Taking text rather than paths is also what makes "no network" structural
 * rather than a promise. This function has no transport, no filesystem, and no
 * clock. A source URL is parsed and classified; it is never dereferenced. The
 * "today" that a date check compares against is declared in the file that owns
 * the date, so the result does not change overnight.
 *
 * There are two such declared ceilings, not one, because ADR-0008 section 1
 * versions the ledger independently "because a source's verification date
 * changes for reasons that have nothing to do with" the snapshot. A snapshot
 * date is bounded by `snapshot.captured_at`; a ledger `verified_at` is bounded
 * by `ledger_date`. Bounding the ledger by the snapshot's capture date made it
 * impossible to record a source verified after the snapshot was taken, which
 * is the opposite of two artifacts on two clocks.
 */

// ---------------------------------------------------------------------------
// Policy constants
// ---------------------------------------------------------------------------

/**
 * `specs/README.md`: "exactly 22 compatibility checks are present". Asserted
 * here as well as in the schema, because `minItems`/`maxItems` are one edit
 * away from being relaxed and this file is where the requirement is written
 * down. ADR-0008 makes this a fact about what IsItAgentReady published on the
 * snapshot date, never this project's rule count.
 */
const REQUIRED_CHECK_COUNT = 22;

/**
 * `specs/README.md`: "every URL uses HTTPS except a source whose normative
 * identifier is HTTP".
 *
 * Empty, and it should stay that way. An entry here is a claim that the
 * source's own canonical, citable identifier is an `http:` URL that the
 * publisher has not issued over TLS, not that an `https:` link was
 * inconvenient to find. Adding one needs the same review as a source change.
 */
const HTTP_SOURCE_ID_ALLOWLIST: readonly string[] = [];

const SNAPSHOT_FILE = "specs/checks.v0.yaml";
const LEDGER_FILE = "specs/sources.v0.yaml";
const RULESET_FILE = "specs/ruleset.standard.v0.yaml";

/**
 * Keys ADR-0008 section 2 forbids on a ruleset rule entry. `compat` is a dated
 * observation about an external tool and `ordinal` and `id` are that tool's
 * identifiers; a native rule with no external counterpart has none of them.
 * `additionalProperties: false` already rejects all three, and this list is
 * kept anyway because the ADR names the check and a schema is one edit away.
 */
const FORBIDDEN_RULE_KEYS: readonly string[] = ["compat", "ordinal", "id"];

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

/**
 * One validation failure.
 *
 * `code` is stable and machine-readable. `location` is the repository-relative
 * file name, followed by a JSON Pointer (RFC 6901) into that parsed document
 * where one exists. A YAML error carries `line L:C` instead, because no parsed
 * document exists yet.
 */
export interface RegistryIssue {
  readonly code: string;
  readonly location: string;
  readonly message: string;
}

/**
 * One listed delta or open item. Reported, never fatal.
 *
 * ADR-0008 sections 2 and 5 require the snapshot-to-ruleset differences to be
 * printed rather than rejected: the snapshot's per-check `rule_version` is
 * frozen metadata that may lag the ruleset by any distance, and an assertion
 * the ruleset adds or retires is a decision, not a defect. A `todo` recorded
 * in the data is carried here for the same reason.
 */
export type RegistryNote = RegistryIssue;

/** One generated artifact pair. */
export interface DigestPair {
  /** The exact bytes of the canonical JSON file, with no trailing newline. */
  readonly canonicalJson: string;
  /** The `sha256:<hex>` line of the digest file. */
  readonly digest: string;
}

/**
 * The generated artifacts that `pnpm specs:canonicalise` writes.
 *
 * There are two, and the split is the point. ADR-0008 makes the ruleset the
 * executable authority and says the snapshot "is never read at scan time", so
 * a digest over the snapshot can no longer identify what produced a verdict.
 * `ruleset` is the digest a report carries; `snapshot` is the seal that proves
 * the frozen file was not edited. The source ledger has no digest: ADR-0007
 * puts `sourceLedgerVersion` in the report, and a version a human increments
 * is what a citation needs to be reproducible.
 */
export interface CanonicalArtifacts {
  readonly snapshot: DigestPair;
  readonly ruleset: DigestPair;
}

export interface RegistryValidationInput {
  readonly snapshotYaml: string;
  readonly snapshotSchemaJson: string;
  readonly ledgerYaml: string;
  readonly ledgerSchemaJson: string;
  readonly rulesetYaml: string;
  readonly rulesetSchemaJson: string;
  /**
   * The committed generated artifacts, when they should be checked for
   * currency. `null` skips the currency check, which is what
   * `pnpm specs:canonicalise` does on its way to rewriting them.
   */
  readonly committed: CanonicalArtifacts | null;
}

export interface RegistryValidationResult {
  readonly issues: readonly RegistryIssue[];
  readonly notes: readonly RegistryNote[];
  /** `null` when a document could not be projected far enough to canonicalize. */
  readonly artifacts: CanonicalArtifacts | null;
}

// ---------------------------------------------------------------------------
// Narrowing helpers
//
// Schema validation runs first, but its violations are collected rather than
// thrown, so the semantic checks below may still be handed a malformed tree.
// These helpers let them skip what they cannot read instead of crashing on it,
// which is what lets one run report every problem in the file.
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? (value as readonly unknown[]) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** RFC 6901 section 3, prefixed with the file the pointer is into. */
function at(file: string, ...tokens: readonly (string | number)[]): string {
  const path = tokens
    .map((token) =>
      typeof token === "number"
        ? String(token)
        : token.replaceAll("~", "~0").replaceAll("/", "~1"),
    )
    .map((token) => `/${token}`)
    .join("");
  return path === "" ? file : `${file}#${path}`;
}

// ---------------------------------------------------------------------------
// Date and URL checks that the schema does not actually make
// ---------------------------------------------------------------------------

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const DAYS_IN_MONTH: readonly number[] = [
  31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
];

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * True when `text` is a real day on the proleptic Gregorian calendar.
 *
 * Written out rather than delegated to `Date`, because `new Date("2026-02-30")`
 * quietly becomes 2 March and `Date.UTC(99, ...)` quietly becomes 1999. A
 * validator whose calendar silently rounds is not a calendar check.
 */
function isRealCalendarDate(text: string): boolean {
  if (!DATE_PATTERN.test(text)) return false;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(5, 7));
  const day = Number(text.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) return false;
  const limit =
    month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
  return day <= limit;
}

interface DateCheckContext {
  readonly issues: RegistryIssue[];
  /**
   * The declared ceiling this file's dates may not exceed, or `null` when the
   * date being checked is the ceiling itself and comparing it would be a
   * tautology. Named so the message says which clock rejected the date.
   */
  readonly ceiling: { readonly label: string; readonly value: string } | null;
}

/**
 * `specs/rule.schema.json` writes `"format": "date"`, which under Draft
 * 2020-12 is an annotation and not an assertion unless the format-assertion
 * vocabulary is declared, which it is not. Whether a given library asserts it
 * anyway is a property of that library, not of the contract. And no `format`
 * catches a date that is real, well formed, and in the future.
 */
function checkDate(
  value: unknown,
  location: string,
  context: DateCheckContext,
): void {
  const text = asString(value);
  if (text === null) return; // already a schema violation

  if (!DATE_PATTERN.test(text)) {
    context.issues.push({
      code: "malformed-date",
      location,
      message: `"${text}" is not a YYYY-MM-DD date`,
    });
    return;
  }

  if (!isRealCalendarDate(text)) {
    context.issues.push({
      code: "impossible-date",
      location,
      message: `"${text}" is not a real calendar date`,
    });
    return;
  }

  // ISO 8601 extended dates sort correctly as strings, so no clock is needed
  // and none is wanted: a test whose result depends on the day it runs is not
  // a test (docs/TEST_STRATEGY.md section 2.1).
  if (context.ceiling !== null && text > context.ceiling.value) {
    context.issues.push({
      code: "future-date",
      location,
      message: `"${text}" is after the ${context.ceiling.label} ${context.ceiling.value}`,
    });
  }
}

function checkUrl(
  value: unknown,
  location: string,
  sourceId: string | null,
  issues: RegistryIssue[],
): void {
  const text = asString(value);
  if (text === null) return; // already a schema violation

  const url = URL.parse(text);
  if (url === null) {
    issues.push({
      code: "unparsable-url",
      location,
      message: `"${text}" is not an absolute URL`,
    });
    return;
  }

  if (url.protocol === "https:") return;

  if (
    url.protocol === "http:" &&
    sourceId !== null &&
    HTTP_SOURCE_ID_ALLOWLIST.includes(sourceId)
  ) {
    return;
  }

  issues.push({
    code: "insecure-url",
    location,
    message: `"${text}" uses ${url.protocol} and is not in HTTP_SOURCE_ID_ALLOWLIST`,
  });
}

// ---------------------------------------------------------------------------
// Uniqueness
// ---------------------------------------------------------------------------

interface Entry {
  readonly value: string;
  readonly location: string;
}

function checkUnique(
  entries: readonly Entry[],
  code: string,
  what: string,
  issues: RegistryIssue[],
): void {
  const firstSeen = new Map<string, string>();
  for (const entry of entries) {
    const previous = firstSeen.get(entry.value);
    if (previous === undefined) {
      firstSeen.set(entry.value, entry.location);
      continue;
    }
    issues.push({
      code,
      location: entry.location,
      message: `${what} "${entry.value}" is already used at ${previous}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Document loading
// ---------------------------------------------------------------------------

interface LoadedDocument {
  readonly root: Record<string, unknown> | null;
  readonly fatal: boolean;
}

/**
 * Parses one document with duplicate-key rejection, bounds alias expansion,
 * and validates it against its schema. Every failure becomes an issue; nothing
 * throws, because this function's contract is that it reports problems and a
 * caller that has to catch for one input class will forget.
 */
function load(
  yamlText: string,
  schemaJson: string,
  file: string,
  issues: RegistryIssue[],
): LoadedDocument {
  // `uniqueKeys` is passed explicitly even though it already defaults to true.
  // A default that satisfies a security requirement should be written at the
  // place the requirement is enforced, or the requirement survives only as
  // long as nobody upstream changes their mind. `prettyErrors` adds the
  // line/column pointer that makes a long file navigable.
  const document = parseDocument(yamlText, {
    uniqueKeys: true,
    prettyErrors: true,
  });

  // Warnings are fatal as well as errors. `yaml` reports things like an
  // unsupported tag as a warning, and a file the parser did not fully
  // understand is not one this project may act on.
  let parseFailed = false;
  for (const problem of [...document.errors, ...document.warnings]) {
    parseFailed = true;
    const line = problem.linePos?.[0];
    issues.push({
      code:
        problem.name === "YAMLWarning" ? "yaml-warning" : "yaml-parse-error",
      location:
        line === undefined
          ? file
          : `${file}#line ${String(line.line)}:${String(line.col)}`,
      message: `${problem.code}: ${problem.message}`,
    });
  }
  // A tree the parser rejected cannot be meaningfully schema-checked, and
  // every downstream message would be noise about the same defect.
  if (parseFailed) return { root: null, fatal: true };

  // `maxAliasCount` bounds YAML alias expansion, which is the billion laughs
  // amplification vector. 100 is the library default, stated here for the same
  // reason as `uniqueKeys`.
  let data: unknown;
  try {
    data = document.toJS({ maxAliasCount: 100 });
  } catch (error) {
    issues.push({
      code: "yaml-expansion-failed",
      location: file,
      message: error instanceof Error ? error.message : String(error),
    });
    return { root: null, fatal: true };
  }

  let schema: unknown;
  try {
    schema = JSON.parse(schemaJson);
  } catch (error) {
    issues.push({
      code: "schema-unreadable",
      location: file,
      message: error instanceof Error ? error.message : String(error),
    });
    return { root: null, fatal: true };
  }

  for (const violation of validateAgainstSchema(data, schema)) {
    issues.push({
      code: "schema-violation",
      // `instanceLocation` is already a URI fragment, `#` and all.
      location: `${file}${violation.instanceLocation}`,
      message: `${violation.error} (${violation.keywordLocation})`,
    });
  }

  const root = asRecord(data);
  if (root === null) {
    issues.push({
      code: "not-a-mapping",
      location: file,
      message: `the root of ${file} is not a mapping`,
    });
    return { root: null, fatal: true };
  }

  return { root, fatal: false };
}

// ---------------------------------------------------------------------------
// The verdict-bearing projections
//
// `docs/IMPLEMENTATION_SPEC.md` section 13 requires a report to carry a ruleset
// digest, and ADR-0008 makes each artifact's identity separate. So each digest
// covers what can change a verdict in its own file and nothing else. Fixing a
// typo in a caveat must not invalidate every pinned report, or nobody will fix
// typos.
//
// Two things are deliberately excluded from both, and both absences are
// inherited from the pre-ADR-0008 projection rather than newly decided here:
//
// - a per-rule `modes` field. No schema defines one; a "modes" list could only
//   be derived, and `.claude/rules/standards.md` forbids inventing a field the
//   schema does not support.
// - array sorting. Element order is preserved exactly as the file has it.
//   Sorting `profiles`, `runtime` or `source_refs` would make the digest ignore
//   a cosmetic reorder, which is attractive, but it is a policy decision about
//   set-valued fields that no accepted decision has made yet.
//
// `interop` is excluded on the same precedent, and it is the weaker of the two
// exclusions: `interop.disposition` gates whether an interop action runs at
// all. It is named here so a later decision can move it in deliberately.
// ---------------------------------------------------------------------------

interface ProjectedCheck {
  readonly rule_id: string;
  readonly rule_version: string;
  readonly runtime: readonly unknown[];
  readonly profiles: readonly unknown[];
  readonly applicability: Record<string, unknown>;
  readonly source_refs: readonly unknown[];
  readonly spec: { readonly requirements: readonly unknown[] };
}

interface ProjectedSnapshot {
  /** The snapshot's identity, now that `ruleset_id` has migrated out. */
  readonly captured_at: string;
  readonly checks: readonly ProjectedCheck[];
}

function projectSnapshot(
  root: Record<string, unknown>,
  issues: RegistryIssue[],
): ProjectedSnapshot | null {
  const snapshot = asRecord(root["snapshot"]);
  const capturedAt =
    snapshot === null ? null : asString(snapshot["captured_at"]);
  const checks = asArray(root["checks"]);

  if (capturedAt === null || checks === null) {
    issues.push({
      code: "projection-failed",
      location: SNAPSHOT_FILE,
      message:
        "snapshot.captured_at and checks are required to build the canonical projection",
    });
    return null;
  }

  const projected: ProjectedCheck[] = [];
  for (const [index, raw] of checks.entries()) {
    const check = asRecord(raw);
    const ruleId = check === null ? null : asString(check["rule_id"]);
    const ruleVersion = check === null ? null : asString(check["rule_version"]);
    const runtime = check === null ? null : asArray(check["runtime"]);
    const profiles = check === null ? null : asArray(check["profiles"]);
    const applicability =
      check === null ? null : asRecord(check["applicability"]);
    const sourceRefs = check === null ? null : asArray(check["source_refs"]);
    const spec = check === null ? null : asRecord(check["spec"]);
    const requirements = spec === null ? null : asArray(spec["requirements"]);

    if (
      ruleId === null ||
      ruleVersion === null ||
      runtime === null ||
      profiles === null ||
      applicability === null ||
      sourceRefs === null ||
      requirements === null
    ) {
      issues.push({
        code: "projection-failed",
        location: at(SNAPSHOT_FILE, "checks", index),
        message:
          "check is missing a field the canonical projection covers, so no digest can be produced",
      });
      return null;
    }

    projected.push({
      rule_id: ruleId,
      rule_version: ruleVersion,
      runtime,
      profiles,
      applicability,
      source_refs: sourceRefs,
      spec: { requirements },
    });
  }

  return { captured_at: capturedAt, checks: projected };
}

interface ProjectedRule {
  readonly rule_id: string;
  readonly rule_version: string;
  readonly implementation_status: string;
  readonly runtime: readonly unknown[];
  readonly profiles: readonly unknown[];
  readonly applicability: Record<string, unknown>;
  readonly source_refs: readonly unknown[];
  readonly spec: {
    readonly claim_scope: string;
    readonly requirements: readonly unknown[];
  };
  readonly compat_assertions: readonly unknown[];
  readonly retired_requirements: readonly unknown[];
}

interface ProjectedRuleset {
  readonly ruleset_id: string;
  readonly ruleset_version: string;
  readonly source_ledger_version: string;
  readonly rules: readonly ProjectedRule[];
}

function projectRuleset(
  root: Record<string, unknown>,
  issues: RegistryIssue[],
): ProjectedRuleset | null {
  const rulesetId = asString(root["ruleset_id"]);
  const rulesetVersion = asString(root["ruleset_version"]);
  const ledgerVersion = asString(root["source_ledger_version"]);
  const rules = asArray(root["rules"]);

  if (
    rulesetId === null ||
    rulesetVersion === null ||
    ledgerVersion === null ||
    rules === null
  ) {
    issues.push({
      code: "projection-failed",
      location: RULESET_FILE,
      message:
        "ruleset_id, ruleset_version, source_ledger_version and rules are required to build the canonical projection",
    });
    return null;
  }

  const projected: ProjectedRule[] = [];
  for (const [index, raw] of rules.entries()) {
    const rule = asRecord(raw);
    const ruleId = rule === null ? null : asString(rule["rule_id"]);
    const ruleVersion = rule === null ? null : asString(rule["rule_version"]);
    const status =
      rule === null ? null : asString(rule["implementation_status"]);
    const runtime = rule === null ? null : asArray(rule["runtime"]);
    const profiles = rule === null ? null : asArray(rule["profiles"]);
    const applicability =
      rule === null ? null : asRecord(rule["applicability"]);
    const sourceRefs = rule === null ? null : asArray(rule["source_refs"]);
    const spec = rule === null ? null : asRecord(rule["spec"]);
    const claimScope = spec === null ? null : asString(spec["claim_scope"]);
    const requirements = spec === null ? null : asArray(spec["requirements"]);

    if (
      rule === null ||
      ruleId === null ||
      ruleVersion === null ||
      status === null ||
      runtime === null ||
      profiles === null ||
      applicability === null ||
      sourceRefs === null ||
      claimScope === null ||
      requirements === null
    ) {
      issues.push({
        code: "projection-failed",
        location: at(RULESET_FILE, "rules", index),
        message:
          "rule is missing a field the canonical projection covers, so no digest can be produced",
      });
      return null;
    }

    projected.push({
      rule_id: ruleId,
      rule_version: ruleVersion,
      implementation_status: status,
      runtime,
      profiles,
      applicability,
      source_refs: sourceRefs,
      spec: { claim_scope: claimScope, requirements },
      compat_assertions: asArray(rule["compat_assertions"]) ?? [],
      retired_requirements: asArray(rule["retired_requirements"]) ?? [],
    });
  }

  return {
    ruleset_id: rulesetId,
    ruleset_version: rulesetVersion,
    source_ledger_version: ledgerVersion,
    rules: projected,
  };
}

async function seal(
  projection: unknown,
  file: string,
  issues: RegistryIssue[],
): Promise<DigestPair | null> {
  let canonicalJson: string;
  try {
    canonicalJson = canonicalizeJson(projection);
  } catch (error) {
    issues.push({
      code: "canonicalization-failed",
      location: file,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  return {
    canonicalJson,
    digest: formatDigest(await sha256HexOfUtf8(canonicalJson)),
  };
}

// ---------------------------------------------------------------------------
// Per-document semantic checks
// ---------------------------------------------------------------------------

interface Ledger {
  readonly ids: ReadonlySet<string>;
  readonly version: string | null;
  /** Ledger index into `sources`, for the orphan report. */
  readonly indexById: ReadonlyMap<string, number>;
  /**
   * Each source's declared `kind`. ADR-0010 section 3's prohibitions are the
   * only reason this is carried: they turn on whether a cited source is
   * `project-policy`, which is a fact about the ledger that the ruleset's own
   * schema cannot see.
   */
  readonly kindById: ReadonlyMap<string, string>;
  /** Every identifier either other file cited, resolved or not. */
  readonly referenced: Set<string>;
}

/** ADR-0010 section 1. The `kind` a self-authored source carries. */
const PROJECT_POLICY_KIND = "project-policy";

function checkLedger(
  root: Record<string, unknown>,
  issues: RegistryIssue[],
  notes: RegistryNote[],
): Ledger {
  const sources = asArray(root["sources"]) ?? [];
  const ids = new Set<string>();
  const indexById = new Map<string, number>();
  const kindById = new Map<string, string>();
  const idEntries: Entry[] = [];

  collectTodos(root, LEDGER_FILE, [], notes);

  // The ledger's own declared clock. It is checked for shape against no
  // ceiling, for the same reason `snapshot.captured_at` is: a value cannot be
  // after itself.
  const ledgerDateLocation = at(LEDGER_FILE, "ledger_date");
  checkDate(root["ledger_date"], ledgerDateLocation, { issues, ceiling: null });
  const declaredLedgerDate = asString(root["ledger_date"]);
  const ledgerDate =
    declaredLedgerDate !== null && isRealCalendarDate(declaredLedgerDate)
      ? declaredLedgerDate
      : null;
  const dateContext: DateCheckContext = {
    issues,
    ceiling:
      ledgerDate === null ? null : { label: "ledger date", value: ledgerDate },
  };
  let newestVerification: {
    readonly date: string;
    readonly id: string;
  } | null = null;

  for (const [index, raw] of sources.entries()) {
    const source = asRecord(raw);
    if (source === null) continue;
    const id = asString(source["id"]);
    if (id !== null) {
      ids.add(id);
      if (!indexById.has(id)) indexById.set(id, index);
      const kind = asString(source["kind"]);
      if (kind !== null && !kindById.has(id)) kindById.set(id, kind);
      idEntries.push({
        value: id,
        location: at(LEDGER_FILE, "sources", index, "id"),
      });
    }
    checkDate(
      source["verified_at"],
      at(LEDGER_FILE, "sources", index, "verified_at"),
      dateContext,
    );
    const verifiedAt = asString(source["verified_at"]);
    if (
      verifiedAt !== null &&
      isRealCalendarDate(verifiedAt) &&
      (newestVerification === null || verifiedAt > newestVerification.date)
    ) {
      newestVerification = { date: verifiedAt, id: id ?? String(index) };
    }
    checkUrl(
      source["url"],
      at(LEDGER_FILE, "sources", index, "url"),
      id,
      issues,
    );
    collectTodos(source, LEDGER_FILE, ["sources", index], notes);
  }

  checkUnique(idEntries, "duplicate-source-id", "source id", issues);

  // The same inconsistency the per-entry check reports, named from the end a
  // maintainer usually got wrong. A ceiling below the newest verification
  // makes every entry above it look like the defect; this points at the one
  // field that is actually stale. It is not an anti-laundering check and
  // cannot be one: with no clock there is no upper bound on `ledger_date`.
  // What keeps the ceiling honest is that raising it is a declared edit to a
  // reviewed line rather than a silent widening.
  if (
    ledgerDate !== null &&
    newestVerification !== null &&
    newestVerification.date > ledgerDate
  ) {
    issues.push({
      code: "ledger-date-before-verification",
      location: ledgerDateLocation,
      message: `ledger_date ${ledgerDate} is earlier than "${newestVerification.id}" verified_at ${newestVerification.date}`,
    });
  }

  return {
    ids,
    version: asString(root["source_ledger_version"]),
    indexById,
    kindById,
    referenced: new Set<string>(),
  };
}

/** One snapshot check, reduced to what the joins need. */
interface SnapshotCheck {
  readonly index: number;
  readonly ruleVersion: string | null;
  /** Requirement id to its text, in file order. */
  readonly requirements: ReadonlyMap<string, string>;
}

function checkSnapshot(
  root: Record<string, unknown>,
  ledger: Ledger,
  issues: RegistryIssue[],
): ReadonlyMap<string, SnapshotCheck> {
  const checks = asArray(root["checks"]) ?? [];
  const byRuleId = new Map<string, SnapshotCheck>();

  if (checks.length !== REQUIRED_CHECK_COUNT) {
    issues.push({
      code: "unexpected-check-count",
      location: at(SNAPSHOT_FILE, "checks"),
      message: `expected exactly ${String(REQUIRED_CHECK_COUNT)} checks, found ${String(checks.length)}`,
    });
  }

  const checkIdEntries: Entry[] = [];
  const ruleIdEntries: Entry[] = [];
  const ordinalEntries: Entry[] = [];
  const requirementIdEntries: Entry[] = [];
  // Paired with the index of the check they came from, so that a check with a
  // missing or non-numeric ordinal (already a schema violation) cannot shift
  // every later pointer by one and send a maintainer to the wrong line.
  const ordinals: { readonly value: number; readonly checkIndex: number }[] =
    [];

  for (const [index, raw] of checks.entries()) {
    const check = asRecord(raw);
    if (check === null) continue;

    const id = asString(check["id"]);
    if (id !== null) {
      checkIdEntries.push({
        value: id,
        location: at(SNAPSHOT_FILE, "checks", index, "id"),
      });
    }

    const ruleId = asString(check["rule_id"]);
    if (ruleId !== null) {
      ruleIdEntries.push({
        value: ruleId,
        location: at(SNAPSHOT_FILE, "checks", index, "rule_id"),
      });
    }

    const ordinal = check["ordinal"];
    if (typeof ordinal === "number") {
      ordinals.push({ value: ordinal, checkIndex: index });
      ordinalEntries.push({
        value: String(ordinal),
        location: at(SNAPSHOT_FILE, "checks", index, "ordinal"),
      });
    }

    checkSourceRefStrings(
      check["source_refs"],
      SNAPSHOT_FILE,
      ["checks", index],
      ledger,
      issues,
    );

    const spec = asRecord(check["spec"]);
    const requirements = new Map<string, string>();
    for (const [reqIndex, rawRequirement] of (spec === null
      ? []
      : (asArray(spec["requirements"]) ?? [])
    ).entries()) {
      const requirement = asRecord(rawRequirement);
      if (requirement === null) continue;
      const requirementId = asString(requirement["id"]);
      if (requirementId === null) continue;
      requirements.set(requirementId, asString(requirement["text"]) ?? "");
      requirementIdEntries.push({
        value: requirementId,
        location: at(
          SNAPSHOT_FILE,
          "checks",
          index,
          "spec",
          "requirements",
          reqIndex,
          "id",
        ),
      });
    }

    if (ruleId !== null && !byRuleId.has(ruleId)) {
      byRuleId.set(ruleId, {
        index,
        ruleVersion: asString(check["rule_version"]),
        requirements,
      });
    }
  }

  checkUnique(checkIdEntries, "duplicate-check-id", "check id", issues);
  checkUnique(ruleIdEntries, "duplicate-rule-id", "rule_id", issues);
  checkUnique(ordinalEntries, "duplicate-ordinal", "ordinal", issues);
  // Assertion ids are public API: they appear in findings, in fixtures and in
  // `--include` selectors. Two rules owning the same one would make a finding
  // ambiguous about which rule produced it, so the namespace is global and not
  // per check.
  checkUnique(
    requirementIdEntries,
    "duplicate-requirement-id",
    "requirement id",
    issues,
  );

  // Ordinals are contiguous 1..N and already in ascending order in the file.
  // ADR-0005 section 2 makes registry order the order in which request budget
  // is reserved, so "the file's order" and "the ordinal order" being the same
  // thing is load-bearing, not cosmetic.
  for (let index = 1; index < ordinals.length; index += 1) {
    const previous = ordinals[index - 1];
    const current = ordinals[index];
    if (previous === undefined || current === undefined) continue;
    if (current.value <= previous.value) {
      issues.push({
        code: "ordinal-not-ascending",
        location: at(SNAPSHOT_FILE, "checks", current.checkIndex, "ordinal"),
        message: `ordinal ${String(current.value)} does not follow ${String(previous.value)} in ascending order`,
      });
    }
  }
  for (const [index, ordinal] of ordinals.entries()) {
    if (ordinal.value !== index + 1) {
      issues.push({
        code: "ordinal-not-contiguous",
        location: at(SNAPSHOT_FILE, "checks", ordinal.checkIndex, "ordinal"),
        message: `expected ordinal ${String(index + 1)}, found ${String(ordinal.value)}`,
      });
    }
  }

  return byRuleId;
}

/** A `source_refs: ["a", "b"]` list of bare ledger identifiers. */
function checkSourceRefStrings(
  value: unknown,
  file: string,
  path: readonly (string | number)[],
  ledger: Ledger,
  issues: RegistryIssue[],
): void {
  for (const [index, raw] of (asArray(value) ?? []).entries()) {
    const ref = asString(raw);
    if (ref === null) continue;
    ledger.referenced.add(ref);
    if (ledger.ids.has(ref)) continue;
    issues.push({
      code: "unresolved-source-ref",
      location: at(file, ...path, "source_refs", index),
      message: `source_refs entry "${ref}" resolves to no source in ${LEDGER_FILE}`,
    });
  }
}

/** A `source_refs: [{ source, section? }]` list of ledger citations. */
function checkSourceRefObjects(
  value: unknown,
  path: readonly (string | number)[],
  ledger: Ledger,
  issues: RegistryIssue[],
): void {
  for (const [index, raw] of (asArray(value) ?? []).entries()) {
    const ref = asRecord(raw);
    const id = ref === null ? null : asString(ref["source"]);
    if (id === null) continue;
    ledger.referenced.add(id);
    if (ledger.ids.has(id)) continue;
    issues.push({
      code: "unresolved-source-ref",
      location: at(RULESET_FILE, ...path, "source_refs", index, "source"),
      message: `source "${id}" resolves to no source in ${LEDGER_FILE}`,
    });
  }
}

function collectTodos(
  node: Record<string, unknown>,
  file: string,
  path: readonly (string | number)[],
  notes: RegistryNote[],
): void {
  for (const [index, raw] of (asArray(node["todo"]) ?? []).entries()) {
    const text = asString(raw);
    if (text === null) continue;
    notes.push({
      code: "open-todo",
      location: at(file, ...path, "todo", index),
      message: text,
    });
  }
}

// ---------------------------------------------------------------------------
// The ruleset, and its joins with the other two files
// ---------------------------------------------------------------------------

function checkRuleset(
  root: Record<string, unknown>,
  ledger: Ledger,
  snapshotChecks: ReadonlyMap<string, SnapshotCheck>,
  issues: RegistryIssue[],
  notes: RegistryNote[],
): void {
  collectTodos(root, RULESET_FILE, [], notes);

  const declaredLedgerVersion = asString(root["source_ledger_version"]);
  if (
    declaredLedgerVersion !== null &&
    ledger.version !== null &&
    declaredLedgerVersion !== ledger.version
  ) {
    issues.push({
      code: "source-ledger-version-mismatch",
      location: at(RULESET_FILE, "source_ledger_version"),
      message: `the ruleset draws sources from ${declaredLedgerVersion} but ${LEDGER_FILE} is ${ledger.version}`,
    });
  }

  const rules = asArray(root["rules"]) ?? [];
  const ruleIdEntries: Entry[] = [];
  const assertionIdEntries: Entry[] = [];

  for (const [index, raw] of rules.entries()) {
    const rule = asRecord(raw);
    if (rule === null) continue;
    const path: readonly (string | number)[] = ["rules", index];

    collectTodos(rule, RULESET_FILE, path, notes);

    const ruleId = asString(rule["rule_id"]);
    if (ruleId !== null) {
      ruleIdEntries.push({
        value: ruleId,
        location: at(RULESET_FILE, ...path, "rule_id"),
      });
    }

    // ADR-0008 section 2: the ruleset manifest has no compat pass heuristic,
    // no ordinal, and no camelCase external id.
    for (const key of FORBIDDEN_RULE_KEYS) {
      if (!(key in rule)) continue;
      issues.push({
        code: "forbidden-ruleset-field",
        location: at(RULESET_FILE, ...path, key),
        message: `a ruleset rule may not carry "${key}"; that belongs to ${SNAPSHOT_FILE}`,
      });
    }

    checkSourceRefStrings(
      rule["source_refs"],
      RULESET_FILE,
      path,
      ledger,
      issues,
    );

    const spec = asRecord(rule["spec"]);
    const declared = new Map<string, string>();
    const requirements =
      spec === null ? [] : (asArray(spec["requirements"]) ?? []);
    for (const [reqIndex, rawRequirement] of requirements.entries()) {
      const assertionPath = [...path, "spec", "requirements", reqIndex];
      const id = checkAssertion(
        rawRequirement,
        assertionPath,
        ledger,
        issues,
        notes,
      );
      if (id === null) continue;
      const requirement = asRecord(rawRequirement);
      declared.set(id, asString(requirement?.["text"]) ?? "");
      assertionIdEntries.push({
        value: id,
        location: at(RULESET_FILE, ...assertionPath, "id"),
      });
    }

    for (const [compatIndex, rawCompat] of (
      asArray(rule["compat_assertions"]) ?? []
    ).entries()) {
      const assertionPath = [...path, "compat_assertions", compatIndex];
      const id = checkAssertion(
        rawCompat,
        assertionPath,
        ledger,
        issues,
        notes,
      );
      if (id === null) continue;
      assertionIdEntries.push({
        value: id,
        location: at(RULESET_FILE, ...assertionPath, "id"),
      });
    }

    if (ruleId === null) continue;
    const published = snapshotChecks.get(ruleId);
    checkRetirements(rule, path, published, declared, issues, notes);
    if (published === undefined) continue;
    reportDeltas(rule, path, published, declared, issues, notes);
  }

  checkUnique(ruleIdEntries, "duplicate-rule-id", "rule_id", issues);
  // The same global namespace the snapshot's requirement ids live in: an
  // assertion id is public API and a finding must name exactly one rule.
  checkUnique(
    assertionIdEntries,
    "duplicate-assertion-id",
    "assertion id",
    issues,
  );
}

/**
 * Validates one assertion declaration and returns its id.
 *
 * ADR-0002 section 6 makes the parameter schema a per-assertion contract that a
 * rule cannot widen, so its well-formedness is checked here rather than at the
 * point a rule reports an outcome.
 */
function checkAssertion(
  raw: unknown,
  path: readonly (string | number)[],
  ledger: Ledger,
  issues: RegistryIssue[],
  notes: RegistryNote[],
): string | null {
  const assertion = asRecord(raw);
  if (assertion === null) return null;

  collectTodos(assertion, RULESET_FILE, path, notes);
  checkSourceRefObjects(assertion["source_refs"], path, ledger, issues);

  const id = asString(assertion["id"]);
  const label = id ?? "(unnamed assertion)";

  const deferred = asRecord(assertion["deferred"]);

  // An assertion with no citation is permitted only where the data says so.
  // ADR-0002 section 6 requires the citations; ADR-0010 section 4 adds the
  // second permitted state. "Not decided" carries a todo, "not evaluated"
  // carries a deferral, and "dropped" is neither: the difference has to be
  // written down or it is not a difference.
  const refs = asArray(assertion["source_refs"]) ?? [];
  const todos = asArray(assertion["todo"]) ?? [];
  if (refs.length === 0 && todos.length === 0 && deferred === null) {
    issues.push({
      code: "uncited-assertion",
      location: at(RULESET_FILE, ...path, "source_refs"),
      message: `${label} cites no source, records no todo saying why, and carries no deferred marker`,
    });
  }

  if (deferred !== null) {
    checkDeferral(deferred, assertion, label, path, issues, notes);
  }
  checkProjectPolicyCitations(assertion, label, path, ledger, issues);

  const excerptAuthorized = assertion["excerpt_authorized"] === true;
  const nameEntries: Entry[] = [];
  for (const [paramIndex, rawParam] of (
    asArray(assertion["params"]) ?? []
  ).entries()) {
    const param = asRecord(rawParam);
    if (param === null) continue;
    const name = asString(param["name"]);
    if (name !== null) {
      nameEntries.push({
        value: name,
        location: at(RULESET_FILE, ...path, "params", paramIndex, "name"),
      });
    }
    if (asString(param["kind"]) === "excerpt" && !excerptAuthorized) {
      issues.push({
        code: "unauthorized-excerpt",
        location: at(RULESET_FILE, ...path, "params", paramIndex, "kind"),
        message: `${label} declares an excerpt parameter but excerpt_authorized is false`,
      });
    }
  }
  checkUnique(
    nameEntries,
    "duplicate-parameter-name",
    `parameter name in ${label}`,
    issues,
  );

  return id;
}

/**
 * ADR-0010 section 4. A deferred assertion is complete, and it is inert.
 *
 * Complete: `adr`, `reason` and `until` are all required, on the reasoning
 * ADR-0008 section 2 uses for `retired_requirements`. A deferral with no
 * decision behind it is the silent pass the marker exists to prevent, and one
 * with no `until` never comes back.
 *
 * Inert: no `source_refs`, no `params`, no excerpt authorization. An assertion
 * that is not evaluated makes no claim, so a citation on it would be a claim
 * resting on a source, and a parameter or an excerpt would be a template slot
 * for a message that can never render. The schema says the same thing in an
 * `if`/`then`, and it is repeated here for the reason every other duplicated
 * constraint in this file is: the schema is one edit away.
 *
 * The deferral is also listed as a note, so `pnpm specs:validate` prints every
 * one of them on a clean run rather than leaving them to be discovered by
 * reading the YAML.
 */
function checkDeferral(
  deferred: Record<string, unknown>,
  assertion: Record<string, unknown>,
  label: string,
  path: readonly (string | number)[],
  issues: RegistryIssue[],
  notes: RegistryNote[],
): void {
  for (const field of ["adr", "reason", "until"] as const) {
    const value = asString(deferred[field]);
    if (value !== null && value.trim() !== "") continue;
    issues.push({
      code: "deferred-marker-incomplete",
      location: at(RULESET_FILE, ...path, "deferred", field),
      message: `${label} is deferred and states no ${field}`,
    });
  }

  const inert: readonly (readonly [string, boolean])[] = [
    ["source_refs", (asArray(assertion["source_refs"]) ?? []).length > 0],
    ["params", (asArray(assertion["params"]) ?? []).length > 0],
    ["excerpt_authorized", assertion["excerpt_authorized"] === true],
  ];
  for (const [field, carried] of inert) {
    if (!carried) continue;
    issues.push({
      code: "deferred-assertion-not-inert",
      location: at(RULESET_FILE, ...path, field),
      message: `${label} is deferred and is never evaluated, so it may not carry ${field}`,
    });
  }

  const adr = asString(deferred["adr"]) ?? "an unnamed decision";
  const until = asString(deferred["until"]) ?? "(no condition stated)";
  notes.push({
    code: "deferred-assertion",
    location: at(RULESET_FILE, ...path, "deferred"),
    message: `${label} is deferred by ${adr} until: ${until}`,
  });
}

/**
 * ADR-0010 section 3, prohibitions 1 and 2, which the JSON Schema cannot
 * express because both need the ledger and the ruleset read together.
 *
 * 1. No `normative` assertion cites a project-policy source. `normative` is
 *    the only strength that maps a `violated` outcome to `fail`, and no `fail`
 *    may rest on this project's own opinion about what is worth doing.
 * 2. No assertion mixes a project-policy source with an external one. ADR-0002
 *    section 6 copies `source_refs` into a finding wholesale, so a mixed list
 *    renders as one authority list and a reader takes the RFC beside it as
 *    endorsement. A rule needing both needs two assertions.
 *
 * Both bind at **assertion** level and neither binds at rule level. A rule's
 * own `source_refs` is an inventory of what the rule rests on and is never
 * what a finding cites, which is why `web.discovery.link` may list `rfc8288`
 * and the relation policy together and this function is not called for it.
 */
function checkProjectPolicyCitations(
  assertion: Record<string, unknown>,
  label: string,
  path: readonly (string | number)[],
  ledger: Ledger,
  issues: RegistryIssue[],
): void {
  const policy: string[] = [];
  const external: string[] = [];
  for (const raw of asArray(assertion["source_refs"]) ?? []) {
    const id = asString(asRecord(raw)?.["source"]);
    // An unresolved id is already reported by `checkSourceRefObjects`, and
    // guessing a kind for it would turn one error into two.
    if (id === null || !ledger.ids.has(id)) continue;
    if (ledger.kindById.get(id) === PROJECT_POLICY_KIND) policy.push(id);
    else external.push(id);
  }
  if (policy.length === 0) return;

  if (asString(assertion["strength"]) === "normative") {
    issues.push({
      code: "project-policy-normative-citation",
      location: at(RULESET_FILE, ...path, "strength"),
      message: `${label} is normative and cites the project-policy source "${policy[0] ?? ""}"; ADR-0010 section 3 forbids a fail resting on this project's own policy`,
    });
  }
  if (external.length > 0) {
    issues.push({
      code: "project-policy-source-mixed",
      location: at(RULESET_FILE, ...path, "source_refs"),
      message: `${label} cites the project-policy source "${policy[0] ?? ""}" alongside "${external[0] ?? ""}"; ADR-0002 section 6 copies this list into a finding, where a mixed list reads as external endorsement`,
    });
  }
}

/**
 * ADR-0008 section 2: the ruleset may add an assertion and it may retire one;
 * it may not quietly drop one the snapshot published. A retirement with no
 * `adr` is a validation failure.
 */
function checkRetirements(
  rule: Record<string, unknown>,
  path: readonly (string | number)[],
  published: SnapshotCheck | undefined,
  declared: ReadonlyMap<string, string>,
  issues: RegistryIssue[],
  notes: RegistryNote[],
): void {
  for (const [index, raw] of (
    asArray(rule["retired_requirements"]) ?? []
  ).entries()) {
    const retirement = asRecord(raw);
    if (retirement === null) continue;
    const retiredPath = [...path, "retired_requirements", index];
    const id = asString(retirement["id"]);
    const adr = asString(retirement["adr"]);
    const reason = asString(retirement["reason"]);
    const label = id ?? "(unnamed)";

    if (adr === null || adr === "") {
      issues.push({
        code: "retirement-without-adr",
        location: at(RULESET_FILE, ...retiredPath),
        message: `retiring "${label}" needs the adr that retired it`,
      });
    }
    if (reason === null || reason === "") {
      issues.push({
        code: "retirement-without-reason",
        location: at(RULESET_FILE, ...retiredPath),
        message: `retiring "${label}" needs a reason`,
      });
    }
    if (id === null) continue;

    if (declared.has(id)) {
      issues.push({
        code: "retired-and-declared",
        location: at(RULESET_FILE, ...retiredPath, "id"),
        message: `"${id}" is retired and also declared by the same rule`,
      });
    }
    if (published !== undefined && !published.requirements.has(id)) {
      issues.push({
        code: "retirement-not-published",
        location: at(RULESET_FILE, ...retiredPath, "id"),
        message: `"${id}" is retired but ${SNAPSHOT_FILE} never published it for this rule`,
      });
    }
    if (adr !== null) {
      notes.push({
        code: "requirement-retired",
        location: at(RULESET_FILE, ...retiredPath, "id"),
        message: `"${id}" is retired by ${adr}`,
      });
    }
  }
}

/**
 * The superset check and the listed deltas of ADR-0008 sections 2 and 5.
 *
 * A dropped requirement is an error. An addition, a retirement, a changed
 * requirement text and a `rule_version` difference are all printed and none of
 * them is an error: the snapshot's `rule_version` is frozen metadata that may
 * lag the ruleset by any distance, which is the invariant the first revision of
 * ADR-0008 got wrong.
 */
function reportDeltas(
  rule: Record<string, unknown>,
  path: readonly (string | number)[],
  published: SnapshotCheck,
  declared: ReadonlyMap<string, string>,
  issues: RegistryIssue[],
  notes: RegistryNote[],
): void {
  const retired = new Set<string>();
  for (const raw of asArray(rule["retired_requirements"]) ?? []) {
    const id = asString(asRecord(raw)?.["id"]);
    if (id !== null) retired.add(id);
  }

  for (const [id, publishedText] of published.requirements) {
    if (retired.has(id)) continue;
    if (!declared.has(id)) {
      issues.push({
        code: "dropped-requirement",
        location: at(RULESET_FILE, ...path, "spec", "requirements"),
        message: `${SNAPSHOT_FILE} publishes "${id}" for this rule; the ruleset neither declares nor retires it`,
      });
      continue;
    }
    if (declared.get(id) !== publishedText) {
      notes.push({
        code: "requirement-text-changed",
        location: at(RULESET_FILE, ...path, "spec", "requirements"),
        message: `"${id}" reads differently in the ruleset than in the snapshot`,
      });
    }
  }

  for (const id of declared.keys()) {
    if (published.requirements.has(id)) continue;
    notes.push({
      code: "requirement-added",
      location: at(RULESET_FILE, ...path, "spec", "requirements"),
      message: `"${id}" is declared by the ruleset and was not published in the snapshot`,
    });
  }

  const rulesetVersion = asString(rule["rule_version"]);
  if (
    rulesetVersion !== null &&
    published.ruleVersion !== null &&
    rulesetVersion !== published.ruleVersion
  ) {
    notes.push({
      code: "rule-version-delta",
      location: at(RULESET_FILE, ...path, "rule_version"),
      message: `ruleset ${rulesetVersion}, snapshot ${published.ruleVersion}; the snapshot value is frozen metadata and is not an error`,
    });
  }
}

// ---------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------

export async function validateRegistry(
  input: RegistryValidationInput,
): Promise<RegistryValidationResult> {
  const issues: RegistryIssue[] = [];
  const notes: RegistryNote[] = [];

  const snapshotDoc = load(
    input.snapshotYaml,
    input.snapshotSchemaJson,
    SNAPSHOT_FILE,
    issues,
  );
  const ledgerDoc = load(
    input.ledgerYaml,
    input.ledgerSchemaJson,
    LEDGER_FILE,
    issues,
  );
  const rulesetDoc = load(
    input.rulesetYaml,
    input.rulesetSchemaJson,
    RULESET_FILE,
    issues,
  );

  if (
    snapshotDoc.root === null ||
    ledgerDoc.root === null ||
    rulesetDoc.root === null
  ) {
    return { issues, notes, artifacts: null };
  }

  // Each file's dates are bounded by that file's own declared ceiling
  // (docs/TEST_STRATEGY.md section 2.1 forbids a real clock in a test).
  // `snapshot.captured_at` bounds the snapshot; `ledger_date` bounds the
  // ledger, and `checkLedger` reads it, because a ledger entry verified after
  // the snapshot was captured is the ordinary case rather than an error.
  const snapshot = asRecord(snapshotDoc.root["snapshot"]);

  if (snapshot !== null) {
    checkDate(
      snapshot["captured_at"],
      at(SNAPSHOT_FILE, "snapshot", "captured_at"),
      {
        issues,
        // The snapshot date cannot be in the future relative to itself; comparing
        // it against itself would be a tautology, so only shape is checked here.
        ceiling: null,
      },
    );
    checkUrl(
      snapshot["compatibility_source"],
      at(SNAPSHOT_FILE, "snapshot", "compatibility_source"),
      null,
      issues,
    );
  }

  const ledger = checkLedger(ledgerDoc.root, issues, notes);
  const snapshotChecks = checkSnapshot(snapshotDoc.root, ledger, issues);
  checkRuleset(rulesetDoc.root, ledger, snapshotChecks, issues, notes);

  // An unreferenced source is dead provenance: it claims the ledger rests on
  // something neither file cites.
  for (const [id, index] of ledger.indexById) {
    if (ledger.referenced.has(id)) continue;
    issues.push({
      code: "orphan-source",
      location: at(LEDGER_FILE, "sources", index, "id"),
      message: `source "${id}" is referenced by no check and no rule`,
    });
  }

  const snapshotProjection = projectSnapshot(snapshotDoc.root, issues);
  const rulesetProjection = projectRuleset(rulesetDoc.root, issues);
  if (snapshotProjection === null || rulesetProjection === null) {
    return { issues, notes, artifacts: null };
  }

  const snapshotSeal = await seal(snapshotProjection, SNAPSHOT_FILE, issues);
  const rulesetSeal = await seal(rulesetProjection, RULESET_FILE, issues);
  if (snapshotSeal === null || rulesetSeal === null) {
    return { issues, notes, artifacts: null };
  }

  const artifacts: CanonicalArtifacts = {
    snapshot: snapshotSeal,
    ruleset: rulesetSeal,
  };

  if (input.committed !== null) {
    compareCommitted(
      input.committed.snapshot,
      artifacts.snapshot,
      "specs/checks.v0.canonical.json",
      "specs/checks.v0.digest.txt",
      issues,
    );
    compareCommitted(
      input.committed.ruleset,
      artifacts.ruleset,
      "specs/ruleset.standard.v0.canonical.json",
      "specs/ruleset.standard.v0.digest.txt",
      issues,
    );
  }

  return { issues, notes, artifacts };
}

function compareCommitted(
  committed: DigestPair,
  current: DigestPair,
  canonicalFile: string,
  digestFile: string,
  issues: RegistryIssue[],
): void {
  if (committed.canonicalJson !== current.canonicalJson) {
    issues.push({
      code: "stale-canonical-json",
      location: canonicalFile,
      message: `committed canonical JSON is not current; run pnpm specs:canonicalise`,
    });
  }
  if (committed.digest.trim() !== current.digest) {
    issues.push({
      code: "stale-digest",
      location: digestFile,
      message: `committed digest is ${committed.digest.trim()}, expected ${current.digest}`,
    });
  }
}
