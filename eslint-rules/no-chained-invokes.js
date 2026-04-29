/**
 * Custom ESLint rule: no-chained-invokes.
 *
 * Flags any function body that contains two or more sequentially `await`-ed
 * IPC-wrapper calls (named imports from `@/lib/tauri-commands`, namespace
 * imports from the same, or direct `invoke` from `@tauri-apps/api/core`).
 *
 * Sequential awaits serialize round-trips across the IPC bridge, violating
 * `docs/architecture.md` rule 1 (Single IPC Chokepoint — keep latency
 * predictable) and `docs/performance.md` rule 2 (parallelize independent
 * I/O). Concurrent IPC must use `Promise.all` / `Promise.allSettled` so the
 * single underlying await unblocks all calls together.
 *
 * Allowlist:
 *  - Function name (FunctionDeclaration / VariableDeclarator / MethodDefinition
 *    key) contains the substring `Bootstrap` (case-insensitive). Bootstrap
 *    sequences during app startup are intentionally serial because each call
 *    primes state the next consumes.
 *  - The function (leading comment block OR any comment inside its body
 *    range) contains `// allow-chained-invokes: <reason>`. The reason token
 *    is mandatory — a bare marker without a justification is not honored.
 *
 * Detection logic:
 *  1. Scan top-level `ImportDeclaration`s. Skip type-only imports
 *     (`import type` and per-specifier `importKind === "type"`). Collect:
 *      - Named-binding set: every `ImportSpecifier.local.name` from any
 *        module path that resolves to `tauri-commands` (`@/lib/tauri-commands`,
 *        relative `./tauri-commands`, `../lib/tauri-commands`, etc.). This
 *        correctly captures renamed imports (`import { foo as bar }` adds
 *        `bar`, not `foo`).
 *      - Namespace set: every `ImportNamespaceSpecifier.local.name` from a
 *        tauri-commands path.
 *      - Direct-invoke set: if `invoke` is named-imported from
 *        `@tauri-apps/api/core`, add its local name. Covers
 *        `tauri-commands.ts` itself.
 *  2. Walk function-like nodes with a stack so each function is counted in
 *     its own scope (nested function bodies do not bleed counts up or down).
 *  3. Per function, count `AwaitExpression` whose `argument` is a
 *     `CallExpression` resolving to one of the tracked bindings:
 *      - `Identifier` callee in named-binding or direct-invoke set, OR
 *      - `MemberExpression` callee whose `object` is an `Identifier` in the
 *        namespace set (e.g. `cmd.foo()` where `cmd` is a `import * as cmd`).
 *     Single `Promise.all([...])` is exactly one `AwaitExpression`, so a
 *     fan-out of N IPC calls under one await counts as 1 and is never
 *     flagged.
 *  4. If `count >= 2` and no allowlist marker matches, report on the
 *     function node.
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow 2+ sequential awaited IPC-wrapper calls in a single function. See docs/architecture.md rule 1 + docs/performance.md rule 2.",
    },
    schema: [],
    messages: {
      chained:
        "Function chains {{count}} awaited IPC calls. Use `Promise.all`/`allSettled` for concurrent IPC, or annotate with `// allow-chained-invokes: <reason>` if sequential is intentional. See docs/architecture.md rule 1 + docs/performance.md rule 2.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();

    /** @type {Set<string>} Bindings imported from a tauri-commands module path. */
    const wrapperNames = new Set();
    /** @type {Set<string>} Namespace bindings (`import * as cmd from "@/lib/tauri-commands"`). */
    const namespaceNames = new Set();
    /** @type {Set<string>} Local names for `invoke` from `@tauri-apps/api/core`. */
    const directInvokeNames = new Set();

    /** Module path detector — accepts both alias and relative spellings. */
    function isTauriCommandsPath(specifier) {
      if (typeof specifier !== "string") return false;
      if (specifier === "@/lib/tauri-commands") return true;
      // Relative path ending in `/tauri-commands` (with optional .ts/.tsx/.js).
      // Examples: `./tauri-commands`, `../lib/tauri-commands`, `../../lib/tauri-commands.ts`.
      return /(^|\/)tauri-commands(\.[tj]sx?)?$/.test(specifier);
    }

    /** True if a comment value contains a valid `allow-chained-invokes: <reason>` marker. */
    function isAllowMarker(commentValue) {
      return /allow-chained-invokes:\s*\S+/.test(commentValue);
    }

    /** Extract the function's identifier name for the Bootstrap allowlist. */
    function getFunctionName(node) {
      // FunctionDeclaration: `async function fooBootstrap() {}`
      if (node.id && node.id.type === "Identifier") return node.id.name;

      const parent = node.parent;
      if (!parent) return "";

      // ArrowFunctionExpression or FunctionExpression assigned to a variable:
      //   `const fooBootstrap = async () => {}`
      if (parent.type === "VariableDeclarator" && parent.id && parent.id.type === "Identifier") {
        return parent.id.name;
      }

      // MethodDefinition / Property:
      //   `class X { async fooBootstrap() {} }`
      //   `{ fooBootstrap: async () => {} }`
      if (
        (parent.type === "MethodDefinition" || parent.type === "Property") &&
        parent.key &&
        parent.key.type === "Identifier"
      ) {
        return parent.key.name;
      }

      // AssignmentExpression: `obj.fooBootstrap = async () => {}` — capture the rhs key.
      if (parent.type === "AssignmentExpression" && parent.left) {
        if (parent.left.type === "Identifier") return parent.left.name;
        if (
          parent.left.type === "MemberExpression" &&
          parent.left.property &&
          parent.left.property.type === "Identifier"
        ) {
          return parent.left.property.name;
        }
      }

      return "";
    }

    /** True if the function name includes "Bootstrap" (case-insensitive substring). */
    function hasBootstrapName(node) {
      const name = getFunctionName(node);
      return name.toLowerCase().includes("bootstrap");
    }

    /** True if any comment leading the function OR any comment inside its body range carries the marker. */
    function hasAllowMarker(node) {
      const leading = sourceCode.getCommentsBefore(node) || [];
      for (const c of leading) {
        if (isAllowMarker(c.value)) return true;
      }
      // Inline comments anywhere inside the function body's source range count too —
      // the marker right above the first await is the most natural placement.
      const allComments = sourceCode.getAllComments();
      const [start, end] = node.range || [];
      if (start === undefined) return false;
      for (const c of allComments) {
        if (!c.range) continue;
        if (c.range[0] >= start && c.range[1] <= end && isAllowMarker(c.value)) return true;
      }
      return false;
    }

    /** True if the call expression invokes a tracked IPC wrapper. */
    function callsTrackedWrapper(callExpr) {
      const callee = callExpr.callee;
      if (!callee) return false;
      if (callee.type === "Identifier") {
        return wrapperNames.has(callee.name) || directInvokeNames.has(callee.name);
      }
      if (callee.type === "MemberExpression") {
        const obj = callee.object;
        if (obj && obj.type === "Identifier" && namespaceNames.has(obj.name)) return true;
      }
      return false;
    }

    // Stack of per-function counters. Index 0 is the outermost function on the stack.
    /** @type {{ node: import('estree').Node, count: number }[]} */
    const stack = [];

    function enterFunction(node) {
      stack.push({ node, count: 0 });
    }

    function exitFunction(node) {
      const frame = stack.pop();
      if (!frame || frame.node !== node) return;
      if (frame.count < 2) return;
      if (hasBootstrapName(node)) return;
      if (hasAllowMarker(node)) return;
      context.report({
        node,
        messageId: "chained",
        data: { count: String(frame.count) },
      });
    }

    return {
      ImportDeclaration(node) {
        // Skip type-only imports — `import type { X } from "..."` is erased at runtime.
        if (node.importKind === "type") return;

        const source = node.source && node.source.value;
        const isWrapperSource = isTauriCommandsPath(source);
        const isCoreSource = source === "@tauri-apps/api/core";

        if (!isWrapperSource && !isCoreSource) return;

        for (const spec of node.specifiers || []) {
          // Per-specifier type-only skip: `import { type X, y } from "..."`.
          if (spec.importKind === "type") continue;

          if (isWrapperSource) {
            if (spec.type === "ImportSpecifier") {
              wrapperNames.add(spec.local.name);
            } else if (spec.type === "ImportNamespaceSpecifier") {
              namespaceNames.add(spec.local.name);
            } else if (spec.type === "ImportDefaultSpecifier") {
              // Defensive: tauri-commands has no default export today, but if a
              // future contributor adds one, treat its local name like a
              // namespace-style binding. Member calls would still need to land
              // in the namespace branch, so add to wrapperNames as the safe
              // option (any direct call of the default counts as a wrapper).
              wrapperNames.add(spec.local.name);
            }
          } else if (isCoreSource) {
            if (
              spec.type === "ImportSpecifier" &&
              spec.imported &&
              spec.imported.name === "invoke"
            ) {
              directInvokeNames.add(spec.local.name);
            }
          }
        }
      },
      FunctionDeclaration: enterFunction,
      "FunctionDeclaration:exit": exitFunction,
      FunctionExpression: enterFunction,
      "FunctionExpression:exit": exitFunction,
      ArrowFunctionExpression: enterFunction,
      "ArrowFunctionExpression:exit": exitFunction,
      AwaitExpression(node) {
        if (stack.length === 0) return;
        const frame = stack[stack.length - 1];
        const arg = node.argument;
        if (!arg || arg.type !== "CallExpression") return;
        if (callsTrackedWrapper(arg)) frame.count += 1;
      },
    };
  },
};

export default rule;
