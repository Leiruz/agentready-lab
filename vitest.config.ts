import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: [
            "packages/*/src/**/*.test.ts",
            "packages/*/test/**/*.test.ts",
          ],
        },
      },
      {
        // docs/TEST_STRATEGY.md section 4: the package-direction check is a
        // small test, not a large architectural framework and not a lint rule.
        test: {
          name: "boundaries",
          environment: "node",
          include: ["test/boundaries/**/*.test.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      // docs/TEST_STRATEGY.md section 13. Set at zero lines of product code
      // so that the threshold is something new code has to meet, never
      // something that gets "temporarily lowered" to let code in.
      include: ["packages/core/src/**", "packages/rules-standard/src/**"],
      thresholds: {
        lines: 85,
        branches: 85,
      },
    },
  },
});
