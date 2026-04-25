/**
 * S2 — Pre-sanitize hast transform that drops `style` from any `<span>` whose
 * className doesn't start with a `katex` token, and from `<math>` elements
 * that aren't part of a KaTeX subtree.
 *
 * Why: `sanitizeSchema` allow-lists `style` on `<span>` and `<math>` for
 * KaTeX visual fidelity (vertical-align / height offsets emitted by KaTeX
 * cannot be expressed via classes alone). Allowing `style` on every span
 * is a UI-redress / tracking-pixel surface (raw markdown HTML like
 * `<span style="position:fixed;inset:0">…</span>` could overlay the entire
 * viewport). This transform narrows the allowance to KaTeX-classed nodes
 * by stripping `style` from everything else BEFORE sanitize runs.
 *
 * Defenses still in play for KaTeX-classed nodes:
 *   - Browser CSS engines neuter `expression(…)` and `javascript:` in style
 *     values; only legacy IE was vulnerable.
 *   - The app's CSP `img-src` blocks remote `url(…)` from style.
 *   - Residual UI-redress risk if KaTeX itself is compromised — accepted.
 */
import type { Plugin } from "unified";
import type { Root, Element } from "hast";
import { visitParents } from "unist-util-visit-parents";

function classList(node: Element): string[] {
  const c = node.properties?.className;
  if (Array.isArray(c)) return c.filter((x): x is string => typeof x === "string");
  if (typeof c === "string") return c.split(/\s+/);
  return [];
}

function isKatexClassed(node: Element): boolean {
  return classList(node).some((c) => c.startsWith("katex"));
}

export const rehypeKatexStyle: Plugin<[], Root> = () => (tree) => {
  // Walk with ancestors so we preserve `style` on every node that is inside
  // a KaTeX subtree (e.g. `<span class="base">` is unprefixed but rendered
  // as a child of `<span class="katex-html">`).
  visitParents(tree, "element", (node: Element, ancestors) => {
    if (node.tagName !== "span" && node.tagName !== "math") return;
    if (!node.properties || !("style" in node.properties)) return;
    if (isKatexClassed(node)) return;
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const a = ancestors[i];
      if (a.type === "element" && isKatexClassed(a as Element)) return;
    }
    delete (node.properties as Record<string, unknown>).style;
  });
};
