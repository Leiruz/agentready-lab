import { describe, expect, it } from "vitest";

import type { ParsedRobots } from "../../src/parsers/robots.js";
import { parseRobots } from "../../src/parsers/robots.js";
import {
  effectiveAccess,
  pathPatternMatches,
  patternOctets,
  selectGroup,
} from "../../src/rules/ai-crawler.js";

/**
 * RFC 9309 group selection and precedence, with no harness and no transport.
 *
 * `src/parsers/robots.ts` deliberately stops at tokenizing, so everything
 * asserted here is `web.policy.ai-crawler`'s own work: section 2.2.1's
 * case-insensitive product-token matching, wildcard fall-through and group
 * merging, and section 2.2.2's most-octets precedence with its allow-wins tie.
 *
 * These are properties of a byte string and a path, and `docs/TEST_STRATEGY.md`
 * section 3 puts them below the contract tier for that reason: asserting them
 * through a scan would add ways for the assertion to be satisfied by something
 * other than the matcher.
 */

const encoder = new TextEncoder();

function parse(lines: readonly string[]): ParsedRobots {
  return parseRobots(encoder.encode(lines.join("\n")));
}

describe("RFC 9309 section 2.2.1 group selection", () => {
  it("matches the product token case-insensitively", () => {
    const parsed = parse(["User-agent: GPTBot", "Disallow: /private/"]);

    for (const spelling of ["GPTBot", "gptbot", "GPTBOT", "gPtBoT"]) {
      const selection = selectGroup(parsed, spelling);
      expect(selection.agent).toBe("gptbot");
      expect(selection.rules).toEqual([
        { line: 2, type: "disallow", path: "/private/" },
      ]);
    }
  });

  it("combines every group naming the same product token", () => {
    // The case `bot-005` exists for: a document repeating a token contributes
    // all of its rules, not the first group's alone.
    const parsed = parse([
      "User-agent: ClaudeBot",
      "Disallow: /research/",
      "",
      "User-agent: ClaudeBot",
      "Allow: /research/public/",
    ]);

    expect(selectGroup(parsed, "ClaudeBot")).toEqual({
      agent: "claudebot",
      rules: [
        { line: 2, type: "disallow", path: "/research/" },
        { line: 5, type: "allow", path: "/research/public/" },
      ],
    });
  });

  it("merges a group that names the token beside other tokens", () => {
    const parsed = parse([
      "User-agent: SomeBot",
      "User-agent: GPTBot",
      "Disallow: /a",
      "",
      "User-agent: GPTBot",
      "Disallow: /b",
    ]);

    expect(selectGroup(parsed, "GPTBot").rules).toEqual([
      { line: 3, type: "disallow", path: "/a" },
      { line: 6, type: "disallow", path: "/b" },
    ]);
  });

  it("uses the wildcard group only when no specific group exists", () => {
    const parsed = parse(["User-agent: *", "Allow: /"]);

    const selection = selectGroup(parsed, "GPTBot");
    expect(selection.agent).toBe("*");
    expect(selection.rules).toEqual([{ line: 2, type: "allow", path: "/" }]);
  });

  it("prefers the specific group over the wildcard group", () => {
    const parsed = parse([
      "User-agent: *",
      "Disallow: /",
      "",
      "User-agent: ClaudeBot",
      "Allow: /",
    ]);

    expect(selectGroup(parsed, "ClaudeBot")).toEqual({
      agent: "claudebot",
      rules: [{ line: 5, type: "allow", path: "/" }],
    });
  });

  it("lets a matching group with no rules stop the wildcard fall-through", () => {
    // Section 2.2.1 selects the group; section 2.2.2 then allows because it
    // holds no rule. That is a different path to "allowed" than the wildcard's,
    // and conflating them would report the wrong source group.
    const parsed = parse([
      "User-agent: *",
      "Disallow: /",
      "",
      "User-agent: GPTBot",
      "",
      "Sitemap: http://127.0.0.1:8787/sitemap.xml",
    ]);

    expect(selectGroup(parsed, "GPTBot")).toEqual({
      agent: "gptbot",
      rules: [],
    });
  });

  it("selects no group when neither the token nor a wildcard appears", () => {
    const parsed = parse(["User-agent: ExampleBot", "Disallow: /"]);

    expect(selectGroup(parsed, "GPTBot")).toEqual({ agent: null, rules: [] });
  });
});

