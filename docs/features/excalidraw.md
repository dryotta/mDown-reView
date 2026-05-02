# Excalidraw

## What it is

A 3-mode viewer for Excalidraw drawings (`.excalidraw`, `.excalidrawlib`) and the round-trippable image variants (`.excalidraw.png`, `.excalidraw.svg`). Users open these files like any other in mdownreview; the viewer offers Source (raw scene JSON, syntax-highlighted), Visual (read-only render of the scene), and Editor (in-place editing through the workspace-write chokepoint) modes via the standard `ViewerToolbar` segmented control.

This is the first feature that **edits user file content** — historically an explicit Non-Goal. The carve-out is bounded by an extension allowlist enforced at a single Rust write chokepoint (rule 32 in [`docs/architecture.md`](../architecture.md), rule 29 in [`docs/security.md`](../security.md)) so the Non-Goal stays load-bearing for every other file type.

## How it works

### Modes

- **Source** — `SourceView` renders the scene JSON via Shiki syntax highlighting. Tier 1 commenting (line + selection) for canonical `.excalidraw` and `.excalidrawlib`; Tier 2 (file-level only) for `.excalidraw.png` and `.excalidraw.svg` because the embedded scene is derived from the rendered image, not authored as JSON.
- **Visual** — `<Excalidraw viewModeEnabled={true}>` mounts a read-only canvas. Pan + zoom only; no edit chrome. Tier 2 commenting (file-level only).
- **Editor** — `<Excalidraw>` mounts the full editor. Built-in Open / Save / Export buttons are hidden via `UIOptions.canvasActions`. Tier 2 commenting (file-level only).

The default mode for all four extensions is **Visual** — uniform with every other visualizable file type and minimizes first-paint cost. Editor is one explicit click away via the toolbar.

### Routing

`src/lib/file-types.ts` routes the four extensions to the new `excalidraw` `FileCategory`. Compound suffixes (`.excalidraw.png`, `.excalidraw.svg`) are matched **before** the single-extension lookup so a real PNG (`photo.png`) keeps routing to `image`. `EnhancedViewer.tsx` switches on `viewMode` to mount `SourceView` (source) or the lazy `ExcalidrawView` shell (visual + editor) — `<ExcalidrawView/>` itself decides Visual vs Editor via the `viewModeEnabled` prop.

### Asset path

Excalidraw fetches its custom fonts from `https://esm.run/...` by default. mdownreview is fully offline (per `AGENTS.md` Constraints), so the package's `dist/prod/` is vendored to `public/excalidraw-assets/` at Vite `configResolved` (see `vite.config.ts` `excalidrawAssetCopy` plugin). `window.EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/"` is set at module-scope in `ExcalidrawView.tsx` so it fires once on first lazy-chunk load.

### Library files

