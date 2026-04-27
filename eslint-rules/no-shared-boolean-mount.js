/**
 * Custom ESLint rule: no-shared-boolean-mount.
 *
 * Flags JSX where two or more sibling `{identifier && <Component/>}` (or
 * `<Fragment/>`) expressions reference the same `identifier` within the same
 * parent JSX element/fragment. Such a shape lets a single store boolean gate
 * the mounting of two distinct UI surfaces, which violates rule 28 in
 * `docs/architecture.md` (Layer separation / chokepoints): two surfaces of
 * the same intent must be modelled as a discriminated-union state so only
 * one is renderable at a time.
 *
 * Detection scope (intentionally narrow — keep false-positives ~0):
 * - The conditional must be `LogicalExpression` with operator `&&`.
 * - Left operand must be a bare `Identifier` (the "shared boolean").
 * - Right operand must be a JSX element/fragment (a real mount site, not a
 *   string/number fallback like `count && 'pending'`).
 * - At least two such siblings under the same JSXElement/JSXFragment with
 *   matching left identifier.
 *
 * Known blind spots (deferred — must be caught in code review):
 * - Ternary gates: `flag ? <X/> : <Y/>` is not a `LogicalExpression`.
 * - Member-expression gates: `state.flag && <X/>` has a `MemberExpression`
 *   left operand, not an `Identifier`. Two siblings of this shape sharing
 *   the same `state.flag` are NOT flagged.
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow two sibling JSX mount expressions gated by the same boolean identifier. See docs/architecture.md rule 28.",
    },
    schema: [],
    messages: {
      shared:
        "Single boolean '{{name}}' gates {{count}} sibling JSX mounts. Model the intent as a discriminated-union state per docs/architecture.md rule 28 (e.g. `surface: 'closed' | 'inline' | 'modal'`).",
    },
  },
  create(context) {
    function visitParent(parent) {
      const children = parent.children || [];
      /** @type {Map<string, import('estree').Node[]>} */
      const occurrences = new Map();
      for (const child of children) {
        if (child.type !== "JSXExpressionContainer") continue;
        const expr = child.expression;
        if (!expr || expr.type !== "LogicalExpression" || expr.operator !== "&&") continue;
        if (expr.left.type !== "Identifier") continue;
        if (expr.right.type !== "JSXElement" && expr.right.type !== "JSXFragment") continue;
        const name = expr.left.name;
        const list = occurrences.get(name);
        if (list) list.push(expr);
        else occurrences.set(name, [expr]);
      }
      for (const [name, nodes] of occurrences) {
        if (nodes.length < 2) continue;
        for (const node of nodes) {
          context.report({
            node,
            messageId: "shared",
            data: { name, count: String(nodes.length) },
          });
        }
      }
    }
    return {
      JSXElement: visitParent,
      JSXFragment: visitParent,
    };
  },
};

export default rule;
