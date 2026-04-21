import { useState } from "react";
import { useStore } from "@/store";
import { CommentInput } from "./CommentInput";
import { CommentThread } from "./CommentThread";
import { groupCommentsIntoThreads } from "@/lib/comment-threads";
import { computeSelectedTextHash } from "@/lib/comment-anchors";
import { truncateSelectedText } from "@/lib/comment-utils";
import type { CommentWithOrphan } from "@/store";
import "@/styles/comments.css";

interface Props {
  filePath: string;
  lineNumber: number;
  lineText: string;
  fileLines: string[];
  matchedComments: CommentWithOrphan[];
  showInput?: boolean;
  onCloseInput?: () => void;
  onSaveComment?: (text: string) => void;
  forceExpanded?: boolean;
  onRequestInput?: () => void;
}

export function LineCommentMargin({
  filePath, lineNumber, lineText, fileLines, matchedComments, showInput, onCloseInput, onSaveComment, forceExpanded, onRequestInput,
}: Props) {
  const { addComment } = useStore();
  const [expanded, setExpanded] = useState(false);

  const unresolved = matchedComments.filter((c) => !c.resolved);

  const handleSave = async (text: string) => {
    if (onSaveComment) {
      onSaveComment(text);
    } else {
      // MRSF §6.2: line-only comments SHOULD include full line as selected_text
      const selectedText = truncateSelectedText(lineText);
      const hash = await computeSelectedTextHash(selectedText);
      addComment(filePath, { line: lineNumber, selected_text: selectedText, selected_text_hash: hash }, text);
    }
    onCloseInput?.();
    setExpanded(true);
  };

  const shouldExpand = expanded || forceExpanded;

  if (!showInput && matchedComments.length === 0) return null;

  return (
    <div className="line-comment-section">
      {showInput && (
        <CommentInput onSave={handleSave} onClose={() => onCloseInput?.()} />
      )}
      {shouldExpand && groupCommentsIntoThreads(matchedComments).map((t) => (
        <CommentThread key={t.root.id} rootComment={t.root} replies={t.replies} filePath={filePath} />
      ))}
      {!shouldExpand && unresolved.length > 0 && (
        <button className="line-comment-count" onClick={() => setExpanded(true)}>
          {unresolved.length} comment{unresolved.length > 1 ? "s" : ""}
        </button>
      )}
      {shouldExpand && !showInput && matchedComments.length > 0 && onRequestInput && (
        <button className="comment-btn" onClick={onRequestInput} style={{ marginTop: 4 }}>
          Add comment
        </button>
      )}
    </div>
  );
}
