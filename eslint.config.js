// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**", "reports/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  eslintConfigPrettier,
  // This repo's own config files are not in tsconfig.json (it includes src/ and test/
  // only), so type-aware rules had to reach them through the parser's default project --
  // which has no `module: NodeNext` and therefore types `import.meta` as an error, tripping
  // no-unsafe-assignment on `tsconfigRootDir` below. They configure tooling rather than
  // ship, so the fix is to lint them without type information instead of inventing a
  // tsconfig for them.
  {
    files: ["eslint.config.js", "vitest.config.ts"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
