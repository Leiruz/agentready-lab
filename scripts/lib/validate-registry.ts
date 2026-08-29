import { parseDocument } from "yaml";

import { canonicalizeJson } from "../../packages/core/src/schema/canonical-json.js";
import { validateAgainstSchema } from "../../packages/core/src/schema/json-schema.js";
import {
  formatDigest,
  sha256HexOfUtf8,
} from "../../packages/core/src/schema/sha256.js";

/**
 * The `specs/checks.v0.yaml` validator, as a pure function.
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
 * "today" that the date checks compare against is `snapshot.captured_at` from
 * the registry itself, so the result does not change overnight.
 */

// ---------------------------------------------------------------------------
// Policy constants
// ---------------------------------------------------------------------------

/**
 * `specs/README.md`: "exactly 22 compatibility checks are present". Asserted
 * here as well as in the schema, because `minItems`/`maxItems` are one edit
 * away from being relaxed and this file is where the requirement is written
 * down.
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

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

/**
 * One validation failure.
 *
 * `code` is stable and machine-readable. `location` is a JSON Pointer (RFC
 * 6901) into the parsed registry, except for the two cases where no parsed
 * document exists yet: a YAML error carries `line L:C`, and a staleness or
 * artifact issue carries the repository-relative path of the file it is about.
 */
export interface RegistryIssue {
  readonly code: string;
  readonly location: string;
  readonly message: string;
}

/** The generated artifacts that `pnpm specs:canonicalise` writes. */
export interface CanonicalArtifacts {
  /** The exact bytes of `specs/checks.v0.canonical.json`, with no trailing newline. */
  readonly canonicalJson: string;
  /** The `sha256:<hex>` line of `specs/checks.v0.digest.txt`. */
  readonly digest: string;
}

export interface RegistryValidationInput {
  readonly registryYaml: string;
  readonly schemaJson: string;
  /**
   * The committed generated artifacts, when they should be checked for
   * currency. `null` skips the currency check, which is what
   * `pnpm specs:canonicalise` does on its way to rewriting them.
   */
  readonly committed: CanonicalArtifacts | null;
}

