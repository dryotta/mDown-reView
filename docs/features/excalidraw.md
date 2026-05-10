# Excalidraw

## What it is

A 3-mode viewer for Excalidraw drawings (`.excalidraw`, `.excalidrawlib`) and the round-trippable image variants (`.excalidraw.png`, `.excalidraw.svg`). Users open these files like any other in mdownreview; the viewer offers Source (raw scene JSON, syntax-highlighted), Visual (read-only render of the scene), and Editor (in-place editing through the workspace-write chokepoint) modes via the standard `ViewerToolbar` segmented control.

This is the first feature that **edits user file content** — historically an explicit Non-Goal. The carve-out is bounded by an extension allowlist enforced at a single Rust write chokepoint (rule 32 in [`docs/architecture.md`](../architecture.md), rule 29 in [`docs/security.md`](../security.md)) so the Non-Goal stays load-bearing for every other file type.

## How it works

### Modes

- **Source** — `SourceView` renders the scene JSON via Shiki syntax highlighting. Tier 1 commenting (line + selection) for canonical `.excalidraw` and `.excalidrawlib`; Tier 2 (file-level only) for `.excalidraw.png` and `.excalidraw.svg` because the embedded scene is derived from the rendered image, not authored as JSON.
- **Visual** — `<Excalidraw viewModeEnabled={true}>` mounts a read-only canvas. Pan + zoom only; no edit chrome. Tier 2 commenting (file-level only). For `.excalidrawlib`, Visual mode also pre-opens the library sidebar so the curated shapes are immediately browsable as a grid.
- **Editor** — `<Excalidraw>` mounts the full editor. Built-in Open / Save / Export buttons are hidden via `UIOptions.canvasActions`. Tier 2 commenting (file-level only). **Available for `.excalidraw` / `.excalidraw.png` / `.excalidraw.svg` only**; iter-22 redesign removed Editor mode for `.excalidrawlib` (libraries are reusable shape collections, not documents the user authors line-by-line; see "Library files" below).

The default mode for all extensions is **Visual** — uniform with every other visualizable file type and minimizes first-paint cost. Editor is one explicit click away via the toolbar.

### Routing

`src/lib/file-types.ts` routes the four extensions to the new `excalidraw` `FileCategory`. Compound suffixes (`.excalidraw.png`, `.excalidraw.svg`) are matched **before** the single-extension lookup so a real PNG (`photo.png`) keeps routing to `image`. `EnhancedViewer.tsx` switches on `viewMode` to mount `SourceView` (source) or the lazy `ExcalidrawView` shell (visual + editor) — `<ExcalidrawView/>` itself decides Visual vs Editor via the `viewModeEnabled` prop.

### Asset path

Excalidraw fetches its custom fonts from `https://esm.run/...` by default. mdownreview is fully offline (per `AGENTS.md` Constraints), so the package's `dist/prod/` is vendored to `public/excalidraw-assets/` at Vite `configResolved` (see `vite.config.ts` `excalidrawAssetCopy` plugin). `window.EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/"` is set at module-scope in `ExcalidrawView.tsx` so it fires once on first lazy-chunk load.

### Library files

`.excalidrawlib` opens in Visual mode with the library sidebar pre-opened, showing the curated shape palette as a grid (`appState.openSidebar = { name: "default", tab: "library" }` set in `useExcalidrawScene`). The user can browse the shapes inside the library throughout the session.

**Editor mode is unavailable for `.excalidrawlib`** (iter-22 redesign — user feedback). Libraries are reusable shape collections, not documents the user authors line-by-line; the toolbar's Editor segmented-control button is hidden via `EnhancedViewer.canEdit=false` for these paths, and any session-persisted `editor` mode is demoted to `visual` on render. Source mode shows the raw library JSON (Tier 1 commenting). The autosave hook is still mounted (it's a generic primitive) but its registry effect bails on `mode !== "editor"`, so no save path can fire.

### Save semantics

