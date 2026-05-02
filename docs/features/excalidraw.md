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

### Save semantics (implemented in iter 3 of #352)

Iter 2 ships read-only mounting. Save UX (explicit Save button + `Ctrl+S`, dirty dot in tab title, close-tab guard) and the external-change banner (when the watcher fires on a dirty editor) are deferred to iter 3. The Rust write IPC (`write_workspace_text` / `write_workspace_binary`) already exists from iter 1 and is consumed by the iter-3 save handler.

### Conflict UX (implemented in iter 3 of #352)

Same — iter 3 wires the watcher-bridge that surfaces a non-modal banner when an external write fires while the editor is dirty.

## Key source

- `src/components/viewers/ExcalidrawView.tsx` — lazy shell mounting `<Excalidraw>`, with theme integration via `useTheme()` and `data-testid="excalidraw-shell"` for E2E.
- `src/lib/excalidraw/extractScene.ts` — thin wrapper over Excalidraw's `loadFromBlob` (PNG/SVG variants → scene JSON for Source mode display). Library invocation, no custom parsing — analogous to Mermaid's render path.
- `src/lib/file-types.ts` — `excalidraw` category, `DOUBLE_EXT_MAP`, `ViewMode = "source" | "visual" | "editor"`, `getDefaultView`, `getFiletypeKey`.
- `src/components/viewers/ViewerToolbar.tsx` — tri-state segmented control gated on `canEdit`.
- `src/components/viewers/EnhancedViewer.tsx` — 3-way switch over `viewMode`.
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
