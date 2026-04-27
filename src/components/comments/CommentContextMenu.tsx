import { useEffect, useRef } from "react";
import "@/styles/comments.css";

export type CommentContextMenuAction = "comment" | "copy-link" | "discussed";

interface Item {
  action: CommentContextMenuAction;
  label: string;
  disabled?: boolean;
}

interface Props {
  open: boolean;
  x: number;
  y: number;
  /** True iff there is a non-empty selection at the click site. Gates the
   *  "Comment on selection" action. */
  hasSelection: boolean;
  /** True iff the click site resolved to a real source line. When false
   *  (whitespace / between-elements / non-line surface), "Mark line as
   *  discussed" is disabled and "Copy link to line" becomes "Copy link to
   *  file" so it still does something useful. Defaults to true for
   *  back-compat with viewers that have not yet been wired. */
  hasLine?: boolean;
  onAction: (a: CommentContextMenuAction) => void;
  onClose: () => void;
}

const MENU_W = 200;
const MENU_H = 110;

/** F6 — floating, keyboard-reachable context menu with three actions:
 *  comment-on-selection, copy-link-to-line, mark-line-as-discussed.
 *  Auto-closes via the parent's `useContextMenu` hook (Esc / outside
 *  click / scroll); Enter on a focused item activates it. */
export function CommentContextMenu({ open, x, y, hasSelection, hasLine = true, onAction, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  const items: Item[] = [
    { action: "comment", label: "Comment on selection", disabled: !hasSelection },
    {
      action: "copy-link",
      label: hasLine ? "Copy link to line" : "Copy link to file",
    },
    { action: "discussed", label: "✅ Mark line as discussed", disabled: !hasLine },
  ];

  // Auto-focus first enabled item on open.
  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    if (!root) return;
    const first = root.querySelector<HTMLButtonElement>(
      'button[role="menuitem"]:not([disabled])',
    );
    first?.focus();
  }, [open]);

  if (!open) return null;

  // Viewport clamp — mirrors useSelectionToolbar's logic.
  const left = Math.max(4, Math.min(x, window.innerWidth - MENU_W - 4));
  const top = Math.max(4, Math.min(y, window.innerHeight - MENU_H - 4));

  const focusSibling = (current: HTMLElement, dir: 1 | -1) => {
    const root = rootRef.current;
    if (!root) return;
    const buttons = Array.from(
      root.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not([disabled])'),
    );
    const idx = buttons.indexOf(current as HTMLButtonElement);
    if (idx === -1) return;
    const next = buttons[(idx + dir + buttons.length) % buttons.length];
    next?.focus();
  };

  const onItemKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, item: Item) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusSibling(e.currentTarget, 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusSibling(e.currentTarget, -1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!item.disabled) {
        onAction(item.action);
        onClose();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      ref={rootRef}
      className="comment-context-menu"
      role="menu"
      aria-label="Comment actions"
      style={{ top, left }}
    >
      {items.map((item) => (
        <button
          key={item.action}
          type="button"
          role="menuitem"
          className="comment-context-menu-item"
          disabled={item.disabled}
          onClick={() => {
            if (!item.disabled) {
              onAction(item.action);
              onClose();
            }
          }}
          onKeyDown={(e) => onItemKeyDown(e, item)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
