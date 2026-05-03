import { lazy, Suspense } from "react";
import { useShallow } from "zustand/shallow";

import { useFileContent } from "@/hooks/useFileContent";
import { useStore } from "@/store";
import { getDefaultView, getFileCategory, type ViewMode } from "@/lib/file-types";

import { SkeletonLoader } from "../SkeletonLoader";

import "@/styles/excalidraw-host.css";

// Lazy-load the same `<ExcalidrawView>` instance the rest of the app
// uses. The dynamic import boundary keeps `@excalidraw/excalidraw` and
// its 1.4 MB chunk out of the main bundle (verified by
// `scripts/check-bundle-baseline.mjs` sentinel scan).
const LazyExcalidrawView = lazy(() =>
  import("../ExcalidrawView").then((m) => ({ default: m.ExcalidrawView })),
);

/**
 * Issue #352 / iter-13 — persistent Excalidraw mount host.
 *
 * Renders one mounted `<ExcalidrawView>` per file path that the user
 * has entered Editor mode for at least once (tracked by
 * `excalidrawEditorMounts` in the tabs slice). Slots are absolutely
 * positioned over the viewer area; only the slot whose path matches
 * `activeTabPath` AND whose view-mode is `visual` or `editor` is
 * visible — all others are hidden via `display: none`.
 *
 * **Why this exists.** Excalidraw's native undo/redo stack lives on
 * the `<Excalidraw>` component instance. Unmounting (which today
 * happens on every tab switch) loses the undo history. By keeping
 * the same instance mounted across tab switches we preserve native
 * Cmd+Z / Cmd+Shift+Z, the library panel, the active tool, and the
 * viewport pan/zoom. Visual ↔ Editor toggling on the SAME instance
 * is achieved via the runtime `viewModeEnabled` prop on
 * `<Excalidraw>` — confirmed dynamic in
 * `node_modules/@excalidraw/excalidraw/dist/types/excalidraw/types.d.ts`
 * (line 436). One instance per path covers both modes.
 *
 * **Why we don't pre-mount in Visual mode.** A user who only briefly
 * previews an `.excalidraw` in Visual mode shouldn't pay the
 * memory cost of a persistent Excalidraw instance. Registration is
 * deferred to first-Editor-entry, which signals intent-to-edit.
 *
 * **Cleanup.** `closeTab`, `closeAllTabs`, and LRU eviction all
 * filter the path out of `excalidrawEditorMounts` in their
 * single-`set()` cleanup (see `src/store/tabs.ts`). The host
 * re-renders, the slot drops from the JSX tree, React unmounts the
 * `<ExcalidrawView>` and its child `<Excalidraw>` — freeing the
 * scene state, library, and ~5–20 MB of RAM per instance.
 *
 * **Source mode coexistence.** When the active tab is in Source
 * mode the host's slot for that path stays mounted but is hidden
 * (display:none). `<SourceView>` rendered by `EnhancedViewer`
 * appears on top in the same viewer area.
 *
 * **Layout assumption.** Mount this component as a sibling of
 * `<ViewerRouter>` inside `.viewer-area` (in `App.tsx`). The CSS in
 * `src/styles/excalidraw-host.css` positions slots absolutely
 * relative to that container.
 */
export function PersistentExcalidrawHost() {
  // useShallow keeps the array identity stable when the underlying
  // `excalidrawEditorMounts` content is element-wise unchanged so the
  // host doesn't re-render on unrelated store mutations.
  const mounts = useStore(useShallow((s) => s.excalidrawEditorMounts));
  const activeTabPath = useStore((s) => s.activeTabPath);
  const activeMode = useStore((s) =>
    s.activeTabPath ? s.viewModeByTab[s.activeTabPath] : undefined,
  );

  // The host renders slots for every registered path. Pre-registration
  // excalidraw rendering still flows through
  // `EnhancedViewer.renderVisualView` for ephemeral one-shot mounts.
  if (mounts.length === 0) return null;

  return (
    <div className="excalidraw-host" data-testid="excalidraw-host">
      {mounts.map((path) => (
        <PersistentExcalidrawSlot
          key={path}
          path={path}
          isActive={path === activeTabPath}
          activeMode={activeMode}
        />
      ))}
    </div>
  );
}

interface SlotProps {
  path: string;
  isActive: boolean;
  /** The active tab's view mode — only used when `isActive === true`. */
  activeMode: ViewMode | undefined;
}

function PersistentExcalidrawSlot({ path, isActive, activeMode }: SlotProps) {
  // The slot owns the `useFileContent` lifecycle for its path. While
  // the active `EnhancedViewer` ALSO calls `useFileContent` for the
  // same path (for Source-mode rendering), the duplication is
  // bounded: at most one extra read per persistent path per session,
  // not per tab switch. The hook's internal `lastSaveByPath`
  // suppression and content-equality short-circuit (see
  // `useFileContent.ts:114-126`) ensure no spurious work on stable
  // content.
  const { status, content } = useFileContent(path);
  const lower = path.toLowerCase();
  const needsExtract =
    lower.endsWith(".excalidraw.png") || lower.endsWith(".excalidraw.svg");

  // Visibility: slot is visible only when its path is the active tab
  // AND the active mode is visual or editor. Source mode hides the
  // slot (SourceView renders in front of it).
  const visible =
    isActive && (activeMode === "visual" || activeMode === "editor");
  // The Excalidraw instance receives the active tab's mode; when
  // hidden we feed "visual" defensively (read-only canvas) so a
  // re-show in Editor mode picks up the correct mode immediately
  // via the viewModeEnabled prop change. The slot's path-default
  // mode is irrelevant here — only the active path's chosen mode
  // matters because only the active path's slot is visible.
  void getDefaultView; // kept for symmetry with EnhancedViewer; unused here
  void getFileCategory;
  const viewMode: "visual" | "editor" =
    isActive && activeMode === "editor" ? "editor" : "visual";

  // Until the file content is loaded for the first time, render an
  // empty slot. Excalidraw's load effect requires `content` to be a
  // valid JSON string for canonical files; rendering before that
  // produces a transient parse-error banner which would flicker into
  // view on first registration.
  if (status !== "ready" || content === undefined) {
    return (
      <div
        className="excalidraw-host__slot"
        data-active={visible ? "true" : "false"}
        data-path={path}
        data-testid={`excalidraw-host-slot-${path}`}
      >
        <Suspense fallback={<SkeletonLoader />}>
          <SkeletonLoader />
        </Suspense>
      </div>
    );
  }

  return (
    <div
      className="excalidraw-host__slot"
      data-active={visible ? "true" : "false"}
      data-path={path}
      data-testid={`excalidraw-host-slot-${path}`}
    >
      <Suspense fallback={<SkeletonLoader />}>
        <LazyExcalidrawView
          content={content}
          filePath={path}
          mode={viewMode}
          needsExtract={needsExtract}
        />
      </Suspense>
    </div>
  );
}

