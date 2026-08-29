import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

// NOTE ON PACKAGE BOUNDARIES.
//
// There is deliberately no `no-restricted-imports` rule here, and none should
// be added. The package boundary in docs/ARCHITECTURE.md section 4 is enforced
// by test/boundaries/package-boundaries.test.ts and by the tsconfig type
// environment (`"lib": ["ES2023"]` with `"types": []` makes `fetch`,
// `process`, `require` and friends undeclared identifiers in core and
// rules-standard). A lint rule can be switched off with a comment on the line
// that violates it; a failing test cannot. Adding the rule here would create
// the impression that lint is the boundary, which would be false and would
// make the real check easier to forget.

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.wrangler/**",
      "coverage/**",
      ".tri/**",
    ],
  },

  js.configs.recommended,

  {
    files: ["**/*.ts"],
    extends: [
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: [
          "./tsconfig.test.json",
          "./packages/*/tsconfig.json",
          "./apps/*/tsconfig.json",
          "./apps/*/tsconfig.test.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],

      // CLAUDE.md, "Code and test quality": no `any`, no broad casts to evade
      // a type problem, no non-null assertions.
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSAnyKeyword",
          message:
            "`any` is banned (CLAUDE.md). Use `unknown` and narrow at the boundary.",
        },
        {
          selector: "TSNonNullExpression",
          message:
            "Non-null assertions are banned (CLAUDE.md). Handle the absent case explicitly.",
        },
      ],
    },
  },

  {
    // Ambient declaration files have to stay global scripts: a top-level
    // `import type` would turn them into modules and their
    // `declare namespace` augmentation would stop applying. `typeof
    // import(...)` is the only way for a global script to name a module type,
    // so the annotation half of consistent-type-imports cannot apply here.
    files: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "separate-type-imports",
          disallowTypeAnnotations: false,
        },
      ],
    },
  },

  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.nodeBuiltin,
    },
  },

  // Must stay last: turns off every rule that fights the formatter.
  prettier,
);
