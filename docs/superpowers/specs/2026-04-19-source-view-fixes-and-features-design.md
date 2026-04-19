# Source View Fixes and Features — Design Spec

**Date:** 2026-04-19
**Branch:** `feature/enhanced-file-viewer`

## Problem

Six issues identified after the initial enhanced file viewer implementation:

1. Comment + button in source view is hard to find and overlaps content
2. Need more fixture files for testing (mermaid, images, code files)
3. No collapse/expand support in source view
4. No in-file search capability
5. PNG images don't load (asset protocol not configured)
6. Images inside HTML preview don't load (iframe can't access local paths)

## Fixes

### Fix 1: Comment + Button Repositioning

**Current:** The + button uses `position: absolute; left: 4px` inside the gutter, only appears on hover, and sometimes overlaps line numbers.

**New layout:** Restructure `.source-line-gutter` from a single flex container into a 2-zone layout:
- **Comment zone (20px):** Fixed-width area at the far left edge. The + button renders here, visible on line hover. No absolute positioning — it flows naturally.
- **Line number zone (40px):** Right-aligned line number, as before.

Total gutter width stays at 60px. The + button is always at the left edge, never overlaps content.

CSS changes:
```
.source-line-gutter {
  display: flex;
  width: 60px;
  min-width: 60px;
}
.source-line-comment-zone {
  width: 20px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
}
.source-line-number-zone {
  flex: 1;
  text-align: right;
  padding-right: 8px;
}
```

### Fix 2: PNG Image Loading

**Root cause:** `convertFileSrc()` returns `https://asset.localhost/...` URLs which require Tauri's asset protocol scope. Not configured, and doesn't work in dev mode.

**Fix:** Replace `convertFileSrc` in `ImageViewer` with `readBinaryFile` (already exists, returns base64). Construct a data URL: `data:image/<ext>;base64,<data>`. Detect MIME type from file extension.

```typescript
const mimeMap: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", svg: "image/svg+xml", webp: "image/webp",
  bmp: "image/bmp", ico: "image/x-icon",
};
```

Show a loading state while the binary is being fetched. Handle errors (file too large, missing).

### Fix 3: HTML Preview Image Loading

**Root cause:** `srcDoc` iframes can't resolve local file paths. `<img src="./photo.png">` has no base URL to resolve against.

**Fix:** Before injecting HTML into the iframe:
1. Parse the HTML string for `<img src="...">` and `<link href="...">` with local paths (not http/https/data)
2. Resolve relative paths against the HTML file's directory
3. Load each via `readBinaryFile`
4. Replace the src/href with base64 data URLs
5. Show a loading indicator while resolving

Implementation: async `resolveLocalAssets(html: string, filePath: string)` utility function. Called in a `useEffect` when content or filePath changes.

## Features

### Feature 1: Collapse/Expand (Code Folding)

**Scope:** Source view only. Transient state (not persisted).

**Region detection strategies:**

1. **Brace matching** — `{` → `}`, `[` → `]`, `(` → `)`. Must respect:
   - String literals (single/double/backtick quoted)
   - Comments (// line, /* block */)
   - Only fold when opener and closer are on different lines
   - Minimum 2 lines to create a foldable region

2. **Indentation-based** — For languages without braces (Python, YAML, plain text):
   - A line that is followed by lines with greater indentation starts a foldable block
   - The block ends when indentation returns to the original level or less
   - Only triggered when no brace-based regions are detected (heuristic: if file has <5 brace regions, use indentation)

**UI:**
- Fold chevron in the comment zone (left of line number): `▾` for expanded, `▸` for collapsed
- Only shown on lines that start a foldable region
- When collapsed: the opener line shows, followed by a `⋯ N lines hidden` placeholder (styled as a muted row)
- Click chevron to toggle
- Keyboard: none initially (click only)

**State:** `Map<number, boolean>` in component state (line number → collapsed). Reset on file change.

**Data model:**
```typescript
interface FoldRegion {
  startLine: number;  // 1-based
  endLine: number;    // 1-based, inclusive
}
```

`computeFoldRegions(lines: string[]): FoldRegion[]` — pure function, memoized on content.

### Feature 2: In-File Search (Ctrl+F)

**Scope:** Source view only. Visual views use browser-native Ctrl+F.

**UI:** Floating search bar at top-right of the source view container:
- Input field with placeholder "Find..."
- Match count: "3 of 17"
- Prev/Next buttons (▲/▼)
- Close button (×)
- Keyboard: Ctrl+F opens and focuses, Escape closes, Enter → next, Shift+Enter → prev

**Highlighting:**
- All matches highlighted with `background: var(--color-search-match, #fff59d)` (yellow)
- Current match highlighted with `background: var(--color-search-current, #ffb74d)` (orange)
- Current match is scrolled into view

**Implementation:**
- `useSearch(content: string)` hook returning `{ query, setQuery, matches, currentIndex, next, prev }`
- Matches computed by scanning content line-by-line for the query string (case-insensitive)
- Each match: `{ lineIndex: number, startCol: number, endCol: number }`
- SourceView wraps match ranges in `<mark>` elements when rendering highlighted lines
- Search bar rendered as an overlay inside `.source-view`

**Edge cases:**
- Empty query: no highlights, count hidden
- No matches: show "No results" in red
- Regex: not supported initially (plain text search only)

### Feature 3: Test Fixture Files

Add to `e2e/fixtures/`:
- `sample.mermaid` — simple flowchart (`graph TD; A-->B; B-->C;`)
- `sample.png` — minimal 1×1 red pixel PNG (base64-encoded, written as binary)
- `sample-with-images.html` — HTML file referencing `sample.png` with a relative path
- `sample.py` — short Python snippet (for indentation folding testing)
- `sample.yaml` — short YAML config

## Non-Goals

- Search across tabs or folder tree
- Persisted fold state
- Regex search
- Code folding in visual/rendered views
- Configuring Tauri asset protocol (using readBinaryFile instead)

## Testing

- **Comment button:** Update SourceView tests to verify button is in `.source-line-comment-zone`
- **Image loading:** Update ImageViewer tests to mock `readBinaryFile` instead of `convertFileSrc`
- **HTML images:** Test `resolveLocalAssets` utility with mocked `readBinaryFile`
- **Fold regions:** Unit test `computeFoldRegions` with brace and indentation samples
- **Search:** Unit test `useSearch` hook, test highlight rendering
- **E2E:** Verify fold chevrons appear, search bar opens with Ctrl+F
