# Standards specifications

This directory contains data contracts for AgentReady Lab's rules. It is a
source ledger and implementation input, not an assertion that every listed rule
already has executable code.

## Files

- `checks.v0.yaml` is the initial, ordered registry of the 22 checks described
  by IsItAgentReady's published documentation on 2026-08-28.
- `rule.schema.json` is the JSON Schema Draft 2020-12 contract for that registry.
- `../docs/STANDARDS_REGISTRY.md` is the human-readable audit and maintenance
  guide.

The `v0` filename marks an unstable registry schema. Four explicit version axes
prevent generated code from guessing:

- `schema_version` identifies the registry's data shape;
- `registry_version` versions this source ledger, including provenance-only
  changes that do not alter verdicts;
- `ruleset_id` and `ruleset_version` identify the immutable executable
  interpretation reported by scans; and
- each check's `rule_version` identifies that native rule's semantics.

A breaking field change requires a new schema generation and filename. A
source-ledger change increments `registry_version`. A verdict-changing
interpretation increments the affected `rule_version` and `ruleset_version` as
well. The initial registry records intended versions for planned rules; it does
not claim that executable artifacts have been released.

## Three claims, never one

Every rule has three independent sections:

| Section | What it may claim | What it must not claim |
| --- | --- | --- |
| `compat` | A dated public heuristic would recognize an observation. | That the target conforms to the linked protocol. |
| `spec` | Evidence satisfies requirements from a pinned source. | That a static document proves an end-to-end implementation. |
| `interop` | A bounded, non-mutating interaction succeeded. | Certification, security, or support beyond the exact action tested. |

The initial `compat` descriptions are independently written from
<https://isitagentready.com/llms-full.txt>. They are snapshot facts about a
published external contract, not normative requirements and not a copy of
Cloudflare's implementation. IsItAgentReady's UI, direct API, URL Scanner API,
and documentation can drift independently.

Each entry also has two deliberately different identifiers:

- `id` preserves the external IsItAgentReady check key for compatibility
  mapping, such as `markdownNegotiation`;
- `rule_id` is AgentReady Lab's stable namespaced public identifier, such as
  `web.content.markdown-negotiation`.

Native reports, CLI selectors, fixtures, and finding codes use `rule_id`.
Compatibility adapters retain `id`. Neither identifier may be silently renamed
after a registry version is published.

The check-level `maturity` field describes the pinned source set, not project
implementation status. Its values are `stable`, `mixed`, `draft`,
`experimental`, `convention`, and `beta`. Implementation status uses the
separate project vocabulary in `PROJECT_STATUS.md`. The `runtime` values
(`http`, `dns`, and `browser`) describe observation capabilities a rule needs;
they never grant a rule direct network access.

## Verdict policy

- `pass` requires an applicable assertion and sufficient evidence.
- `fail` is reserved for an evaluated, applicable normative assertion.
- A failed SHOULD/recommendation is normally `warning`.
- An irrelevant rule is `not-applicable`; it is not a pass.
- Missing or unsafe-to-fetch evidence is `unable-to-check`; it is not a fail.
- A runtime-only surface such as WebMCP is `unsupported-runtime` outside a
  compatible browser harness.
- Experimental discovery mechanisms are opt-in. Absence alone is not a
  specification failure.
- Commerce rules require a user-selected commerce profile and a known endpoint.
  Heuristic ecommerce classification may be reported as evidence but must not
  silently change applicability.

## Source pinning

RFC URLs are stable identifiers. Living specifications and draft repositories
must additionally be pinned to a release, date, draft number, or commit before
their executable rules merge. A moving `/latest/` link is a discovery URL, not
a reproducibility pin.

Each registry source records `verified_at`. Updating that field alone is not a
substitute for reviewing schemas, examples, discovery paths, requirement words,
and security considerations.

## Validation

From the repository root, a future validation script should perform all of the
following:

1. parse `checks.v0.yaml` with duplicate-key rejection;
2. validate it against `specs/rule.schema.json` using JSON Schema Draft 2020-12;
3. enforce semantic constraints JSON Schema cannot express here:
   - source IDs, compatibility check IDs, native rule IDs, ordinals, and
     requirement IDs are unique;
   - ordinals are contiguous from 1 through 22;
   - every `source_refs` item resolves;
   - every URL uses HTTPS except a source whose normative identifier is HTTP;
   - exactly 22 compatibility checks are present;
4. serialize a canonical form and verify that fixture expectations are stable.

Do not fetch source URLs during normal tests. A separately scheduled drift job
may report changes without rewriting the registry or changing CI verdicts.

## Change procedure

1. Open an issue naming the protocol version and observed delta.
2. Add or update positive, negative, ambiguous, and unable-to-check fixtures.
3. Cite the exact source section or schema and classify each assertion as
   normative, recommended, or advisory.
4. Run compatibility and specification tests separately.
5. Record whether previous results change and bump the correct registry, rule,
   and ruleset version axes.
6. Request review from someone other than the author for standards and security
   changes.

Do not silently reinterpret an old draft. Preserve the old ruleset when users
may need reproducible historical results.
