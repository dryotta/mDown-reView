import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import rule from "./no-chained-invokes.js";

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

tester.run("no-chained-invokes", rule, {
  valid: [
    // 1. Single awaited wrapper call — under the threshold.
    {
      code: `
        import { ipcReadFile } from "@/lib/tauri-commands";
        async function f() { await ipcReadFile("a"); }
      `,
    },
    // 2. Promise.all of N wrapper calls is exactly ONE AwaitExpression.
    //    Even though three wrappers are invoked, the rule sees a single
    //    awaited call to `Promise.all`, so the count is 1.
    {
      code: `
        import { ipcA, ipcB, ipcC } from "@/lib/tauri-commands";
        async function f() {
          await Promise.all([ipcA(), ipcB(), ipcC()]);
        }
      `,
    },
    // 2b. Promise.allSettled is treated identically — one awaited call.
    {
      code: `
        import { ipcA, ipcB } from "@/lib/tauri-commands";
        async function f() {
          await Promise.allSettled([ipcA(), ipcB()]);
        }
      `,
    },
    // 3. Bootstrap function name is allowlisted (case-insensitive substring).
    {
      code: `
        import { ipcA, ipcB, ipcC } from "@/lib/tauri-commands";
        async function useLaunchArgsBootstrap() {
          await ipcA();
          await ipcB();
          await ipcC();
        }
      `,
    },
    // 3b. Bootstrap match is case-insensitive — `bootstrapStartup` qualifies.
    {
      code: `
        import { ipcA, ipcB } from "@/lib/tauri-commands";
        const bootstrapStartup = async () => {
          await ipcA();
          await ipcB();
        };
      `,
    },
    // 4. Inline `// allow-chained-invokes: <reason>` marker inside the body.
    {
      code: `
        import { ipcA, ipcB } from "@/lib/tauri-commands";
        async function loadFiles() {
          // allow-chained-invokes: ordering matters for state migration
          await ipcA();
          await ipcB();
        }
      `,
    },
    // 4b. Block-comment marker leading the function declaration.
    {
      code: `
        import { ipcA, ipcB } from "@/lib/tauri-commands";
        /* allow-chained-invokes: schema-migration ordering required */
        async function migrate() {
          await ipcA();
          await ipcB();
        }
      `,
    },
    // 5. Type-only imports are ignored — only the runtime named import counts.
    //    Here the type-only `Foo` is dropped; the single runtime `ipcReadFile`
    //    leaves the count at 1 (under threshold). Uses the TS parser because
    //    `import type` is TypeScript syntax.
    {
      code: `
        import type { Foo } from "@/lib/tauri-commands";
        import { ipcReadFile } from "@/lib/tauri-commands";
        async function f() { await ipcReadFile("a"); }
      `,
      languageOptions: {
        parser: tsParser,
        parserOptions: { ecmaVersion: "latest", sourceType: "module" },
      },
    },
    // 6. Renamed import is tracked by its local alias only — `a` (not `ipcA`)
    //    is what the body actually calls. With one await, no flag.
    {
      code: `
        import { ipcA as a } from "@/lib/tauri-commands";
        async function f() { await a(); }
      `,
    },
    // 7. Awaited identifiers that are NOT imported from tauri-commands are
    //    not tracked at all, so two awaits of a local async function are
    //    fine. Guards against false positives on plain in-process awaits.
    {
      code: `
        async function f() {
          const localFn = async () => 1;
          await localFn();
          await localFn();
        }
      `,
    },
    // 8. Nested function bodies are counted in their own scope. Outer has
    //    one wrapper-await, inner has one wrapper-await — neither hits the
    //    threshold of two.
    {
      code: `
        import { ipcA, ipcB } from "@/lib/tauri-commands";
        async function outer() {
          await ipcA();
          async function inner() {
            await ipcB();
          }
        }
      `,
    },
    // Sanity: relative-path import from `./tauri-commands` (single await OK).
    {
      code: `
        import { ipcA } from "./tauri-commands";
        async function f() { await ipcA(); }
      `,
    },
  ],
  invalid: [
    // 1. Two awaited named-import wrappers in the same body.
    {
      code: `
        import { ipcA, ipcB } from "@/lib/tauri-commands";
        async function f() {
          await ipcA();
          await ipcB();
        }
      `,
      errors: [{ messageId: "chained" }],
    },
    // 2. Three sequential awaits also fail (count >= 2).
    {
      code: `
        import { ipcA, ipcB, ipcC } from "@/lib/tauri-commands";
        async function f() {
          await ipcA();
          await ipcB();
          await ipcC();
        }
      `,
      errors: [{ messageId: "chained" }],
    },
    // 3. Namespace import — both calls go through the same `cmd` binding.
    {
      code: `
        import * as cmd from "@/lib/tauri-commands";
        async function f() {
          await cmd.foo();
          await cmd.bar();
        }
      `,
      errors: [{ messageId: "chained" }],
    },
    // 4. Renamed wrappers — local aliases `a` and `b` still resolve to
    //    tauri-commands bindings and must not bypass the rule.
    {
      code: `
        import { ipcA as a, ipcB as b } from "@/lib/tauri-commands";
        async function f() {
          await a();
          await b();
        }
      `,
      errors: [{ messageId: "chained" }],
    },
    // 5. Direct `invoke` from `@tauri-apps/api/core` — covers the pattern
    //    used inside `tauri-commands.ts` itself, where every wrapper is
    //    `await invoke(...)`.
    {
      code: `
        import { invoke } from "@tauri-apps/api/core";
        async function f() {
          await invoke("a");
          await invoke("b");
        }
      `,
      errors: [{ messageId: "chained" }],
    },
  ],
});
