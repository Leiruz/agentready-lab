/**
 * Output safety for reporters. `docs/THREAT_MODEL.md` section 20.3.
 *
 * Everything a report says about a target came from a server this project
 * treats as hostile: a header value, a media type, a URL, a redirect location,
 * a bounded excerpt. Section 20.3 requires a reporter to "remove ANSI escapes,
 * OSC hyperlinks, C0/C1 controls, and unsafe bidirectional controls", to
 * escape "for the exact sink", and to "cap every message, evidence value,
 * annotation set, and final report".
 *
 * This is deliberately a second pass rather than a reuse of core's
 * `sanitizeText`, and the two are not redundant copies of one control:
 *
 * - core neutralizes a value as it *enters* the report, replacing each unsafe
 *   character with U+FFFD. That is right for a stored artifact, where a
 *   deletion would silently change a length or a digest;
 * - this neutralizes a value as it *leaves* for a terminal, removing whole
 *   escape sequences. Killing only the ESC byte would leave the rest of an
 *   SGR sequence as visible garbage in the middle of a finding message;
 * - a reporter cannot assume its input came from this version of core. A
 *   report read back from a file carries whatever sanitizer produced it, and
 *   the sink boundary is the last place the question can be asked.
 *
 * There is exactly one canonical JSON serializer, in core, and this module
 * does not touch it. Sanitizing is a per-sink escape; canonicalizing is not.
 */

/**
 * The caps. Every target-influenced string a reporter prints goes through one
 * of them, and a value longer than its cap is cut and marked, never cut
 * silently.
 */
export const TEXT_LIMITS = {
  /**
   * One rendered finding message. Core composes it from a static template plus
   * bounded parameters (256 characters for an authorized excerpt, 128
   * otherwise), so a template with several parameters can still outgrow a
   * readable block.
   */
  message: 512,
  /** ADR-0007 section 2 bounds a remediation summary at 240 characters. */
  remediation: 240,
  /** A pinned source title. Not target-controlled, bounded anyway. */
  title: 200,
  /**
   * A URL, a header value, a redirect location, a DNS record value.
   * `docs/THREAT_MODEL.md` section 16 bounds a raw target URL at 2,048.
   */
  value: 2048,
  /**
   * An identifier: a rule id, a finding code, an evidence id, a source id, a
   * header name, a record type, a status word. Core's own non-excerpt
   * parameter bound.
   */
  label: 128,
} as const;

/**
 * Appended in place of the removed tail. Explicit, ASCII, and inside the cap:
 * a bounded string is never longer than its limit, so a caller that budgeted
 * for the limit is not surprised by the marker.
 */
export const TRUNCATION_MARKER = " [truncated]";

// These patterns are lists of the characters that must not reach a terminal,
// so they necessarily contain those characters.
/* eslint-disable no-control-regex */

/**
 * Rule 1. Whole escape sequences, longest form first.
 *
 * In order: OSC introduced by ESC ] or by C1 U+009D and closed by BEL, by the
 * two-character string terminator or by C1 ST, which is the form an OSC 8
 * hyperlink takes; the
 * string-argument controls DCS, SOS, PM and APC; CSI introduced by ESC [ or
 * by C1 U+009B, which is every SGR colour, cursor move and screen clear; and
 * finally any remaining two- or three-character escape.
 *
 * An *unterminated* OSC matches none of the first two alternatives and falls
 * through to the last, which removes the introducer and leaves the arguments
 * as visible text. That is deliberate: swallowing to the end of the string
 * would delete legitimate text for no gain, because rule 2 below removes every
 * remaining ESC, so no terminal ever enters OSC state.
 */
const ESCAPE_SEQUENCE =
  /\u001b\][^\u0007\u001b\u009c]*(?:\u0007|\u001b\\|\u009c)|\u009d[^\u0007\u001b\u009c]*(?:\u0007|\u001b\\|\u009c)|\u001b[PX^_][^\u001b\u009c]*(?:\u001b\\|\u009c)|\u001b\[[0-?]*[ -/]*[@-~]|\u009b[0-?]*[ -/]*[@-~]|\u001b[ -/]*[0-~]/g;

/**
 * Rule 2. C0, DEL and C1.
 *
 * This is what makes the module safe rather than tidy. Whatever rule 1 did or
 * did not consume, no U+001B survives this, so no escape sequence can exist in
 * the output at all. It also removes the newlines and carriage returns that
 * would otherwise let one header value become several lines of report.
 */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * Rule 3. Bidirectional formatting characters.
 *
 * The embeddings and overrides U+202A to U+202E and the isolates U+2066 to
 * U+2069 reorder what follows them, so one host name can be made to read as
 * another. U+061C, U+200E and U+200F are the same trick in one character. A
 * report exists to say truthfully what a target served, and a string that
 * renders as a different string than it contains cannot do that.
 */
const BIDIRECTIONAL_CONTROL = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * Rule 4. The Unicode line and paragraph separators.
 *
 * Neither controls nor bidirectional, but a line break to a JavaScript source
 * reader, to some Markdown renderers and to some log viewers, which is enough
 * for one field to become two lines.
 */
const LINE_SEPARATOR = /[\u2028\u2029]/g;

/* eslint-enable no-control-regex */

/**
 * Rule 5. GitHub Actions workflow command syntax.
 *
 * A runner reads a log line whose first non-blank characters are a colon pair
 * as a command: an error annotation, an add-mask, or the stop-commands form
 * that silences every command after it. Human output reaches a CI log whenever
 * anyone runs this tool in a workflow step, so a target that gets a colon pair
 * to the start of a line has a command channel into someone else's build.
 *
 * Escaping both colons is enough, because a runner matches the literal pair,
 * and it touches nothing else: an IPv6 literal and a C++ scope keep their
 * colons, since only a line-leading pair is a command.
 *
 * The `m` flag is what lets one rule serve two call sites: applied to a single
 * field it can only match at position 0, and applied to a finished document it
 * checks every line.
 */
const WORKFLOW_COMMAND = /^([ \t]*)::/gm;

export function neutralizeWorkflowCommands(text: string): string {
  return text.replace(WORKFLOW_COMMAND, "$1\\:\\:");
}

/** Rule 6. Cut to the cap, and say so. */
function bound(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const head = value.slice(0, maxLength - TRUNCATION_MARKER.length);
  // A slice can land between the two code units of an astral character.
  // A lone high surrogate renders as U+FFFD in a terminal and makes the same
  // string unserializable as canonical JSON (RFC 8785 section 3.2.2.2), so the
  // half character is dropped rather than kept.
  const last = head.charCodeAt(head.length - 1);
  const safe = last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head;
  return safe + TRUNCATION_MARKER;
}

/**
 * Makes one target-influenced string safe to print, and bounds it.
 *
 * Order is load-bearing. Sequences are removed before lone control characters,
 * so an SGR sequence does not leave its parameters behind. Control characters
 * are removed before the workflow-command rule, because removing a character
 * can *create* the pair that rule looks for, and a rule that had already run
 * would not see it. Bounding is last, so the truncation marker cannot itself
 * be cut.
 */
export function sanitize(value: string, maxLength: number): string {
  const stripped = value
    .replace(ESCAPE_SEQUENCE, "")
    .replace(CONTROL_CHARACTER, "")
    .replace(BIDIRECTIONAL_CONTROL, "")
    .replace(LINE_SEPARATOR, "");
  return bound(neutralizeWorkflowCommands(stripped), maxLength);
}
