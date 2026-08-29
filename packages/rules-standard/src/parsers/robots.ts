import type { HttpObservationRequest } from "@agentready-lab/core";

/**
 * The shared `robots.txt` tokenizer of `docs/ARCHITECTURE.md` section 7.
 *
 * Four rules read this one parse: `web.discovery.robots`,
 * `web.policy.ai-crawler`, `web.policy.content-signals` and
 * `web.discovery.sitemap`. It is therefore a **tokenizer and nothing else**.
 *
 * WHAT IT DOES. RFC 9309 section 2.2's ABNF defines exactly three records:
 * `user-agent`, `allow` and `disallow`. Those are recognized, validated
 * against the ABNF, and assembled into groups. Nothing else is interpreted.
 *
 * WHAT IT DELIBERATELY DOES NOT DO.
 *
 * - It does not interpret extension records. `Sitemap:` and `Content-Signal:`
 *   come out of `extensions` as a field name, a value and a line number, and
 *   the consuming rule decides what they mean. RFC 9309 section 2.2.4 says
 *   crawlers MAY interpret other records and MAY be lenient, and its only MUST
 *   is that parsing them must not interfere with parsing the defined records.
 *   That MUST is discharged here structurally: an extension line never opens,
 *   closes or splits a group, and never marks a group as having seen a rule.
 *   ADR-0009 section 3 requires a parser unit test proving identical group
 *   selection with extension records present and stripped.
 * - It does not do group matching or longest-match precedence. RFC 9309
 *   section 2.2.2's "most octets wins" belongs to `web.policy.ai-crawler`,
 *   whose agent owns it. `groups[].agents` is lowercased for it (section 2.2.1
 *   makes the product token case-insensitive) and every record carries its
 *   1-based line number, which is what `DiscoveredProvenance.locator` wants.
 * - It does not retrieve anything and it knows no HTTP semantics. A caller
 *   hands it the bounded decoded body it already has. Whether the response was
 *   a 200, a 404 or a transport error is the *rule's* question, and each of
 *   the four rules answers it from its own observation. Do not call the memo
 *   loader before establishing that your observation carried a body.
 *
 * MEMO SAFETY. The result is stored under `agentready-lab/parsed-robots/v1`,
 * which ADR-0002 section 11 validates as acyclic plain data with an approved
 * prototype and then deeply freezes. So: plain objects and arrays only, no
 * `Map`, `Set`, `Date`, `Uint8Array`, `RegExp`, class instance, getter, symbol
 * key or `undefined` property, and **no object reachable twice**. The last one
 * is the trap: `assertPlainData` rejects a shared node exactly as it rejects a
 * cycle, so a single hoisted `EMPTY_ARRAY` constant reused for two fields
 * would be a contract violation. Every array below is built fresh.
 *
 * HOSTILE INPUT. This parses whatever a server returned. Every bound is
 * enforced before the work it bounds, the two regexes are anchored and
 * alternation-free, and the scan is a single linear pass.
 */

/**
 * The shared cache namespace, written once so four rules cannot disagree.
 *
 * `packages/core/src/engine/memo-keys.ts` holds the closed list this is on. A
 * key outside that list is a contract violation, and a change to the shape
 * below is a new key there rather than a silent reuse of this one.
 */
export const PARSED_ROBOTS_MEMO_KEY = "agentready-lab/parsed-robots/v1";

/** The bound a document exceeded. `null` in `refusedBy` means none did. */
export type RobotsLimit =
  "bytes" | "lines" | "line-length" | "groups" | "rules" | "extensions";

export interface RobotsParseLimits {
  /**
   * Total body bytes. RFC 9309 section 2.5: "Crawlers SHOULD impose a parsing
   * limit [...] The parsing limit MUST be at least 500 kibibytes." 512 KiB
   * clears that floor.
   */
  readonly maxBytes: number;
  readonly maxLines: number;
  /** UTF-16 code units in one line, after decoding. */
  readonly maxLineLength: number;
  readonly maxGroups: number;
  /** Total `allow` and `disallow` records across every group. */
  readonly maxRules: number;
  readonly maxExtensions: number;
}

