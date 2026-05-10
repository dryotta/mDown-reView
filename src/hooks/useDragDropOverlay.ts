import { useEffect, useState } from "react";
import { listenDragDrop, listenEvent, type DragDropEvent } from "@/lib/tauri-events";
import { assertNever } from "@/lib/assert-never";

/**
 * Visual-feedback hook for drag-drop file-open.
 *
 * Returns `{ isDragging, lastRejection }`:
 *   - `isDragging`: true while the user is dragging files over the window.
 *   - `lastRejection`: a transient flag (auto-clears after 3 s) set when
 *     Rust rejects a drop because no path resolved to a usable file or
 *     folder. Drives a toast surface so the user gets visible feedback
 *     instead of the overlay silently disappearing
 *     (bug-expert / product-expert PR #372 review).
 *
 * The actual file-open work is performed in Rust
 * (`commands::drag_drop::handle_dropped_paths` →
 * `launch_routing::route_args_to_window`), so this hook intentionally
 * does NOT consume the dropped paths — its only purpose is to drive
 * an overlay component that gives the user a target to aim for during
 * drag, plus a small transient toast on rejection.
 *
 * The switch on `payload.type` includes a default `assertNever` arm so
 * any future Tauri minor that adds a fifth discriminator (e.g. a
 * `cancel` variant) is caught at compile time rather than silently
 * leaving the overlay stuck on. Mirrors `docs/design-patterns.md`
 * rule 24 (cross-component handoff exhaustiveness).
 */
export interface DragDropOverlayState {
  isDragging: boolean;
  lastRejection: { count: number; reason: string } | null;
}

const REJECTION_TOAST_MS = 3000;

export function useDragDropOverlay(): DragDropOverlayState {
  const [isDragging, setIsDragging] = useState(false);
  const [lastRejection, setLastRejection] =
    useState<DragDropOverlayState["lastRejection"]>(null);

  useEffect(() => {
    const unlistenPromise = listenDragDrop((payload: DragDropEvent) => {
      switch (payload.type) {
        case "enter":
        case "over":
          setIsDragging(true);
          break;
        case "drop":
        case "leave":
          setIsDragging(false);
          break;
        default:
          assertNever(payload);
      }
    });
    return () => {
      unlistenPromise.then((fn) => fn()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const unlistenPromise = listenEvent("drag-drop-rejected", (payload) => {
      setLastRejection({ count: payload.count, reason: payload.reason });
    });
    return () => {
      unlistenPromise.then((fn) => fn()).catch(() => {});
    };
  }, []);

  // Auto-clear the rejection toast after a few seconds. A new
  // rejection during the timer resets it (the effect's cleanup runs
  // first, clearing the stale timeout).
  useEffect(() => {
    if (lastRejection === null) return;
    const t = setTimeout(() => setLastRejection(null), REJECTION_TOAST_MS);
    return () => clearTimeout(t);
  }, [lastRejection]);

  return { isDragging, lastRejection };
}
