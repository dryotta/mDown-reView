# MRSF Migration Design Spec

**Date:** 2026-04-20  
**Status:** Approved  
**Goal:** Migrate mdownreview from custom v3 sidecar format to the MRSF v1.0 specification so that users can use VS Code's Sidemark extension and mdownreview interchangeably on the same sidecar files.

## Approach

Big-bang migration. Drop all backward compatibility with our v1/v2/v3 sidecar format. After this migration, mdownreview reads and writes only MRSF-compliant sidecars. Old `.review.json` files are no longer supported.

## 1. Sidecar Format

### File naming

- **Primary:** `<file>.review.yaml` (written by mdownreview)
- **Also recognized:** `<file>.review.json` (readable for interop with JSON-preferring tools)
- Detection order: `.review.yaml` first, `.review.json` fallback

### On-disk schema (MRSF v1.0)

```yaml
mrsf_version: "1.0"
document: relative/path/to/file.md
comments:
  - id: "uuid-v4"
    author: "Display Name (identifier)"
    timestamp: "2026-04-20T17:00:00-07:00"  # RFC 3339 with timezone
    text: "Comment text"
    resolved: false
    line: 12                      # 1-based, optional
    end_line: 14                  # optional, inclusive
    start_column: 5               # 0-based, optional
    end_column: 42                # optional
    selected_text: "exact text"   # optional
    selected_text_hash: "sha256"  # optional, hex-encoded SHA-256
    anchored_text: "current text" # optional, set when drifted
    commit: "full-sha"            # optional, when git available
    type: "suggestion"            # optional
    severity: "high"              # optional (low|medium|high)
    reply_to: "parent-uuid"       # optional, for threading
```

### Field mapping from v3

| v3 field | MRSF field | Notes |
|---|---|---|
| `version` | `mrsf_version` | `3` → `"1.0"` |
| (implicit) | `document` | New: relative path to source file from workspace root (or sidecar parent if no workspace) |
| `id` | `id` | Same |
| `author` | `author` | `"human"` → user's configured name; `"agent"` → agent identity string |
| `createdAt` | `timestamp` | Must include timezone offset |
| `text` | `text` | Same |
| `resolved` | `resolved` | Same |
| `lineNumber` | `line` | Same value, different key |
| `anchorType` | (removed) | Inferred from field presence |
| `lineHash` | (removed) | Replaced by `selected_text_hash` |
| `contextBefore/After` | (removed) | Not in MRSF v1.0 |
| `selectedText` | `selected_text` | Same concept, snake_case |
| `selectionStartOffset` | `start_column` | Same concept |
| `selectionEndLine` | `end_line` | Same concept |
| `selectionEndOffset` | `end_column` | Same concept |
| `blockHash`, `headingContext`, `fallbackLine` | (removed) | Legacy fields dropped |
| `responses[]` | `reply_to` | Flatten: each response becomes a top-level comment with `reply_to` |
| (none) | `commit` | New: git HEAD SHA when available |
| (none) | `type` | New: suggestion/issue/question/accuracy/style/clarity |
| (none) | `severity` | New: low/medium/high |
| (none) | `anchored_text` | New: current text when drifted from `selected_text` |

## 2. Rust Backend

### Dependencies

**Add:**
- `serde_yaml` — YAML read/write (primary format)
- `sha2` — SHA-256 for `selected_text_hash`

**Remove:**
- FNV-1a hashing code (no longer needed for `lineHash`)

### Struct changes (`commands.rs`)

