/**
 * Custom ESLint rule: no-startup-side-effect-import.
 *
 * Flags top-level `import` statements in `src/main.tsx` and `src/App.tsx`
 * whose specifier is not on a per-file allowlist. Top-level imports in
 * these files run at app cold-start; anything that is not strictly
 * required for boot adds debt against the cold-start budget. See
 * docs/architecture.md and issue #262.
 *
 * The two startup files have different needs:
 *
 *   - main.tsx is the literal cold-start entry. It mounts React and hands
 *     off to App. Its allowlist is tight: CSS, react/react-dom, the
 *     logger, and the App symbol itself.
 *
 *   - App.tsx is the composition root. It is unavoidably the place where
 *     components, hooks, viewmodels, and the Zustand store get wired
 *     together. A tight allowlist would force every legitimate child
 *     import into a workaround. App.tsx therefore allows the broader
 *     internal surface (`@/components/*`, `@/hooks/*`, `@/lib/*`,
 *     `@/store(/*)`, `@tauri-apps/api/*`, `zustand(/*)`) plus everything
 *     main.tsx allows.
 *
 * The rule short-circuits for any other file so that the bulk of the
 * codebase is unaffected.
 */

// Per-file allowlists. Each entry is either an exact specifier or a
// prefix that ends in "/" (matching any submodule under that prefix).
const MAIN_TSX_EXACT = new Set(["react", "react-dom", "react-dom/client", "@/logger", "@/App"]);

const MAIN_TSX_PREFIX = [];

// App.tsx inherits everything main.tsx allows and adds the composition
// root surface.
const APP_TSX_EXACT = new Set([...MAIN_TSX_EXACT, "react/jsx-runtime", "zustand", "@/store"]);

const APP_TSX_PREFIX = [
  "zustand/",
  "@tauri-apps/api/",
  "@/store/",
  "@/lib/",
  "@/hooks/",
  "@/components/",
];

function isCssSpecifier(source) {
  return source.endsWith(".css") || source.endsWith(".scss");
}

function isAllowed(source, exact, prefixes) {
  if (isCssSpecifier(source)) return true;
  if (exact.has(source)) return true;
  for (const prefix of prefixes) {
    if (source.startsWith(prefix)) return true;
  }
  return false;
}

function normalizeFilename(filename) {
  return filename.replace(/\\/g, "/");
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow non-allowlisted top-level imports in src/main.tsx and src/App.tsx. See docs/architecture.md and issue #262.",
    },
    schema: [],
    messages: {
      notAllowed:
        "Import '{{source}}' is not on the startup allowlist for {{basename}}. Top-level imports here run at app cold-start. If this module is intentional, add it to the rule's allowlist with rationale; otherwise inline the work behind a function call or dynamic import. See docs/architecture.md.",
    },
  },
  create(context) {
    const rawFilename = context.filename || context.getFilename();
    const filename = normalizeFilename(rawFilename);

    let exact;
    let prefixes;
    let basename;

    if (filename.endsWith("src/main.tsx")) {
      exact = MAIN_TSX_EXACT;
      prefixes = MAIN_TSX_PREFIX;
      basename = "main.tsx";
    } else if (filename.endsWith("src/App.tsx")) {
      exact = APP_TSX_EXACT;
      prefixes = APP_TSX_PREFIX;
      basename = "App.tsx";
    } else {
      // Rule does not apply to this file.
      return {};
    }

    return {
      ImportDeclaration(node) {
        const source = node.source && node.source.value;
        if (typeof source !== "string") return;
        if (isAllowed(source, exact, prefixes)) return;

        context.report({
          node,
          messageId: "notAllowed",
          data: { source, basename },
        });
      },
    };
  },
};

export default rule;
