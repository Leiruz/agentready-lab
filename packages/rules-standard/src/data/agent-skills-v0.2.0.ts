/**
 * The pinned Agent Skills Discovery v0.2.0 vocabulary and grammars, for the
 * draft's Discovery Index and Index Format sections.
 *
 * THAT IS A SUBSET OF THE DRAFT AND THE SUBSET IS THE POINT. The document also
 * has HTTP Considerations, Client Implementation, Archive Distribution, Archive
 * Safety and Security Considerations sections. None of them is encoded here,
 * because none of them constrains the shape of an index document, which is the
 * only thing `agent.discovery.skills` reads.
 *
 * EVERY VALUE HERE IS TRANSCRIBED, NONE IS RECALLED. The authority is
 * `specs/sources.v0.yaml`, ledger id `agent-skills-discovery-v0.2.0`, which
 * pins the Cloudflare draft's `README.md` at commit
 * `1bd1167983fa5ac9cd47987710c525308eda1a98` (committed 2026-03-24, read
 * 2026-08-29). The ledger `notes` carry the whole of the schema this file
 * encodes, so a reader can check each constant against them without leaving
 * the repository and without re-fetching an undated URL. They also carry the
 * draft's other sections, which this file does not encode; a note in that
 * entry is a record of what the source says and never of what is checked.
 *
 * The draft states version 0.2.0, published 2026-01-17, updated 2026-03-12.
 *
 * NOTHING IS ADDED THAT THE DRAFT DOES NOT DEFINE. There is no `version`
 * field, no ordering rule and no size limit on the index here, because the
 * draft defines none. `agent.discovery.skills` asserts `profile-conformance`
 * against this draft, so a constraint invented in this file would become a
 * normative `fail` nothing published requires.
 *
 * THE MEDIA TYPE IS ABSENT FOR THE OPPOSITE REASON, and an earlier revision of
 * this comment got it wrong: it listed the media type alongside the three
 * above as something "the pinned notes state none" of. The notes stated none
 * because they had been written from the Discovery Index section alone. The
 * draft's HTTP Considerations section does state one, and servers MUST "Serve
 * /.well-known/agent-skills/index.json with application/json content type". It
 * is still not encoded here, because no assertion in
 * `specs/ruleset.standard.v0.yaml` could report a violation of it. See
 * `INDEX_ACCEPT` in `../rules/skills.ts` and the ruleset's `todo`.
 *
 * CHANGING ANY VALUE IS A VERSION CHANGE, not an edit: a new draft revision is
 * a new ledger `verified_at`, a new `version`, a `rule_version` bump on
 * `agent.discovery.skills`, and new fixtures.
 */

/** The v0.2.0 index location. */
export const AGENT_SKILLS_INDEX_PATH = "/.well-known/agent-skills/index.json";

/**
 * The pre-v0.2 location.
 *
 * It is here because `agent.discovery.skills` has to tell "the mechanism is
 * not deployed" from "the mechanism is deployed at the location the current
 * draft replaced", and those are different verdicts
 * (`docs/FIXTURE_CATALOG.md` cases `skl-006` and `skl-004`). It is never a
 * v0.2.0 conformance pass: `specs/ruleset.standard.v0.yaml` states the delta
 * as "A legacy-path presence pass is compatibility only".
 */
export const LEGACY_SKILLS_INDEX_PATH = "/.well-known/skills/index.json";

/**
 * The v0.2.0 `$schema` value.
 *
 * The draft calls it an opaque identifier that need not resolve, so it is
 * compared as an exact string and is never dereferenced. A client meeting an
 * unrecognized `$schema` SHOULD warn and SHOULD NOT process the index; an
 * absent `$schema` is treated as v0.1.0 for backward compatibility.
 */
export const AGENT_SKILLS_V0_2_0_SCHEMA =
  "https://schemas.agentskills.io/discovery/0.2.0/schema.json";

/** The two required top-level members of the index. */
export const SCHEMA_MEMBER = "$schema";
export const SKILLS_MEMBER = "skills";

/** `name`: 1 to 64 characters. */
export const SKILL_NAME_MIN_LENGTH = 1;
export const SKILL_NAME_MAX_LENGTH = 64;

/** `type`: exactly one of these two. */
export const SKILL_TYPES = ["skill-md", "archive"] as const;

/** `description`: at most 1024 characters. */
export const SKILL_DESCRIPTION_MAX_LENGTH = 1024;

/** `digest`: `sha256:` followed by 64 lowercase hex characters. */
export const SKILL_DIGEST_PREFIX = "sha256:";
export const SKILL_DIGEST_HEX_LENGTH = 64;

/**
 * `name`: lowercase alphanumerics and hyphens, with no leading, trailing or
 * consecutive hyphen.
 *
 * The three hyphen prohibitions are the grammar rather than three separate
 * tests: a name is one or more runs of `[a-z0-9]` joined by single hyphens, so
 * a leading, trailing or doubled hyphen has no run to join and cannot match.
 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Built from the two pinned values above rather than restating them, so the
 * grammar and the constants cannot drift apart. `sha256:` holds no regex
 * metacharacter, so it interpolates as itself.
 */
const SKILL_DIGEST = new RegExp(
  `^${SKILL_DIGEST_PREFIX}[0-9a-f]{${String(SKILL_DIGEST_HEX_LENGTH)}}$`,
);

export function isSkillName(value: string): boolean {
  return (
    value.length >= SKILL_NAME_MIN_LENGTH &&
    value.length <= SKILL_NAME_MAX_LENGTH &&
    SKILL_NAME.test(value)
  );
}

