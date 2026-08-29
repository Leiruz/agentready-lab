import {
  CONTENT_SIGNALS_VOCABULARY,
  isPinnedLabel,
} from "../data/content-signals-vocabulary.v0.js";
import type { RobotsExtensionRecord } from "./robots.js";

/**
 * A **detection-only** reading of the `Content-Signal` records in a robots.txt.
 *
 * THE THING THIS FILE IS NOT. It is not a grammar, and there is no pinned
 * source it could be a grammar for. `draft-romm-aipref-contentsignals-00` is
 * expired and defines a vocabulary and nothing else: no robots.txt field
 * syntax, no ABNF, no placement rule and no value grammar.
 * `https://contentsignals.org/` is a JavaScript application shell.
 * ADR-0009 section 1 therefore forbids writing one, and section 3 retires the
 * only assertion that would have needed it, so `web.policy.content-signals`
 * produces **no `spec: fail` for any Content Signals condition whatsoever**.
 * Nothing below may grow a verdict, and the two places that would be tempting
 * are called out where they occur.
 *
 * WHAT IT IS. A lenient reading whose entire output is *which tokens a
 * publisher declared*. RFC 9309 section 2.2.4 is the authority for reading an
 * extension record at all -- "Crawlers MAY interpret other records that are
 * not part of the robots.txt protocol [...] Crawlers MAY be lenient when
 * interpreting other records" -- and a `MAY` to be lenient is the opposite of
 * a licence to be strict. So every judgement call below is resolved toward
 * recognizing more, and a shape this reading cannot isolate is simply not
 * counted rather than reported as malformed.
 *
 * WHAT IT REFUSES TO DECIDE.
 *
 * - **What a value means.** A declared value is compared with another declared
 *   value for equality, and is never read, classified, or checked against a
 *   set. ADR-0009 section 5 names the concrete forbidden thing: `yes` and `no`
 *   may not become an allowed-value enum because the community examples use
 *   them. Values do not appear in this module's output at all, which is the
 *   structural version of that rule -- a caller cannot report a verdict about
 *   a value it was never handed.
 * - **Whether a record is well formed.** There is no well-formedness condition
 *   to fail. An item that carries no `=`, an empty item and an item whose
 *   token is empty are all read for what they do declare and produce no
 *   complaint.
 * - **Where a record may appear.** The draft defines no placement rule, so
 *   this reads every `Content-Signal` record in the document and does not
 *   attribute one to a REP group. `apps/fixtures-worker` writes the record
 *   above the first `User-agent` line precisely so that no group owns it, and
 *   the robots parser deliberately hands out extension records without group
 *   association. Deriving one here would be the invented placement rule
 *   ADR-0009 forbids.
 *
 * HOSTILE INPUT. The records arrive from `parseRobots`, which already bounded
 * the document at 512 KiB, the line count, the line length and the extension
 * count. Every string this module stores is a slice of that bounded document,
 * so the two counting bounds below are the only ones it needs to add. Both are
 * checked before the work they bound, and the scan is a single linear pass
 * with no regular expression over target text.
 */

/** The lowercased RFC 9309 section 2.2.4 field name this rule reads. */
export const CONTENT_SIGNAL_FIELD = "content-signal";

/** The bound a document exceeded. `null` in `refusedBy` means none did. */
export type ContentSignalLimit = "records" | "declarations";

export interface ContentSignalParseLimits {
  /** `Content-Signal` records in one document. */
  readonly maxRecords: number;
  /** Comma-separated items across every record, whether or not they parse. */
  readonly maxDeclarations: number;
}

/**
 * Generous next to a real declaration, which carries three items in one
 * record, and far below what `ROBOTS_PARSE_LIMITS` would let through.
 */
export const CONTENT_SIGNAL_PARSE_LIMITS: ContentSignalParseLimits = {
  maxRecords: 64,
  maxDeclarations: 512,
};