export const ROBOTS_PARSE_LIMITS: RobotsParseLimits = {
  maxBytes: 524288,
  maxLines: 20000,
  maxLineLength: 4096,
  maxGroups: 1000,
  maxRules: 10000,
  maxExtensions: 1000,
};

/** How many malformed lines are described. `malformedCount` keeps counting. */
export const MAX_DESCRIBED_MALFORMED_LINES = 64;

/**
 * Why one line is not an RFC 9309 record.
 *
 * Each reason is a specific ABNF clause and none of them is invented
 * strictness. `no-separator` and `unparseable-field` are the only shapes that
 * are neither `emptyline`, `comment`, a defined record, nor a section 2.2.4
 * `field: value` other record.
 */
export type RobotsMalformedReason =
  /** No `:` at all, so the line is not a record of any kind. */
  | "no-separator"
  /** The field name is not an RFC 9110 token. */
  | "unparseable-field"
  /** `product-token = identifier / "*"`, `identifier = 1*[-A-Z_a-z]`. */
  | "bad-product-token"
  /** `path-pattern = "/" *UTF8-char-noctl`, or `empty-pattern = *WS`. */
  | "bad-path-pattern"
  /** `group = startgroupline ...`: a rule before any `user-agent` line. */
  | "rule-outside-group";

export interface RobotsMalformedLine {
  /** 1-based, counted over the original document. */
  readonly line: number;
  readonly reason: RobotsMalformedReason;
}

export interface RobotsRule {
  readonly line: number;
  readonly type: "allow" | "disallow";
  /** The `path-pattern`, or `""` for RFC 9309's `empty-pattern`. */
  readonly path: string;
}

export interface RobotsGroup {
  /** Lowercased product tokens, in document order. `*` is one of them. */
  readonly agents: readonly string[];
  /** The line of each entry in `agents`, at the same index. */
  readonly agentLines: readonly number[];
  readonly rules: readonly RobotsRule[];
}

/** An RFC 9309 section 2.2.4 "other record", handed out uninterpreted. */
export interface RobotsExtensionRecord {
  readonly line: number;
  /** Lowercased field name, e.g. `sitemap` or `content-signal`. */
  readonly field: string;
  /** The verbatim value, comment-stripped and whitespace-trimmed. */
  readonly value: string;
}

export interface ParsedRobots {
  /**
   * The bound the document exceeded, or `null`.
   *
   * Non-`null` means the parse was **refused**: every array below is empty and
   * every count is zero. A consumer must branch on this before reading
   * anything else. Refusal is not a verdict about the publisher; RFC 9309
   * section 2.5 makes the parsing limit the crawler's own, so a rule reports
   * this as indeterminate and never as a violation.
   */
  readonly refusedBy: RobotsLimit | null;
  /**
   * The body was not well-formed UTF-8 and was decoded with U+FFFD.
   *
   * RFC 9309 section 2.3: "The file MUST be UTF-8 encoded". That MUST is on
   * the publisher, so this is a violation and not a refusal.
   */
  readonly invalidUtf8: boolean;
  readonly lineCount: number;
  readonly groups: readonly RobotsGroup[];
  readonly extensions: readonly RobotsExtensionRecord[];
  /** Bounded by `MAX_DESCRIBED_MALFORMED_LINES`. */
  readonly malformed: readonly RobotsMalformedLine[];
  /** Every malformed line, including those `malformed` did not describe. */
  readonly malformedCount: number;
}

