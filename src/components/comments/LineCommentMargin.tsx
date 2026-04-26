import { useState } from "react";
import { useCommentActions } from "@/lib/vm/use-comment-actions";
import { CommentInput } from "./CommentInput";
import { CommentThread } from "./CommentThread";
import { truncateSelectedText } from "@/lib/comment-utils";
import { fingerprintAnchor } from "@/lib/anchor-fingerprint";
import type { CommentThread as CommentThreadType } from "@/lib/tauri-commands";
import "@/styles/comments.css";

interface Props {
  filePath: string;
  lineNumber: number;
  lineText: string;
  threads: CommentThreadType[];
  showInput?: boolean;
  onCloseInput?: () => void;
  onSaveComment?: (text: string) => void;
  forceExpanded?: boolean;
  onRequestInput?: () => void;
  // Optional override for the draft persistence key. When the input is
  // driven by a richer selection anchor (e.g. a word-range selection in
  // markdown), the parent passes a fingerprint of that anchor instead so
  // the line-only default doesn't collide. Falls back to the line anchor
  // when omitted.
  draftKey?: string;
}

export function LineCommentMargin({
  filePath, lineNumber, lineText, threads, showInput, onCloseInput, onSaveComment, forceExpanded, onRequestInput, draftKey,
}: Props) {
  const { addComment } = useCommentActions();
  const [expanded, setExpanded] = useState(false);

  const unresolvedCount = threads.reduce((acc, t) => {
    let count = t.root.resolved ? 0 : 1;
    count += t.replies.filter(r => !r.resolved).length;
    return acc + count;
  }, 0);

  const handleSave = async (text: string) => {
    if (onSaveComment) {
      onSaveComment(text);
    } else {
      // MRSF §6.2: line-only comments SHOULD include full line as selected_text
      const selectedText = truncateSelectedText(lineText);
      addComment(filePath, text, { line: lineNumber, selected_text: selectedText }).catch(() => {});
    }
    onCloseInput?.();
    setExpanded(true);
  };

  const shouldExpand = expanded || forceExpanded;

  if (!showInput && threads.length === 0) return null;

  return (
    <div className="line-comment-section">
      {showInput && (
        <CommentInput
          onSave={handleSave}
          onClose={() => onCloseInput?.()}
          draftKey={draftKey ?? `${filePath}::new::${fingerprintAnchor({ kind: "line", line: lineNumber })}`}
        />
      )}
      {shouldExpand && threads.map((t) => (
        <CommentThread key={t.root.id} rootComment={t.root} replies={t.replies} filePath={filePath} />
      ))}
      {!shouldExpand && unresolvedCount > 0 && (
        <button className="line-comment-count" onClick={() => setExpanded(true)}>
          {unresolvedCount} comment{unresolvedCount > 1 ? "s" : ""}
        </button>
      )}
      {shouldExpand && !showInput && threads.length > 0 && onRequestInput && (
        <button className="comment-btn" onClick={onRequestInput} style={{ marginTop: 4 }}>
          Add comment
        </button>
      )}
    </div>
  );
}