Editor mode **auto-saves on change** — there is no Save button and no manual save action. Excalidraw's `<Excalidraw onChange>` fires on every scene mutation (real edits, tool selection, viewport pan); each onChange resets a 2-second debounce timer. After 2 seconds with no further onChange, the live scene is persisted to disk via the workspace-write IPC.

The save fires only when the **persistent content** has actually diverged from the on-disk baseline. The renderer keeps a `lastSavedHashRef` baseline, computed as a stable hash that strips Excalidraw's volatile `version` / `versionNonce` / `updated` fields (these mutate on every operation including mount-time normalisation passes). Mount-time onChanges produce the same stable hash as the loaded scene, so opening a file does NOT trigger a save. Tool clicks and viewport pans are filtered out the same way.

**Cmd+S / Ctrl+S** flushes the pending debounce immediately. A transient `Saved` pill flashes top-right of the canvas (~1.5 s) **only when a real disk write fired** — the pill is gated on `userInitiated && success`, so Cmd+S during paused / no-diff / conflict / in-flight states correctly does NOT flash the pill. The persistent `SaveStatusIndicator` (described below) is the source of truth for save state at all times; the pill is just a transient confirmation flash for the keyboard shortcut.

### Persistent save-state indicator

A persistent `SaveStatusIndicator` sits in the bottom-middle of the canvas in Editor mode and surfaces the current save state at all times — `saved`, `unsaved`, `saving`, `failed`, or `paused`. Priority order (highest → lowest): `paused > failed > saving > unsaved > saved`. The indicator hides until the first edit (no chrome on a freshly-opened, unmodified scene) and auto-fades 2 s after settling on `saved`; `failed` and `paused` never auto-fade — the user must take an explicit action (Retry / Resume / Dismiss) before the indicator clears. The `failed` and `paused` states use the must-acknowledge-banner pattern (`docs/best-practices-project/must-acknowledge-banner.md`): `paused` exposes only `[Resume]`, never `[Dismiss]`, so the user cannot accidentally hide an unsafe state.

Format-preserving by file type (each branch is honoured in `src/lib/excalidraw/saveScene.ts`):

| Extension | Excalidraw API | Wire IPC |
|---|---|---|
| `.excalidraw` | `serializeAsJSON({ elements, appState, files })` | `write_workspace_text` |
| `.excalidrawlib` | `serializeLibraryAsJSON({ libraryItems })` | `write_workspace_text` |
| `.excalidraw.png` | `exportToBlob({ ..., mimeType: "image/png", embedScene: true })` → base64 | `write_workspace_binary` |
| `.excalidraw.svg` | `exportToSvg({ ..., embedScene: true })` → base64 | `write_workspace_binary` |

JSON saves are **verbatim** — no `JSON.stringify(..., null, 2)` rewrap, no custom pretty-printing. Excalidraw's serializer already emits a stable canonical form; re-formatting it would shift line numbers on every save and defeat MRSF's source-line re-anchoring.

After every successful save the renderer calls `recordSave(filePath)` (Zustand `lastSaveByPath`) so `useFileWatcher` suppresses the watcher echo of our own write — without this the watcher fires `file-changed`, `useFileContent` would reload, and the loop churns.

### First-Editor-entry disclosure banner

A dismissible info banner above the canvas teaches users on their **first Editor-mode entry** that edits persist without an explicit save action AND that re-serialising the JSON may shift line-anchored comments:

> Editor saves changes automatically as you draw. Editing rewrites the underlying JSON — comments pinned to specific lines may move to the whole file on save. &nbsp; **[Got it]**

Dismissed once and stays dismissed forever (per browser profile, tracked in `localStorage` under `mdownreview:excalidraw-first-entry-seen`). Two legacy seen-flags (`mdownreview:excalidraw-autosave-banner-seen` from iter-12, `mdownreview:excalidraw-first-save-warning-seen` from iter-11) are still **read** on mount so users who already dismissed either of the previous two banners are not re-shown the merged version. SSR / cookie-blocked / private mode degrades to "always seen" so the banner doesn't surface where dismissal can't persist.