describe("RFC 9309 section 2.2.3 path patterns", () => {
  it("matches a prefix of the path", () => {
    expect(pathPatternMatches("/foo", "/foo")).toBe(true);
    expect(pathPatternMatches("/foo", "/foobar")).toBe(true);
    expect(pathPatternMatches("/foo", "/foo/deep/page")).toBe(true);
    expect(pathPatternMatches("/foo", "/fo")).toBe(false);
    expect(pathPatternMatches("/foo", "/bar/foo")).toBe(false);
  });

  it("anchors the end of the match on a trailing $", () => {
    expect(pathPatternMatches("/foo$", "/foo")).toBe(true);
    expect(pathPatternMatches("/foo$", "/foobar")).toBe(false);
    expect(pathPatternMatches("/foo$", "/foo/")).toBe(false);
  });

  it("treats $ as an ordinary character anywhere but the end", () => {
    expect(pathPatternMatches("/a$b", "/a$b")).toBe(true);
    expect(pathPatternMatches("/a$b", "/a$bc")).toBe(true);
    expect(pathPatternMatches("/a$b", "/ab")).toBe(false);
    expect(pathPatternMatches("/a$b$", "/a$b")).toBe(true);
    expect(pathPatternMatches("/a$b$", "/a$bc")).toBe(false);
  });

  it("expands * to any run of characters, including none", () => {
    expect(pathPatternMatches("/fish*", "/fish")).toBe(true);
    expect(pathPatternMatches("/fish*", "/fishheads")).toBe(true);
    expect(pathPatternMatches("/*.pdf", "/reports/q3.pdf")).toBe(true);
    expect(pathPatternMatches("/*.pdf", "/reports/q3.pdf.txt")).toBe(true);
    expect(pathPatternMatches("/a*b*c", "/axxbyyc")).toBe(true);
    expect(pathPatternMatches("/a*b*c", "/axxcyyb")).toBe(false);
  });

  it("combines * with the $ anchor", () => {
    expect(pathPatternMatches("/*.pdf$", "/reports/q3.pdf")).toBe(true);
    expect(pathPatternMatches("/*.pdf$", "/reports/q3.pdf.txt")).toBe(false);
    // The anchored tail must land after everything already consumed, so a
    // right-to-left search is required and a leftmost one would be wrong here.
    expect(pathPatternMatches("/a*a$", "/aa")).toBe(true);
    expect(pathPatternMatches("/a*a$", "/ab")).toBe(false);
  });

  it("matches nothing for RFC 9309's empty-pattern", () => {
    // The ABNF keeps `empty-pattern` apart from `path-pattern` and gives it no
    // matching semantics. A zero-length prefix would make a bare `Disallow:`
    // block the whole site, which inverts what it means everywhere it is used.
    expect(pathPatternMatches("", "/")).toBe(false);
    expect(pathPatternMatches("", "/anything")).toBe(false);
  });

  it("does not read a pattern as a regular expression", () => {
    // Target text reaches this matcher, so pattern metacharacters have to be
    // literals rather than an engine a publisher could drive.
    expect(pathPatternMatches("/a.c", "/abc")).toBe(false);
    expect(pathPatternMatches("/a.c", "/a.c")).toBe(true);
    expect(pathPatternMatches("/a+", "/aaa")).toBe(false);
    expect(pathPatternMatches("/(a)", "/(a)")).toBe(true);
  });
});

