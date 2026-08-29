/**
 * Parser ownership for `packages/rules-standard`.
 *
 * This file re-exports nothing on purpose, and that is the point of it.
 *
 * Eight rule families are built in parallel and six of them own a parser here.
 * A barrel that re-exported each one would be a single file all six had to
 * edit, which is the collision the rest of this package is arranged to avoid.
 * A rule therefore imports a parser by its own path, as
 * `import { parseRobots } from "../parsers/robots.js"`, and adding a parser
 * touches exactly one new file. What is left here is the ledger that keeps two
 * agents from both writing a robots parser.
 *
 * OWNERSHIP. The owner writes the module; a consumer imports it and does not
 * modify it. A consumer that needs a behaviour change asks the owner rather
 * than forking the parser, because a second robots parser is a second answer
 * to "what does this file say".
 *
 * | Module              | Owner            | Consumers                          |
 * | ------------------- | ---------------- | ---------------------------------- |
 * | `media-type.ts`     | markdown         | sitemap, api-catalog, skills, robots |
 * | `robots.ts`         | robots           | ai-crawler, content-signals, sitemap |
 * | `link-header.ts`    | link             | none                                |
 * | `json-safe.ts`      | api-catalog      | skills                              |
 * | `sitemap-xml.ts`    | sitemap          | none                                |
 * | `content-signals.ts`| content-signals  | none                                |
 *
 * ORDERING. `media-type.ts`, `robots.ts` and `json-safe.ts` have consumers, so
 * their owners land them before the consuming rules need them. Nothing here
 * blocks a consuming agent from starting: a rule can be written against the
 * parser signature it needs and the two reconciled once both exist.
 *
 * CONSTRAINTS every module in this directory inherits.
 *
 * - Input is hostile. Every parser reads bytes an unknown origin served, under
 *   `docs/THREAT_MODEL.md`. Bound the input, bound the output, and review any
 *   regex over target text for pathological backtracking.
 * - `fetch`, `process`, `URL` and `AbortSignal` do not exist here: the package
 *   compiles with `"lib": ["ES2023"]` and `"types": []`, and
 *   `test/boundaries/package-boundaries.test.ts` asserts that each of those
 *   names fails to resolve. A parser receives bytes or a decoded string; it
 *   never fetches and never resolves a URL itself.
 * - Pure and synchronous. No clock, no randomness, no `Promise`, no timer.
 * - A parse result that reaches `context.memo()` must be plain JSON-shaped
 *   data: no `Map`, `Set`, `Date`, `Uint8Array`, `RegExp`, class instance,
 *   getter, symbol key, cycle or `undefined` property survives the freeze in
 *   ADR-0002 section 11. The shared robots representation is the memo key
 *   `agentready-lab/parsed-robots/v1`, and `MEMO_KEYS` in `packages/core` is
 *   the closed list, so a new shared parse result is a one-line change there
 *   first.
 * - XML parsing resolves no DTD and no external entity.
 */

export {};
