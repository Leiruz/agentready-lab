import { exports as workerExports } from "cloudflare:workers";
import { expect, it } from "vitest";

it("answers 404 for a path with no registered fixture", async () => {
  const response = await workerExports.default.fetch(
    "https://fixtures.invalid/nothing-here",
  );

  expect(response.status).toBe(404);
  expect(response.headers.get("content-type")).toBe(
    "text/plain; charset=utf-8",
  );
});
