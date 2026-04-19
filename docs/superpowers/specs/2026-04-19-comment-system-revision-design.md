# Comment System Revision — Design Spec

## Problem Statement

The current comment system has two anchor types (block and line) with inconsistent UX across source and visual views. Block-based comments in the markdown visual view use content hashing which is fragile and doesn't map to source lines. Line-based comments in the source view match by `lineHash` alone, causing duplicates when identical lines exist. There is no support for selection-based comments. The comment button visibility is inconsistent between views.

This revision unifies the comment system around line-based and selection-based anchoring, ensures consistent UX in both source and visual views, fixes the duplicate comment bug, and adds shell scripts for batch comment operations.

## Scope

**In scope:**
- Remove block-based comment anchoring
- Keep and fix line-based comments (compound anchor: lineNumber + lineHash)
- Add selection-based comments with text highlight
- Consistent comment UX across source view and visual view
- Floating toolbar + right-click context menu for selection comments
- Gutter `+` button for line comments in both views
- CommentsPanel (right sidebar) kept as optional/collapsible
- Selection comment visualization: gutter marker + inline text highlight
- Sidecar format v3 with migration from v2
- Shell scripts (bash + PowerShell) for scanning and cleaning comments
- Improved test coverage for comment features
- Fix all known comment bugs

**Out of scope:**
- Editing file content
- Block-based comments (being removed)
- Cloud sync or collaboration
- Comment threading (reply to comment)

## Data Model

### ReviewComment (v3)

```typescript
interface ReviewComment {
  id: string;
  anchorType: "line" | "selection";

  // Line anchor (always present — primary key for positioning)
  lineNumber: number;
  lineHash: string;           // 8-char FNV-1a hex of normalized line text

  // Context for robust re-anchoring after file modifications
  contextBefore?: string;     // normalized text of 2 lines before (joined with \n)
  contextAfter?: string;      // normalized text of 2 lines after (joined with \n)

  // Selection anchor (only when anchorType === "selection")
  selectedText?: string;      // exact selected text for re-anchoring
  selectionStartOffset?: number;  // char offset within lineNumber
  selectionEndLine?: number;      // end line number (may equal lineNumber)
  selectionEndOffset?: number;    // char offset within end line

  // Comment content
  text: string;
  createdAt: string;
  resolved: boolean;

  // Response tracking (for AI agent workflow)
  responses?: CommentResponse[];
}

interface CommentResponse {
  author: string;             // agent name or user identifier
  text: string;
  createdAt: string;
}
```

### Sidecar Format

```json
{
  "version": 3,
  "comments": [...]
}
```

### Migration

- **v2 line comments** → preserved as-is (already have `lineNumber` + `lineHash`)
- **v2 block comments** → preserved in sidecar as-is with `anchorType: "block"`. Displayed at `fallbackLine` (if present) or line 1 with an orphan warning. The UI does not allow creating new block comments, but existing ones are kept until the user explicitly deletes them or runs the cleanup script.
- **v1 (legacy)** → same treatment as v2 block comments
- Sidecar version bumps to 3 on next save. All existing comments (including legacy block comments) are preserved in the saved file.

## Comment Matching Algorithm

Comments are matched to document content using a **multi-strategy cascade** designed to survive significant file modifications (e.g., AI agents rewriting code around comments). The algorithm runs on file load and produces a `matchedLineNumber` for display.

### Strategy Cascade (in order, stop at first match)

1. **Exact match**: `lineHash` matches at `lineNumber` → anchored. Confidence: high.
2. **Nearby hash match**: `lineHash` found within ±30 lines of `lineNumber` → re-anchor. Confidence: high.
3. **Context match**: `contextBefore` or `contextAfter` found near `lineNumber` (±30 lines) → anchor to the line adjacent to the matching context. Confidence: medium.
4. **Global hash search**: `lineHash` found anywhere in the file → re-anchor to closest match. Confidence: medium-low.
5. **Selected text search** (selection comments only): `selectedText` found as substring anywhere in file → re-anchor to the line containing it. Confidence: medium-low.
6. **Orphaned**: no match found. Display at original `lineNumber` (clamped to file length) with orphan warning. Confidence: none.

### Design for AI Agent Workflow

The primary use case is: user adds comments → AI agent reads comments via scripts → AI modifies the file → user reopens the file and comments re-anchor.

