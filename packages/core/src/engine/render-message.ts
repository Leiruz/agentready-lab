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
 * Bounds and sanitizes one target-influenced string for evidence.
 *
 * `docs/THREAT_MODEL.md` section 20.3 requires every evidence value to be
 * capped and stripped of terminal, control and bidirectional sequences. A URL
 * and a redirect `Location` are target-influenced in exactly the way a finding
 * parameter is, so they go through the same sanitizer rather than a second
 * one that could disagree with it.
 */
export function sanitizeEvidenceText(value: string, maxLength: number): string {
  return sanitizeText(value).slice(0, maxLength);
}

/** The 256-character cap is `docs/THREAT_MODEL.md` section 16's excerpt limit. */
export function sanitizeParam(param: FindingParam): string {
  switch (param.kind) {
    case "count":
    case "http-status":
      return String(param.value);
    case "excerpt":
      return sanitizeText(param.value).slice(0, 256);
    default:
      return sanitizeText(param.value).slice(0, 128);
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
