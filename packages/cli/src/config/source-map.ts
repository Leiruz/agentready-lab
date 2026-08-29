import path from "node:path";

import { configurationError } from "../errors.js";

/**
 * Fixture `sec-011`: "Source map is absolute or contains `..`" is
 * "Configuration rejected before scanning"
 * (`docs/FIXTURE_CATALOG.md` section 13).
 *
 * A source map turns a web resource into a repository file location, and
 * `docs/THREAT_MODEL.md` section 20 makes those locations the only way a
 * finding becomes an actionable code-scanning result. A path that escapes the
 * repository therefore does not merely read the wrong file; it writes an
 * annotation onto a file the scan never looked at. So this is a validator and
 * not a resolver: nothing here touches the filesystem, and every rejection
 * happens before a target request exists.
 *
 * The rules are stated as five separate refusals with five separate messages
 * rather than one regular expression. A single pattern would be shorter and
 * would tell a user with a Windows drive letter that their path "is invalid",
 * which is the class of message this project spends its error text avoiding.
 */

/** `C:` or `c:/`, with either separator or none. */
const DRIVE_LETTER = /^[A-Za-z]:/;

/** `\\server\share`, `//server/share`, and the `\\?\` extended form. */
const UNC_PREFIX = /^[/\\]{2}/;

/** A percent-encoded dot, which is a `.` that survives one decode. */
const ENCODED_DOT = /%2e/i;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/;

function segmentsOf(value: string): readonly string[] {
  return value.split(/[/\\]+/);
}

/**
 * One repository-relative path, or a refusal.
 *
 * `where` names the setting so that a map with twenty entries says which one
 * stopped the run.
 */
export function assertRepositoryPath(where: string, value: string): void {
  if (value === "") {
    throw configurationError(
      `${where} is empty.`,
      "A source-map entry names a repository file; an empty path names none.",
    );
  }
  if (CONTROL.test(value)) {
    throw configurationError(
      `${where} contains a control character.`,
      "A repository path is printed into reports and annotations, so control characters are refused rather than escaped.",
    );
  }
  if (UNC_PREFIX.test(value)) {
    throw configurationError(
      `${where} is a UNC path: ${JSON.stringify(value)}.`,
      "A UNC prefix names a host and a share, which is remote I/O outside the approved transport. Use a path relative to the repository root.",
    );
  }
  if (DRIVE_LETTER.test(value)) {
    throw configurationError(
      `${where} begins with a drive letter: ${JSON.stringify(value)}.`,
      "A drive-qualified path is absolute. Use a path relative to the repository root, such as public/robots.txt.",
    );
  }
  if (value.startsWith("/") || value.startsWith("\\")) {
    throw configurationError(
      `${where} is absolute: ${JSON.stringify(value)}.`,
      "Use a path relative to the repository root, such as public/robots.txt.",
    );
  }
  if (ENCODED_DOT.test(value)) {
    throw configurationError(
      `${where} contains a percent-encoded dot: ${JSON.stringify(value)}.`,
      "A repository path is a filesystem path and is never percent-decoded, so an encoded dot is either a mistake or an attempt to hide one. Write the path literally.",
    );
  }
  if (segmentsOf(value).includes("..")) {
    throw configurationError(
      `${where} contains a '..' segment: ${JSON.stringify(value)}.`,
      "A source map may not leave the repository.",
    );
  }

  // The second pass. The check above reads the string the user wrote; this one
  // reads what a consumer that joins and normalizes would get. They agree
  // today for every input this validator accepts, and they are both kept
  // because the first is a statement about the text and the second is a
  // statement about the path it denotes, and a future separator or
  // normalization rule can move one without moving the other.
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  if (normalized === ".." || normalized.startsWith("../")) {
    throw configurationError(
      `${where} escapes the repository once normalized: ${JSON.stringify(value)} becomes ${JSON.stringify(normalized)}.`,
      "A source map may not leave the repository.",
    );
  }
  if (path.posix.isAbsolute(normalized)) {
    throw configurationError(
      `${where} is absolute once normalized: ${JSON.stringify(value)} becomes ${JSON.stringify(normalized)}.`,
      "Use a path relative to the repository root.",
    );
  }
}

/**
 * The web-resource half of one entry.
 *
 * The key is an origin-relative request path, not a file path, so it has its
 * own rules: it must be rooted, it may not be protocol-relative, and it may
 * not traverse, because a key that normalizes to a different resource maps a
 * finding onto a file that was never observed.
 */
function assertRequestPath(key: string): void {
  // Checked before the label below quotes the key, so a key with a control
  // character is described rather than echoed.
  if (CONTROL.test(key) || key.includes("\\")) {
    throw configurationError(
      "a report.sourceMap key contains a control character or a backslash.",
      "A request path uses '/' and no control characters.",
    );
  }
  const where = `report.sourceMap key ${JSON.stringify(key)}`;
  if (!key.startsWith("/")) {
    throw configurationError(
      `${where} is not origin-relative.`,
      "A source-map key is a request path and begins with '/', such as /robots.txt.",
    );
  }
  if (key.startsWith("//")) {
    throw configurationError(
      `${where} is protocol-relative.`,
      "A leading '//' names an authority. A source-map key is a path on the scanned origin only.",
    );
  }
  if (segmentsOf(key).includes("..")) {
    throw configurationError(
      `${where} contains a '..' segment.`,
      "The key must be the resolved request path the scan actually observes.",
    );
  }
}

export type SourceMap = ReadonlyMap<string, string>;

/**
 * Validates a whole map and freezes it into insertion-independent order.
 *
 * Entries are sorted by key so that two configurations with the same pairs
 * produce the same map whatever order they were written in. Nothing downstream
 * depends on that yet, and it costs one line to make true now rather than to
 * discover is false later.
 */
export function validateSourceMap(
  entries: Readonly<Record<string, unknown>>,
): SourceMap {
  const validated = new Map<string, string>();
  for (const key of Object.keys(entries).sort()) {
    const value = entries[key];
    if (typeof value !== "string") {
      throw configurationError(
        `report.sourceMap[${JSON.stringify(key)}] is not a string.`,
        "Each entry maps a request path to one repository-relative file path.",
      );
    }
    assertRequestPath(key);
    assertRepositoryPath(`report.sourceMap[${JSON.stringify(key)}]`, value);
    validated.set(key, value);
  }
  return validated;
}
