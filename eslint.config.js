import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import-x";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import security from "eslint-plugin-security";
import noDirectInvoke from "./eslint-rules/no-direct-invoke.js";
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
      "import-x": importPlugin,
      react: reactPlugin,
      "react-hooks": reactHooks,
      // Local rules live under `eslint-rules/`. See docs/architecture.md
      // rule 28 for the no-shared-boolean-mount enforcement.
      local: {
        rules: {
          "no-shared-boolean-mount": noSharedBooleanMount,
          "no-direct-invoke": noDirectInvoke,
        },
      },
      security: security,
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
      "local/no-direct-invoke": "error",

      // Import hygiene
      "import-x/no-duplicates": "warn",
      "import-x/no-self-import": "error",
      "import-x/order": [
        "warn",
        {
          groups: [
            ["builtin", "external"],
            "internal",
            ["parent", "sibling", "index"],
          ],
          alphabetize: { order: "asc", caseInsensitive: true },
          "newlines-between": "always",
        },
      ],

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

      // Security
      "security/detect-non-literal-regexp": "warn",
      "security/detect-unsafe-regex": "warn",
      "security/detect-object-injection": "off",
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
      "local/no-direct-invoke": "off",
    },
  },
  prettier,
];
