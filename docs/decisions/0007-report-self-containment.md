# ADR-0007: Report self-containment, sources and remediation

- Status: Accepted
- Decision date: 2026-08-29
- Owners: Initial maintainers
- Applies from: M1

## Context

Goal G-2 in `docs/IMPLEMENTATION_SPEC.md` promises that every result identifies
"the source specification and pinned version/date" and "an independently written
remediation summary". Neither is satisfiable from a report as currently modeled.

**Sources are unresolvable.** `RuleFinding.sourceRefs` carries
`{ sourceId, section? }`, where `sourceId` keys into the `sources` array of
`specs/checks.v0.yaml`. `CanonicalScanReportV1` has no top-level `sources` array
and carries no source-ledger or snapshot version. A consumer holding only the
JSON report sees `{"sourceId": "rfc9309"}` with no title, URL, status, version,
or verification date, and no way to know which pinned source set to resolve it
in.

**Remediation is modeled nowhere.** It is required by G-2, by FR-6, and by the
section 24 release definition of done, and it appears in
`docs/TEST_STRATEGY.md` section 6's contract-test list. It exists in zero
schemas. `specs/rule.schema.json` is `additionalProperties: false` at every
level, so remediation cannot be added to a check without a schema change, and
`RuleFinding` carries only `message`.

## Decision

### 1. The canonical report carries the sources it cites

`CanonicalScanReportV1` gains a cited-source array and names its version axes
explicitly:

```ts
export interface ReportSource {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly kind: string;
  readonly status: string;
  readonly version?: string;
  readonly verifiedAt: string;
}

export interface ExternalSnapshotRef {
  /** `snapshot.captured_at` of `specs/checks.v0.yaml`. */
  readonly capturedAt: string;
  /** `schema_version` of that file. */
  readonly schemaVersion: string;
}

export interface CanonicalScanReportV1 {
  // ... existing fields, including `ruleset: { id, version, digest }` ...
  /** `source_ledger_version` of `specs/sources.v0.yaml`. */
  readonly sourceLedgerVersion: string;
  /** Present in `compat` mode and absent in every other mode. */
  readonly externalSnapshot?: ExternalSnapshotRef;
  readonly sources: readonly ReportSource[];
}
```

`sources` is projected from the source ledger at build time and filtered to the
sources actually cited by a finding in that report, sorted by `id`.

#### The first revision named a field no artifact has

That revision added `readonly registryVersion: string` and said it was "the
pinned `registry_version` of the ruleset artifact". Adversarial review on
2026-08-29 showed that after ADR-0008 nothing carries `registry_version`:
`specs/checks.v0.yaml` loses that top-level field in the section 2 migration,
and the two artifacts it moves to carry `ruleset_version` and
`source_ledger_version` instead. `registryVersion` is removed rather than
repointed, because it named a merged axis that ADR-0008 exists to split.

The three axes a report must identify are therefore:

| Axis | Where it is in the report |
| --- | --- |
| `ruleset_version` | the existing `ruleset.version` field |
| `source_ledger_version` | the new top-level `sourceLedgerVersion` |
| `snapshot.captured_at` | `externalSnapshot`, in `compat` mode only |

A second top-level `rulesetVersion` field is deliberately **not** added.
`CanonicalScanReportV1` already carries `ruleset: { id, version, digest }`
(`docs/ARCHITECTURE.md` section 9, and the example in
`docs/IMPLEMENTATION_SPEC.md` section 13), so a second copy would be two fields
that must be equal and can only disagree. That is the same reasoning ADR-0002
used to take `status` away from rules and ADR-0003 used to keep `retryable` off
the renderer, and it should not be broken here for symmetry with a field name.

`externalSnapshot` is required in `compat` mode because a compatibility verdict
is a claim about a dated external inventory, and a reader holding only the JSON
must be able to see which one. It is absent in `spec` and `interop` mode, where
the snapshot decided nothing and asserting it would imply otherwise. A `compat`
report without it, or a non-`compat` report with it, is a contract-test failure.

