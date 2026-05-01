# Viewer Consistency

Canonical reference for the capability tiers that every viewer must follow. Ensures a predictable, professional user experience regardless of file type. Cross-referenced from [`viewer.md`](viewer.md) and [`comments.md`](comments.md).

## Governing principle

> **Every file the user opens gets a consistent baseline experience. Capabilities scale by content type, never by accident.**

A user who opens a `.csv`, a `.png`, and a `.md` should never wonder "why can't I leave a comment on this one?" or "where did the Reveal button go?" Differences in capability are intentional and follow the tier system below — not ad-hoc omissions.

Feature docs must reflect shipped code, not aspirations — see meta-principle 5 in [`docs/principles.md`](../principles.md).

## Capability tiers

Every viewer falls into exactly one tier. The tier determines its **minimum** capability set — a viewer may exceed its tier but must never fall below it.

### Tier 1 — Full-commenting viewers

**Viewers:** MarkdownViewer (visual mode), SourceView

Full inline commenting at line and selection granularity. These are the primary review surfaces.

| Capability | Required |
|---|---|
| File-level comment (toolbar button) | ✅ |
| Line-level comment (gutter click) | ✅ |
| Text selection comment (selection toolbar) | ✅ |
| Scroll-to-line from CommentsPanel | ✅ |
| Comment badges in gutter | ✅ |
| Find / search (Ctrl+F) | ✅ |
| ViewerToolbar | ✅ |
| FileActionsBar (reveal in folder) | ✅ |
| Zoom (useZoom + ZoomControl) | ✅ |
| Keyed on `path` for clean remount | ✅ |

### Tier 2 — Visual viewers with source toggle

**Viewers:** JsonTreeView, CsvTableView, HtmlPreviewView, MermaidView, KqlPlanView

These render structured content in a non-line-based visual form. In visual mode, only file-level commenting is available. The user can switch to source view (via the Source/Visual toggle) for full Tier-1 commenting through SourceView.

| Capability | Visual mode | Source mode |
|---|---|---|
| File-level comment (toolbar button) | ✅ | ✅ |
| Line-level comment | ❌ | ✅ (via SourceView) |
| Text selection comment | ❌ | ✅ (via SourceView) |
| Source/Visual toggle | ✅ | ✅ |
| ViewerToolbar | ✅ | ✅ |
| FileActionsBar | ✅ | ✅ |
| Zoom (useZoom + ZoomControl) | ✅ | ✅ |
| Keyed on `path` | ✅ | ✅ |

**Future structured anchors.** The Rust backend supports typed anchor variants for structured content (`CsvCell`, `JsonPath`, `ImageRect`, `HtmlRange`, `HtmlElement`, `WordRange`). Frontend entry points to create these anchors are not yet wired up. When they are, each structured viewer gains content-native commenting (e.g. click a CSV cell, click a JSON node) in visual mode — but the universal baseline above still applies.

### Tier 3 — Media viewers

**Viewers:** ImageViewer

These render non-text content that cannot be meaningfully commented at line granularity. Only file-level commenting is available — there is no source toggle.

| Capability | Required |
|---|---|
| File-level comment (toolbar button) | ✅ |
| ViewerToolbar | ✅ |
| FileActionsBar (reveal in folder) | ✅ |
| Zoom (useZoom + ZoomControl) | ✅ where applicable (image) |
| Keyed on `path` for clean remount | ✅ |

### Tier 4 — Placeholder viewers

**Viewers:** BinaryPlaceholder, TooLargePlaceholder

The file cannot be rendered as content. The viewer shows metadata (name, size, MIME, mtime) and offers actions (reveal in folder, copy path, hex view).

| Capability | Required |
|---|---|
| File-level comment (toolbar button) | ✅ |
| ViewerToolbar | ✅ |
| FileActionsBar (reveal in folder) | ✅ |
| Filename, byte size, last-modified time | ✅ |
| Keyed on `path` for clean remount | ✅ |

### Tier 5 — Degraded / special-case viewers

**Viewers:** DeletedFileViewer, error state

These are not normal viewing scenarios. Capabilities are intentionally reduced but must still meet a minimum bar.

| Viewer | Comment capability | Other |
|---|---|---|
| DeletedFileViewer | Read-only: displays existing comment count, directs user to CommentsPanel | ViewerToolbar with "Comment on file" (sidecar still exists) and actionable "Show comments" button |
| Error state (non-ghost) | **File-level comment required** — user should be able to note "this file is broken" | ViewerToolbar with "Comment on file" and FileActionsBar |

## Universal requirements

These apply to **every** viewer in every tier, no exceptions:

1. **ViewerToolbar on every viewer.** Every viewer mounts a `ViewerToolbar`. It is the single, consistent surface for viewer-level actions. Some props may be hidden (e.g. source/visual toggle on media viewers), but the toolbar itself is always present.

2. **"Comment on file" entry point.** Every ViewerToolbar passes `onCommentOnFile` so the user can leave a file-level comment from any file type — text, binary, media, too-large, error, or deleted.

3. **All viewer actions surface through the toolbar.** File-type-specific features (hex view toggle for binary, export PNG/SVG for Mermaid, fit/original-size for images) are exposed as toolbar controls — not as standalone buttons in the viewer body. This keeps all actions discoverable in one consistent location. The viewer body renders content only; the toolbar renders controls.

4. **FileActionsBar in the toolbar trailing slot.** The "Reveal in folder" action appears via `<FileActionsBar>` in the `ViewerToolbar` `trailing` prop. It must not be duplicated in the viewer body.

5. **`key={path}` on the viewer root.** Path changes force unmount → remount. This prevents stale state (old error messages, old media playback, old hex bytes) from leaking across tab switches.

6. **File meta propagation.** When `useFileContent` resolves (or falls back to `statFile`), the result is written to the Zustand `fileMetaByPath` cache via `setFileMeta` so StatusBar and other observers don't issue redundant IPC.

7. **Consistent zoom.** Viewers that support zoom use the shared `useZoom(filetypeKey)` hook and `ZoomControl` component. Custom zoom state (e.g. a local `scale` variable with custom buttons) is not permitted — it breaks keyboard shortcuts (Ctrl+=/−/0), persistence, and the per-filetype zoom store. Viewers where zoom is not meaningful may omit `ZoomControl` from the toolbar — document the reason in this file.

## Checklist for adding a new viewer

When a new file type or viewer is added:

- [ ] Assign it to a tier and document the assignment in this file
- [ ] Verify it meets every capability row for its tier
- [ ] Mount a `ViewerToolbar` (universal requirement 1)
- [ ] Wire `onCommentOnFile` through the toolbar (universal requirement 2)
- [ ] Surface all viewer actions through the toolbar, not the body (universal requirement 3)
- [ ] Add `FileActionsBar` in the toolbar `trailing` slot (universal requirement 4)
- [ ] Use `useZoom` if the viewer supports scaling (universal requirement 7)
- [ ] Key the component on `path` (universal requirement 5)
- [ ] Update [`viewer.md`](viewer.md) with routing and description
- [ ] Add a Vitest smoke test and a browser e2e test (rule 7 in [`docs/test-strategy.md`](../test-strategy.md))

## Known gaps (current violations)

No known gaps — all viewers comply with the universal requirements as of the toolbar consolidation in PR #246.
