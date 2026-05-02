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

Editor mode **auto-saves on change** — there is no Save button and no manual save action. Excalidraw's `<Excalidraw onChange>` fires on every scene mutation (real edits, tool selection, viewport pan); each onChange resets a 2-second debounce timer. After 2 seconds with no further onChange, the live scene is persisted to disk via the workspace-write IPC.

The save fires only when the **persistent content** has actually diverged from the on-disk baseline. The renderer keeps a `lastSavedHashRef` baseline, computed as a stable hash that strips Excalidraw's volatile `version` / `versionNonce` / `updated` fields (these mutate on every operation including mount-time normalisation passes). Mount-time onChanges produce the same stable hash as the loaded scene, so opening a file does NOT trigger a save. Tool clicks and viewport pans are filtered out the same way.

**Cmd+S / Ctrl+S** flushes the pending debounce immediately and shows a transient `Saved` pill (top-right of the canvas, ~1.5s). This restores the muscle-memory affordance for power users — saves still happen automatically; the keyboard shortcut just confirms the action and bypasses the 2s wait.

Format-preserving by file type (each branch is honoured in `src/lib/excalidraw/saveScene.ts`):

| Extension | Excalidraw API | Wire IPC |
|---|---|---|
| `.excalidraw` | `serializeAsJSON({ elements, appState, files })` | `write_workspace_text` |
| `.excalidrawlib` | `serializeLibraryAsJSON({ libraryItems })` | `write_workspace_text` |
| `.excalidraw.png` | `exportToBlob({ ..., mimeType: "image/png", embedScene: true })` → base64 | `write_workspace_binary` |
| `.excalidraw.svg` | `exportToSvg({ ..., embedScene: true })` → base64 | `write_workspace_binary` |

JSON saves are **verbatim** — no `JSON.stringify(..., null, 2)` rewrap, no custom pretty-printing. Excalidraw's serializer already emits a stable canonical form; re-formatting it would shift line numbers on every save and defeat MRSF's source-line re-anchoring.

After every successful save the renderer calls `recordSave(filePath)` (Zustand `lastSaveByPath`) so `useFileWatcher` suppresses the watcher echo of our own write — without this the watcher fires `file-changed`, `useFileContent` would reload, and the loop churns.

### "Changes save automatically." info banner

A dismissible info banner above the canvas teaches users that edits persist without an explicit save action:

> Changes save automatically. &nbsp; **[Got it]**

Dismissed once and stays dismissed forever (per browser profile, tracked in `localStorage` under `mdownreview:excalidraw-autosave-banner-seen`). Pattern mirrors the first-save warning. SSR / cookie-blocked / private mode degrades to "always seen" so the banner doesn't surface where dismissal can't persist.

### Auto-save lifecycle: flush, pause, in-flight coalesce

- **Tab switch / window close / mode switch out of Editor** → the pending debounce is **flushed**, not cancelled. The component's `useEffect` cleanup calls `flushAutoSave()` synchronously so any in-flight edits land on disk before the live scene state is torn down. (Without this, switching tabs within 2s of an edit would silently discard the change.)
- **External change pending** (conflict banner up) → auto-save is **paused** until the user picks Reload or Keep editing. Don't clobber the on-disk version while the user is deciding.
- **Concurrent saves** → serialised at the renderer via `saveInFlightRef`. An onChange arriving while a save is in flight sets `pendingSaveRef = true`; after the in-flight save resolves, a follow-up debounce fires automatically so the user's latest edits land on disk.
- **Three consecutive failures** → auto-save **pauses** and the save-error banner shifts to:

  > Auto-save paused after repeated failures: <reason> &nbsp; **[Resume] [Dismiss]**

  Without this guard a broken disk / readonly drive would surface one error banner per ~2s of editing — UI spam. Resume clears the failure counter and re-engages the loop.
- **Read-only tabs** (outside any open workspace) — Editor mode is unavailable (the toolbar segmented control hides the Editor button and any stored `editor` mode demotes to `visual`), so auto-save doesn't fire on them.

### Conflict-banner gate