Filtering to cited sources keeps the report bounded. The registry holds roughly
thirty sources; embedding all of them in every report would put the same
unchanging block in every diff and would grow with the registry rather than with
the scan. The 1 MiB report ceiling in `docs/THREAT_MODEL.md` section 16 exists
for a reason.

This is forbidden:

- a finding citing a `sourceId` that does not appear in `sources`, which a
  contract test must check because JSON Schema cannot express it;
- resolving or fetching a source URL at report time, or at any other time during
  a scan;
- a reporter adding, removing, or rewriting a source entry;
- using an undated `latest` URL as the pinned `version`, per
  `IMPLEMENTATION_SPEC.md` section 12.1.

Because no report has shipped, this lands inside `schemaVersion` `1.0.0` rather
than as a bump.

### 2. Remediation lives in a separate keyed file

Remediation text lives in `specs/remediation.v0.yaml`, governed by
`specs/remediation.schema.json`. It is keyed by finding code, which ADR-0002
section 9 makes identical to a `spec.requirements[].id` for a `spec`-mode
finding and to the rule's own versioned compatibility assertion id for a
`compat`-mode finding. Both kinds need an entry, and their remediation classes
are distinct.

Keeping it out of `checks.v0.yaml` matters for a specific reason: that file is
`additionalProperties: false` throughout and ADR-0008 freezes it at 22 entries
as the external compatibility snapshot. Adding a remediation field would force a
schema generation bump on a file whose whole purpose is to stay pinned.

```yaml
schema_version: "0"
remediation_version: "0.1.0"
ruleset_id: "standard"
ruleset_version: "0.2.0"
entries:
  - finding_code: "markdown.vary"
    rule_id: "web.content.markdown-negotiation"
    class: "recommended-hardening"
    summary: >-
      Add Accept to the Vary response header so a shared cache cannot serve
      the HTML representation to a Markdown request.
    detail: >-
      RFC 9110 Section 12.5.5 requires a response that varies by a request
      header to name that header in Vary. Without it, an intermediary that
      stored the HTML representation may reuse it for a request carrying
      Accept: text/markdown.
    source_refs: ["rfc9110"]
    authored_at: "2026-08-29"
```

Required fields: `finding_code`, `rule_id`, `class`, `summary`, `detail`,
`source_refs`, `authored_at`. `additionalProperties` is `false`.
`finding_code` is unique across the file. `class` is one of:

| `class` | Meaning, from FR-6 |
| --- | --- |
| `required-correction` | A violated applicable normative requirement. |
| `recommended-hardening` | A failed recommendation or advisory. |
| `compatibility-workaround` | A change that only affects a dated external tool's recognition, never conformance. |

`summary` is bounded at 240 characters and is what enters the report.
`detail` is unbounded prose, surfaced by the human reporter and by
`agentready-lab rules explain <rule-id>`, and never embedded per finding.

`RuleFinding` gains:

```ts
readonly remediation?: {
  readonly class:
    | "required-correction"
    | "recommended-hardening"
    | "compatibility-workaround";
  readonly summary: string;
};
```

It is present on every finding whose status is `fail` or `warning`, and absent
otherwise. A `pass` needs no remediation, and attaching one would imply a defect
where none was found.

### 3. Completeness is a build gate, not a review item

A build-time check fails when any assertion declared in a rule's
`metadata.assertions` whose class can derive `fail` or `warning` has no entry in
`remediation.v0.yaml`. This makes the section 24 release
criterion "every rule has pinned sources and independent remediation text"
mechanically verifiable instead of a checklist line.

A second check fails when a `remediation.v0.yaml` entry names a
`finding_code` or `rule_id` that the pinned ruleset does not declare.

### 4. Remediation text rules

Every entry is written independently and grounded in the sources it cites. The
`source_refs` list must resolve against the same registry as the finding's
`sourceRefs`, and it exists so that remediation cannot drift away from the
requirement it explains.

This is forbidden:

- copying or paraphrasing IsItAgentReady's remediation text, or any other
  scanner's. ADR-0001 section 3 already forbids it for `compat` mode, and
  `CLAUDE.md` repeats it. It is a licensing question as well as an independence
  one: the external documentation is published prose, not a public-domain
  contract;
