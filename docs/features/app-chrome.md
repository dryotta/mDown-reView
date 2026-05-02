# App Chrome

## What it is

The persistent UI surfaces that frame every workspace view: the **top toolbar** (file/folder/comments controls + native menu actions), the **viewer toolbar** (sticky source/visual/wrap toggle inside each viewer), and the **status bar** at the bottom of the window. Together they give the app its IDE-like feel without intruding on the content area.

## How it works

### Top toolbar

A flex row pinned above the main area. The left side holds a button group (Open File / Open Folder / Comments toggle / Settings — 4 buttons total) that does NOT shrink — those controls stay readable at every viewport width. The right side hosts the `TabBar`, whose wrapper *does* shrink (`flex-shrink: 1; min-width: 0`) so when many tabs are open the inner scroll strip overflows naturally and the left/right chevrons appear without any DOM-level workaround.

The Settings button (gear icon) flips `settingsSurface` to `'inline'` on the store. The no-tab area then routes to `<WelcomeView>` by default and to `<SettingsView>` when `settingsSurface === 'inline'` — see [settings.md](settings.md).

After the post-redesign cleanup, the toolbar carries no theme dropdown or About button — those moved into the native OS menu. App-level menu events (Theme · Light/Dark/System, About, Check for Update) are forwarded as `menu-*` Tauri events handled in `useMenuListeners` (rule 24 in [`docs/architecture.md`](../architecture.md)). The **Window** submenu also exposes a **Toggle Developer Tools** item (`F12`) that opens or closes the WebView's inspector for the current window — handled entirely in Rust (no frontend event) and available in release builds because `tauri` is built with the `devtools` Cargo feature. This is the **only** way to inspect the renderer: right-click does nothing (the WebView's default context menu is suppressed app-wide and the app ships no in-app context menus, see rule 29 in [`docs/architecture.md`](../architecture.md)).

### Viewer toolbar (sticky)

Each viewer renders a `ViewerToolbar` overlay at the top of its scroll container. It is `position: sticky; top: 0; z-index: 2`, so it stays in view as the body scrolls. Its left and right groups are hard-coded JSX — left holds the active-view toggle (Source ↔ Visual for files that support both) plus the Wrap toggle for source views, and the right holds the `ZoomControl`. Two `ReactNode` composition seams sit between those groups: a `centerSlot` for per-viewer affordances (the **file/orphan pill** plugged in by `ViewerRouter` for commentable viewers — `ToolbarFileCommentPill` renders an always-on **Comment on file** button whose label gains a `"{N} file {M} orphan"` count summary when there is at least one unresolved file-anchored or orphan thread) and a `trailing` slot used by `EnhancedViewer` to plug in `FileActionsBar`. The pill's counts are derived in TS from the same `useComments(filePath)` subscription the panel uses, routed through the typed `deriveAnchor()` adapter (`deriveAnchor(root).kind === "file"` for the file count, `root.isOrphaned` for the orphan count, resolved threads excluded) — never raw `anchor_kind` string equality at consumer sites and never from `FileBadge.file_level_count`. This is the only place these counts are visible in viewer chrome (rule 31 in [`docs/architecture.md`](../architecture.md) covers the producer side and prescribes the consumer-side `deriveAnchor` route; the slot composition itself follows `architecture-avoid-boolean-props` + `patterns-children-over-render-props` in [`docs/best-practices-common/react/composition-patterns.md`](../best-practices-common/react/composition-patterns.md)).

### Status bar

A single-row strip at the bottom of the window reports state for the active tab:

- **Path** — truncated from the head with an ellipsis so the filename always remains readable.
- **Size** — formatted via `formatSize` (`B` / `KB` / `MB`) from the `fileMetaByPath` cache.
- **Lines** — formatted with thousands separators from the same cache.
- **File reloaded N min ago** — relative time since the last successful `read_text_file` for this path.
- **Comments reloaded N min ago** — relative time since the last successful `get_file_comments`.

Critically, the status bar does NOT call `useFileContent` — that hook is the **sole issuer** of `read_text_file` IPC. The cached `{ sizeBytes, lineCount }` values arrive via `setFileMeta` which `useFileContent` calls on success (see the structured-IPC chokepoint note in [`docs/architecture.md`](../architecture.md) §IPC chokepoints, rule 19 in [`docs/performance.md`](../performance.md)).

