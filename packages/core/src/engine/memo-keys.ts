/**
 * The compile-time list of namespaced memo keys.
 *
 * `docs/ARCHITECTURE.md` section 7 prescribes one shared parsed robots
 * representation consumed by three rules, and gives the key by example. A memo
 * key is a shared-cache namespace: two rules that pick the same string get each
 * other's parse result, so the set is closed here rather than being whatever a
 * rule happened to type. A key outside this list is a contract violation.
 *
 * Adding a key is a visible one-line change with a version suffix, which is
 * what makes a parser format change a new key rather than a silent reuse of
 * the old one.
 */
export const MEMO_KEYS = ["agentready-lab/parsed-robots/v1"] as const;

export type MemoKey = (typeof MEMO_KEYS)[number];

const MEMO_KEY_SET: ReadonlySet<string> = new Set<string>(MEMO_KEYS);

export function isMemoKey(candidate: string): candidate is MemoKey {
  return MEMO_KEY_SET.has(candidate);
}
