/**
 * remark-github-alerts — tiny plugin recognizing GitHub-style alerts inside
 * blockquotes whose first paragraph starts with `[!NOTE]`, `[!TIP]`,
 * `[!IMPORTANT]`, `[!WARNING]`, or `[!CAUTION]`.
 *
 * Rewrites the blockquote so it renders as:
 *   <div class="md-alert md-alert-{kind}">
 *     <p class="md-alert-title">{Kind}</p>
 *     {rest of original blockquote children}
 *   </div>
 *
 * Sanitization is enforced separately by `sanitizeSchema.ts`, which allows
 * only the exact `md-alert*` class tokens on `<div>` and `md-alert-title` on
 * `<p>`. Anything else this plugin emitted would be stripped at render time.
 */
import type { Plugin } from "unified";
import type { Root, Blockquote, Paragraph } from "mdast";
import { visit } from "unist-util-visit";

const PATTERN = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(\r?\n)?/;

export const remarkGithubAlerts: Plugin<[], Root> = () => (tree) => {
  visit(tree, "blockquote", (node: Blockquote) => {
    const para = node.children[0];
    if (!para || para.type !== "paragraph") return;
    const firstChild = para.children[0];
    if (!firstChild || firstChild.type !== "text") return;
    const m = firstChild.value.match(PATTERN);
    if (!m) return;
    const kind = m[1];
    firstChild.value = firstChild.value.slice(m[0].length);
    if (firstChild.value === "") para.children.shift();
    if (para.children.length === 0) node.children.shift();
    node.data = {
      ...(node.data ?? {}),
      hName: "div",
      hProperties: { className: ["md-alert", `md-alert-${kind.toLowerCase()}`] },
    };
    const title: Paragraph = {
      type: "paragraph",
      children: [{ type: "text", value: kind.charAt(0) + kind.slice(1).toLowerCase() }],
      data: { hName: "p", hProperties: { className: ["md-alert-title"] } },
    };
    node.children.unshift(title);
  });
};

export default remarkGithubAlerts;
