import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import type { ExtraProps } from "react-markdown";
import { LineCommentMargin } from "@/components/comments/LineCommentMargin";
import { CommentThread } from "@/components/comments/CommentThread";
import { fingerprintAnchor } from "@/lib/anchor-fingerprint";
import type {
  CommentThread as CommentThreadType,
  CommentAnchor,
} from "@/lib/tauri-commands";

// Context for inline comment gutters in markdown blocks
export interface MdCommentContextValue {
  commentCountByLine: Map<number, number>;
}

export const MdCommentContext = createContext<MdCommentContextValue>({
  commentCountByLine: new Map(),
});

// Inline gutter component for commentable markdown blocks
export function makeCommentableBlock(Tag: string) {
  return function CommentableBlock({ children, node, ...props }: ComponentPropsWithoutRef<"div"> & ExtraProps) {
    const line = node?.position?.start.line ?? 0;
    const { commentCountByLine } = useContext(MdCommentContext);
    const count = commentCountByLine.get(line) ?? 0;

    return (
      <div
        className={`md-commentable-block${count > 0 ? " has-comments" : ""}`}
        data-source-line={line}
        data-comment-count={count > 0 ? count : undefined}
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
  const { commentCountByLine } = useContext(MdCommentContext);
  const count = commentCountByLine.get(line) ?? 0;
  return React.createElement(
    as,
    {
      className: `md-commentable-block${count > 0 ? " has-comments" : ""}`,
      "data-source-line": line,
      "data-comment-count": count > 0 ? count : undefined,
    },
    children,
  );
}

// Cell-level commentable factory for `td` / `th`. Unlike makeCommentableBlock,
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
    const { commentCountByLine } = useContext(MdCommentContext);
    const count = commentCountByLine.get(line) ?? 0;
    const merged = [
      className,
      `md-commentable-cell${count > 0 ? " has-comments" : ""}`,
    ]
      .filter(Boolean)
      .join(" ");
    return React.createElement(
      Tag,
      {
        ...props,
        className: merged,
        "data-source-line": line,
        // C7 (iter 6 Group A) — cell-specific attribute lets the popover
        // target this exact cell (a `<tr>` typically shares one source
        // line across all its `<td>`s, so `[data-source-line]` alone is
        // ambiguous for tables).
        "data-source-cell-line": line,
        "data-comment-count": count > 0 ? count : undefined,
      },
      children,
    );
  };
}

export function CommentableLi({ children, node, ...props }: ComponentPropsWithoutRef<"li"> & ExtraProps) {
  const line = node?.position?.start.line ?? 0;
  const { commentCountByLine } = useContext(MdCommentContext);
  const count = commentCountByLine.get(line) ?? 0;

  return (
    <li
      {...props}
      data-source-line={line}
      data-comment-count={count > 0 ? count : undefined}
      className={`md-commentable-li${count > 0 ? " has-comments" : ""}`}
    >
      {children}
    </li>
  );
}

// Extracted to avoid reading refs during render in the parent component
export function MdCommentPopover({
  expandedLine,
  commentingLine,
  bodyRef,
  threadsByLine,
  filePath,
  lines,
  pendingSelectionAnchor,
  addComment,
  setCommentingLine,
  setExpandedLine,
  clearSelection,
}: {
  expandedLine: number | null;
  commentingLine: number | null;
  bodyRef: React.RefObject<HTMLDivElement | null>;
  threadsByLine: Map<number, CommentThreadType[]>;
  filePath: string;
  lines: string[];
  pendingSelectionAnchor: CommentAnchor | null;
  addComment: (filePath: string, text: string, anchor?: CommentAnchor) => Promise<void>;
  setCommentingLine: (v: number | null) => void;
  setExpandedLine: (v: number | null) => void;
  clearSelection: () => void;
}) {
  const activeLine = expandedLine ?? commentingLine;
  const [position, setPosition] = useState<{ top: number } | null>(null);

  useEffect(() => {
    if (!activeLine || !bodyRef.current) {
      setPosition(null);
      return;
    }
    const el =
      bodyRef.current.querySelector(`[data-source-cell-line="${activeLine}"]`) ??
      bodyRef.current.querySelector(`[data-source-line="${activeLine}"]`);
    if (!el) {
      setPosition(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const containerRect = bodyRef.current.getBoundingClientRect();
    setPosition({ top: rect.top - containerRect.top + rect.height });
  }, [activeLine, bodyRef]);

  if (!activeLine || !position) return null;

  const lineThreads = threadsByLine.get(activeLine) ?? [];
  return (
    <div className="md-comment-popover md-comment-popover-inline" style={{
      position: "absolute",
      top: position.top,
      zIndex: 20,
    }}>
      {lineThreads.length > 0 && (
        <div className="md-comment-threads">
          {lineThreads.map(t => <CommentThread key={t.root.id} rootComment={t.root} replies={t.replies} filePath={filePath} />)}
        </div>
      )}

      {commentingLine === activeLine ? (
        <LineCommentMargin
          filePath={filePath}
          lineNumber={activeLine}
          lineText={lines[activeLine - 1] ?? ""}
          threads={[]}
          showInput={true}
          onCloseInput={() => { setCommentingLine(null); setExpandedLine(null); clearSelection(); }}
          onSaveComment={
            pendingSelectionAnchor
              ? (text: string) => {
                  addComment(filePath, text, pendingSelectionAnchor).catch(() => {});
                  clearSelection();
                }
              : undefined
          }
          draftKey={
            pendingSelectionAnchor
              ? `${filePath}::new::${fingerprintAnchor({ kind: "line", ...pendingSelectionAnchor })}`
              : undefined
          }
        />
      ) : (
        <button
          className="comment-btn comment-btn-primary"
          style={{ marginTop: 8 }}
          onClick={() => setCommentingLine(activeLine)}
        >
          Add comment
        </button>
      )}
    </div>
  );
}
