import React, { createContext, useContext, type ComponentPropsWithoutRef } from "react";
import type { ExtraProps } from "react-markdown";
import { formatBadgeCount } from "@/lib/format-badge-count";

// Context shared by every commentable block / cell / list item — exposes
// per-line comment counts so wrappers can stamp `data-comment-count` and
// the `has-comments` modifier class. The CSS-only bubble marker
// (`.md-commentable-block.has-comments::before`) reads those attributes.
export interface MdCommentContextValue {
  commentCountByLine: Map<number, number>;
}

export const MdCommentContext = createContext<MdCommentContextValue>({
  commentCountByLine: new Map(),
});

// Inline gutter component for commentable markdown blocks
export function makeCommentableBlock(Tag: string) {
  return function CommentableBlock({
    children,
    node,
    ...props
  }: ComponentPropsWithoutRef<"div"> & ExtraProps) {
    const line = node?.position?.start.line ?? 0;
    // `position.end.line` lets selections that stay inside this single
    // block but cross multiple source lines (e.g. a soft-wrapped
    // paragraph) propagate the real end-line into the anchor — without
    // it, the JS-side capture collapses to `endLine === startLine` and
    // the Rust matcher's projection-based search loses its span hint
    // (closest-to-original tie-break degrades to "closest to start").
    const endLine = node?.position?.end.line ?? line;
    const { commentCountByLine } = useContext(MdCommentContext);
    const count = commentCountByLine.get(line) ?? 0;

    return (
      <div
        className={`md-commentable-block${count > 0 ? " has-comments" : ""}`}
        data-source-line={line}
        data-source-end-line={endLine}
        data-comment-count={count > 0 ? formatBadgeCount(count) : undefined}
      >
        {React.createElement(Tag, props, children)}
      </div>
    );
  };
}

// Wrap arbitrary inline JSX in the same commentable envelope used by
// makeCommentableBlock. Used by the markdown `pre` callback (which has to
// dispatch to HighlightedCode / Mermaid / KaTeX before deciding what to
// render) so the final tree still carries data-source-line for the gutter
// and selection layer.
export function CommentableWrapper({
  node,
  children,
  as = "div",
}: {
  node?: ExtraProps["node"];
  children: React.ReactNode;
  as?: "div" | "span";
}) {
  const line = node?.position?.start.line ?? 0;
  const endLine = node?.position?.end.line ?? line;
  const { commentCountByLine } = useContext(MdCommentContext);
  const count = commentCountByLine.get(line) ?? 0;
  return React.createElement(
    as,
    {
      className: `md-commentable-block${count > 0 ? " has-comments" : ""}`,
      "data-source-line": line,
      "data-source-end-line": endLine,
      "data-comment-count": count > 0 ? formatBadgeCount(count) : undefined,
    },
    children
  );
}

// Cell-level commentable factoryfor `td` / `th`. Unlike makeCommentableBlock,
// this MUST apply data attributes inline on the cell — wrapping a `<td>` in a
// `<div>` would inject a non-cell child into `<tr>` and break the table
// layout model. Mirrors the inline-attrs pattern from CommentableLi.
export function CommentableTableCell(Tag: "td" | "th") {
  return function CommentableCell({
    children,
    node,
    className,
    ...props
  }: ComponentPropsWithoutRef<"td"> & ExtraProps) {
    const line = node?.position?.start.line ?? 0;
    const endLine = node?.position?.end.line ?? line;
    const { commentCountByLine } = useContext(MdCommentContext);
    const count = commentCountByLine.get(line) ?? 0;
    const merged = [className, `md-commentable-cell${count > 0 ? " has-comments" : ""}`]
      .filter(Boolean)
      .join(" ");
    return React.createElement(
      Tag,
      {
        ...props,
        className: merged,
        "data-source-line": line,
        "data-source-end-line": endLine,
        // C7 (iter 6 Group A) — cell-specific attribute lets the popover
        // target this exact cell (a `<tr>` typically shares one source
        // line across all its `<td>`s, so `[data-source-line]` alone is
        // ambiguous for tables).
        "data-source-cell-line": line,
        "data-comment-count": count > 0 ? formatBadgeCount(count) : undefined,
      },
      children
    );
  };
}

export function CommentableLi({
  children,
  node,
  ...props
}: ComponentPropsWithoutRef<"li"> & ExtraProps) {
  const line = node?.position?.start.line ?? 0;
  const endLine = node?.position?.end.line ?? line;
  const { commentCountByLine } = useContext(MdCommentContext);
  const count = commentCountByLine.get(line) ?? 0;

  return (
    <li
      {...props}
      data-source-line={line}
      data-source-end-line={endLine}
      data-comment-count={count > 0 ? formatBadgeCount(count) : undefined}
      className={`md-commentable-li${count > 0 ? " has-comments" : ""}`}
    >
      {children}
    </li>
  );
}
