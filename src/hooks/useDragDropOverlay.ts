import { useEffect, useState } from "react";
import { listenDragDrop } from "@/lib/tauri-events";

/**
 * Visual-feedback hook for drag-drop file-open.
 *
 * Returns `isDragging` — `true` while the user is dragging files over
 * the window, `false` otherwise. The actual file-open work is performed
 * in Rust (`src-tauri/src/lib.rs`'s `WindowEvent::DragDrop` arm →
 * `launch_routing::route_args_through_registry`), so this hook
 * intentionally does NOT consume the dropped paths — its only purpose
 * is to drive an overlay component that gives the user a target to aim
 * for during drag.
 *
 * Cancellation flag (`cancelled`) prevents a stale `set` after unmount
 * (e.g. React StrictMode double-mount in dev). The listener is
 * scoped to the current webview by Tauri's
 * `getCurrentWebview().onDragDropEvent`.
 */
export function useDragDropOverlay(): boolean {
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const unlistenPromise = listenDragDrop((payload) => {
      if (cancelled) return;
      switch (payload.type) {
        case "enter":
        case "over":
          setIsDragging(true);
          break;
        case "drop":
        case "leave":
          setIsDragging(false);
          break;
      }
    });
    return () => {
      cancelled = true;
      unlistenPromise.then((fn) => fn()).catch(() => {});
    };
  }, []);

  return isDragging;
}