describe("RFC 9309 section 2.2.2 precedence", () => {
  it("gives the longest matching pattern the decision", () => {
    const parsed = parse([
      "User-agent: GPTBot",
      "Disallow: /research/",
      "Allow: /research/public/",
    ]);

    expect(
      effectiveAccess(parsed, "GPTBot", "/research/public/paper.pdf"),
    ).toEqual({
      token: "GPTBot",
      decision: "allowed",
      agent: "gptbot",
      rule: { line: 3, type: "allow", path: "/research/public/" },
    });
    expect(
      effectiveAccess(parsed, "GPTBot", "/research/private/paper.pdf").decision,
    ).toBe("disallowed");
  });

  it("keeps the longest pattern whatever order it appears in", () => {
    const forward = parse([
      "User-agent: GPTBot",
      "Allow: /a/long/specific/path",
      "Disallow: /a/",
    ]);
    const reversed = parse([
      "User-agent: GPTBot",
      "Disallow: /a/",
      "Allow: /a/long/specific/path",
    ]);

    for (const parsed of [forward, reversed]) {
      expect(
        effectiveAccess(parsed, "GPTBot", "/a/long/specific/path").decision,
      ).toBe("allowed");
    }
  });

  it("gives an equal-length allow the decision, in either order", () => {
    const allowFirst = parse([
      "User-agent: GPTBot",
      "Allow: /x/y",
      "Disallow: /x/y",
    ]);
    const disallowFirst = parse([
      "User-agent: GPTBot",
      "Disallow: /x/y",
      "Allow: /x/y",
    ]);

    for (const parsed of [allowFirst, disallowFirst]) {
      const access = effectiveAccess(parsed, "GPTBot", "/x/y");
      expect(access.decision).toBe("allowed");
      expect(access.rule?.type).toBe("allow");
    }
  });

  it("allows by default when no rule in the matching group matches", () => {
    const parsed = parse(["User-agent: GPTBot", "Disallow: /private/"]);

    expect(effectiveAccess(parsed, "GPTBot", "/public/page")).toEqual({
      token: "GPTBot",
      decision: "allowed",
      agent: "gptbot",
      rule: null,
    });
  });

  it("allows by default when no group matches at all", () => {
    const parsed = parse(["User-agent: ExampleBot", "Disallow: /"]);

    expect(effectiveAccess(parsed, "GPTBot", "/")).toEqual({
      token: "GPTBot",
      decision: "allowed",
      agent: null,
      rule: null,
    });
  });

  it("ignores an empty disallow value rather than blocking the site", () => {
    const parsed = parse(["User-agent: GPTBot", "Disallow:"]);

    const access = effectiveAccess(parsed, "GPTBot", "/anything");
    expect(access.decision).toBe("allowed");
    expect(access.rule).toBeNull();
  });

  it("resolves the merged group, not the first matching one", () => {
    // `bot-005`. The winning rule is in the second group, so a first-group-only
    // resolver reports `disallowed` here.
    const parsed = parse([
      "User-agent: ClaudeBot",
      "Disallow: /research/",
      "",
      "User-agent: ClaudeBot",
      "Allow: /research/public/",
    ]);

    expect(
      effectiveAccess(parsed, "ClaudeBot", "/research/public/paper.pdf"),
    ).toEqual({
      token: "ClaudeBot",
      decision: "allowed",
      agent: "claudebot",
      rule: { line: 5, type: "allow", path: "/research/public/" },
    });
  });

  it("resolves the specific group even when the wildcard disallows", () => {
    const parsed = parse([
      "User-agent: *",
      "Disallow: /",
      "",
      "User-agent: ClaudeBot",
      "Allow: /",
    ]);

    const access = effectiveAccess(parsed, "ClaudeBot", "/docs/guide");
    expect(access.decision).toBe("allowed");
    expect(access.agent).toBe("claudebot");
    // The unconfigured token still falls to the wildcard.
    expect(effectiveAccess(parsed, "GPTBot", "/docs/guide")).toMatchObject({
      decision: "disallowed",
      agent: "*",
    });
  });
});

describe("most octets, not most code units", () => {
  it("counts UTF-8 octets", () => {
    expect(patternOctets("/abcde")).toBe(6);
    expect(patternOctets("/ééé")).toBe(7);
    expect(patternOctets("/€")).toBe(4);
    expect(patternOctets("/\u{1d11e}")).toBe(5);
    // What `String.length` would have said, and the reason it is not used.
    expect("/ééé".length).toBeLessThan("/abcde".length);
  });

  it("decides a non-ASCII tie the way section 2.2.2 says", () => {
    // The allow pattern is 5 octets in 3 code units; the disallow is 4 octets
    // in 4 code units. Both match the path, so counting octets allows it and
    // counting code units would disallow it.
    const parsed = parse([
      "User-agent: GPTBot",
      "Allow: /éé",
      "Disallow: /*ab",
    ]);

    const access = effectiveAccess(parsed, "GPTBot", "/ééab");
    expect(access.decision).toBe("allowed");
    expect(access.rule?.path).toBe("/éé");
  });
});
