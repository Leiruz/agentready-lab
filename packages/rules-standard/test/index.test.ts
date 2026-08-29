import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

import { RULES_STANDARD_PACKAGE_VERSION } from "../src/index.js";

it("keeps the exported version in step with package.json", () => {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );

  expect(manifest).toMatchObject({
    name: "@agentready-lab/rules-standard",
    version: RULES_STANDARD_PACKAGE_VERSION,
  });
});
