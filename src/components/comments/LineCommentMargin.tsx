import { useState } from "react";
import { useStore } from "@/store";
import { computeLineHash, captureContext } from "@/lib/comment-anchors";
import { CommentInput } from "./CommentInput";
import { CommentThread } from "./CommentThread";
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

  const handleSave = (text: string) => {
    if (onSaveComment) {
      onSaveComment(text);
    } else {
      const idx = lineNumber - 1;
      const ctx = captureContext(fileLines, idx);
      addComment(
        filePath,
        {
          anchorType: "line",
          lineHash: computeLineHash(lineText),
          lineNumber,
          contextBefore: ctx.contextBefore,
          contextAfter: ctx.contextAfter,
        },
        text
      );
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
      {shouldExpand && matchedComments.map((c) => <CommentThread key={c.id} comment={c} />)}
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