**Key robustness features:**
- **Context lines** (`contextBefore`, `contextAfter`): 2 lines of surrounding context captured at comment creation time. Even if the commented line is completely rewritten, the context lines help locate the *neighborhood* where the comment belongs.
- **Global fallback**: if the line moved far beyond ±30 lines (e.g., AI inserted a large block above), the global hash search and selectedText search still find it.
- **Graceful degradation**: orphaned comments are displayed (not hidden) at the best-guess position. The user can see which comments lost their anchor and manually re-anchor or delete them.
- **Re-anchor on save**: when comments are auto-saved, `lineNumber` is updated to the matched position so subsequent loads start from the correct location.

### Context Capture

When creating a comment at line N:
- `contextBefore` = normalized text of lines N-2 and N-1 (joined with `\n`), or fewer if at file start
- `contextAfter` = normalized text of lines N+1 and N+2 (joined with `\n`), or fewer if at file end
- Context uses the same normalization as `lineHash` (trim, collapse whitespace)

### Selection Comment Re-anchoring

For selection comments, after finding the anchor line:
1. Check if `selectedText` exists at the expected offsets → exact selection highlight
2. Search for `selectedText` as substring within ±5 lines of anchor → adjusted highlight
3. If not found, degrade to line comment display (no highlight, show at anchor line)

### Line Hash Normalization

`lineHash` is computed by `fnv1a8()` (kept from existing code) on the line text after normalization:
- Trim leading/trailing whitespace
- Collapse internal whitespace runs to single space
- Case-sensitive (no lowercasing)

### Offset Units

All character offsets (`selectionStartOffset`, `selectionEndOffset`) use **UTF-16 code unit indices** to match JavaScript's `String.prototype.length` and DOM `Range` API behavior.

### Duplicate Hash Handling

When re-anchoring, if multiple nearby lines match the same `lineHash`:
- Prefer the line closest to the original `lineNumber`
- If equidistant, prefer the line above (lower line number)

## Architecture

### Component Structure

```
EnhancedViewer
├── SourceView (source mode)
│   ├── Line gutter with + buttons
│   ├── Inline comment threads (per-line)
│   ├── Selection highlights (overlay)
│   └── SelectionToolbar (floating, appears on text select)
├── MarkdownViewer (visual mode — markdown only)
│   ├── Block-start gutter with + buttons (mapped from DOM to source lines)
│   ├── Inline comment threads (per block-start line)
│   └── No selection comments (source view only)
├── CommentsPanel (right sidebar, optional)
│   ├── Comment list (sorted by line number)
│   ├── Filter: unresolved / all
│   └── Click-to-scroll navigation
└── Other visual views (JSON, CSV, HTML, Mermaid, KQL)
    └── Comments disabled in visualization mode (source view only)
```

### Key Design Decisions

1. **All comments anchor to source line numbers.** Even in visual (markdown) view, comments store the source file line number. The visual view maps rendered DOM elements back to source lines using `node.position.start.line` from react-markdown's AST.

2. **One comment per anchor.** A line comment and a selection comment on the same line are separate comments. Multiple selection comments on the same line are allowed if their selections don't overlap.

3. **Gutter is unified.** Both source and visual views use the same gutter component with `+` button. In visual view, the gutter maps to source lines via position data from the markdown AST.

4. **Selection toolbar appears on mouseup** after selecting text. It shows a single "💬 Comment" button. It disappears on click-away or escape. Position: floating above/below the selection end.

5. **Context menu** adds "Add Comment" option via right-click when text is selected.

6. **Comments in non-markdown visual views** (JSON formatter, CSV table, HTML preview, Mermaid diagram) are only available in source view mode. The visual rendering doesn't have line-level mapping.

## Comment UX Flow

### Adding a Line Comment

1. User hovers over a line → `+` button appears in the gutter
2. User clicks `+` → CommentInput opens inline below the line
3. User types comment text, presses Ctrl+Enter or clicks Save
4. Comment saved with `anchorType: "line"`, `lineNumber`, `lineHash`
5. Gutter shows comment indicator (blue dot or speech bubble icon)

### Adding a Selection Comment

1. User selects text in the document (either view)
2. On mouseup, a floating toolbar appears near the selection with "💬 Comment"
3. Alternatively, user right-clicks → context menu shows "Add Comment on Selection"
4. CommentInput opens inline at the selection start line
5. Comment saved with `anchorType: "selection"`, `lineNumber`, `lineHash`, `selectedText`, offsets
6. Selected text range highlighted with semi-transparent background
7. Gutter shows comment indicator at the start line

### Viewing Comments