The single combined disclosure replaced the previous two-banner stack (autosave-info + MRSF warning). The de-jargonized copy ("comments pinned to specific lines" / "the whole file") replaced internal terminology ("line-anchored comments" / "file-level"). Both changes ship from the #352 ship-readiness review (product-expert P0-2 + P0-3).

### Auto-save lifecycle: flush, pause, in-flight coalesce

- **Tab switch / window close / mode switch out of Editor** → the pending debounce is **flushed**, not cancelled. The component's `useEffect` cleanup calls `flushAutoSave()` synchronously so any in-flight edits land on disk before the live scene state is torn down. (Without this, switching tabs within 2s of an edit would silently discard the change.)
- **External change pending** (conflict banner up) → auto-save is **paused** until the user picks Reload or Keep my edits. Don't clobber the on-disk version while the user is deciding. The conflict gate reads `useStore.getState().externalChangePendingByTab[filePath]` directly so a same-tick "Keep my edits" handler that flips pending=false then calls `flush()` sees the new value (no ref-mirror race).
- **Concurrent saves** → serialised at the renderer via `saveInFlightRef`. An onChange arriving while a save is in flight sets `pendingSaveRef = true`; after the in-flight save resolves, a follow-up debounce fires automatically so the user's latest edits land on disk.
- **Reload during in-flight save** → `resetBaseline()` flips `voidInFlightSaveRef` so the racing save's `.then` continuation **skips** the post-success bookkeeping (no `lastSavedHashRef` update, no `recordSave()`, no `setExcalidrawDirty(false)`). The user's draft bytes have already been written but they cannot be unwritten — what we prevent is the racing save claiming "this draft is the canonical baseline" and arming watcher self-suppression that would silently absorb the external version's `file-changed` event.
- **Three consecutive failures** → auto-save **pauses** and the save-error banner shifts to:

  > Auto-save paused after repeated failures: <reason> &nbsp; **[Resume] [Dismiss]**

  Without this guard a broken disk / readonly drive would surface one error banner per ~2s of editing — UI spam. Resume clears the failure counter and re-engages the loop.
- **Read-only tabs** (outside any open workspace) — Editor mode is unavailable (the toolbar segmented control hides the Editor button and any stored `editor` mode demotes to `visual`), so auto-save doesn't fire on them.

### Conflict-banner gate

The `excalidrawDirtyByTab` slice in `tabs.ts` tracks "live scene has diverged from on-disk". ExcalidrawView's `onChange` sets it to `true` when the stable content hash diverges from `lastSavedHashRef`; save success clears it back to `false`.

`useFileContent` reads the flag on every `mdownreview:file-changed` event:

