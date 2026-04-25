/**
 * S1 — Pre-sanitize hast transform that strips a leading `user-content-`
 * prefix from clobber-class attributes (`id`, `name`, `ariaDescribedBy`,
 * `ariaLabelledBy`) on GFM-footnote-related nodes.
 *
 * Why: `mdast-util-gfm-footnote` already emits ids prefixed with
 * `user-content-`, and `rehype-sanitize`'s default `clobberPrefix` re-adds
 * the SAME prefix → the rendered DOM ends up with `user-content-user-content-fn-1`
 * while matching `<a href="#user-content-fn-1">` is left untouched (sanitize
 * does not prefix `href` values), silently breaking every footnote link.
 *
 * Strategy: scrub the existing prefix on footnote-only nodes before sanitize
 * runs, then let sanitize re-add it cleanly. We deliberately do NOT touch
 * `href` — sanitize never prefixes hrefs, so keeping them as `#user-content-fn-1`
 * keeps them in sync with the post-sanitize prefixed `id`.
 *
 * Footnote nodes are identified narrowly: any element whose `id` starts with
 * `user-content-fn-` or `user-content-fnref-`, or whose className contains
 * `footnote-ref` / `footnote-backref` / `footnotes`, or `<sup>` whose only
 * child is a footnote anchor. Anything else is left alone — no global rewrite.
 */
import type { Plugin } from "unified";
import type { Root, Element } from "hast";
import { visit } from "unist-util-visit";

const PREFIX = "user-content-";
const CLOBBER_ATTRS = ["id", "name", "ariaDescribedBy", "ariaLabelledBy"] as const;

function stripPrefix(value: unknown): unknown {
  if (typeof value === "string" && value.startsWith(PREFIX)) {
    return value.slice(PREFIX.length);
  }
  return value;
}

function isFootnoteElement(node: Element): boolean {
  const id = node.properties?.id;
  if (typeof id === "string" && (id.startsWith("user-content-fn-") || id.startsWith("user-content-fnref-"))) {
    return true;
  }
  const className = node.properties?.className;
  if (Array.isArray(className)) {
    for (const c of className) {
      if (c === "footnote-ref" || c === "footnote-backref" || c === "footnotes" || c === "data-footnotes") {
        return true;
      }
    }
  }
  // GFM emits `data-footnote-ref` / `data-footnote-backref` / `data-footnotes`.
  const props = node.properties ?? {};
  if (
    "dataFootnoteRef" in props ||
    "dataFootnoteBackref" in props ||
    "dataFootnotes" in props
  ) {
    return true;
  }
  return false;
}

export const rehypeFootnotePrefix: Plugin<[], Root> = () => (tree) => {
  visit(tree, "element", (node: Element) => {
    if (!isFootnoteElement(node)) return;
    const props = node.properties;
    if (!props) return;
    for (const key of CLOBBER_ATTRS) {
      if (key in props) {
        (props as Record<string, unknown>)[key] = stripPrefix(props[key]);
      }
    }
  });
};