/**
 * The one request shape all four consuming rules issue.
 *
 * ADR-0005 section 3 keys deduplication on the method, URL, `Accept`, redirect
 * policy and byte caps, so four rules that each wrote their own request would
 * be four fetches of `/robots.txt` instead of the single shared observation
 * `docs/TEST_STRATEGY.md` section 6 requires. The rule-local `id` is not part
 * of the key, so each rule passes its own.
 *
 * `Accept: text/plain` is not a preference: RFC 9309 section 2.3 fixes the
 * representation at `text/plain`, so there is nothing to negotiate and asking
 * for anything else would weaken the media-type assertion.
 */
export const ROBOTS_PATH = "/robots.txt";
export const ROBOTS_ACCEPT = "text/plain";
export const ROBOTS_MEDIA_TYPE = "text/plain";

export function robotsObservationRequest(id: string): HttpObservationRequest {
  return {
    kind: "http",
    id,
    method: "GET",
    target: { kind: "origin-path", path: ROBOTS_PATH },
    accept: ROBOTS_ACCEPT,
    // RFC 9309 section 2.3.1.2 asks crawlers to follow at least five
    // consecutive redirects. The engine's own `maxRedirects` is five and a
    // rule may only lower a budget, so five is what this asks for; the
    // same-origin restriction is `docs/THREAT_MODEL.md`'s, not the RFC's.
    redirects: "follow-same-origin",
    maxEncodedBytes: ROBOTS_PARSE_LIMITS.maxBytes,
    maxDecodedBytes: ROBOTS_PARSE_LIMITS.maxBytes,
  };
}

/** RFC 9110 section 5.6.2 `token`. `#` cannot survive comment stripping. */
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** RFC 9309 section 2.2 `identifier = 1*(%x2D / %x41-5A / %x5F / %x61-7A)`. */
const IDENTIFIER = /^[A-Z_a-z-]+$/;

function isProductToken(value: string): boolean {
  return value === "*" || IDENTIFIER.test(value);
}

/**
 * `path-pattern = "/" *UTF8-char-noctl`.
 *
 * `UTF8-1-noctl = %x21 / %x22 / %x24-7F` excludes every code point below
 * `%x21`, which is what rejects an interior space or tab. `%x23` (`#`) is also
 * excluded, and cannot reach here because comment stripping already removed
 * it; section 2.2.3 requires a literal `#` in a path to be percent-encoded.
 */
function isPathPattern(value: string): boolean {
  if (!value.startsWith("/")) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 0x21) return false;
  }
  return true;
}

/** RFC 9309 section 2.2 `WS = %x20 / %x09`, and only those two. */
function trimWs(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end) {
    const code = value.charCodeAt(start);
    if (code !== 0x20 && code !== 0x09) break;
    start += 1;
  }
  while (end > start) {
    const code = value.charCodeAt(end - 1);
    if (code !== 0x20 && code !== 0x09) break;
    end -= 1;
  }
  return value.slice(start, end);
}

interface DecodedBody {
  readonly text: string;
  readonly valid: boolean;
}

/**
 * UTF-8 decoding, written out because `TextDecoder` does not exist here.
 *
 * `packages/rules-standard` compiles with `"lib": ["ES2023"], "types": []`, so
 * there is no `TextDecoder` to call. That is a gain rather than a cost: the
 * `valid` flag below is exactly RFC 9309 section 2.3's "MUST be UTF-8
 * encoded", and `TextDecoder` without `fatal: true` would have replaced the
 * bad bytes without saying it had.
 *
 * The accepted byte sequences are RFC 3629's, transcribed from RFC 9309
 * section 2.2's own `UTF8-2`/`UTF8-3`/`UTF8-4` rules, so overlong forms,
 * surrogate halves and code points above U+10FFFF are all rejected. A leading
 * byte-order mark is dropped, which is what a `utf-8` `TextDecoder` does and
 * is not an extension of the RFC.
 */