- **Gutter indicators**: colored dot/icon for lines with comments. Blue = unresolved, green = resolved
- **Inline threads**: clicking the gutter indicator expands the comment thread below the line
- **Selection highlights**: semi-transparent yellow/orange background on the selected text range
- **CommentsPanel**: right sidebar lists all comments sorted by line number, click to navigate
- **CommentsPanel click-to-scroll**: clicking a comment in the panel scrolls the viewer to the matching line, highlights the line/selection with a brief flash animation, and expands the inline comment thread. Works in both source and visual view — in visual view, scrolls to the nearest block element with matching `data-source-line`.
- **Responses**: each comment can have responses (from AI agents or users). Responses are displayed below the comment text in the inline thread, each with author name and timestamp.

### Resolving / Deleting

- Each comment has Resolve / Delete buttons in its thread
- Resolved comments show with muted styling and strikethrough
- CommentsPanel has a toggle to show/hide resolved comments

## Visual View Line Mapping (Markdown)

The markdown visual view needs to map rendered DOM elements back to source lines for comment positioning. This is achieved via react-markdown's `node` prop which provides `position.start.line` for each AST element.

### Strategy

1. Each rendered block element (`p`, `h1`–`h6`, `li`, `pre`, `blockquote`, `table`, etc.) receives a `data-source-line` attribute from the AST node's position
2. The gutter renders `+` buttons aligned to these block elements
3. When adding a comment, the `lineNumber` is read from `data-source-line`
4. The `lineHash` is computed from the corresponding source line text

**Limitation**: In visual view, comments can only target the **start line of a block element**, not arbitrary lines within a multi-line paragraph or code fence. For finer-grained line targeting, users should switch to source view.

### Selection in Visual View

**Selection-based comments are only available in source view.** In visual (markdown) view, the rendered HTML transforms the source text (e.g., `**bold**` → `bold`, links, images, code spans). Mapping DOM selection offsets back to reliable source character offsets is not feasible without a deep source-mapping layer. Users who need selection comments should switch to source view.

In visual view, only line-level comments are supported, anchored to the block-start line as described above.

## Removed: Block-Based Comments

The following are removed:
- `anchorType: "block"` (no new block comments created; legacy ones preserved read-only)
- `blockHash` field (not used for new comments)
- `headingContext` field (not used for new comments)
- `fallbackLine` field (replaced by `lineNumber` as primary anchor)
- `CommentMargin` component (block-level gutter — replaced by unified line gutter)
- `comment-block-wrapper` CSS class and associated hover behavior
- `makeBlock()` wrapper in MarkdownViewer
- `ListItemWithComment` wrapper in MarkdownViewer
- `buildHeadingContextMap()` utility
- `extractText()` utility for block text extraction

**Kept**: `fnv1a8()` hash function — still used for `lineHash` computation on individual lines.

## Scripts

Scripts live in `scripts/` directory at the repo root. **Python** (cross-platform, has built-in `json` module) and **PowerShell** versions are provided. No external dependencies required.

### scan-comments.py / scan-comments.ps1

Scans a directory (recursively) for `.review.json` sidecar files and displays all comments in a structured format.

**Usage:**
```bash
python scripts/scan-comments.py [directory]          # defaults to current dir
./scripts/scan-comments.ps1 [-Path directory]        # defaults to current dir
```

**Output format (tab-separated for easy piping):**
```
FILE	LINE	STATUS	ANCHOR	REFERENCE	COMMENT
src/app.tsx	42	unresolved	line	<line text>	This function needs error handling
src/utils.ts	15	resolved	selection	"fetchData(url)"	Consider caching
src/old.md	1	orphaned	block	<n/a>	Legacy block comment
```

**Columns:**
- `FILE` — relative path to the reviewed file (not the sidecar)
- `LINE` — `lineNumber` (or `fallbackLine` for legacy block comments, or `1` if neither)
- `STATUS` — `unresolved` / `resolved` / `orphaned`
- `ANCHOR` — `line` / `selection` / `block` (legacy)
- `REFERENCE` — for line: first 60 chars of the source line text; for selection: the `selectedText` (truncated to 60 chars); for block: `<n/a>`
- `COMMENT` — comment text with newlines replaced by `\n` literal

**Flags:**
- `--unresolved` / `-Unresolved` — show only unresolved comments
- `--resolved` / `-Resolved` — show only resolved comments
- `--json` / `-Json` — output as JSON array (for programmatic consumption / AI agent input)