The `excalidrawDirtyByTab` slice in `tabs.ts` tracks "live scene has diverged from on-disk". ExcalidrawView's `onChange` sets it to `true` when the stable content hash diverges from `lastSavedHashRef`; save success clears it back to `false`.

`useFileContent` reads the flag on every `mdownreview:file-changed` event:

- **Not dirty** → silent reload (existing behaviour for non-Excalidraw files too).
- **Dirty** → set `externalChangePendingByTab[path] = true` instead of bumping the reload key. The view renders a non-modal banner above the canvas:

  > File changed on disk &nbsp; **[Reload]** &nbsp; **[Keep editing — your changes will overwrite the version on disk]**

  - **Reload** clears pending, cancels the pending auto-save timer (so a debounced save doesn't clobber the freshly-loaded scene), bumps the internal `reloadKey` so `<Excalidraw>` remounts with fresh `initialData`, and dispatches a synthetic `mdownreview:file-changed` event so `useFileContent` re-reads the on-disk bytes (canonical files) or re-runs `extractScene` (binary variants).
  - **Keep editing — your changes will overwrite the version on disk** clears pending; the next debounce fire writes the user's version through the same workspace-write IPC.

User-driven, no implicit data loss either way.

### Save errors

Workspace-write IPC failures (10 MB cap exceeded, file outside workspace, extension not allowlisted, NTFS ADS filename, malformed base64) surface as a non-modal banner above the canvas with friendly copy mapped from the Rust error string:

> Couldn't save your changes: Drawing too large to save (12 MB > 10 MB limit). Try removing embedded images or splitting the drawing. &nbsp; **[Retry] [Dismiss]**

The banner is `role="alert"` so screen readers announce it immediately. The canvas remains mounted — save failures are recoverable, not catastrophic. Retry clears the failure counter and re-fires the save bypassing the debounce.

After **3 consecutive failures**, the loop pauses and the banner copy + button shift:

> Auto-save paused after repeated failures: <reason> &nbsp; **[Resume] [Dismiss]**

### MRSF first-Editor-entry warning

The first time a user enters **Editor mode** for any Excalidraw file (per browser profile, tracked in `localStorage` under `mdownreview:excalidraw-first-save-warning-seen`), an info-toned banner appears above the canvas:

> Saving a drawing may move some line-anchored comments to file-level. &nbsp; **[Got it]**

This is a one-shot pedagogical hint — Excalidraw re-serialises the JSON on every save, so line numbers shift and Tier-1 line-anchored comments may degrade to file-level via the standard 4-step MRSF re-anchor → orphan flow. The carve-out at [`docs/principles.md`](../principles.md) only stays load-bearing if the user is informed; this banner is the informant. Pre-iter-11 the warning fired on first successful save; under auto-save the user has no explicit save action, so the trigger shifted to first Editor-mode entry — proactive disclosure with a clear cause.

## Key source

- `src/components/viewers/ExcalidrawView.tsx` — lazy shell mounting `<Excalidraw>`, with theme integration via `useTheme()`, `data-testid="excalidraw-shell"` for E2E, the `onChange` → debounced auto-save wiring, the "Changes save automatically." banner, the save-error banner (with failure-pause + Resume), the conflict banner, the MRSF warning banner, the transient "Saved" pill (Cmd+S flush feedback), and the listener for `mdownreview:excalidraw-flush-save`. Owns `reloadKey` for explicit canvas remount on conflict-banner Reload.
- `src/components/viewers/ExcalidrawSourceMode.tsx` — lazy wrapper that runs `extractScene(filePath)` and feeds pretty-printed JSON to `<SourceView>` so PNG/SVG variants in Source mode display the embedded scene.
- `src/lib/excalidraw/extractScene.ts` — thin wrapper over Excalidraw's `loadFromBlob` (PNG/SVG variants → scene JSON for Visual mode + Source mode display).
- `src/lib/excalidraw/saveScene.ts` — thin wrapper over `serializeAsJSON` / `serializeLibraryAsJSON` / `exportToBlob` / `exportToSvg`; routes to `write_workspace_text` / `write_workspace_binary` per extension.
- `src/lib/excalidraw/first-save-warning.ts` — `localStorage` chokepoint for the MRSF first-Editor-entry seen flag. `hasSeenMrsfWarning()` / `markMrsfWarningSeen()` (legacy aliases `hasSeenFirstSave` / `markFirstSaveSeen` retained for back-compat).
- `src/lib/excalidraw/autosave-banner.ts` — `localStorage` chokepoint for the auto-save info banner seen flag.
- `src/lib/file-types.ts` — `excalidraw` category, `DOUBLE_EXT_MAP`, `ViewMode = "source" | "visual" | "editor"`, `getDefaultView`, `getFiletypeKey`.
- `src/components/viewers/ViewerToolbar.tsx` — tri-state segmented control gated on `canEdit` (false when the active tab is read-only).
- `src/components/viewers/EnhancedViewer.tsx` — 3-way switch over `viewMode`. Routes Source mode for binary excalidraw paths to `<ExcalidrawSourceMode/>`.
- `src/store/tabs.ts` — `excalidrawDirtyByTab` (gates the conflict banner) and `externalChangePendingByTab` (renders the conflict banner) maps; `setExcalidrawDirty`, `setExternalChangePending` actions.
- `src/hooks/useFileContent.ts` — gates `mdownreview:file-changed` reload on the dirty flag to surface the conflict banner instead of silently reloading mid-edit.
- `src/hooks/useGlobalShortcuts.ts` — `Ctrl/Cmd+S` shortcut dispatches `mdownreview:excalidraw-flush-save` for active Excalidraw editor tabs.
- `src-tauri/src/commands/fs_write.rs` — workspace-write chokepoint (`write_workspace_text` / `write_workspace_binary`); see architecture rule 32.
- `vite.config.ts` `excalidrawAssetCopy` — fonts vendored to `public/excalidraw-assets/`.
- `scripts/check-bundle-baseline.mjs` + `scripts/bundle-baseline.json` — main-entry-chunk regression guard. Wired to CI.

## Known limitations

- **MRSF re-anchor fragility** (documented above). Saving an Excalidraw scene may degrade Tier-1 line-anchored comments to file-level. The first-Editor-entry warning banner alerts the user once.
- **Multi-window same-file race**: two windows open on the same `.excalidraw` and the user edits in window A → window A auto-saves → window B's watcher fires → window B reloads → window B's user-edits-in-flight in `liveSceneRef` are lost when window B's onChange writes them out (post-watcher) and clobbers window A's edit. Single-instance-per-file dispatch (mirroring `cli-file-open.md`) is the canonical fix and is tracked as a follow-up. See [`docs/best-practices-common/tauri/v2-patterns.md`](../best-practices-common/tauri/v2-patterns.md) for the cross-window event + state-sharing patterns this fix would build on.
- **No native E2E save round-trip yet** — issue #352 spec mandates `e2e/native/excalidraw-real-write.spec.ts`. Browser e2e + the Rust unit tests for `fs_write.rs` cover the IPC contract; native end-to-end (real disk write + read-back inside a Tauri binary) is tracked as a follow-up.

## Related rules

- Architecture rule 32 in [`docs/architecture.md`](../architecture.md) — workspace-write IPC chokepoint.
- Architecture rule 1 (IPC chokepoint pair) — augmented with the second chokepoint clause.
- Architecture rule 23 — file-size budgets; `tabs.ts` is on the 500-line shared-chokepoint list.
- Architecture rule 30 — Warm-tier subscription discipline (`viewModeByTab`, `excalidrawDirtyByTab`, `externalChangePendingByTab`).
- Security rule 29 in [`docs/security.md`](../security.md) — five workspace-write bounds.
- Security rule 1 — 10 MB file-read cap (which transitively bounds the embedded-scene parser surface).
- Security rule 17 — CSP grants `worker-src 'self' blob:` and `connect-src 'self'` to support Excalidraw's web workers and i18n loader.
- Viewer-consistency Tier-2 + Editor sub-mode (this doc's parent: [`viewer-consistency.md`](viewer-consistency.md)).
- Principles Non-Goal carve-out at [`docs/principles.md`](../principles.md).
