import { useCallback, useRef } from "react";

import { useRenderCount } from "@/hooks/dev/useRenderCount";
import { useStore } from "@/store";

interface Props {
  /**
   * The FolderTree element (or empty when no workspace open). Passed as
   * children so its identity is stable across FolderPaneShell re-renders
   * — React bails out at the FolderTree subtree on each drag tick.
   */
  children: React.ReactNode;
  /**
   * When true, the drag handle is suppressed (workspace closed; no
   * folder pane to resize).
   */
  hideDragHandle: boolean;
}

/**
 * Owns the folder-pane wrapper, the `--folder-pane-width` CSS variable,
 * and the drag handle. Subscribes to `folderPaneWidth` so App does not
 * have to — App therefore does not re-render during drag.
 *
 * RC1/P2.4 (#298): the drag handler at the bottom calls
 * `setFolderPaneWidth` on every mousemove. Co-locating the subscription
 * with the handler localises the drag re-render storm to this shell;
 * the FolderTree subtree (passed via `children`) re-uses the same
 * element identity from App and bails out via React's children
 * referential-equality optimisation.
 */
export function FolderPaneShell({ children, hideDragHandle }: Props) {
  useRenderCount("FolderPaneShell");
  const folderPaneWidth = useStore((s) => s.folderPaneWidth);
  const setFolderPaneWidth = useStore((s) => s.setFolderPaneWidth);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startWidth: folderPaneWidth };
      const onMove = (e: MouseEvent) => {
        if (!dragRef.current) return;
        const delta = e.clientX - dragRef.current.startX;
        const newWidth = Math.max(
          160,
          Math.min(window.innerWidth * 0.5, dragRef.current.startWidth + delta)
        );
        setFolderPaneWidth(newWidth);
      };
      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [folderPaneWidth, setFolderPaneWidth]
  );

  return (
    <div
      className={`folder-pane-wrapper${hideDragHandle ? " folder-pane-hidden" : ""}`}
      style={{ "--folder-pane-width": `${folderPaneWidth}px` } as React.CSSProperties}
    >
      {children}
      {!hideDragHandle && <div className="drag-handle" onMouseDown={onDragStart} />}
    </div>
  );
}