export function isSkillType(value: string): boolean {
  return SKILL_TYPES.some((type) => type === value);
}

/**
 * Code points, not UTF-16 code units, because the draft says characters. An
 * emoji is one character and two units, and a 1024-emoji description is within
 * the limit the draft states.
 *
 * Counted by hand rather than by `[...value]` or `Array.from`, which allocate
 * an array as long as the string for a value whose only use is a comparison.
 * `parseJsonSafe` rejects a lone surrogate, so every string that reaches here
 * is well formed and a high surrogate is always followed by its low one.
 */
function codePointLength(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < value.length) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) index += 1;
    }
    count += 1;
  }
  return count;
}

export function isSkillDescription(value: string): boolean {
  return codePointLength(value) <= SKILL_DESCRIPTION_MAX_LENGTH;
}

/**
 * Syntax only. Lowercase hex is required, so an uppercase digest is invalid
 * even though it denotes the same bytes; the draft fixes the encoding and this
 * project does not relax it.
 */
export function isSkillDigest(value: string): boolean {
  return SKILL_DIGEST.test(value);
}

// ---------------------------------------------------------------------------
// RFC 3986 URI-reference
// ---------------------------------------------------------------------------

/**
 * The draft says a `url` resolves per RFC 3986 section 5 against the index URL
 * and may be path-absolute, absolute, or relative. So the checkable property
 * is that the field is a well-formed RFC 3986 `URI-reference`, and nothing
 * more: resolving it needs a base URL, and a rule may not construct one.
 * `URL` is an undeclared identifier in this package, and
 * `test/boundaries/package-boundaries.test.ts` keeps it that way.
 *
 * The grammar below is assembled from RFC 3986 Appendix A so that each
 * fragment can be read against the ABNF it names. Every alternation is
 * disjoint on its first character, and every quantified group requires a
 * literal delimiter to begin an iteration, so the match is linear in the input
 * and cannot backtrack pathologically (`src/parsers/index.ts` requires that
 * review of any regex over target text).
 *
 * TWO DELIBERATE IMPRECISIONS, both in the accepting direction.
 *
 * 1. `IP-literal` is checked as a bracketed run of hex digits, colons, dots,
 *    `%` and letters rather than against the full `IPv6address` ABNF, which
 *    would be several hundred characters of alternation for a case no fixture
 *    reaches.
 * 2. `authority` is checked as one flat run of the characters `userinfo`,
 *    `host` and `port` are built from, instead of `[userinfo "@"] host
 *    [":" port]`. Written literally, that optional prefix makes the match
 *    quadratic on an authority containing many `@` characters, which is a
 *    denial of service a hostile index can trigger for free. The flat form is
 *    one unambiguous quantifier and is linear.
 *
 * Both accept a superset, so a malformed IPv6 literal or a doubled `@` is not
 * reported as a violation. That direction is the safe one: this assertion is
 * `normative`, and a false `violated` is a false accusation while a false
 * `satisfied` is only a missed finding.
 */
const UNRESERVED = "A-Za-z0-9\\-._~";
const SUB_DELIMS = "!$&'()*+,;=";
const PCT = "%[0-9A-Fa-f]{2}";
const PCHAR = `(?:[${UNRESERVED}${SUB_DELIMS}:@]|${PCT})`;
/** `segment-nz-nc`: no colon, so a relative first segment is not a scheme. */
const SEGMENT_NZ_NC = `(?:[${UNRESERVED}${SUB_DELIMS}@]|${PCT})+`;
const SEGMENT = `${PCHAR}*`;
const SEGMENT_NZ = `${PCHAR}+`;
const SCHEME = "[A-Za-z][A-Za-z0-9+\\-.]*";
const IP_LITERAL = "\\[[A-Za-z0-9:.%\\-]+\\]";
/** `reg-name` characters plus the `userinfo` and `port` ones. See above. */
const REG_NAME = `(?:[${UNRESERVED}${SUB_DELIMS}:@]|${PCT})*`;
const AUTHORITY = `(?:${IP_LITERAL}(?::[0-9]*)?|${REG_NAME})`;
const PATH_ABEMPTY = `(?:/${SEGMENT})*`;
const PATH_ABSOLUTE = `/(?:${SEGMENT_NZ}(?:/${SEGMENT})*)?`;
const PATH_NOSCHEME = `${SEGMENT_NZ_NC}(?:/${SEGMENT})*`;
const PATH_ROOTLESS = `${SEGMENT_NZ}(?:/${SEGMENT})*`;
const QUERY = `(?:${PCHAR}|[/?])*`;
const FRAGMENT = QUERY;
const HIER_PART = `(?://${AUTHORITY}${PATH_ABEMPTY}|${PATH_ABSOLUTE}|${PATH_ROOTLESS})?`;
const RELATIVE_PART = `(?://${AUTHORITY}${PATH_ABEMPTY}|${PATH_ABSOLUTE}|${PATH_NOSCHEME})?`;
const URI = `${SCHEME}:${HIER_PART}(?:\\?${QUERY})?(?:#${FRAGMENT})?`;
const RELATIVE_REF = `${RELATIVE_PART}(?:\\?${QUERY})?(?:#${FRAGMENT})?`;

const URI_REFERENCE = new RegExp(`^(?:${URI}|${RELATIVE_REF})$`);

/** RFC 3986 section 4.1 `URI-reference`. Syntax only; nothing is resolved. */
export function isUriReference(value: string): boolean {
  return URI_REFERENCE.test(value);
}
