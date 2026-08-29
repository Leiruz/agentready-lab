import { describe, expect, it } from "vitest";

import {
  TEXT_LIMITS,
  TRUNCATION_MARKER,
  neutralizeWorkflowCommands,
  sanitize,
} from "../src/index.js";
import {
  ANSI_RED,
  ANSI_RESET,
  ASTRAL,
  BEL,
  C1_CSI,
  C1_OSC,
  CR,
  DEL,
  ESC,
  FSI,
  HOSTILE,
  LF,
  LSEP,
  NUL,
  OSC8_LINK,
  PDF,
  PDI,
  RLO,
  WORKFLOW_COMMAND,
} from "./support/fixtures.js";

/**
 * `docs/THREAT_MODEL.md` section 20.3.
 *
 * Every case here is a payload rather than a description of one. A sanitizer
 * that has only been read is a sanitizer that does not work, so each rule is
 * attacked with the byte sequence it exists to stop, and the removal of any
 * one rule has to make one of these fail.
 */

const CAP = TEXT_LIMITS.value;

/** Anything that must never reach a terminal, a log or a Markdown renderer. */
function unsafeCharacters(text: string): readonly string[] {
  const found: string[] = [];
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const unsafe =
      (code < 0x20 && code !== 0x0a) ||
      code === 0x7f ||
      (code >= 0x80 && code <= 0x9f) ||
      code === 0x061c ||
      code === 0x200e ||
      code === 0x200f ||
      code === 0x2028 ||
      code === 0x2029 ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069);
    if (unsafe) found.push(`U+${code.toString(16).toUpperCase()}`);
  }
  return found;
}

describe("escape sequences", () => {
  it("removes an SGR sequence whole, not just its introducer", () => {
    const painted = `${ANSI_RED}danger${ANSI_RESET}`;

    // The weaker control that core applies would kill the ESC and leave the
    // parameters, so asserting only "no ESC" would pass without this rule.
    expect(sanitize(painted, CAP)).toBe("danger");
  });

  it("removes an OSC 8 hyperlink and keeps only its visible label", () => {
    const sanitized = sanitize(OSC8_LINK, CAP);

    expect(sanitized).toBe("your bank");
    expect(sanitized).not.toContain("attacker.example");
    expect(sanitized).not.toContain("8;;");
  });

  it("removes a cursor-control CSI and a screen clear", () => {
    expect(sanitize(`${ESC}[2J${ESC}[1;1Hgone`, CAP)).toBe("gone");
  });

  it("removes the single-byte C1 introducers", () => {
    expect(sanitize(`${C1_CSI}31mred`, CAP)).toBe("red");
    expect(sanitize(`${C1_OSC}0;title${BEL}kept`, CAP)).toBe("kept");
  });

  it("leaves no ESC behind for an unterminated OSC", () => {
    const sanitized = sanitize(`${ESC}]8;;https://attacker.example`, CAP);

    // The arguments stay visible on purpose: swallowing to the end of the
    // string would delete legitimate text, and rule 2 has already made the
    // remainder inert by removing every ESC.
    expect(sanitized).not.toContain(ESC);
    expect(sanitized).toBe("8;;https://attacker.example");
  });
});

describe("control characters", () => {
  it("removes C0, DEL and C1", () => {
    const sanitized = sanitize(`a${NUL}b${CR}${LF}c${DEL}d`, CAP);

    expect(sanitized).toBe("abcd");
    expect(unsafeCharacters(sanitized)).toStrictEqual([]);
  });

  it("cannot let one field become two lines", () => {
    expect(sanitize(`first${LF}second`, CAP)).not.toContain(LF);
  });
});

describe("bidirectional and separator characters", () => {
  it("removes overrides and isolates", () => {
    const spoofed = `${RLO}moc.rekcatta${PDF} ${FSI}safe${PDI}`;

    expect(sanitize(spoofed, CAP)).toBe("moc.rekcatta safe");
  });

  it("removes the line and paragraph separators", () => {
    expect(sanitize(`one${LSEP}two`, CAP)).toBe("onetwo");
  });
});

describe("workflow commands", () => {
  it("escapes a leading colon pair so a runner cannot read a command", () => {
    const sanitized = sanitize(WORKFLOW_COMMAND, CAP);

    expect(sanitized.startsWith("::")).toBe(false);
    expect(sanitized).toBe("\\:\\:error title=pwned::injected annotation");
  });

  it("escapes a pair that only appears once a control byte is removed", () => {
    // The order of the rules is what this proves: the colon pair does not
    // exist in the input, and would not exist for a sanitizer that neutralized
    // before it stripped.
    expect(sanitize(`:${NUL}:stop-commands::x`, CAP).startsWith("::")).toBe(
      false,
    );
  });

  it("leaves an IPv6 literal and a scope operator alone", () => {
    const url = "http://[::1]:8787/std::vector";

    expect(sanitize(url, CAP)).toBe(url);
  });

  it("escapes every line of a document, not only the first", () => {
    const document = ["ok", "::add-mask::secret", "  ::error::two"].join(LF);
    const guarded = neutralizeWorkflowCommands(document);

    for (const line of guarded.split(LF)) {
      expect(line.trimStart().startsWith("::")).toBe(false);
    }
  });
});

describe("bounding", () => {
  it("leaves a value of exactly the cap untouched", () => {
    const exact = "a".repeat(CAP);

    expect(sanitize(exact, CAP)).toBe(exact);
    expect(sanitize(exact, CAP)).not.toContain(TRUNCATION_MARKER);
  });

  it("marks a value one character over the cap and stays within it", () => {
    const sanitized = sanitize("a".repeat(CAP + 1), CAP);

    expect(sanitized).toHaveLength(CAP);
    expect(sanitized.endsWith(TRUNCATION_MARKER)).toBe(true);
  });

  it("never cuts an astral character in half", () => {
    // The cut falls at `cap - marker.length`, which is exactly between the two
    // code units of the emoji. A lone surrogate would render as U+FFFD and
    // would make the same string unserializable as canonical JSON (RFC 8785
    // section 3.2.2.2), so the half character goes and the value comes back one
    // short of the cap.
    const cap = 40;
    const filler = "a".repeat(cap - TRUNCATION_MARKER.length - 1);
    const sanitized = sanitize(`${filler}${ASTRAL}${"t".repeat(20)}`, cap);

    expect(sanitized).toBe(`${filler}${TRUNCATION_MARKER}`);
    expect(sanitized).toHaveLength(cap - 1);
    for (const character of sanitized) {
      const code = character.codePointAt(0) ?? 0;
      expect(code >= 0xd800 && code <= 0xdfff).toBe(false);
    }
  });
});

describe("the whole payload", () => {
  it("leaves nothing unsafe in the sec-010 string", () => {
    const sanitized = sanitize(HOSTILE, TEXT_LIMITS.message);

    expect(unsafeCharacters(sanitized)).toStrictEqual([]);
    expect(sanitized).not.toContain("attacker.example");
    expect(sanitized.startsWith("::")).toBe(false);
  });

  it("is idempotent", () => {
    const once = sanitize(HOSTILE, TEXT_LIMITS.message);

    expect(sanitize(once, TEXT_LIMITS.message)).toBe(once);
  });
});