- generating remediation text at scan time with a language model, or at any
  other time without a human author and a review;
- text that tells the user to disable, exclude, or downgrade the check;
- text that names a specific commercial product as the fix, including
  Cloudflare's, which would also contradict the non-affiliation position in
  `README.md`;
- text that asserts a legal, contractual, or enforceability consequence. See
  ADR-0009 for the Content Signals case where this matters most.

## Rationale

A report that cannot be read without the repository that produced it is not
evidence, and G-4 asks for reports "suitable for an upstream issue or test
vector". Attaching the cited sources and the registry version is the smallest
change that makes a report stand alone.

Separating remediation from the registry is a boundary decision, not storage
convenience. `checks.v0.yaml` records what an external tool published on a date;
remediation records what this project tells a user to do. Those have different
authors, review requirements, licensing exposure, and change cadences, and one
file with one version axis would couple all of it.

Putting only `summary` in the report, with `detail` behind `rules explain`,
keeps the machine-readable artifact bounded while leaving the full explanation
one command away.

## Consequences

### Positive

- A JSON report identifies its sources, their status, pinned version, and
  verification date without any other file.
- `sourceLedgerVersion` tells which pinned source set a historical report was
  produced against, and in `compat` mode `externalSnapshot` tells which dated
  external inventory decided the compatibility verdicts. G-3 needs both to make
  draft drift visible, and the first revision's single merged field could show
  neither.
- The definition-of-done item on remediation becomes a failing build rather than
  a missed checklist line.
- The frozen 22-check registry schema needs no generation bump.

### Costs

- Three new artifacts: the remediation file, its schema, and the two
  completeness checks.
- Remediation text becomes a release blocker. A new finding code cannot merge
  without prose written and reviewed by a human.
- The report grows by the cited-source block and one summary per non-passing
  finding. Small for an eight-rule scan, but not nothing.
- `remediation_version` is a fifth version axis alongside `schema_version`,
  `ruleset_version`, `source_ledger_version`, and the snapshot's
  `captured_at`, to be pinned in CI like the others. Four of the five now reach
  the report, which is more surface than a single `registry_version` would have
  been and is the price of ADR-0008 splitting the authorities.

## Alternatives considered

### Embed the full source objects in each finding

Rejected. A source cited by six findings is serialized six times, and the
duplicates then have to be proven identical.

### Ship the whole registry `sources` array in every report

Rejected. Every report would carry the same thirty entries regardless of what
was evaluated, growing with the registry rather than the scan.

### Add remediation to `checks.v0.yaml`

Rejected. The file is `additionalProperties: false` throughout, forcing a schema
generation bump, and it merges the external snapshot with project-authored
prose, the conflation ADR-0008 exists to prevent.

### Put remediation in the rule's TypeScript source

Rejected. Prose in source cannot be reviewed by a standards maintainer without
reading code, validated by a schema, or diffed independently of an
implementation change.

### Resolve sources by fetching their URLs when rendering

Rejected outright. It puts network access in a reporter, which
`ARCHITECTURE.md` section 4 defines as a pure transform, and makes a report's
contents depend on when it was rendered.

## Revisit conditions

- Localized remediation is requested, needing a language axis and a decision
  about which language enters the report.
- The report exceeds its size ceiling on a realistic profile.
- A source's pinned version changes in a way that invalidates existing
  remediation text, bumping `remediation_version` and the affected
  `rule_version`.
- A `1.0.0` report schema is cut, freezing `sources`, `sourceLedgerVersion`,
  and `externalSnapshot` as public contract.

## Related documents

- [ADR-0001: Scope, modes, and no aggregate score](0001-scope-modes-and-scoring.md)
- [ADR-0002: Rule execution model and observation types](0002-rule-execution-model.md)
- [ADR-0008: Registry extensibility and missing assertions](0008-registry-extensibility.md)
- [ADR-0009: Content Signals source pinning](0009-content-signals-source-pinning.md)
- [Implementation specification](../IMPLEMENTATION_SPEC.md)
- [Standards registry](../STANDARDS_REGISTRY.md)