export interface RegistryValidationResult {
  readonly issues: readonly RegistryIssue[];
  /** `null` when the registry could not be projected far enough to canonicalize. */
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

/** RFC 6901 section 3. */
function pointer(...tokens: readonly (string | number)[]): string {
  return tokens
    .map((token) =>
      typeof token === "number"
        ? String(token)
        : token.replaceAll("~", "~0").replaceAll("/", "~1"),
    )
    .map((token) => `/${token}`)
    .join("");
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
  /** `snapshot.captured_at`, or `null` when it is itself unusable. */
  readonly snapshotDate: string | null;
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
  if (context.snapshotDate !== null && text > context.snapshotDate) {
    context.issues.push({
      code: "future-date",
      location,
      message: `"${text}" is after the snapshot date ${context.snapshotDate}`,
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

function checkUnique(
  entries: readonly { readonly value: string; readonly location: string }[],
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
// The verdict-bearing projection
// ---------------------------------------------------------------------------

/**
 * The subset of the registry that the ruleset digest covers.
 *
 * `docs/IMPLEMENTATION_SPEC.md` section 13 requires a report to carry a
 * ruleset digest, and ADR-0008 makes the registry's identity separate from its
 * prose. So the digest covers what can change a verdict and nothing else:
 * `ruleset_id`, `ruleset_version`, and per check `rule_id`, `rule_version`,
 * `runtime`, `profiles`, `applicability`, `source_refs`, and
 * `spec.requirements`.
 *
 * Deliberately excluded: `title`, `compat` (a dated observation about someone
 * else's tool, not an assertion this project makes), `spec.deltas`,
 * `interop.caveats`, every source's `notes` and `verified_at`, and the whole
 * `sources` block. Fixing a typo in a caveat must not invalidate every pinned
 * report, or nobody will fix typos.
 *
 * Two things the brief's summary of this list asks for are not here, and both
 * absences are deliberate:
 *
 * - a per-check `modes` field. `specs/rule.schema.json` defines no such
 *   property. Every check carries `compat`, `spec` and `interop` blocks, so a
 *   "modes" list could only be derived, and `.claude/rules/standards.md`
 *   forbids inventing a field the schema does not support. If the registry
 *   gains one, it belongs in this projection.
 * - array sorting. Element order is preserved exactly as the file has it.
 *   Sorting `profiles`, `runtime` or `source_refs` would make the digest
 *   ignore a cosmetic reorder, which is attractive, but it is a policy
 *   decision about set-valued fields that no accepted decision has made yet.
 */
interface ProjectedCheck {
  readonly rule_id: string;
  readonly rule_version: string;
  readonly runtime: readonly unknown[];
  readonly profiles: readonly unknown[];
  readonly applicability: Record<string, unknown>;
  readonly source_refs: readonly unknown[];
  readonly spec: { readonly requirements: readonly unknown[] };
}

interface ProjectedRuleset {
  readonly ruleset_id: string;
  readonly ruleset_version: string;
  readonly checks: readonly ProjectedCheck[];
}

function project(
  root: Record<string, unknown>,
  issues: RegistryIssue[],
): ProjectedRuleset | null {
  const rulesetId = asString(root["ruleset_id"]);
  const rulesetVersion = asString(root["ruleset_version"]);
  const checks = asArray(root["checks"]);

  if (rulesetId === null || rulesetVersion === null || checks === null) {
    issues.push({
      code: "projection-failed",
      location: "",
      message:
        "ruleset_id, ruleset_version and checks are required to build the canonical projection",
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
        location: pointer("checks", index),
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

  return {
    ruleset_id: rulesetId,
    ruleset_version: rulesetVersion,
    checks: projected,
  };
}

// ---------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------

export async function validateRegistry(
  input: RegistryValidationInput,
): Promise<RegistryValidationResult> {
  const issues: RegistryIssue[] = [];

  // 1. Parse with duplicate-key rejection.
  //
  // `uniqueKeys` is passed explicitly even though it already defaults to true.
  // A default that satisfies a security requirement should be written at the
  // place the requirement is enforced, or the requirement survives only as
  // long as nobody upstream changes their mind. `prettyErrors` adds the
  // line/column pointer that makes a 1395-line file navigable.
  const document = parseDocument(input.registryYaml, {
    uniqueKeys: true,
    prettyErrors: true,
  });

  // Warnings are fatal as well as errors. `yaml` reports things like an
  // unsupported tag as a warning, and a registry the parser did not fully
  // understand is not a registry this project may act on.
  for (const problem of [...document.errors, ...document.warnings]) {
    const line = problem.linePos?.[0];
    issues.push({
      code:
        problem.name === "YAMLWarning" ? "yaml-warning" : "yaml-parse-error",
      location:
        line === undefined
          ? ""
          : `line ${String(line.line)}:${String(line.col)}`,
      message: `${problem.code}: ${problem.message}`,
    });
  }
  if (issues.length > 0) {
    // A tree the parser rejected cannot be meaningfully schema-checked, and
    // every downstream message would be noise about the same defect.
    return { issues, artifacts: null };
  }

  // `maxAliasCount` bounds YAML alias expansion, which is the billion laughs
  // amplification vector. 100 is the library default, stated here for the same
  // reason as `uniqueKeys`. Crossing it throws rather than returning, so it is
  // converted into an issue: this function's contract is that it reports
  // problems, and a caller that has to catch for one input class will forget.
  let data: unknown;
  try {
    data = document.toJS({ maxAliasCount: 100 });
  } catch (error) {
    issues.push({
      code: "yaml-expansion-failed",
      location: "",
      message: error instanceof Error ? error.message : String(error),
    });
    return { issues, artifacts: null };
  }

  // 2. JSON Schema Draft 2020-12, short-circuit off.
  let schema: unknown;
  try {
    schema = JSON.parse(input.schemaJson);
  } catch (error) {
    issues.push({
      code: "schema-unreadable",
      location: "",
      message: error instanceof Error ? error.message : String(error),
    });
    return { issues, artifacts: null };
  }

  for (const violation of validateAgainstSchema(data, schema)) {
    issues.push({
      code: "schema-violation",
      location: violation.instanceLocation,
      message: `${violation.error} (${violation.keywordLocation})`,
    });
  }

  const root = asRecord(data);
  if (root === null) {
    issues.push({
      code: "not-a-mapping",
      location: "",
      message: "the registry root is not a mapping",
    });
    return { issues, artifacts: null };
  }

  // 3 and 4. Semantic constraints and the format assertions the schema makes
  // only as annotations.
  const snapshot = asRecord(root["snapshot"]);
  const capturedAt =
    snapshot === null ? null : asString(snapshot["captured_at"]);
  const snapshotDate =
    capturedAt !== null && isRealCalendarDate(capturedAt) ? capturedAt : null;
  const dateContext: DateCheckContext = { issues, snapshotDate };

  if (snapshot !== null) {
    checkDate(snapshot["captured_at"], pointer("snapshot", "captured_at"), {
      issues,
      // The snapshot date cannot be in the future relative to itself; comparing
      // it against itself would be a tautology, so only shape is checked here.
      snapshotDate: null,
    });
    checkUrl(
      snapshot["compatibility_source"],
      pointer("snapshot", "compatibility_source"),
      null,
      issues,
    );
  }

  const sources = asArray(root["sources"]) ?? [];
  const sourceIds = new Set<string>();
  const sourceIdEntries: { value: string; location: string }[] = [];

  for (const [index, raw] of sources.entries()) {
    const source = asRecord(raw);
    if (source === null) continue;
    const id = asString(source["id"]);
    if (id !== null) {
      sourceIds.add(id);
      sourceIdEntries.push({
        value: id,
        location: pointer("sources", index, "id"),
      });
    }
    checkDate(
      source["verified_at"],
      pointer("sources", index, "verified_at"),
      dateContext,
    );
    checkUrl(source["url"], pointer("sources", index, "url"), id, issues);
  }
  checkUnique(sourceIdEntries, "duplicate-source-id", "source id", issues);

  const checks = asArray(root["checks"]) ?? [];

  // 5. Exactly 22 checks. ADR-0008 makes this a fact about what IsItAgentReady
  // published on the snapshot date, not this project's rule count, so it is a
  // hard equality and not a floor.
  if (checks.length !== REQUIRED_CHECK_COUNT) {
    issues.push({
      code: "unexpected-check-count",
      location: pointer("checks"),
      message: `expected exactly ${String(REQUIRED_CHECK_COUNT)} checks, found ${String(checks.length)}`,
    });
  }

  const checkIdEntries: { value: string; location: string }[] = [];
  const ruleIdEntries: { value: string; location: string }[] = [];
  const ordinalEntries: { value: string; location: string }[] = [];
  const requirementIdEntries: { value: string; location: string }[] = [];
  // Paired with the index of the check they came from, so that a check with a
  // missing or non-numeric ordinal (already a schema violation) cannot shift
  // every later pointer by one and send a maintainer to the wrong line.
  const ordinals: { readonly value: number; readonly checkIndex: number }[] =
    [];
  const referencedSourceIds = new Set<string>();

  for (const [index, raw] of checks.entries()) {
    const check = asRecord(raw);
    if (check === null) continue;

    const id = asString(check["id"]);
    if (id !== null) {
      checkIdEntries.push({
        value: id,
        location: pointer("checks", index, "id"),
      });
    }

    const ruleId = asString(check["rule_id"]);
    if (ruleId !== null) {
      ruleIdEntries.push({
        value: ruleId,
        location: pointer("checks", index, "rule_id"),
      });
    }

    const ordinal = check["ordinal"];
    if (typeof ordinal === "number") {
      ordinals.push({ value: ordinal, checkIndex: index });
      ordinalEntries.push({
        value: String(ordinal),
        location: pointer("checks", index, "ordinal"),
      });
    }

    for (const [refIndex, rawRef] of (
      asArray(check["source_refs"]) ?? []
    ).entries()) {
      const ref = asString(rawRef);
      if (ref === null) continue;
      referencedSourceIds.add(ref);
      if (!sourceIds.has(ref)) {
        issues.push({
          code: "unresolved-source-ref",
          location: pointer("checks", index, "source_refs", refIndex),
          message: `source_refs entry "${ref}" resolves to no sources[].id`,
        });
      }
    }

    const spec = asRecord(check["spec"]);
    for (const [reqIndex, rawRequirement] of (spec === null
      ? []
      : (asArray(spec["requirements"]) ?? [])
    ).entries()) {
      const requirement = asRecord(rawRequirement);
      const requirementId =
        requirement === null ? null : asString(requirement["id"]);
      if (requirementId === null) continue;
      requirementIdEntries.push({
        value: requirementId,
        location: pointer(
          "checks",
          index,
          "spec",
          "requirements",
          reqIndex,
          "id",
        ),
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
        location: pointer("checks", current.checkIndex, "ordinal"),
        message: `ordinal ${String(current.value)} does not follow ${String(previous.value)} in ascending order`,
      });
    }
  }
  for (const [index, ordinal] of ordinals.entries()) {
    if (ordinal.value !== index + 1) {
      issues.push({
        code: "ordinal-not-contiguous",
        location: pointer("checks", ordinal.checkIndex, "ordinal"),
        message: `expected ordinal ${String(index + 1)}, found ${String(ordinal.value)}`,
      });
    }
  }

  // An unreferenced source is dead provenance: it claims the registry rests on
  // something no rule cites.
  for (const [index, raw] of sources.entries()) {
    const source = asRecord(raw);
    const id = source === null ? null : asString(source["id"]);
    if (id === null || referencedSourceIds.has(id)) continue;
    issues.push({
      code: "orphan-source",
      location: pointer("sources", index, "id"),
      message: `source "${id}" is referenced by no check`,
    });
  }

  // 6. Canonical serialization and digest.
  const projection = project(root, issues);
  if (projection === null) return { issues, artifacts: null };

  let canonicalJson: string;
  try {
    canonicalJson = canonicalizeJson(projection);
  } catch (error) {
    issues.push({
      code: "canonicalization-failed",
      location: "",
      message: error instanceof Error ? error.message : String(error),
    });
    return { issues, artifacts: null };
  }

  const artifacts: CanonicalArtifacts = {
    canonicalJson,
    digest: formatDigest(await sha256HexOfUtf8(canonicalJson)),
  };

  if (input.committed !== null) {
    if (input.committed.canonicalJson !== artifacts.canonicalJson) {
      issues.push({
        code: "stale-canonical-json",
        location: "specs/checks.v0.canonical.json",
        message:
          "committed canonical JSON is not current; run pnpm specs:canonicalise",
      });
    }
    if (input.committed.digest.trim() !== artifacts.digest) {
      issues.push({
        code: "stale-digest",
        location: "specs/checks.v0.digest.txt",
        message: `committed digest is ${input.committed.digest.trim()}, expected ${artifacts.digest}`,
      });
    }
  }

  return { issues, artifacts };
}
