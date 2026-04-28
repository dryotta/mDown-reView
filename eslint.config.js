import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import noSharedBooleanMount from "./eslint-rules/no-shared-boolean-mount.js";

export default [
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      react: reactPlugin,
      "react-hooks": reactHooks,
      // Local rules live under `eslint-rules/`. See docs/architecture.md
      // rule 28 for the no-shared-boolean-mount enforcement.
      local: { rules: { "no-shared-boolean-mount": noSharedBooleanMount } },
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "local/no-shared-boolean-mount": "error",

      // Core ESLint rules
      "no-console": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-var": "error",
      "prefer-const": "error",

      // React quality rules
      "react/no-array-index-key": "warn",
      "react/self-closing-comp": "warn",
      "react/jsx-boolean-value": ["warn", "never"],
    },
    settings: { react: { version: "detect" } },
  },
  {
    files: [
      "src/**/*.test.{ts,tsx}",
      "src/**/*.spec.{ts,tsx}",
      "src/__mocks__/**/*.{ts,tsx}",
      "src/__tests__/**/*.{ts,tsx}",
      "src/test-setup.ts",
    ],
    rules: {
      "no-console": "off",
    },
  },
  prettier,
];