**Edge cases:**
- Malformed JSON files: print warning to stderr, skip file, continue
- Supports sidecar versions 1, 2, and 3
- Output paths are relative to the scan directory
- Exit code 0 on success (even if no comments found), 1 on fatal error

### respond-comments.py / respond-comments.ps1

Adds a response to a specific comment by ID, or to all unresolved comments in a file. Designed for AI agents to programmatically respond to review comments.

**Usage:**
```bash
# Respond to a specific comment by ID
python scripts/respond-comments.py --file src/app.tsx --id ecv4rn81 --author "copilot" --text "Fixed the error handling"

# Respond to all unresolved comments in a file (reads responses from stdin as JSON)
python scripts/respond-comments.py --file src/app.tsx --author "copilot" --from-json responses.json
```

```powershell
# Respond to a specific comment by ID
./scripts/respond-comments.ps1 -File src/app.tsx -Id ecv4rn81 -Author "copilot" -Text "Fixed the error handling"

# Respond to all unresolved comments from JSON input
./scripts/respond-comments.ps1 -File src/app.tsx -Author "copilot" -FromJson responses.json
```

**JSON input format** (for batch responses):
```json
[
  { "id": "ecv4rn81", "text": "Fixed the error handling in commit abc123" },
  { "id": "xk9f2m3a", "text": "This is intentional, see docs/design.md" }
]
```

**Behavior:**
- Appends a `CommentResponse` to the comment's `responses` array
- Creates the `responses` array if it doesn't exist
- Preserves all other comment fields unchanged
- Atomic write (temp + rename) matching the Rust sidecar save behavior
- Exit code 0 on success, 1 if comment ID not found or file error

### resolve-comments.py / resolve-comments.ps1

Resolves comments by ID, by author response, or all unresolved comments in a file/directory.

**Usage:**
```bash
# Resolve specific comments by ID
python scripts/resolve-comments.py --file src/app.tsx --id ecv4rn81 --id xk9f2m3a

# Resolve all comments that have a response from a specific agent
python scripts/resolve-comments.py [directory] --responded-by "copilot"

# Resolve all unresolved comments in a directory
python scripts/resolve-comments.py [directory] --all
```

```powershell
./scripts/resolve-comments.ps1 -File src/app.tsx -Id ecv4rn81,xk9f2m3a
./scripts/resolve-comments.ps1 [-Path directory] -RespondedBy "copilot"
./scripts/resolve-comments.ps1 [-Path directory] -All
```

**Behavior:**
- Sets `resolved: true` on matching comments
- `--responded-by` / `-RespondedBy`: resolves comments where `responses` array contains at least one response from the named author
- Reports count of comments resolved per file
- `--dry-run` / `-DryRun` shows what would be changed

### clean-comments.py / clean-comments.ps1

Deletes resolved comments or all comments from sidecar files.

**Usage:**
```bash
python scripts/clean-comments.py [directory] [--all] [--dry-run]
./scripts/clean-comments.ps1 [-Path directory] [-All] [-DryRun]
```

**Behavior:**
- Default: removes only resolved comments from each sidecar file. If all comments were resolved, deletes the sidecar file entirely.
- `--all` / `-All`: deletes entire `.review.json` sidecar files
- `--dry-run` / `-DryRun`: shows what would be changed without modifying files
- Reports count of files modified / deleted to stdout
- Empty sidecar files (no comments remaining) are deleted rather than left as `{"version":3,"comments":[]}`

**Edge cases (all scripts):**
- Malformed JSON files: print warning to stderr, skip file, continue
- Supports sidecar versions 1, 2, and 3 (preserves version on rewrite)
- Python scripts use only stdlib (`json`, `os`, `sys`, `argparse`) — no pip dependencies
- PowerShell scripts use `ConvertFrom-Json` / `ConvertTo-Json` (built-in)
- Atomic writes: write to temp file, then rename (matches Rust behavior)
- Exit code 0 on success, 1 on fatal error

## CSS Design

### Comment Gutter (Both Views)

```
┌──────────────────────────────────────────┐
│ [+] │ 1 │ import React from 'react';     │  ← source view
│     │ 2 │ import { useState } from ...   │
│ [💬]│ 3 │ function App() {               │  ← has comment
│     │ 4 │   const [x, setX] = ...        │
│ [+] │ 5 │   return <div>hello</div>;     │  ← hover shows +
└──────────────────────────────────────────┘
```

- `+` button: appears on hover, always at left edge (no indentation)
- Comment indicator: small icon, always visible for lines with comments
- Both views use the same `.comment-gutter` component

