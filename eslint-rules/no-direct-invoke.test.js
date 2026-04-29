import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "./no-direct-invoke.js";

// Wire RuleTester into vitest's globals so test failures surface through
// vitest's reporter rather than RuleTester's default console output.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it;

const tester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
  },
});

tester.run("no-direct-invoke", rule, {
  valid: [
    // tauri-commands.ts is the single allowed importer.
    {
      code: `import { invoke } from "@tauri-apps/api/core";`,
      filename: "src/lib/tauri-commands.ts",
    },
    // Importing something other than invoke is fine anywhere.
    {
      code: `import { convertFileSrc } from "@tauri-apps/api/core";`,
      filename: "src/components/Foo.tsx",
    },
    // Importing from a different package is fine.
    {
      code: `import { listen } from "@tauri-apps/api/event";`,
      filename: "src/components/Foo.tsx",
    },
    // Default import (not a named specifier) should not be flagged.
    {
      code: `import core from "@tauri-apps/api/core";`,
      filename: "src/components/Foo.tsx",
    },
  ],
  invalid: [
    // Direct invoke import in a component file.
    {
      code: `import { invoke } from "@tauri-apps/api/core";`,
      filename: "src/components/Foo.tsx",
      errors: [{ messageId: "noDirectInvoke" }],
    },
    // invoke alongside other imports still triggers.
    {
      code: `import { invoke, convertFileSrc } from "@tauri-apps/api/core";`,
      filename: "src/lib/some-util.ts",
      errors: [{ messageId: "noDirectInvoke" }],
    },
    // Deep path that happens to end differently.
    {
      code: `import { invoke } from "@tauri-apps/api/core";`,
      filename: "src/hooks/useCustom.ts",
      errors: [{ messageId: "noDirectInvoke" }],
    },
  ],
});