Replace `ReviewComment`, `CommentResponse`, `ReviewComments`, `LegacyReviewComments` with:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
struct MrsfComment {
    id: String,
    author: String,
    timestamp: String,
    text: String,
    resolved: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    end_line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    start_column: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    end_column: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    selected_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    anchored_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    selected_text_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    commit: Option<String>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    comment_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    severity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reply_to: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MrsfSidecar {
    mrsf_version: String,
    document: String,
    comments: Vec<MrsfComment>,
}
```

### File operations

- `save_review_comments` → serialize with `serde_yaml`, write to `.review.yaml`
- `load_review_comments` → try `.review.yaml` first (serde_yaml), fall back to `.review.json` (serde_json)
- `read_dir` filter → hide both `.review.yaml` and `.review.json`
- `scan_review_files` → scan for both suffixes
- New: `get_git_head()` helper — runs `git rev-parse HEAD` via `std::process::Command`, returns `Option<String>`

### Watcher changes (`watcher.rs`)

- Watch both `.review.yaml` and `.review.json` suffixes
- Emit `kind: "review"` for both

## 3. TypeScript Types & Store

### Types (`tauri-commands.ts`)

```typescript
interface MrsfComment {
  id: string;
  author: string;
  timestamp: string;
  text: string;
  resolved: boolean;
  line?: number;
  end_line?: number;
  start_column?: number;
  end_column?: number;
  selected_text?: string;
  anchored_text?: string;
  selected_text_hash?: string;
  commit?: string;
  type?: "suggestion" | "issue" | "question" | "accuracy" | "style" | "clarity";
  severity?: "low" | "medium" | "high";
  reply_to?: string;
}

interface MrsfSidecar {
  mrsf_version: string;
  document: string;
  comments: MrsfComment[];
}
```

### Store changes (`index.ts`)

- `CommentWithOrphan` extends `MrsfComment` + `{ isOrphaned: boolean; matchedLineNumber?: number }`
- `addComment()` creates `MrsfComment` with UUID v4, RFC 3339 timestamp, author from settings
- `addReply()` creates a new top-level `MrsfComment` with `reply_to` = parent ID
- Remove all `responses[]` handling
- Thread grouping selector: group comments where `reply_to` matches a root comment's `id`, sort by `timestamp`

### Author management

- First-time prompt: ask user for display name and identifier
- Persist in localStorage / app settings
- Format: `"Display Name (identifier)"` — matching MRSF convention
- Used as default for all new comments

## 4. Re-anchoring

Complete rewrite of `comment-matching.ts` and `comment-anchors.ts` to implement the MRSF 4-step re-anchoring algorithm (spec §8):

### Algorithm

1. **Exact text match** — if `selected_text` present, search document for exact occurrence. If found at original `line`, anchor there. If found elsewhere, relocate and set new `line`/`end_line`.
2. **Line/column fallback** — if no `selected_text` or text not found, check if `line` still exists in document. If so, anchor there (best-effort).
3. **Fuzzy match** — if exact text not found, attempt fuzzy string matching across document lines using a configurable threshold (default 0.6). If match found above threshold, anchor there and set `anchored_text` to the current text at that position.
4. **Orphan** — if no match found, mark as orphaned. Comment remains valid but unanchored.

### Anchor creation (`comment-anchors.ts`)

When creating a new comment:
- For line comments: capture `line` only
- For selection comments: capture `line`, `end_line`, `start_column`, `end_column`, `selected_text`
- Compute `selected_text_hash` = hex-encoded SHA-256 of `selected_text`
- If git available, set `commit` from Rust backend

### Removed

- `generateLineHash()` (FNV-1a)
- `generateContext()` (contextBefore/After)
- All 6-strategy matching (hash at line, nearby hash, context match, global hash, text search)

## 5. UI Components

### CommentThread.tsx

- Thread rendering: root comments have no `reply_to`; replies have `reply_to` matching a root `id`
- Render root first, then replies sorted by `timestamp`
- Author badge: display full author string
- Type badge: color-coded (suggestion=blue, issue=red, question=yellow, accuracy=orange, style=purple, clarity=green)
- Severity badge: high=red pill, medium=orange pill, low=gray pill
- Reply action: creates a new `MrsfComment` with `reply_to`
- Orphan banner: shown when `isOrphaned` is true

### CommentsPanel.tsx

- Group by thread (root + its replies), sort threads by root's `line`
- Filter toggles: resolved, by type

### LineCommentMargin.tsx (new comment creation flow)

Sequential flow matching VS Code Sidemark extension UX:
1. Enter comment text
2. Select type (suggestion/issue/question/accuracy/style/clarity/none) — dropdown or quick-pick
3. Select severity (high/medium/low/none) — dropdown or quick-pick
4. Comment created with all fields

### SourceView.tsx & MarkdownViewer.tsx

- Sidecar path: try `.review.yaml` first, `.review.json` fallback
- Comment creation produces MRSF fields

### DeletedFileViewer.tsx

- Same ghost file handling, reads MRSF format

### FolderTree.tsx

- Hide both `.review.yaml` and `.review.json`
- Ghost entry detection: check both suffixes

## 6. Python Skills

### mdownreview-skills (`mdownreview.py`)

Switch to official MRSF Python library:

```python
# Auto-install at top of script
try:
    import mrsf
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", "mrsf"])
    import mrsf
```

- `read_comments` → `mrsf.parse_sidecar(path)`
- `respond_to_comment` → create reply comment with `reply_to` field using `mrsf` library
- `resolve_comment` → `mrsf.resolve_comment()` or direct field update
- File discovery: look for `.review.yaml` first, `.review.json` fallback

### test_mdownreview.py

- Rewrite all fixtures to use MRSF schema
- Test with YAML format

## 7. Testing & Interop Validation

### MRSF reference fixtures

Copy 6 example sidecar files from the MRSF repo (`examples/`) as test fixtures:
- `architecture.md.review.yaml` — basic with type, column spans, `x_` extensions
- `contributing.md.review.yaml` — re-anchoring scenarios (orphan, line-only, drift, deleted sections)
- `api-reference.md.review.yaml`, `data-model.md.review.yaml`, `deployment-guide.md.review.yaml`, `security-policy.md.review.yaml`

### Test categories

1. **Round-trip tests** — load each MRSF example, save it back as YAML, verify output is schema-compliant
2. **Schema validation** — use `mrsf.schema.json` to validate all sidecars generated by mdownreview
3. **Re-anchoring tests** — use `contributing.md.review.yaml` scenarios to verify orphan detection, line-only fallback, drift handling
4. **Threading tests** — verify flat `reply_to` model works: create root + replies, verify thread grouping
5. **Interop smoke test** — generate a sidecar, run `mrsf validate` CLI against it
6. **Author management tests** — first-time prompt, persistence, format validation

### Rust integration tests

- Round-trip YAML serialization/deserialization
- `.review.yaml` / `.review.json` detection and loading
- `read_dir` hides both suffixes
- `scan_review_files` finds both suffixes
- `get_git_head()` returns SHA when in git repo, None when not

## 8. Documentation

### AGENTS.md (mdownreview)

Update to document:
- MRSF v1.0 sidecar format (replace v3 docs)
- `.review.yaml` as primary format
- Threading via `reply_to`
- Author convention
- Type/severity fields
- Link to MRSF specification

### AGENTS.md (mdownreview2)

Update schema section to reference MRSF v1.0.

## 9. File Change Summary

### Files to rewrite/heavily modify

| File | Change |
|---|---|
| `src-tauri/src/commands.rs` | New MRSF structs, YAML read/write, git HEAD helper |
| `src-tauri/Cargo.toml` | Add serde_yaml, sha2 |
| `src/lib/tauri-commands.ts` | New MRSF types |
| `src/store/index.ts` | Flat threading, MRSF fields, author management |
| `src/lib/comment-matching.ts` | MRSF 4-step re-anchoring |
| `src/lib/comment-anchors.ts` | MRSF anchor creation with SHA-256 |
| `src/components/comments/CommentThread.tsx` | Flat reply_to rendering, type/severity badges |
| `src/components/comments/CommentsPanel.tsx` | Thread grouping by reply_to |
| `src/components/comments/LineCommentMargin.tsx` | Type/severity selection in creation flow |
| `src/components/viewers/SourceView.tsx` | YAML sidecar paths, MRSF fields |
| `src/components/viewers/MarkdownViewer.tsx` | Same |
| `src/components/viewers/DeletedFileViewer.tsx` | MRSF format |
| `src/components/FolderTree/FolderTree.tsx` | Hide .review.yaml, detect both suffixes |
| `src-tauri/src/watcher.rs` | Watch .review.yaml |
| `src/hooks/useFileWatcher.ts` | Both suffixes |
| `mdownreview-skills/skills/mdownreview.py` | Use `pip install mrsf` library |
| `mdownreview-skills/skills/test_mdownreview.py` | MRSF fixtures |
| `src/styles/comments.css` | Type/severity badge styles |
| `AGENTS.md` (both repos) | MRSF format docs |

### Files to delete/remove

- All legacy v1/v2/v3 handling code (LegacyReviewComments struct, version migration logic)

### Test files to rewrite

| File | Change |
|---|---|
| `src/__tests__/store/comments.test.ts` | MRSF fields, flat threading |
| `src/lib/__tests__/comment-matching.test.ts` | MRSF 4-step algorithm |
| `src/components/comments/__tests__/CommentThread.test.tsx` | reply_to threading |
| `src/components/comments/__tests__/CommentsPanel.test.tsx` | MRSF fields |
| `src-tauri/tests/commands_integration.rs` | YAML round-trip, MRSF structs |
| `src/hooks/__tests__/useFileWatcher.test.ts` | Both suffixes |

### New test fixtures

- Copy MRSF example sidecars to `src/__tests__/fixtures/mrsf/`
- Copy `mrsf.schema.json` for validation tests