function decodeUtf8(bytes: Uint8Array): DecodedBody {
  const points: number[] = [];
  let valid = true;
  let index = 0;
  const length = bytes.length;
  if (
    length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    index = 3;
  }

  const tail = (at: number): number => (at < length ? (bytes[at] ?? 0) : -1);

  while (index < length) {
    const first = bytes[index] ?? 0;
    if (first < 0x80) {
      points.push(first);
      index += 1;
      continue;
    }

    let needed: number;
    let point: number;
    let lowerBound = 0x80;
    let upperBound = 0xbf;
    if (first >= 0xc2 && first <= 0xdf) {
      needed = 1;
      point = first & 0x1f;
    } else if (first >= 0xe0 && first <= 0xef) {
      needed = 2;
      point = first & 0x0f;
      if (first === 0xe0) lowerBound = 0xa0;
      if (first === 0xed) upperBound = 0x9f;
    } else if (first >= 0xf0 && first <= 0xf4) {
      needed = 3;
      point = first & 0x07;
      if (first === 0xf0) lowerBound = 0x90;
      if (first === 0xf4) upperBound = 0x8f;
    } else {
      points.push(0xfffd);
      valid = false;
      index += 1;
      continue;
    }

    let consumed = 0;
    let ok = true;
    while (consumed < needed) {
      const byte = tail(index + 1 + consumed);
      const low = consumed === 0 ? lowerBound : 0x80;
      const high = consumed === 0 ? upperBound : 0xbf;
      if (byte < low || byte > high) {
        ok = false;
        break;
      }
      point = (point << 6) | (byte & 0x3f);
      consumed += 1;
    }
    if (!ok) {
      points.push(0xfffd);
      valid = false;
      // Advance past the lead byte only, so a truncated sequence followed by a
      // valid one still decodes the valid one.
      index += 1;
      continue;
    }
    points.push(point);
    index += 1 + needed;
  }

  // Chunked, because `String.fromCodePoint(...points)` on a 512 KiB document
  // would exceed the argument-count limit.
  let text = "";
  for (let at = 0; at < points.length; at += 4096) {
    text += String.fromCodePoint(...points.slice(at, at + 4096));
  }
  return { text, valid };
}

/**
 * Splits on RFC 9309 section 2.2's `NL = %x0D / %x0A / %x0D.0A`.
 *
 * A lone CR is a line break, and a document with no final newline ends with a
 * content line rather than losing it. A trailing empty segment after a final
 * newline is dropped, so `a\n` and `a` produce the same one line.
 */
function splitLines(text: string): readonly string[] {
  const lines: string[] = [];
  let start = 0;
  let index = 0;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === 0x0a) {
      lines.push(text.slice(start, index));
      index += 1;
      start = index;
      continue;
    }
    if (code === 0x0d) {
      lines.push(text.slice(start, index));
      index += text.charCodeAt(index + 1) === 0x0a ? 2 : 1;
      start = index;
      continue;
    }
    index += 1;
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

/** Every array is a fresh literal: ADR-0002 section 11 rejects a shared node. */
function refused(limit: RobotsLimit): ParsedRobots {
  return {
    refusedBy: limit,
    invalidUtf8: false,
    lineCount: 0,
    groups: [],
    extensions: [],
    malformed: [],
    malformedCount: 0,
  };
}

interface OpenGroup {
  readonly agents: string[];
  readonly agentLines: number[];
  readonly rules: RobotsRule[];
}

/**
 * Tokenizes one `robots.txt` body.
 *
 * Tolerant in the way RFC 9309 section 2.3.1.5 asks for -- "Crawlers MUST try
 * to parse each line" -- and honest about what it could not parse, rather than
 * discarding it. CRLF, LF, a lone CR, a missing final newline, comments, blank
 * lines and unknown fields are all handled; none of them ends a group.
 */