export interface ContentSignalReading {
  /**
   * The bound the declaration exceeded, or `null`.
   *
   * Non-`null` means the reading was **refused**: `present` is false and every
   * array is empty. A refusal is this scanner's own budget and says nothing
   * about the publisher, so the rule reports it as indeterminate and never as
   * a violation. Reporting it as satisfied would be worse than either: a bound
   * that hid an unrecognized token would silently turn a warning into a pass.
   */
  readonly refusedBy: ContentSignalLimit | null;
  /** At least one `Content-Signal` record was served. */
  readonly present: boolean;
  /**
   * The distinct pinned labels declared, in the draft's Table 1 order.
   *
   * Table 1 order rather than document order, so the array is a projection of
   * a fixed three-member vocabulary and cannot be steered by the target.
   */
  readonly recognized: readonly string[];
  /**
   * The distinct declared tokens outside the pinned set, in first-declared
   * order.
   *
   * "Unrecognized by this project's pinned sources", and nothing stronger. It
   * is not a claim that the token is wrong: the pinned source is an expired
   * draft, and a publisher may well be using a convention that postdates it.
   */
  readonly unrecognized: readonly string[];
  /**
   * The distinct tokens declared more than once with values that are not the
   * same string, in first-conflicting order.
   *
   * Ambiguity, not a violation. No pinned source defines conflict resolution,
   * so this reports the unresolved state instead of selecting a winner.
   */
  readonly conflicting: readonly string[];
}

/** Every array is a fresh literal, so no two fields share a node. */
function refused(limit: ContentSignalLimit): ContentSignalReading {
  return {
    refusedBy: limit,
    present: false,
    recognized: [],
    unrecognized: [],
    conflicting: [],
  };
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

/**
 * Reads every `Content-Signal` record handed out by `parseRobots`.
 *
 * The comma is the separator every example in this repository and on the
 * community site uses, and no source pins it, so an item this reading does not
 * isolate is simply not counted. That direction is safe by construction: a
 * missed token can only shrink `recognized`, never add to `unrecognized`, and
 * the rule has no failure for it to reach in either case.
 */
export function readContentSignals(
  extensions: readonly RobotsExtensionRecord[],
  limits: Partial<ContentSignalParseLimits> = {},
): ContentSignalReading {
  const bounds: ContentSignalParseLimits = {
    ...CONTENT_SIGNAL_PARSE_LIMITS,
    ...limits,
  };
  const records = extensions.filter(
    (record) => record.field === CONTENT_SIGNAL_FIELD,
  );
  if (records.length > bounds.maxRecords) return refused("records");

  /** The first value seen for a token, kept only to compare the next one. */
  const firstValue = new Map<string, string>();
  const recognized = new Set<string>();
  const unrecognizedSeen = new Set<string>();
  const unrecognized: string[] = [];
  const conflictingSeen = new Set<string>();
  const conflicting: string[] = [];
  let declarations = 0;

  for (const record of records) {
    for (const item of record.value.split(",")) {
      declarations += 1;
      if (declarations > bounds.maxDeclarations) {
        return refused("declarations");
      }

      // The first `=` splits the item, so a value containing one keeps it. An
      // item with no `=` still declares its token; it just declares no value.
      const separator = item.indexOf("=");
      const rawToken = separator === -1 ? item : item.slice(0, separator);
      const rawValue = separator === -1 ? "" : item.slice(separator + 1);

      // Lowercased for recognition only. RFC 9309 section 2.2.4's leniency
      // covers it, and it can only move a token from `unrecognized` to
      // `recognized`, which is the direction that avoids inventing a warning.
      const token = trimWs(rawToken).toLowerCase();
      if (token.length === 0) continue;
      const value = trimWs(rawValue);

      const previous = firstValue.get(token);
      if (previous === undefined) {
        firstValue.set(token, value);
      } else if (previous !== value && !conflictingSeen.has(token)) {
        // Exact string comparison, deliberately. Nothing pins what a value
        // means, so this cannot know that `YES` and `yes` are one declaration,
        // and saying so is exactly what the conflict assertion is for. It
        // reports an unresolved state; it does not pick a winner and it does
        // not judge either value.
        conflictingSeen.add(token);
        conflicting.push(token);
      }

      if (isPinnedLabel(token)) {
        recognized.add(token);
      } else if (!unrecognizedSeen.has(token)) {
        unrecognizedSeen.add(token);
        unrecognized.push(token);
      }
    }
  }

  return {
    refusedBy: null,
    present: records.length > 0,
    recognized: CONTENT_SIGNALS_VOCABULARY.map((entry) => entry.label).filter(
      (label) => recognized.has(label),
    ),
    unrecognized,
    conflicting,
  };
}
