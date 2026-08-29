import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        // docs/TEST_STRATEGY.md section 2.4: unit, contract and reporter jobs
        // run with the global network APIs replaced by a throwing sentinel, so
        // a rule that reaches the network is a test failure rather than a
        // silent pass.
        test: {
          name: "unit",
          environment: "node",
          setupFiles: ["packages/testkit/src/sentinel/deny-all.setup.ts"],
          include: [
            "packages/*/src/**/*.test.ts",
            "packages/*/test/**/*.test.ts",
          ],
          // The suites that legitimately open sockets. Excluded here and
          // included by the loopback project below: a deny-all install refuses
          // their listeners as well as their connects. configDefaults.exclude
          // must be spread, because setting exclude replaces vitest's own
          // defaults and would start collecting node_modules and dist.
          exclude: [
            ...configDefaults.exclude,
            "packages/transport-node/**",
            "packages/testkit/test/loopback/**",
          ],
        },
      },
      {
        // docs/TEST_STRATEGY.md section 2.4: "Only the local-loopback
        // integration job may open sockets, and only to the exact server
        // created by the test." This tier still denies DNS and every
        // non-loopback destination.
        test: {
          name: "loopback",
          environment: "node",
          setupFiles: ["packages/testkit/src/sentinel/loopback-only.setup.ts"],
          include: [
            "packages/transport-node/src/**/*.test.ts",
            "packages/transport-node/test/**/*.test.ts",
            "packages/testkit/test/loopback/**/*.test.ts",
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
