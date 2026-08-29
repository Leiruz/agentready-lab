import { RuleContractViolation } from "../model/contract-violation.js";
import type { FindingParam } from "../model/rule.js";
import type { OutcomeKind } from "../model/status.js";

/**
 * ADR-0002 section 6. Finding prose is a static template, not a rule-supplied
 * string.
 *
 * This is the concrete forbidden thing: a rule may not construct a message. It
 * cannot interpolate a hostname, a header value, a redirect location, a body
 * excerpt it chose itself, or an exception. Those are the four routes by which
 * target-controlled bytes reached the previous design's report.
 */

/**
 * `docs/THREAT_MODEL.md` section 20.3's list: C0 controls, DEL and C1, and the
 * bidirectional formatting characters.
 */
// The control characters are the point of this pattern: it is the list of
// things that must not reach a terminal, a Markdown renderer or a SARIF
// viewer, so it necessarily contains them.
/* eslint-disable no-control-regex */
const UNSAFE_TEXT =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

export function sanitizeText(value: string): string {
  return value.replace(UNSAFE_TEXT, "\ufffd");
}

/**
 * Truncates to `maxLength` UTF-16 code units without splitting a surrogate
 * pair.
 *
 * Every cap in this file is a count of code units, and an astral character
 * occupies two of them, so a bare `slice` can land between the halves of one
 * and leave a lone high surrogate at the end. That is not cosmetic:
 * `canonicalizeJson` terminates on a lone surrogate (RFC 8785 section
 * 3.2.2.2), so a target that puts an emoji across the boundary of a header
 * value or a URL would make the whole scan unreportable as JSON. The bounds
 * here are all applied to target-controlled bytes, which is exactly the input
 * that would be chosen deliberately.
 *
 * The half character is dropped rather than replaced, because the cap is a
 * maximum and a replacement would need a code unit the caller did not budget.
 */
function bound(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const head = value.slice(0, maxLength);
  const last = head.charCodeAt(head.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head;
}

/**
 * Bounds and sanitizes one target-influenced string for evidence.
 *
 * `docs/THREAT_MODEL.md` section 20.3 requires every evidence value to be
 * capped and stripped of terminal, control and bidirectional sequences. A URL
 * and a redirect `Location` are target-influenced in exactly the way a finding
 * parameter is, so they go through the same sanitizer rather than a second
 * one that could disagree with it.
 */
export function sanitizeEvidenceText(value: string, maxLength: number): string {
  return bound(sanitizeText(value), maxLength);
}

/** The 256-character cap is `docs/THREAT_MODEL.md` section 16's excerpt limit. */
export function sanitizeParam(param: FindingParam): string {
  switch (param.kind) {
    case "count":
    case "http-status":
      return String(param.value);
    case "excerpt":
      return bound(sanitizeText(param.value), 256);
    default:
      return bound(sanitizeText(param.value), 128);
  }
}

export type MessageTemplates = ReadonlyMap<
  string,
  Readonly<Partial<Record<OutcomeKind, string>>>
>;

export function renderMessage(
  templates: MessageTemplates,
  assertion: string,
  outcome: OutcomeKind,
  params: Readonly<Record<string, FindingParam>>,
): string {
  const template = templates.get(assertion)?.[outcome];
  if (template === undefined) {
    throw new RuleContractViolation(
      "missing-message-template",
      `no message template for ${assertion} ${outcome}`,
    );
  }
  return template.replace(/\{([a-z][a-z0-9-]*)\}/g, (_match, name: string) => {
    const param = params[name];
    if (param === undefined) {
      throw new RuleContractViolation(
        "missing-template-parameter",
        `missing template parameter ${name}`,
      );
    }
    return sanitizeParam(param);
  });
}