`.excalidrawlib` opens in Visual mode with the palette grid preview (Excalidraw's built-in library renderer). Editor mode allows editing the library; saving routes through the same workspace-write chokepoint as scenes.

### Save semantics

Editor mode supports explicit save only — there is **no autosave** and no save-on-blur. Saves are triggered by:

1. The **Save** button in the `ViewerToolbar` trailing slot (visible only when category is `excalidraw` AND view mode is `editor`).
2. **Ctrl+S** (Cmd+S on macOS) when the active tab is an Excalidraw file in Editor mode.

Both paths dispatch the `mdownreview:excalidraw-save-request` DOM event keyed by file path; the live `<ExcalidrawView/>` (the only surface holding the canvas state) is the listener. This decouples the toolbar + global-shortcut surfaces from the lazy Excalidraw chunk — neither imports `@excalidraw/excalidraw` directly.

Format-preserving by file type (each branch is honoured in `src/lib/excalidraw/saveScene.ts`):

| Extension | Excalidraw API | Wire IPC |
|---|---|---|
| `.excalidraw` | `serializeAsJSON({ elements, appState, files })` | `write_workspace_text` |
| `.excalidrawlib` | `serializeLibraryAsJSON({ libraryItems })` | `write_workspace_text` |
| `.excalidraw.png` | `exportToBlob({ ..., mimeType: "image/png", embedScene: true })` → base64 | `write_workspace_binary` |
| `.excalidraw.svg` | `exportToSvg({ ..., embedScene: true })` → base64 | `write_workspace_binary` |

JSON saves are **verbatim** — no `JSON.stringify(..., null, 2)` rewrap, no custom pretty-printing. Excalidraw's serializer already emits a stable canonical form; re-formatting it would shift line numbers on every save and defeat MRSF's source-line re-anchoring. The PNG/SVG round-trips re-render the raster + freshly embed the scene chunk, so the original file format is preserved (we never silently rewrite a `.excalidraw.png` to canonical `.excalidraw` JSON).

### Dirty tracking + close-tab guard

Excalidraw's `<Excalidraw onChange>` fires on every scene mutation. The view counts past the initial mount-restore call and then sets `excalidrawDirtyByTab[path] = true` in the tabs slice. The TabBar reads that map and renders a `•` next to the basename when dirty (with `aria-label="Unsaved changes"` for screen readers).

Closing a dirty Excalidraw tab triggers a `globalThis.confirm("Discard changes?")` prompt; cancelling the prompt aborts the close and leaves dirty state intact. `closeAllTabs` prompts once if any open Excalidraw tab is dirty.

The dirty flag clears on:

- successful save (the IPC promise resolves).
- explicit reload via the conflict banner's `Reload` button.
- mode-switch out of `editor` (the Visual / Source modes can't have meaningful dirty state).
- tab close (after the guard prompt).

### External-change conflict (watcher contention)

When the file watcher fires `file-content-changed` on a file open in Editor mode, `useFileContent` checks the dirty flag:

- **Not dirty** → silent reload (existing behaviour).
- **Dirty** → set `externalChangePendingByTab[path] = true` instead of bumping the reload key. The view renders a non-modal banner above the canvas:

  > File changed on disk &nbsp; **[Reload]** &nbsp; **[Keep editing — your save will overwrite]**

  - **Reload** clears dirty + pending and dispatches a fresh `mdownreview:file-changed` event so `useFileContent` picks up the on-disk version.
  - **Keep editing — your save will overwrite** clears pending only; dirty stays true so the next Save will overwrite the on-disk version through the same workspace-write IPC.

User-driven, no implicit data loss either way. Mirrors the sidecar conflict UX.

## Key source

- `src/components/viewers/ExcalidrawView.tsx` — lazy shell mounting `<Excalidraw>`, with theme integration via `useTheme()`, `data-testid="excalidraw-shell"` for E2E, the `onChange` → dirty-tracking wiring, the conflict banner, and the listener for `mdownreview:excalidraw-save-request`.
- `src/lib/excalidraw/extractScene.ts` — thin wrapper over Excalidraw's `loadFromBlob` (PNG/SVG variants → scene JSON for Source mode display).
- `src/lib/excalidraw/saveScene.ts` — thin wrapper over `serializeAsJSON` / `serializeLibraryAsJSON` / `exportToBlob` / `exportToSvg`; routes to `write_workspace_text` / `write_workspace_binary` per extension.
- `src/lib/file-types.ts` — `excalidraw` category, `DOUBLE_EXT_MAP`, `ViewMode = "source" | "visual" | "editor"`, `getDefaultView`, `getFiletypeKey`.
- `src/components/viewers/ViewerToolbar.tsx` — tri-state segmented control gated on `canEdit`.
- `src/components/viewers/EnhancedViewer.tsx` — 3-way switch over `viewMode`, `Save` button rendered in the toolbar trailing slot when the active mode is `editor`.
- `src/store/tabs.ts` — `excalidrawDirtyByTab` + `externalChangePendingByTab` maps; `setExcalidrawDirty`, `setExternalChangePending` actions; close-tab `Discard changes?` guard.
- `src/components/TabBar/TabBar.tsx` — dirty-dot rendering off `excalidrawDirtyByTab`.
- `src/hooks/useFileContent.ts` — gates the `mdownreview:file-changed` reload to surface the conflict banner when the editor is dirty.
- `src/hooks/useGlobalShortcuts.ts` — `Ctrl/Cmd+S` shortcut bound only to active Excalidraw editor tabs.
- `src-tauri/src/commands/fs_write.rs` — workspace-write chokepoint (`write_workspace_text` / `write_workspace_binary`); see architecture rule 32.
- `vite.config.ts` `excalidrawAssetCopy` — fonts vendored to `public/excalidraw-assets/`.

## Related rules

- Architecture rule 32 in [`docs/architecture.md`](../architecture.md) — workspace-write IPC chokepoint.
- Architecture rule 1 (IPC chokepoint pair) — augmented with the second chokepoint clause.
- Architecture rule 23 — file-size budgets (ExcalidrawView soft cap 250 LoC).
- Architecture rule 30 — Warm-tier subscription discipline (`viewModeByTab`).
- Security rule 29 in [`docs/security.md`](../security.md) — five workspace-write bounds.
- Security rule 1 — 10 MB file-read cap (which transitively bounds the embedded-scene parser surface).
- Security rule 17 — CSP composition; iter 1 added `worker-src 'self' blob:` and `connect-src 'self'` to support Excalidraw's web workers and i18n loader.
- Viewer-consistency Tier-2 + Editor sub-mode (this doc's parent: [`viewer-consistency.md`](viewer-consistency.md)).
- Principles Non-Goal carve-out at [`docs/principles.md`](../principles.md).
