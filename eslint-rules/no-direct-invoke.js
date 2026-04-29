/**
 * Custom ESLint rule: no-direct-invoke.
 *
 * Prevents importing `invoke` from `@tauri-apps/api/core` outside of
 * `tauri-commands.ts`. All IPC must flow through the typed wrappers in
 * `src/lib/tauri-commands.ts` — see docs/architecture.md rule 1
 * (Single IPC Chokepoint).
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow direct invoke imports outside tauri-commands.ts. See docs/architecture.md rule 1.",
    },
    schema: [],
    messages: {
      noDirectInvoke:
        "Direct import of 'invoke' from '@tauri-apps/api/core' is not allowed. Use the typed wrappers in 'src/lib/tauri-commands.ts' instead.",
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value !== "@tauri-apps/api/core") return;

        const filename = context.filename || context.getFilename();
        if (filename.endsWith("tauri-commands.ts")) return;

        const hasInvoke = node.specifiers.some(
          (s) => s.type === "ImportSpecifier" && s.imported.name === "invoke",
        );

        if (hasInvoke) {
          context.report({ node, messageId: "noDirectInvoke" });
        }
      },
    };
  },
};

export default rule;
