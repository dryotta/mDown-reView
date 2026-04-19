import { useEffect } from "react";
import "@/styles/comments.css";

interface Props {
  position: { top: number; left: number };
  onAddComment: () => void;
  onDismiss: () => void;
}

export function SelectionToolbar({ position, onAddComment, onDismiss }: Props) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".selection-toolbar")) onDismiss();
    };
    document.addEventListener("keydown", handleKeyDown);
    const timer = setTimeout(() => document.addEventListener("click", handleClick), 100);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("click", handleClick);
      clearTimeout(timer);
    };
  }, [onDismiss]);

  return (
    <div
      className="selection-toolbar"
      style={{ top: position.top, left: position.left }}
    >
      <button
        className="selection-toolbar-btn"
        aria-label="Add comment on selection"
        onClick={onAddComment}
      >
        💬 Comment
      </button>
    </div>
  );
}
