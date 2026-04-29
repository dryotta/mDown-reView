import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "./no-startup-side-effect-import.js";

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
      ecmaFeatures: { jsx: true },
    },
  },
});

tester.run("no-startup-side-effect-import", rule, {
  valid: [
    // ---- main.tsx allowlist ----
    {
      code: `import React from "react";`,
      filename: "src/main.tsx",
    },
    {
      code: `import "@/styles/x.css";`,
      filename: "src/main.tsx",
    },
    {
      code: `import * as logger from "@/logger";`,
      filename: "src/main.tsx",
    },
    {
      code: `import App from "@/App";`,
      filename: "src/main.tsx",
    },
    {
      code: `import ReactDOM from "react-dom/client";`,
      filename: "src/main.tsx",
    },
    // Issue #264 — runtime tracing fires `recordStartupPhase("theme-applied")`
    // from main.tsx. The wrapper is a thin façade over auto-generated
    // bindings; allowlist explicitly so the cold-start path can opt in.
    {
      code: `import { recordStartupPhase } from "@/lib/tauri-commands";`,
      filename: "src/main.tsx",
    },

    // ---- App.tsx broader allowlist ----
    {
      code: `import { useState } from "react";`,
      filename: "src/App.tsx",
    },
    {
      code: `import { useStore } from "@/store";`,
      filename: "src/App.tsx",
    },
    {
      code: `import { useShallow } from "zustand/shallow";`,
      filename: "src/App.tsx",
    },
    {
      code: `import { useUpdateActions } from "@/lib/vm/use-update-actions";`,
      filename: "src/App.tsx",
    },
    {
      code: `import { FolderTree } from "@/components/FolderTree/FolderTree";`,
      filename: "src/App.tsx",
    },
    {
      code: `import { useFileWatcher } from "@/hooks/useFileWatcher";`,
      filename: "src/App.tsx",
    },
    {
      code: `import { invoke } from "@tauri-apps/api/core";`,
      filename: "src/App.tsx",
    },
    {
      code: `import "@/styles/app.css";`,
      filename: "src/App.tsx",
    },

    // ---- Non-startup files: rule must short-circuit. ----
    {
      code: `import { whateverHeavyThing } from "shiki";`,
      filename: "src/components/Foo.tsx",
    },
    {
      code: `import yaml from "yaml";`,
      filename: "src/lib/some-util.ts",
    },
    // Backslash filename path (Windows) for a non-startup file is still
    // ignored thanks to normalization.
    {
      code: `import yaml from "yaml";`,
      filename: "src\\lib\\some-util.ts",
    },
  ],

  invalid: [
    // main.tsx imports a non-allowlisted internal module.
    {
      code: `import { foo } from "@/store";`,
      filename: "src/main.tsx",
      errors: [{ messageId: "notAllowed" }],
    },
    // main.tsx imports a third-party heavy package.
    {
      code: `import shiki from "shiki";`,
      filename: "src/main.tsx",
      errors: [{ messageId: "notAllowed" }],
    },
    // main.tsx imports a Tauri API module — not on the tight allowlist.
    {
      code: `import { invoke } from "@tauri-apps/api/core";`,
      filename: "src/main.tsx",
      errors: [{ messageId: "notAllowed" }],
    },
    // App.tsx imports a non-allowlisted alias prefix.
    {
      code: `import { something } from "@/utils/heavy";`,
      filename: "src/App.tsx",
      errors: [{ messageId: "notAllowed" }],
    },
    // App.tsx imports a third-party not on the allowlist.
    {
      code: `import yaml from "yaml";`,
      filename: "src/App.tsx",
      errors: [{ messageId: "notAllowed" }],
    },
  ],
});