export function parseRobots(
  body: Uint8Array,
  limits: Partial<RobotsParseLimits> = {},
): ParsedRobots {
  const bounds: RobotsParseLimits = { ...ROBOTS_PARSE_LIMITS, ...limits };
  if (body.length > bounds.maxBytes) return refused("bytes");

  const decoded = decodeUtf8(body);
  const lines = splitLines(decoded.text);
  if (lines.length > bounds.maxLines) return refused("lines");

  const groups: RobotsGroup[] = [];
  const extensions: RobotsExtensionRecord[] = [];
  const malformed: RobotsMalformedLine[] = [];
  let malformedCount = 0;
  let ruleCount = 0;
  let open: OpenGroup | null = null;
  let openHasRules = false;

  const note = (line: number, reason: RobotsMalformedReason): void => {
    malformedCount += 1;
    if (malformed.length < MAX_DESCRIBED_MALFORMED_LINES) {
      malformed.push({ line, reason });
    }
  };
  const close = (): void => {
    if (open === null) return;
    groups.push({
      agents: open.agents,
      agentLines: open.agentLines,
      rules: open.rules,
    });
    open = null;
    openHasRules = false;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    if (raw.length > bounds.maxLineLength) return refused("line-length");
    const lineNumber = index + 1;

    // `EOL = *WS [comment] NL` and `comment = "#" *(UTF8-char-noctl / WS /
    // "#")`, and `#` is excluded from `UTF8-char-noctl`, so the first `#` on a
    // line always starts the comment and never sits inside a path or a value.
    const hash = raw.indexOf("#");
    const line = trimWs(hash === -1 ? raw : raw.slice(0, hash));
    if (line.length === 0) continue;

    const colon = line.indexOf(":");
    if (colon === -1) {
      note(lineNumber, "no-separator");
      continue;
    }
    const field = trimWs(line.slice(0, colon)).toLowerCase();
    const value = trimWs(line.slice(colon + 1));
    if (!TOKEN.test(field)) {
      note(lineNumber, "unparseable-field");
      continue;
    }

    if (field === "user-agent") {
      if (!isProductToken(value)) {
        note(lineNumber, "bad-product-token");
        continue;
      }
      // `group = startgroupline *(startgroupline / emptyline) *(rule /
      // emptyline)`: consecutive agent lines share one group, and an agent
      // line after a rule starts the next one.
      let current: OpenGroup | null = open;
      if (current === null || openHasRules) {
        close();
        if (groups.length >= bounds.maxGroups) return refused("groups");
        current = { agents: [], agentLines: [], rules: [] };
        open = current;
      }
      current.agents.push(value.toLowerCase());
      current.agentLines.push(lineNumber);
      continue;
    }

    if (field === "allow" || field === "disallow") {
      if (value.length !== 0 && !isPathPattern(value)) {
        note(lineNumber, "bad-path-pattern");
        continue;
      }
      const current = open;
      if (current === null) {
        note(lineNumber, "rule-outside-group");
        continue;
      }
      ruleCount += 1;
      if (ruleCount > bounds.maxRules) return refused("rules");
      current.rules.push({ line: lineNumber, type: field, path: value });
      openHasRules = true;
      continue;
    }

    // RFC 9309 section 2.2.4. Handed out, never interpreted, and pointedly not
    // touching `open` or `openHasRules`: that is the non-interference MUST.
    if (extensions.length >= bounds.maxExtensions) return refused("extensions");
    extensions.push({ line: lineNumber, field, value });
  }
  close();

  return {
    refusedBy: null,
    invalidUtf8: !decoded.valid,
    lineCount: lines.length,
    groups,
    extensions,
    malformed,
    malformedCount,
  };
}

/**
 * The distinct extension field names, sorted and bounded.
 *
 * `docs/FIXTURE_CATALOG.md` case `rob-006` wants the ignored field names
 * reported "in a bounded way". This is that list; the cap is separate from
 * `maxExtensions` because a thousand records can carry a thousand distinct
 * names.
 */
export function extensionFieldNames(
  parsed: ParsedRobots,
  limit = 16,
): readonly string[] {
  const names = new Set<string>();
  for (const record of parsed.extensions) {
    names.add(record.field);
    if (names.size >= limit) break;
  }
  return [...names].sort();
}
