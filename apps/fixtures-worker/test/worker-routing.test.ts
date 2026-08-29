/**
 * The Workers adapter. ADR-0006 section 2 keeps `<id>.fixture.test` as a
 * manifest label, and a deployed Worker is the one place it is ever used: the
 * case is selected from the leftmost label of the request host.
 *
 * It is never given to a transport and never used to build a scan target. The
 * local harness reaches these same cases at `http://127.0.0.1:<port>` with one
 * fixture per port, which `test/base-origin.test.ts` exercises.
 */
import { exports as workerExports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("host-label routing", () => {
  it("serves the case named by the leftmost host label", async () => {
    const response = await workerExports.default.fetch(
      "https://rob-001.fixture.test/robots.txt",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(await response.text()).toContain("User-agent: GPTBot");
  });

  it("serves each case its own override of the same path", async () => {
    const absent = await workerExports.default.fetch(
      "https://rob-002.fixture.test/robots.txt",
    );
    expect(absent.status).toBe(404);

    const softNotFound = await workerExports.default.fetch(
      "https://rob-003.fixture.test/robots.txt",
    );
    expect(softNotFound.status).toBe(200);
    expect(softNotFound.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
  });

  it("negotiates the homepage in the Workers runtime too", async () => {
    const markdown = await workerExports.default.fetch(
      "https://md-001.fixture.test/",
      { headers: { accept: "text/markdown" } },
    );
    expect(markdown.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(markdown.headers.get("vary")).toBe("Accept");
  });

  it("does not serve a layer-B case", async () => {
    // ADR-0006 section 4: layer B is structurally undeployable, so the two
    // cases whose subject is the wire are absent from the compiled manifest.
    const response = await workerExports.default.fetch(
      "https://lnk-001.fixture.test/robots.txt",
    );
    expect(response.status).toBe(404);
  });

  it("answers 404 for a host label with no fixture", async () => {
    const response = await workerExports.default.fetch(
      "https://not-a-case.fixture.test/robots.txt",
    );
    expect(response.status).toBe(404);
  });
});