- **Not dirty** → silent reload (existing behaviour for non-Excalidraw files too).
- **Dirty** → set `externalChangePendingByTab[path] = true` instead of bumping the reload key. The view renders a non-modal banner above the canvas:

  > File changed on disk &nbsp; **[Reload (discard my edits)]** &nbsp; **[Keep my edits (overwrite disk)]**

  Buttons are styled asymmetrically — Reload is the primary/recommended action (filled background); "Keep my edits (overwrite disk)" is destructively styled (outlined-destructive) so the irreversible choice cannot be mistaken for the safer one via more reassuring text. Copy is short + parallel.

  - **Reload (discard my edits)** clears pending, cancels the pending auto-save timer, **voids any in-flight save** (sets `voidInFlightSaveRef` so the racing save's `.then` skips baseline / dirty / `recordSave` updates), bumps the internal `reloadKey` so `<Excalidraw>` remounts with fresh `initialData`, and dispatches a synthetic `mdownreview:file-changed` event so `useFileContent` re-reads the on-disk bytes (canonical files) or re-runs `extractScene` (binary variants).
  - **Keep my edits (overwrite disk)** clears pending and **flushes immediately** — the user's intent ("write my version now") is honoured at click time rather than deferred until the next onChange. Without the immediate flush, a power loss / OOM kill before the user's next edit would silently drop the divergent in-memory version.

User-driven, no implicit data loss either way.

### Save errors

Workspace-write IPC failures (10 MB cap exceeded, file outside workspace, extension not allowlisted, NTFS ADS filename, malformed base64) surface as a non-modal banner above the canvas with friendly copy mapped from the typed `WorkspaceWriteError` discriminator:

> Couldn't save your changes: Drawing too large to save (12 MB > 10 MB limit). Try removing embedded images or splitting the drawing. &nbsp; **[Retry] [Dismiss]**

The banner is `role="alert"` so screen readers announce it immediately. The canvas remains mounted — save failures are recoverable, not catastrophic. Retry clears the failure counter and re-fires the save bypassing the debounce.

After **3 consecutive failures**, the loop pauses and the banner copy + button shift:

> Auto-save paused after repeated failures: <reason> &nbsp; **[Resume] [Dismiss]**

### Cmd+S behaviour

`Cmd/Ctrl+S` while in Editor mode dispatches `mdownreview:excalidraw-flush-save` with the active file path. The view's listener calls `flush({ userInitiated: true })`. The "Saved" pill (top-right of the canvas, ~1.5s) flashes **only when a real write fired** — the user-initiated flag propagates into `performSave`'s success `.then`, which gates the pill on a successful disk write. The pill does NOT flash when the save is paused (3-strike), the conflict banner is up, the live scene matches the baseline (no diff), or any other early-bail in `performSave`.

## Persistent editor across tab switches

Excalidraw's native undo/redo, library panel, tool selection, and viewport pan/zoom all live on the `<Excalidraw>` component instance. Unmounting the instance (which previously happened on every tab switch) lost that state — closing then reopening the same tab even within the same session reset the canvas to a fresh render.

A **persistent mount host** keeps `<Excalidraw>` instances alive across tab switches:

- `src/store/tabs.ts:excalidrawEditorMounts` — `string[]` of file paths whose user has entered Editor mode at least once. Idempotent setter `markExcalidrawEditorMounted(path)`. Cleared by `closeTab`, `closeAllTabs`, and LRU eviction in a single `set()` call (rule 16).
- `src/components/viewers/excalidraw/PersistentExcalidrawHost.tsx` — rendered once at App-root level inside `.viewer-area` as a sibling of `<ViewerRouter>`. Renders one `<ExcalidrawView>` slot per registered path; absolutely positioned over the viewer area. Only the active path's slot is `data-active="true"` (visible); all other slots stay mounted but are `display: none` so React preserves the underlying canvas state.
- **Visual ↔ Editor share one instance.** The `viewModeEnabled` prop on `<Excalidraw>` is dynamic (verified in `node_modules/@excalidraw/excalidraw/dist/types/excalidraw/types.d.ts` line 436) — toggling between Visual and Editor mode flips the prop without a remount. One persistent instance per path covers both modes.
- **Source mode coexistence.** When the active tab is in Source mode the host's slot for that path stays mounted but hidden; `<SourceView>` rendered by `EnhancedViewer` appears on top in the same viewer area.
- **Why deferred to first Editor entry.** A user who only previews a drawing in Visual mode shouldn't pay the memory cost of a persistent Excalidraw instance (~5–20 MB). Registration is gated on entering Editor mode — a clear intent-to-edit signal. Pre-registration Visual viewing still flows through `EnhancedViewer.renderVisualView` for an ephemeral one-shot mount.
- **Cleanup contract.** Closing the tab unmounts the instance. The store's single-`set()` cleanup makes the multi-slice mutation atomic, so no subscriber observes an intermediate state where the tab is gone but the mount entry lingers.

What this preserves across tab switches:

- Excalidraw's native Cmd+Z / Cmd+Shift+Z history (the public API exposes only `history.clear()`; the stack is private and unreachable, so mount preservation is the only way to keep it alive).
- Open library panel + active tool + currently-selected elements.
- Viewport pan/zoom (`scrollX` / `scrollY` / `zoom` are non-persisted appState fields).
- The user's in-flight scene state (`liveSceneRef`).

What this does NOT cross:

- App close / reopen sessions. The persistent host is session-scoped — instances unmount on app exit (after the close-flush handshake drains pending saves). Cross-session undo would require a custom undo stack persisted to disk; tracked as a follow-up if user-tested demand emerges.

## Key source

- `src/components/viewers/ExcalidrawView.tsx` — lazy shell mounting `<Excalidraw>`, with theme integration via `useTheme()`, `data-testid="excalidraw-shell"` for E2E, the `onChange` → debounced auto-save wiring, the combined first-Editor-entry banner, the save-error banner (with failure-pause + Resume), the conflict banner, the transient "Saved" pill (Cmd+S flush feedback), and the listener for `mdownreview:excalidraw-flush-save`. Owns `reloadKey` for explicit canvas remount on conflict-banner Reload.
- `src/components/viewers/ExcalidrawSourceMode.tsx` — lazy wrapper that runs `extractScene(filePath)` and feeds pretty-printed JSON to `<SourceView>` so PNG/SVG variants in Source mode display the embedded scene.
- `src/components/viewers/excalidraw/ExcalidrawBanners.tsx` — presentational banner components: `FirstEntryBanner`, `SaveErrorBanner`, `ConflictBanner` (primary/destructive button styling), `SavedPill`.
- `src/components/viewers/excalidraw/PersistentExcalidrawHost.tsx` — module-scope mount host that keeps `<ExcalidrawView>` instances alive across tab switches. Reads `excalidrawEditorMounts` + `activeTabPath` + `viewModeByTab` to decide which slot is `data-active`. CSS in `src/styles/excalidraw-host.css`.
- `src/hooks/useExcalidrawAutoSave.ts` — auto-save state machine: `notifyChange` (cheap reference-identity pre-filter before snapshot), `flush({ userInitiated })`, `resetBaseline` (voids in-flight saves), failure counter + Resume, post-unmount drain, ref-mirror discipline.
- `src/hooks/useExcalidrawScene.ts` — scene loader for canonical JSON + binary variants (`extractScene` for `.png` / `.svg`).
- `src/hooks/useExcalidrawCloseFlush.ts` — close-flush handshake driver; awaits the `lastSavePromiseRef` chain before signalling Rust the window is safe to close.
- `src/lib/excalidraw/extractScene.ts` — thin wrapper over Excalidraw's `loadFromBlob` (PNG/SVG variants → scene JSON for Visual mode + Source mode display).
- `src/lib/excalidraw/saveScene.ts` — thin wrapper over `serializeAsJSON` / `serializeLibraryAsJSON` / `exportToBlob` / `exportToSvg`; routes to `write_workspace_text` / `write_workspace_binary` per extension.
- `src/lib/excalidraw/stable-hash.ts` — `computeSceneSnapshot` (volatile-stripped element/library hash + persisted-appState slice). Exports `PERSISTED_APPSTATE_KEYS` for the autosave hook's pre-filter.
- `src/lib/excalidraw/error-mapping.ts` — `friendlySaveError` maps the typed `WorkspaceWriteError` discriminator to user-facing copy.
- `src/lib/excalidraw/seen-flag.ts` — single `localStorage` chokepoint factory `seenFlag(key)` returning `{ has, mark }`. Used by `ExcalidrawView` for the first-Editor-entry seen flag.
- `src/lib/excalidraw/flush-registry.ts` — module-scope per-path flush-callback registry consumed by `useExcalidrawCloseFlush` to drain every editor tab on app close.
- `src/lib/file-types.ts` — `excalidraw` category, `DOUBLE_EXT_MAP`, `ViewMode = "source" | "visual" | "editor"`, `getDefaultView`, `getFiletypeKey`.
- `src/components/viewers/ViewerToolbar.tsx` — tri-state segmented control gated on `canEdit` (false when the active tab is read-only).
- `src/components/viewers/EnhancedViewer.tsx` — 3-way switch over `viewMode`. Routes Source mode for binary excalidraw paths to `<ExcalidrawSourceMode/>`. For paths in `excalidrawEditorMounts`, renders an empty placeholder for Visual/Editor (the `<PersistentExcalidrawHost>` overlays).
- `src/store/tabs.ts` — `excalidrawDirtyByTab` (gates the conflict banner), `externalChangePendingByTab` (renders the conflict banner), `excalidrawEditorMounts` (tracks paths with persistent `<Excalidraw>` instances). Setters `setExcalidrawDirty`, `setExternalChangePending`, `markExcalidrawEditorMounted`. All three maps cleared atomically on `closeTab` / `closeAllTabs` / LRU eviction.
- `src/hooks/useFileContent.ts` — gates `mdownreview:file-changed` reload on the dirty flag to surface the conflict banner instead of silently reloading mid-edit.
- `src/hooks/useGlobalShortcuts.ts` — `Ctrl/Cmd+S` shortcut dispatches `mdownreview:excalidraw-flush-save` for active Excalidraw editor tabs.
- `src-tauri/src/commands/fs_write.rs` — workspace-write chokepoint (`write_workspace_text` / `write_workspace_binary`); see architecture rule 32.
- `src-tauri/src/commands/open_file_registry.rs` — multi-window same-file singleton primitive (`claim_open_file`, `release_open_file`, `release_open_files`, `focus_window`).
- `src-tauri/src/commands/close_flush.rs` — close-flush handshake commands invoked from `WindowEvent::CloseRequested`.
- `vite.config.ts` `excalidrawAssetCopy` — fonts vendored to `public/excalidraw-assets/` (English-only Latin font allowlist; `data/` filtered to non-JS assets).
- `scripts/check-bundle-baseline.mjs` + `scripts/bundle-baseline.json` — main-entry-chunk regression guard. Wired to CI.

## Known limitations

- **MRSF re-anchor fragility** (documented above). Saving an Excalidraw scene may degrade Tier-1 line-anchored comments to file-level. The first-Editor-entry banner alerts the user once.
- **Persistent host loses state on app close.** Undo history, library panel, viewport pan/zoom survive tab switches but reset on app restart. Cross-session persistence would require a custom undo stack persisted to disk.
- **No native E2E save round-trip via the Editor UI yet.** `e2e/native/08-excalidraw-real-write.spec.ts` exercises the `write_workspace_text` IPC + watcher self-suppression + extension allowlist directly. A full Editor-driven `onChange → autosave → disk` round-trip in a real Tauri binary is tracked as a follow-up.

## Multi-window same-file singleton

Cross-window event/state patterns this section builds on are governed by the `multiwin-window-scoped-events` rule (window-scoped emit/listen) — see `tauri-coding-expert`'s bundled knowledge.

A canonical file path is open in **at most one window at a time**. When window B tries to open a file already in window A:

- Rust's `claim_open_file` IPC returns `OwnedElsewhere { window_label: <A> }`.
- Rust ALSO raises window A via `focus_window` (un-minimize → show → set-focus — handles minimized + macOS-hidden windows) and emits the `focus-tab` event to A with the path payload.
- A's renderer (`useFocusTab` hook) selects the corresponding tab.
- B's renderer reverts the synchronously-added tab in `claimOrRevert` (`src/store/tabs.ts`) so the user sees no duplicate.

The synchronous tab-add followed by async claim with revert-on-conflict was chosen over making `openFile` itself async to keep the ~80 existing test call sites compatible — the visible "flash and vanish" for a true duplicate is invisible at 60 Hz given sub-millisecond local IPC.

Lifecycle:

- `closeTab` / `closeAllTabs` / LRU eviction fire `release_open_file(s)` so the next opener can re-claim.
- `WindowEvent::Destroyed` purges every entry owned by the dying window's label (safety net for force-killed renderers).
- Stale-owner reap: at every claim, if the existing owner's label is no longer in `app.webview_windows()`, drop the stale entry inline.

Source: `src-tauri/src/commands/open_file_registry.rs`. The primitive is generic — future per-file singletons (Mermaid editor, etc.) reuse the same module.

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