A single `setInterval(60_000ms)` rerenders the relative-time labels every minute. The interval is registered in an effect keyed on `activeTabPath` and cleared on unmount or tab switch — there is at most one timer active per window. All four data sources (`fileMetaByPath`, `lastFileReloadedAt`, `lastCommentsReloadedAt`, `activeTabPath`) are read with **fine-grained scalar selectors** so an unrelated path's update does not re-render the status bar.

```mermaid
flowchart LR
    Hook["useFileContent (sole<br/>read_text_file caller)"] -- "setFileMeta(path, size, lines)" --> Store[("Zustand store<br/>fileMetaByPath")]
    Hook -- "setLastFileReloadedAt" --> Store
    VM["use-comments"] -- "setLastCommentsReloadedAt" --> Store
    Store -- "scalar selectors" --> SB["StatusBar<br/>(no IPC of its own)"]
```

## Key source

- **Top toolbar:** `src/App.tsx` (`.toolbar` block) · `src/styles/app.css` (`.toolbar*` rules)
- **Tab bar:** `src/components/TabBar/TabBar.tsx` · `src/styles/tab-bar.css` (`.tab-bar-wrapper` flex-shrink:1, min-width:0)
- **Viewer toolbar (sticky):** `src/components/viewers/ViewerToolbar.tsx` · `src/styles/viewer-toolbar.css` (`position: sticky; top: 0; z-index: 2`) · slot-prop composition (rule `patterns-children-over-render-props` in [`docs/best-practices-common/react/composition-patterns.md`](../best-practices-common/react/composition-patterns.md))
- **Status bar:** `src/components/StatusBar/StatusBar.tsx` · `src/styles/status-bar.css`
- **Store fields:** `src/store/tabs.ts` — `fileMetaByPath`, `lastFileReloadedAt`, `lastCommentsReloadedAt`, `activeTabPath` (all session-only, never persisted — rule 15 in [`docs/architecture.md`](../architecture.md))
- **Hook contract:** `src/hooks/useFileContent.ts` (calls `setFileMeta` on success); `src/lib/vm/use-comments.ts` (calls `setLastCommentsReloadedAt`)

## Multi-window behavior

The toolbar, viewer toolbar, and status bar are mounted **per window**. Each window owns its own native menu (built via `WebviewWindowBuilder::menu(...)` at construction time, never `app.set_menu()`), its own tab strip, and its own status-bar timer; menu events fire only against the window that originated them.

Per-window state (tabs, active file, folder-tree expansion, pane sizes) is isolated per window — it never leaks across windows. Cross-window synchronized state (theme, author name, recent items, reading width, update channel) is declared in the exported `CROSS_WINDOW_SYNCED_KEYS` constant in `src/store/index.ts` and propagated via `useCrossWindowPrefsSync` so a theme toggle in one window updates every other window.

For the canonical rule set governing per-window menus, window-scoped events, registry lifecycle, state isolation, label conventions, and the cross-window allowlist, see [`docs/best-practices-common/tauri/v2-patterns.md`](../best-practices-common/tauri/v2-patterns.md) — the `multiwin-*` rules.

## Related rules

- IPC chokepoint + structured returns — rules 1-3 in [`docs/architecture.md`](../architecture.md).
- Persist allowlist (status-bar caches are session-only) — rule 15 in [`docs/architecture.md`](../architecture.md).
- One IPC round-trip per user action — rule 2 in [`docs/performance.md`](../performance.md).
- Status-bar 60-second tick + scalar selectors — rule 20 in [`docs/performance.md`](../performance.md), rule 19 in [`docs/architecture.md`](../architecture.md).
- Native menu events forwarded as Tauri events — rule 24 in [`docs/architecture.md`](../architecture.md).
- File-size budgets for the chrome files — rule 23 in [`docs/architecture.md`](../architecture.md).
- Multi-window menu/event/state contracts — `multiwin-*` rules in [`docs/best-practices-common/tauri/v2-patterns.md`](../best-practices-common/tauri/v2-patterns.md).
- ViewerToolbar slot composition over prop-bag growth — `architecture-avoid-boolean-props` + `patterns-children-over-render-props` in [`docs/best-practices-common/react/composition-patterns.md`](../best-practices-common/react/composition-patterns.md).
