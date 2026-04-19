# Enhanced File Viewer & Review System

**Date:** 2026-04-19
**Status:** Approved

## Problem Statement

mDown reView currently only provides rich viewing for `.md`/`.mdx` files (rendered markdown with block-level review comments). All other text files get a basic syntax-highlighted source view with no comment support, and binary files (including images) are rejected entirely.

Users who receive batches of AI-generated files need to review not just markdown but also code, configuration, data files, and diagrams — with commenting and visualization support appropriate to each file type.

## Goals

1. Enable review comments on **all text files** — line-level for source views, block-level for visual views.
2. Provide **syntax highlighting** for all commonly used text and code files (already partially done; extend to KQL).
3. **Auto-format and visualize** structured files: JSON (tree explorer), CSV/TSV (sortable table), HTML (sandboxed preview), Mermaid (rendered diagram), KQL (formatted query + operator plan).
4. Provide a **Source | Visual toggle** for files that support visualization.
5. Support **image viewing** (browser-native formats) with comments disabled.
6. Add **KQL (Kusto Query Language)** syntax highlighting and visualization.

## Non-Goals

- Editing file content (app remains a viewer/reviewer).
- File type OS associations beyond `.md`/`.mdx`.
- Chart/graph rendering for CSV data.
- Running KQL queries against a Kusto engine.
- Rendering HTML with active scripts/navigation in default mode.

---

## Architecture

### Component Tree

```
ViewerRouter
├─ EnhancedViewer                (unified wrapper for all text files)
│   ├─ ViewerToolbar             (Source | Visual toggle, shared)
│   ├─ SourceView                (syntax-highlighted source + line comments)
│   ├─ MarkdownRenderedView      (refactored from current MarkdownViewer)
│   ├─ JsonTreeView              (collapsible tree explorer)
│   ├─ CsvTableView              (sortable table)
│   ├─ HtmlPreviewView           (sandboxed iframe preview)
│   ├─ MermaidView               (rendered diagram + pan/zoom/export)
│   └─ KqlPlanView               (formatted query + operator plan table)
├─ ImageViewer                   (new — display only, no comments)
└─ BinaryPlaceholder             (existing, for non-image binaries)
```

### File Type Classification

A new `src/lib/file-types.ts` module provides centralized file type detection:

```typescript
type FileCategory = "markdown" | "json" | "csv" | "html" | "mermaid" | "kql" | "image" | "text";

function getFileCategory(path: string): FileCategory;
function hasVisualization(category: FileCategory): boolean;
function getDefaultView(category: FileCategory): "source" | "visual";
```

### File Type Routing Table

| Category | Extensions | Source View | Visual View | Default | Comments |
|---|---|---|---|---|---|
| Markdown | `.md`, `.mdx` | Syntax-highlighted | Rendered markdown | **Visual** | Block (visual), Line (source) |
| JSON | `.json`, `.jsonc` | Syntax-highlighted | Tree explorer (collapsible) | **Visual** | Line (source) |
| CSV/TSV | `.csv`, `.tsv` | Raw text | Sortable table | **Visual** | Line (source) |
| HTML | `.html`, `.htm` | Syntax-highlighted | Sandboxed iframe preview | **Source** | Line (source) |
| Mermaid | `.mermaid`, `.mmd` | Source text | Rendered diagram + pan/zoom | **Visual** | Line (source) |
| KQL | `.kql`, `.csl` | Syntax-highlighted | Formatted query + operator plan | **Visual** | Line (source) |
| Image | `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.bmp`, `.ico` | — | Image display | **Visual** | **Disabled** |
| Other text | All other text files | Syntax-highlighted | — (no toggle) | **Source** | Line |

---

## EnhancedViewer

The unified wrapper component that replaces direct `MarkdownViewer` / `SourceViewer` usage for text files.

### Responsibilities

- Determines file category via `getFileCategory(path)`.
- Renders `ViewerToolbar` with Source | Visual toggle for files that `hasVisualization()`.
- Manages view mode state (source vs visual), defaulting per `getDefaultView()`.
- Renders the appropriate sub-view based on file category and current mode.
- Passes comment infrastructure to the active sub-view.

