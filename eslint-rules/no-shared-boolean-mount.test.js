import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "./no-shared-boolean-mount.js";

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

// Each `code` snippet is wrapped in a default-export function so the JSX
// parses as a real component body, mirroring how App.tsx renders mount sites.
const wrap = (jsx) => `export default function C() { return (${jsx}); }`;

tester.run("no-shared-boolean-mount", rule, {
  valid: [
    // Single mount — no sibling, nothing to share.
    { code: wrap(`<div>{flag && <Foo/>}</div>`) },
    // Two siblings gated by *different* identifiers — the discriminator is
    // implicit in the identifier names.
    { code: wrap(`<div>{a && <X/>}{b && <Y/>}</div>`) },
    // Discriminated-union shape: left operand is a BinaryExpression, not
    // an Identifier. This is the canonical post-fix App.tsx shape and is
    // exactly what rule 28 prescribes.
    {
      code: wrap(
        `<div>{settingsSurface === 'inline' && <SettingsView/>}{settingsSurface === 'modal' && <SettingsDialog/>}</div>`,
      ),
    },
    // Same identifier but right operand is a string literal (not a mount).
    // The rule deliberately ignores these because they are not "mount sites".
    { code: wrap(`<div>{flag && 'on'}{flag && 'still on'}</div>`) },
  ],
  invalid: [
    // The pre-fix App.tsx shape: two sibling mounts gated by the same
    // boolean. Both occurrences are reported (count = 2).
    {
      code: wrap(
        `<div>{settingsOpen && <SettingsView/>}{settingsOpen && <SettingsDialog/>}</div>`,
      ),
      errors: [
        { messageId: "shared", data: { name: "settingsOpen", count: "2" } },
        { messageId: "shared", data: { name: "settingsOpen", count: "2" } },
      ],
    },
    // Fragment parent + three siblings on one identifier — three reports.
    {
      code: wrap(
        `<>{open && <A/>}{open && <B/>}{open && <C/>}</>`,
      ),
      errors: [
        { messageId: "shared", data: { name: "open", count: "3" } },
        { messageId: "shared", data: { name: "open", count: "3" } },
        { messageId: "shared", data: { name: "open", count: "3" } },
      ],
    },
  ],
});
