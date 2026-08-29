/**
 * The pinned Content Signals vocabulary: three labels, cited, and nothing else.
 *
 * WHAT THE PINNED SOURCE IS. `draft-romm-aipref-contentsignals-00`, an
 * **expired** individual Internet-Draft with no standards-track status and no
 * IETF consensus. `specs/sources.v0.yaml` records the reading: the archived
 * text carries the running header "Expires 4 April 2026" over a document dated
 * 1 October 2025, and that expiry was read from the source rather than
 * computed. ADR-0009 section 7 requires every finding that cites the draft to
 * call it expired, so the word is part of the data here and not a footnote.
 *
 * WHAT IT DEFINES. A vocabulary. Section 3 defines three usage categories and
 * Table 1 in section 4 gives their labels. That is the whole of it.
 *
 * WHAT IT DOES NOT DEFINE, and what therefore may not appear in this file.
 * There is no robots.txt field syntax, no ABNF, no placement rule and **no
 * value grammar**. The draft's own table of contents runs Introduction,
 * Conventions, Vocabulary Definition, Usage Category Labels, Security
 * Considerations, IANA Considerations, Addendum, References, and its Security
 * Considerations section reads only "TODO Security". So:
 *
 * - a fourth label may not be added. The set is closed by Table 1, and a token
 *   this project recognizes but the table does not would be this project's
 *   invention presented as a pinned vocabulary;
 * - an allowed-value set may not be added. ADR-0009 section 5 names this as
 *   the concrete forbidden thing: `yes` and `no` may not become an enum
 *   because the community site's examples happen to use them. That needs a
 *   pinned source and a new decision;
 * - nothing here decides a `spec` verdict on its own. ADR-0009 section 2 keeps
 *   the three labels as the vocabulary of the `compat` assertion and of
 *   section 4's advisory `content-signals.unrecognized-vocabulary`. They are a
 *   dated recognition set, not a conformance requirement.
 *
 * `https://contentsignals.org/` is the rule's other Content Signals source and
 * contributes nothing to this file: it was verified on 2026-08-29 as a
 * 1,966-byte JavaScript application shell with no machine-readable grammar,
 * token list or ABNF.
 */

/** The `specs/sources.v0.yaml` id every citation of the draft resolves to. */
export const CONTENT_SIGNALS_SOURCE_ID = "content-signals-draft-00";

export const CONTENT_SIGNALS_DRAFT = "draft-romm-aipref-contentsignals-00";

/**
 * Read from the archived text's running header, not computed from a lifetime.
 *
 * ADR-0009 sections 3 and 7 made confirming this a release blocker for the
 * rule rather than a documentation nicety.
 */
export const CONTENT_SIGNALS_DRAFT_EXPIRY = "2026-04-04";

/** True, and it is data rather than a comment so a test can assert on it. */
export const CONTENT_SIGNALS_DRAFT_EXPIRED = true;

export interface ContentSignalLabel {
  /** The label exactly as Table 1 gives it. */
  readonly label: string;
  /** The section of the draft defining that usage category. */
  readonly definedIn: string;
  /** Where the label string itself is given. Table 1, for all three. */
  readonly labelledIn: string;
}

/**
 * The three labels, in the draft's own section order.
 *
 * Not sorted alphabetically: the order is section 3.1, 3.2, 3.3, so that a
 * reader comparing this file with the draft reads them in the same sequence.
 */
export const CONTENT_SIGNALS_VOCABULARY: readonly ContentSignalLabel[] = [
  { label: "search", definedIn: "3.1", labelledIn: "Table 1 in section 4" },
  { label: "ai-input", definedIn: "3.2", labelledIn: "Table 1 in section 4" },
  { label: "ai-train", definedIn: "3.3", labelledIn: "Table 1 in section 4" },
];

const PINNED_LABELS: ReadonlySet<string> = new Set(
  CONTENT_SIGNALS_VOCABULARY.map((entry) => entry.label),
);

/**
 * Whether a declared token is one of Table 1's three labels.
 *
 * A token outside the set is *unrecognized by this project's pinned sources*,
 * which is all this predicate ever means. It is not a judgement that the
 * publisher wrote something wrong, and it says nothing at all about the value
 * the token was declared with.
 */
export function isPinnedLabel(candidate: string): boolean {
  return PINNED_LABELS.has(candidate);
}