### ViewerToolbar

A shared component rendered above the file content:

- **Source** / **Visual** segmented toggle button — only shown when `hasVisualization()` returns true.
- Toggle state is per-tab (switching tabs remembers each tab's view mode).
- For files without visualization (plain text, most code files), toolbar is hidden and source view is the only option.

---

## Visualization Sub-Views

### MarkdownRenderedView

Refactored from the existing `MarkdownViewer`. Contains all current markdown rendering logic (react-markdown + remark-gfm + @shikijs/rehype + rehype-slug) and block-level comment integration.

No functional changes — this is a reorganization to fit into the `EnhancedViewer` wrapper.

### JsonTreeView

Interactive tree explorer for JSON and JSONC files.

**Features:**
- Collapsible/expandable nodes (▼/► toggle).
- Key counts shown for objects and arrays (e.g., `{} root (3 keys)`).
- Color-coded value types: strings, numbers, booleans, null.
- Root node expanded by default; nested nodes collapsed past depth 2.
- Block-level comments can attach to top-level keys.

**Implementation:** Custom recursive React component — no external dependency needed.

### CsvTableView

Sortable table rendering for CSV and TSV files.

**Features:**
- First row treated as column headers.
- Click column header to sort (ascending/descending/unsorted cycle).
- Sort indicator arrows on active column.
- Alternating row backgrounds for readability.
- Footer showing row × column count.
- Handles quoted fields, escaped commas, multiline values.

**Implementation:** Uses `papaparse` for parsing (lazy-loaded on first CSV/TSV open). Table rendering and sorting are custom.

### HtmlPreviewView

Sandboxed HTML rendering.

**Features:**
- Default mode: `<iframe srcdoc sandbox="allow-same-origin">` — scripts, forms, and navigation disabled.
- Warning banner: "⚠ Sandboxed preview — scripts and external resources disabled."
- Unsafe mode toggle: removes sandbox restrictions except navigation. Separate toggle in toolbar area (not the Source/Visual toggle).
- Iframe resizes to content height (no inner scrollbar when possible).

**Implementation:** Native `<iframe>` with `srcdoc` attribute — no dependency needed. External resources (images, CSS, fonts referenced via URLs) will not load in sandbox mode since the app is fully offline.

### MermaidView

Rendered Mermaid diagrams with interactivity.

**Features:**
- Renders `.mermaid` / `.mmd` files using `mermaid.js`.
- Pan and zoom controls (zoom +/−, fit-to-view, drag to pan).
- Export buttons: PNG and SVG download.
- Respects app theme (light/dark) for diagram rendering.
- Error display if Mermaid syntax is invalid.

**Implementation:** `mermaid` package, lazy-loaded via dynamic `import()` on first `.mermaid`/`.mmd` open. Pan/zoom via CSS transforms + pointer events.

### KqlPlanView

Formatted KQL query display with operator breakdown.

**Features:**
- **Formatted Query Section:** Auto-breaks at each `|` pipe operator, proper indentation, syntax-colored keywords (`where`, `summarize`, `project`, `extend`, `join`, `union`, `top`, `sort`, `render`, `let`, etc.).
- **Operator Plan Table:** Step number, operator name, and details columns. Parsed from the pipe-delimited query structure.
- Operator count shown in footer.

**Implementation:** Custom KQL pipe parser — splits on `|`, identifies operator keywords, extracts arguments. No external dependency. The parser is purely cosmetic (formatting + plan extraction), not a full KQL language parser.

**Supported KQL operators for plan extraction:**
`where`, `summarize`, `project`, `project-away`, `extend`, `join`, `union`, `top`, `sort`, `order`, `take`, `limit`, `count`, `distinct`, `render`, `let`, `mv-expand`, `parse`, `evaluate`, `invoke`, `search`, `find`, `print`, `range`, `datatable`, `externaldata`, `materialize`, `as`, `consume`, `fork`, `facet`, `sample`, `sample-distinct`, `getschema`, `project-rename`, `project-reorder`, `serialize`, `partition`, `lookup`, `bag_unpack`, `narrow`, `pivot`.

---

## SourceView (Line-Level Comments)

Refactored from the existing `SourceViewer` with added line-level comment support.

### Comment Interaction

- Hovering over a line number gutter shows a `+` button.
- Clicking `+` opens an inline comment input below the line (similar to GitHub PR review).
- Existing comments render as inline threads below their anchored line.
- Comments attach via `lineHash` (hash of line content) and `lineNumber`.

### Line Comment Anchoring

- `lineHash`: 8-char FNV-1a hex of the trimmed line content (same algorithm as `blockHash`). If the line moves (insertion/deletion above), the comment re-anchors by matching the hash.
- `lineNumber`: Stored as fallback for display when content match fails.
- Orphaned line comments (line content changed or deleted) are flagged, same as current block comment orphan behavior.

---

## ImageViewer

New component for browser-native image formats.

### Supported Formats

All formats the browser can natively render: `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.bmp`, `.ico`.

### Features

- Displays image using `convertFileSrc()` from Tauri to get a local asset URL.
- Shows dimensions and file size in the viewer header.
- Fit-to-width by default, click to toggle original size.
- No comment affordances — no hover `+`, no comment panel, no sidecar creation.

### Rust Layer

**New Tauri command: `read_binary_file`**
- Reads file as raw bytes, returns base64-encoded string.
- Same 10 MB size limit as `read_text_file`.
- Binary detection check is skipped (we expect binary content).
- Used as fallback if `convertFileSrc()` doesn't work for a given file.

Frontend wrapper added to `tauri-commands.ts`:
```typescript
function readBinaryFile(path: string): Promise<string>; // base64
```

---

## Comment System Extensions

### Extended Data Model

```typescript
interface ReviewComment {
  id: string;                        // UUID
  anchorType: "block" | "line";      // NEW — determines anchor strategy
  blockHash?: string;                // Existing — for block-level (visual views)
  lineHash?: string;                 // NEW — hash of line content
  lineNumber?: number;               // NEW — line number for source view comments
  headingContext?: string | null;     // Existing — for block comments only
  fallbackLine?: number;             // Existing — kept for block comment display
  text: string;
  createdAt: string;                 // ISO timestamp
  resolved: boolean;
}
```

### Sidecar Format v2

```json
{
  "version": 2,
  "comments": [
    {
      "id": "...",
      "anchorType": "block",
      "blockHash": "a1b2c3d4",
      "headingContext": "introduction",
      "fallbackLine": 5,
      "text": "This paragraph needs revision",
      "createdAt": "2026-04-19T10:00:00Z",
      "resolved": false
    },
    {
      "id": "...",
      "anchorType": "line",
      "lineHash": "e5f6g7h8",
      "lineNumber": 42,
      "text": "Consider using a more descriptive variable name",
      "createdAt": "2026-04-19T10:05:00Z",
      "resolved": false
    }
  ]
}
```

### Migration

- **v1 → v2**: All existing comments get `anchorType: "block"`. Existing fields preserved. Migration happens on next save (same as current legacy migration pattern).
- **Forward compatibility**: v2 reader ignores unknown fields. v1 reader (older app version) ignores unknown fields too since it only looks for `comments[]` array members it understands.

### View Mode Behavior

- **Visual view** shows block-level comments (attached to rendered elements).
- **Source view** shows line-level comments (attached to source lines).
- **CommentsPanel** shows all comments for the file, grouped: "Visual Comments" and "Source Comments" sections.
- **Tab badge** counts all unresolved comments (both types combined).

---

## KQL Syntax Highlighting

Shiki does not include a built-in KQL/Kusto grammar. A custom TextMate grammar will be created.

### Grammar File

`src/lib/kql.tmLanguage.json` — registered with Shiki at highlighter creation time.

### Scope Coverage

- **Keywords:** `let`, `where`, `summarize`, `project`, `extend`, `join`, `union`, `top`, `sort`, `order`, `take`, `limit`, `count`, `distinct`, `render`, `mv-expand`, `parse`, `evaluate`, `invoke`, `search`, `find`, `print`, `range`, `datatable`, `externaldata`.
- **Operators:** `==`, `!=`, `=~`, `!~`, `has`, `!has`, `has_cs`, `contains`, `!contains`, `startswith`, `endswith`, `matches regex`, `in`, `!in`, `between`, `and`, `or`, `not`.
- **Built-in functions:** `count()`, `sum()`, `avg()`, `min()`, `max()`, `dcount()`, `percentile()`, `arg_max()`, `arg_min()`, `make_list()`, `make_set()`, `strcat()`, `tostring()`, `toint()`, `todatetime()`, `ago()`, `now()`, `bin()`, `format_datetime()`, etc.
- **Types:** `string`, `int`, `long`, `real`, `decimal`, `bool`, `datetime`, `timespan`, `dynamic`, `guid`.
- **Comments:** `//` line comments, `/* */` block comments.
- **Strings:** Double-quoted, single-quoted, `h""` (hash strings), `@""` (verbatim strings).
- **Pipe operator:** `|` highlighted as delimiter.
- **Numeric literals:** integers, reals, timespan literals (`1d`, `2h`, `30m`).

---

## Dependencies & Bundle Size

### New Dependencies

| Package | Purpose | Size | Loading |
|---|---|---|---|
| `mermaid` | Diagram rendering | ~1.5 MB | **Lazy** — dynamic import on first `.mermaid`/`.mmd` open |
| `papaparse` | CSV/TSV parsing | ~20 KB | **Lazy** — dynamic import on first CSV/TSV open |

### No External Dependencies Needed For

- **JSON tree view** — custom recursive React component.
- **KQL parser/formatter** — custom pipe-split parser.
- **HTML preview** — native `<iframe srcdoc sandbox>`.
- **Image viewing** — native `<img>` with Tauri `convertFileSrc()`.
- **CSV table sorting** — JS `Array.sort()`.
- **KQL TextMate grammar** — JSON file registered with Shiki.

### Shiki Already Handles

Syntax highlighting for: TypeScript, JavaScript, Python, Rust, Go, Java, C, C++, CSS, HTML, JSON, YAML, TOML, Shell, SQL, Ruby, PHP, Swift, Kotlin, C#, and more. KQL grammar is the only addition.

---

## Folder Tree

No structural changes needed. Image files already appear in the tree (the tree shows all files from `read_dir`). The only change is that clicking an image file now opens `ImageViewer` instead of `BinaryPlaceholder`.

---

## Testing Plan

### Unit Tests

- `file-types.ts`: Classification for all extensions, edge cases (no extension, unknown extension, case insensitivity).
- `JsonTreeView`: Rendering, expand/collapse, nested structures, edge cases (empty object, large arrays).
- `CsvTableView`: Parsing, sorting, header detection, quoted fields, TSV delimiter.
- `KqlPlanView`: Pipe parsing, operator extraction, formatting, edge cases (nested pipes in strings, comments).
- `KqlFormatter`: Line breaking, indentation, keyword colorization.
- `HtmlPreviewView`: Sandbox attribute presence, unsafe mode toggle, content injection.
- `MermaidView`: Rendering callback, error handling for invalid syntax, export functions.
- `ImageViewer`: Correct image URL generation, dimensions display, comment UI absence.
- `SourceView` (line comments): Line hash computation, comment placement, orphan detection.
- `ViewerToolbar`: Toggle state, visibility based on file category.
- `EnhancedViewer`: Correct sub-view selection per file type, view mode persistence per tab.
- Comment model v2: Migration from v1, serialization, both anchor types coexisting.

### E2E Tests

- Open a `.json` file → visual mode shows tree, toggle to source shows highlighted JSON.
- Open a `.csv` file → visual mode shows sortable table.
- Open a `.html` file → source by default, toggle to visual shows sandboxed preview.
- Open a `.mermaid` file → visual mode renders diagram.
- Open a `.kql` file → visual mode shows formatted query + plan.
- Open an image file → displays image, no comment UI visible.
- Add a line comment on source view → persists in sidecar, visible on reopen.
- Add a block comment on visual view → coexists with line comments in same sidecar.
- Source/Visual toggle state persists per tab when switching between tabs.

### Rust Tests

- `read_binary_file`: Reads image files, respects 10 MB limit, returns valid base64.