### Selection Highlight

```css
.comment-selection-highlight {
  background: rgba(255, 186, 0, 0.2);  /* semi-transparent yellow */
  border-bottom: 2px solid rgba(255, 186, 0, 0.6);
  border-radius: 2px;
}

.comment-selection-highlight.resolved {
  background: rgba(0, 180, 0, 0.1);
  border-bottom-color: rgba(0, 180, 0, 0.3);
}
```

### Floating Selection Toolbar

```css
.selection-toolbar {
  position: fixed;
  z-index: 100;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  padding: 4px 8px;
}
```

Positioned dynamically above or below the selection using `window.getSelection().getRangeAt(0).getBoundingClientRect()`.

## Testing Strategy

### Unit Tests (Vitest) — Comment Matching Algorithm

These tests are critical for the AI agent workflow. The matching algorithm must be thoroughly tested with realistic file modification scenarios.

1. **Exact match** — comment at line 10, lineHash matches line 10 → anchored at 10
2. **Nearby hash match** — line moved ±5 lines → re-anchored to new position
3. **Context-based match** — commented line rewritten but surrounding lines unchanged → anchored via context
4. **Global hash fallback** — line moved >30 lines (e.g., large block inserted above) → found globally
5. **Selected text fallback** — selection comment, line hash doesn't match, but selectedText found nearby
6. **Duplicate lines** — two identical lines, comment on line 10 → stays on 10, not duplicated to line 20
7. **Orphaned gracefully** — commented line and all context deleted → orphaned at original lineNumber (clamped to file length)
8. **File truncated** — file shortened, lineNumber beyond EOF → clamped to last line, shown as orphaned
9. **File empty** — all content deleted → all comments orphaned at line 1
10. **Multiple comments, mixed matching** — some exact, some re-anchored, some orphaned in same file
11. **Re-anchor updates lineNumber** — after re-anchoring, saved lineNumber reflects new position
12. **Context match disambiguates** — two identical lines, context lines differ → correct one matched
13. **Selection degradation** — selectedText not found → degrades to line comment display

### Unit Tests (Vitest) — Other

14. **Selection anchor creation** — test offset computation, single-line and multi-line selections
15. **Sidecar migration** — test v1→v3, v2→v3, block comment preservation as orphaned
16. **Store actions** — addComment, editComment, deleteComment, resolveComment, addResponse with new model
17. **Line hash computation** — normalization (trim, collapse whitespace), case sensitivity
18. **Context capture** — correct 2-line before/after at file boundaries
19. **CommentsPanel** — sorting by line number, filtering, click-to-scroll dispatch
20. **Response model** — add response, display responses, resolve-by-respondent

### Component Tests (Vitest + RTL)

21. **CommentInput** — Ctrl+Enter save, Escape cancel, empty rejection
22. **CommentThread** — resolve/unresolve, edit, delete, display responses with author/timestamp
23. **SelectionToolbar** — appearance on selection, disappearance on click-away/escape
24. **Gutter** — `+` button hover, comment indicator rendering, click to expand thread
25. **Selection highlights** — highlight rendering, resolved vs unresolved styling
26. **CommentsPanel scroll-to** — clicking comment triggers scroll and flash animation in viewer

### E2E Tests (Playwright)

27. **Add line comment** in source view → verify persisted in sidecar
28. **Add selection comment** in source view → verify highlight + sidecar
29. **Add line comment** in visual (markdown) view → verify source line mapping
30. **Duplicate line handling** — two identical lines, comment on one → only one shows
31. **Re-anchoring** — modify file content, reopen → comment re-anchors to moved line
32. **CommentsPanel navigation** — click comment → scrolls to correct line and highlights
33. **Resolve/delete** — verify UI update and sidecar persistence
34. **Response display** — comment with responses shows author and text

### Rust Integration Tests

35. **Sidecar v3 round-trip** — save and load with new fields (contextBefore, contextAfter, responses)
36. **v2 migration** — load v2 file, verify comments preserved with all fields
37. **Atomic save** — verify temp+rename behavior
38. **New fields optional** — v3 sidecar without contextBefore/responses loads cleanly

### Script Tests

39. **scan-comments.py** — test with v1, v2, v3 sidecars, malformed JSON, empty dirs
40. **respond-comments.py** — test single response, batch response, missing comment ID
41. **resolve-comments.py** — test by ID, by respondent, --all, --dry-run
42. **clean-comments.py** — test resolved-only cleanup, --all deletion, empty sidecar deletion
