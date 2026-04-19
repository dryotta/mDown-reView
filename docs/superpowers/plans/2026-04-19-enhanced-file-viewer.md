# Enhanced File Viewer & Review System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend mDown reView to support reviewing, syntax-highlighting, and visualizing all common file types — not just markdown.

**Architecture:** A unified `EnhancedViewer` wraps all text files with a shared Source/Visual toggle toolbar. Each file type gets a visualization sub-view (JSON tree, CSV table, HTML sandbox, Mermaid diagram, KQL plan). Line-level comments extend the existing block-level system for source views. Images get a dedicated read-only viewer.

**Tech Stack:** React 18, TypeScript, Zustand, Shiki (syntax highlighting), mermaid.js (lazy), papaparse (lazy), custom KQL TextMate grammar, Tauri v2 Rust commands.

**Spec:** `docs/superpowers/specs/2026-04-19-enhanced-file-viewer-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `src/lib/file-types.ts` | Centralized file type classification (category, hasVisualization, defaultView) |
| `src/lib/fnv1a.ts` | Shared FNV-1a hash (extracted from MarkdownViewer for reuse by line comments) |
| `src/lib/kql.tmLanguage.json` | Custom TextMate grammar for KQL syntax highlighting |
| `src/lib/kql-parser.ts` | KQL pipe parser for formatting + operator plan extraction |
| `src/components/viewers/ViewerToolbar.tsx` | Shared Source/Visual toggle toolbar |
| `src/components/viewers/EnhancedViewer.tsx` | Unified wrapper for all text files |
| `src/components/viewers/SourceView.tsx` | Refactored source view with line-level comments |
| `src/components/viewers/MarkdownRenderedView.tsx` | Refactored from MarkdownViewer (visual rendering only) |
| `src/components/viewers/JsonTreeView.tsx` | Collapsible JSON tree explorer |
| `src/components/viewers/CsvTableView.tsx` | Sortable CSV/TSV table |
| `src/components/viewers/HtmlPreviewView.tsx` | Sandboxed HTML iframe preview |
| `src/components/viewers/MermaidView.tsx` | Mermaid diagram renderer with pan/zoom/export |
| `src/components/viewers/KqlPlanView.tsx` | Formatted KQL query + operator plan table |
| `src/components/viewers/ImageViewer.tsx` | Image display component |
| `src/components/comments/LineCommentMargin.tsx` | Line-level comment gutter for source views |
| `src/styles/viewer-toolbar.css` | Toolbar styles |
| `src/styles/json-tree.css` | JSON tree view styles |
| `src/styles/csv-table.css` | CSV table styles |
| `src/styles/image-viewer.css` | Image viewer styles |
| `src/styles/kql-plan.css` | KQL plan view styles |
| `src/styles/mermaid-view.css` | Mermaid view styles |

### Modified Files

| File | Changes |
|---|---|
| `src/lib/tauri-commands.ts` | Add `readBinaryFile` wrapper, update `ReviewComment` interface to v2 |
| `src/store/index.ts` | Update `CommentsSlice` for dual anchor types, add `viewModeByTab` state |
| `src/hooks/useFileContent.ts` | Add `"image"` status for image files |
| `src/components/viewers/ViewerRouter.tsx` | Route through `EnhancedViewer` and `ImageViewer` |
| `src/components/viewers/MarkdownViewer.tsx` | Extract `fnv1a8` to shared module |
| `src/components/comments/CommentsPanel.tsx` | Group by anchor type, support line comment scroll-to |
| `src/components/comments/CommentMargin.tsx` | Accept extended anchor types |
| `src-tauri/src/commands.rs` | Add `read_binary_file` command, update `ReviewComment` struct to v2 |
| `src-tauri/src/lib.rs` | Register `read_binary_file` in invoke handler |
| `src/__mocks__/@tauri-apps/api/core.ts` | Add `Uint8Array` to mock return types |

---

## Phase 1: Foundation

### Task 1: File Type Classification Module

**Files:**
- Create: `src/lib/file-types.ts`
- Test: `src/lib/__tests__/file-types.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/lib/__tests__/file-types.test.ts
import { describe, it, expect } from "vitest";
import { getFileCategory, hasVisualization, getDefaultView } from "@/lib/file-types";

describe("getFileCategory", () => {
  it("classifies markdown files", () => {
    expect(getFileCategory("readme.md")).toBe("markdown");
    expect(getFileCategory("doc.MDX")).toBe("markdown");
  });

  it("classifies JSON files", () => {
    expect(getFileCategory("config.json")).toBe("json");
    expect(getFileCategory("settings.jsonc")).toBe("json");
  });

  it("classifies CSV/TSV files", () => {
    expect(getFileCategory("data.csv")).toBe("csv");
    expect(getFileCategory("data.tsv")).toBe("csv");
  });

  it("classifies HTML files", () => {
    expect(getFileCategory("page.html")).toBe("html");
    expect(getFileCategory("page.htm")).toBe("html");
  });

  it("classifies Mermaid files", () => {
    expect(getFileCategory("flow.mermaid")).toBe("mermaid");
    expect(getFileCategory("flow.mmd")).toBe("mermaid");
  });

  it("classifies KQL files", () => {
    expect(getFileCategory("query.kql")).toBe("kql");
    expect(getFileCategory("query.csl")).toBe("kql");
  });

  it("classifies image files", () => {
    expect(getFileCategory("photo.png")).toBe("image");
    expect(getFileCategory("photo.jpg")).toBe("image");
    expect(getFileCategory("photo.jpeg")).toBe("image");
    expect(getFileCategory("icon.svg")).toBe("image");
    expect(getFileCategory("icon.gif")).toBe("image");
    expect(getFileCategory("icon.webp")).toBe("image");
    expect(getFileCategory("icon.bmp")).toBe("image");
    expect(getFileCategory("icon.ico")).toBe("image");
  });

  it("classifies other text files", () => {
    expect(getFileCategory("app.ts")).toBe("text");
    expect(getFileCategory("main.py")).toBe("text");
    expect(getFileCategory("Makefile")).toBe("text");
  });

  it("handles case insensitivity", () => {
    expect(getFileCategory("FILE.JSON")).toBe("json");
    expect(getFileCategory("IMAGE.PNG")).toBe("image");
  });

  it("handles files with no extension", () => {
    expect(getFileCategory("Makefile")).toBe("text");
    expect(getFileCategory("Dockerfile")).toBe("text");
  });
});

describe("hasVisualization", () => {
  it("returns true for visualizable categories", () => {
    expect(hasVisualization("markdown")).toBe(true);
    expect(hasVisualization("json")).toBe(true);
    expect(hasVisualization("csv")).toBe(true);
    expect(hasVisualization("html")).toBe(true);
    expect(hasVisualization("mermaid")).toBe(true);
    expect(hasVisualization("kql")).toBe(true);
  });

  it("returns false for non-visualizable categories", () => {
    expect(hasVisualization("text")).toBe(false);
    expect(hasVisualization("image")).toBe(false);
  });
});

describe("getDefaultView", () => {
  it("returns visual for markdown, json, csv, mermaid, kql", () => {
    expect(getDefaultView("markdown")).toBe("visual");
    expect(getDefaultView("json")).toBe("visual");
    expect(getDefaultView("csv")).toBe("visual");
    expect(getDefaultView("mermaid")).toBe("visual");
    expect(getDefaultView("kql")).toBe("visual");
  });

  it("returns source for html and text", () => {
    expect(getDefaultView("html")).toBe("source");
    expect(getDefaultView("text")).toBe("source");
  });

  it("returns visual for image", () => {
    expect(getDefaultView("image")).toBe("visual");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/file-types.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement file-types.ts**

```typescript
// src/lib/file-types.ts
import { extname } from "@/lib/path-utils";

export type FileCategory =
  | "markdown"
  | "json"
  | "csv"
  | "html"
  | "mermaid"
  | "kql"
  | "image"
  | "text";

const CATEGORY_MAP: Record<string, FileCategory> = {
  ".md": "markdown",
  ".mdx": "markdown",
  ".json": "json",
  ".jsonc": "json",
  ".csv": "csv",
  ".tsv": "csv",
  ".html": "html",
  ".htm": "html",
  ".mermaid": "mermaid",
  ".mmd": "mermaid",
  ".kql": "kql",
  ".csl": "kql",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".svg": "image",
  ".webp": "image",
  ".bmp": "image",
  ".ico": "image",
};

const VISUALIZABLE: Set<FileCategory> = new Set([
  "markdown",
  "json",
  "csv",
  "html",
  "mermaid",
  "kql",
]);

const DEFAULT_VIEW: Record<FileCategory, "source" | "visual"> = {
  markdown: "visual",
  json: "visual",
  csv: "visual",
  html: "source",
  mermaid: "visual",
  kql: "visual",
  image: "visual",
  text: "source",
};

export function getFileCategory(path: string): FileCategory {
  const ext = extname(path); // already lowercased
  return CATEGORY_MAP[ext] ?? "text";
}

export function hasVisualization(category: FileCategory): boolean {
  return VISUALIZABLE.has(category);
}

export function getDefaultView(category: FileCategory): "source" | "visual" {
  return DEFAULT_VIEW[category];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/file-types.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/file-types.ts src/lib/__tests__/file-types.test.ts
git commit -m "feat: add file type classification module"
```

---

### Task 2: Extract Shared FNV-1a Hash

**Files:**
- Create: `src/lib/fnv1a.ts`
- Modify: `src/components/viewers/MarkdownViewer.tsx:54-62`
- Test: `src/lib/__tests__/fnv1a.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/lib/__tests__/fnv1a.test.ts
import { describe, it, expect } from "vitest";
import { fnv1a8 } from "@/lib/fnv1a";

describe("fnv1a8", () => {
  it("returns 8-char hex string", () => {
    const hash = fnv1a8("hello");
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("produces consistent hashes", () => {
    expect(fnv1a8("test")).toBe(fnv1a8("test"));
  });

  it("produces different hashes for different input", () => {
    expect(fnv1a8("hello")).not.toBe(fnv1a8("world"));
  });

  it("handles empty string", () => {
    const hash = fnv1a8("");
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/fnv1a.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create fnv1a.ts and update MarkdownViewer import**

```typescript
// src/lib/fnv1a.ts
export function fnv1a8(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
```

Then in `src/components/viewers/MarkdownViewer.tsx`, replace the local `fnv1a8` function (lines 54-62) with:
```typescript
import { fnv1a8 } from "@/lib/fnv1a";
```
Remove the local `fnv1a8` function definition.

- [ ] **Step 4: Run full test suite to verify nothing broke**

Run: `npx vitest run`
Expected: All existing tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/fnv1a.ts src/lib/__tests__/fnv1a.test.ts src/components/viewers/MarkdownViewer.tsx
git commit -m "refactor: extract fnv1a8 hash to shared module"
```

---

### Task 3: Rust `read_binary_file` Command

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tests/commands_integration.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src/lib/tauri-commands.ts`

- [ ] **Step 1: Write Rust integration test**

Add to `src-tauri/tests/commands_integration.rs`:
```rust
#[test]
fn read_binary_file_returns_base64() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("image.png");
    let png_bytes: Vec<u8> = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    std::fs::write(&path, &png_bytes).unwrap();

    let result = mdown_review_lib::commands::read_binary_file(path.to_string_lossy().into_owned());
    assert!(result.is_ok());
    let b64 = result.unwrap();
    use base64::Engine;
    let decoded = base64::engine::general_purpose::STANDARD.decode(&b64).unwrap();
    assert_eq!(decoded, png_bytes);
}

#[test]
fn read_binary_file_rejects_too_large() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("huge.bin");
    let data = vec![0u8; 11 * 1024 * 1024];
    std::fs::write(&path, &data).unwrap();

    let result = mdown_review_lib::commands::read_binary_file(path.to_string_lossy().into_owned());
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), "file_too_large");
}

#[test]
fn read_binary_file_missing_file() {
    let result = mdown_review_lib::commands::read_binary_file("/nonexistent/file.png".into());
    assert!(result.is_err());
}
```

- [ ] **Step 2: Run Rust test to verify it fails**

Run: `cd src-tauri && cargo test`
Expected: FAIL — `read_binary_file` not found

- [ ] **Step 3: Add `base64` dependency to Cargo.toml**

Add to `[dependencies]` in `src-tauri/Cargo.toml`:
```toml
base64 = "0.22"
```

- [ ] **Step 4: Implement `read_binary_file` in commands.rs**

Add after `read_text_file` function (after line 122):
```rust
/// Read a binary file, returning base64-encoded content. Rejects files >10 MB.
#[tauri::command]
pub fn read_binary_file(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| {
        tracing::error!("[rust] command error: {}", e);
        e.to_string()
    })?;

    const MAX_SIZE: usize = 10 * 1024 * 1024;
    if bytes.len() > MAX_SIZE {
        return Err("file_too_large".into());
    }

    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}
```

- [ ] **Step 5: Register in lib.rs**

In `src-tauri/src/lib.rs`, add `commands::read_binary_file` to the `generate_handler![]` macro.

- [ ] **Step 6: Add frontend wrapper to tauri-commands.ts**

Add to `src/lib/tauri-commands.ts`:
```typescript
export const readBinaryFile = (path: string): Promise<string> =>
  invoke<string>("read_binary_file", { path });
```

- [ ] **Step 7: Run Rust tests**

Run: `cd src-tauri && cargo test`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/tests/commands_integration.rs src/lib/tauri-commands.ts
git commit -m "feat: add read_binary_file Tauri command for image support"
```

---

### Task 4: Comment Model v2 — Types and Store Update

**Files:**
- Modify: `src/lib/tauri-commands.ts:17-30`
- Modify: `src-tauri/src/commands.rs:20-45`
- Modify: `src/store/index.ts`
- Test: `src/__tests__/store/comments.test.ts`
- Test: `src-tauri/tests/commands_integration.rs`

- [ ] **Step 1: Update `ReviewComment` interface in tauri-commands.ts**

Replace the existing `ReviewComment` interface:
```typescript
export interface ReviewComment {
  id: string;
  anchorType: "block" | "line";
  blockHash?: string;
  lineHash?: string;
  lineNumber?: number;
  headingContext?: string | null;
  fallbackLine?: number;
  text: string;
  createdAt: string;
  resolved: boolean;
}
```

- [ ] **Step 2: Update Rust `ReviewComment` struct**

In `src-tauri/src/commands.rs`, replace the `ReviewComment` struct:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewComment {
    pub id: String,
    #[serde(rename = "anchorType", default = "default_anchor_type")]
    pub anchor_type: String,
    #[serde(rename = "blockHash", skip_serializing_if = "Option::is_none")]
    pub block_hash: Option<String>,
    #[serde(rename = "lineHash", skip_serializing_if = "Option::is_none")]
    pub line_hash: Option<String>,
    #[serde(rename = "lineNumber", skip_serializing_if = "Option::is_none")]
    pub line_number: Option<u32>,
    #[serde(rename = "headingContext")]
    pub heading_context: Option<String>,
    #[serde(rename = "fallbackLine", skip_serializing_if = "Option::is_none")]
    pub fallback_line: Option<u32>,
    pub text: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub resolved: bool,
}

fn default_anchor_type() -> String {
    "block".to_string()
}
```

Update `save_review_comments` to write version 2:
```rust
let payload = ReviewComments {
    version: 2,
    comments,
};
```

- [ ] **Step 3: Add v2 comment tests**

Add to `src/__tests__/store/comments.test.ts`:
```typescript
describe("comment v2 compatibility", () => {
  it("handles v1 comments (block-only, no anchorType)", () => {
    const v1Comment = {
      id: "abc",
      blockHash: "12345678",
      headingContext: null,
      fallbackLine: 5,
      text: "old comment",
      createdAt: "2026-01-01T00:00:00Z",
      resolved: false,
    };
    useStore.getState().setFileComments("/test.md", [v1Comment as any]);
    const comments = useStore.getState().commentsByFile["/test.md"];
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toBe("old comment");
  });

  it("stores line comments with anchorType", () => {
    const lineComment = {
      id: "def",
      anchorType: "line" as const,
      lineHash: "abcd1234",
      lineNumber: 42,
      text: "line comment",
      createdAt: "2026-01-01T00:00:00Z",
      resolved: false,
    };
    useStore.getState().setFileComments("/test.ts", [lineComment]);
    const comments = useStore.getState().commentsByFile["/test.ts"];
    expect(comments).toHaveLength(1);
    expect(comments[0].anchorType).toBe("line");
    expect(comments[0].lineHash).toBe("abcd1234");
    expect(comments[0].lineNumber).toBe(42);
  });
});
```

- [ ] **Step 4: Add Rust v2 migration test**

Add to `src-tauri/tests/commands_integration.rs`:
```rust
#[test]
fn load_v1_comments_defaults_anchor_type_to_block() {
    let dir = tempfile::tempdir().unwrap();
    let file_path = dir.path().join("test.md");
    std::fs::write(&file_path, "# hello").unwrap();
    let sidecar = dir.path().join("test.md.review.json");
    std::fs::write(&sidecar, r#"{"version":1,"comments":[{"id":"a","blockHash":"12345678","headingContext":null,"fallbackLine":1,"text":"hello","createdAt":"2026-01-01T00:00:00Z","resolved":false}]}"#).unwrap();

    let result = mdown_review_lib::commands::load_review_comments(file_path.to_string_lossy().into_owned()).unwrap().unwrap();
    assert_eq!(result.comments[0].anchor_type, "block");
}
```

- [ ] **Step 5: Run all tests**

Run: `cd src-tauri && cargo test` and `npx vitest run`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/tauri-commands.ts src-tauri/src/commands.rs src/store/index.ts src/__tests__/store/comments.test.ts src-tauri/tests/commands_integration.rs
git commit -m "feat: extend comment model to v2 with line-level anchoring"
```

---

### Task 5: View Mode State in Store

**Files:**
- Modify: `src/store/index.ts`
- Test: `src/__tests__/store/tabs.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/__tests__/store/tabs.test.ts`:
```typescript
describe("view mode per tab", () => {
  it("stores and retrieves view mode for a tab", () => {
    useStore.getState().setViewMode("/test.json", "visual");
    expect(useStore.getState().viewModeByTab["/test.json"]).toBe("visual");
  });

  it("defaults to undefined when not set", () => {
    expect(useStore.getState().viewModeByTab["/unknown"]).toBeUndefined();
  });

  it("clears view mode when tab is closed", () => {
    useStore.getState().openFile("/test.json");
    useStore.getState().setViewMode("/test.json", "source");
    useStore.getState().closeTab("/test.json");
    expect(useStore.getState().viewModeByTab["/test.json"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/store/tabs.test.ts`
Expected: FAIL — `setViewMode` not found

- [ ] **Step 3: Add viewModeByTab to store**

In `src/store/index.ts`, add to `TabsSlice` interface:
```typescript
viewModeByTab: Record<string, "source" | "visual">;
setViewMode: (path: string, mode: "source" | "visual") => void;
```

In the store implementation, add:
```typescript
viewModeByTab: {},
setViewMode: (path, mode) => set((s) => ({
  viewModeByTab: { ...s.viewModeByTab, [path]: mode },
})),
```

In `closeTab`, after filtering tabs, also remove the view mode entry:
```typescript
const { [path]: _, ...restViewModes } = get().viewModeByTab;
set({ tabs: newTabs, activeTabPath: newActive, viewModeByTab: restViewModes });
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/store/tabs.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/index.ts src/__tests__/store/tabs.test.ts
git commit -m "feat: add per-tab view mode state to store"
```

---

## Phase 2: Core Components

### Task 6: ViewerToolbar Component

**Files:**
- Create: `src/components/viewers/ViewerToolbar.tsx`
- Create: `src/styles/viewer-toolbar.css`
- Test: `src/components/viewers/__tests__/ViewerToolbar.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// src/components/viewers/__tests__/ViewerToolbar.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ViewerToolbar } from "../ViewerToolbar";

describe("ViewerToolbar", () => {
  it("renders source and visual toggle buttons", () => {
    render(<ViewerToolbar activeView="source" onViewChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /source/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /visual/i })).toBeInTheDocument();
  });

  it("highlights the active view", () => {
    render(<ViewerToolbar activeView="visual" onViewChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /visual/i })).toHaveClass("active");
    expect(screen.getByRole("button", { name: /source/i })).not.toHaveClass("active");
  });

  it("calls onViewChange when toggling", () => {
    const onChange = vi.fn();
    render(<ViewerToolbar activeView="source" onViewChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /visual/i }));
    expect(onChange).toHaveBeenCalledWith("visual");
  });

  it("does not render when hidden", () => {
    const { container } = render(
      <ViewerToolbar activeView="source" onViewChange={vi.fn()} hidden />
    );
    expect(container.querySelector(".viewer-toolbar")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/viewers/__tests__/ViewerToolbar.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement ViewerToolbar**

```typescript
// src/components/viewers/ViewerToolbar.tsx
import "@/styles/viewer-toolbar.css";

interface Props {
  activeView: "source" | "visual";
  onViewChange: (view: "source" | "visual") => void;
  hidden?: boolean;
}

export function ViewerToolbar({ activeView, onViewChange, hidden }: Props) {
  if (hidden) return null;

  return (
    <div className="viewer-toolbar" role="toolbar" aria-label="View mode">
      <div className="viewer-toolbar-toggle">
        <button
          className={`viewer-toolbar-btn${activeView === "source" ? " active" : ""}`}
          onClick={() => onViewChange("source")}
          aria-pressed={activeView === "source"}
        >
          Source
        </button>
        <button
          className={`viewer-toolbar-btn${activeView === "visual" ? " active" : ""}`}
          onClick={() => onViewChange("visual")}
          aria-pressed={activeView === "visual"}
        >
          Visual
        </button>
      </div>
    </div>
  );
}
```

```css
/* src/styles/viewer-toolbar.css */
.viewer-toolbar {
  display: flex;
  align-items: center;
  padding: 4px 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-shrink: 0;
}

.viewer-toolbar-toggle {
  display: flex;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  overflow: hidden;
}

.viewer-toolbar-btn {
  padding: 3px 12px;
  font-size: 12px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.viewer-toolbar-btn:hover {
  background: var(--color-hover);
}

.viewer-toolbar-btn.active {
  background: var(--color-accent);
  color: white;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components/viewers/__tests__/ViewerToolbar.test.tsx`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/viewers/ViewerToolbar.tsx src/styles/viewer-toolbar.css src/components/viewers/__tests__/ViewerToolbar.test.tsx
git commit -m "feat: add ViewerToolbar source/visual toggle component"
```

---

### Task 7: SourceView with Line Comments

**Files:**
- Create: `src/components/viewers/SourceView.tsx`
- Create: `src/components/comments/LineCommentMargin.tsx`
- Test: `src/components/viewers/__tests__/SourceView.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// src/components/viewers/__tests__/SourceView.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SourceView } from "../SourceView";

vi.mock("shiki", () => ({
  createHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: vi.fn().mockReturnValue("<pre><code>highlighted</code></pre>"),
    getLoadedLanguages: vi.fn().mockReturnValue([]),
    loadLanguage: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/logger");

vi.mock("@/lib/tauri-commands", () => ({
  loadReviewComments: vi.fn().mockResolvedValue(null),
  saveReviewComments: vi.fn().mockResolvedValue(undefined),
}));

describe("SourceView", () => {
  it("renders source content with line numbers", async () => {
    render(<SourceView content={"line1\nline2\nline3"} path="/test.ts" filePath="/test.ts" />);
    await waitFor(() => {
      expect(screen.getByText("1")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
    });
  });

  it("shows add-comment button on line hover", async () => {
    render(<SourceView content={"const x = 1;"} path="/test.ts" filePath="/test.ts" />);
    await waitFor(() => {
      expect(screen.getByText("1")).toBeInTheDocument();
    });
    const lineGutter = screen.getByText("1").closest(".source-line-gutter");
    if (lineGutter) fireEvent.mouseEnter(lineGutter);
    expect(screen.getByLabelText("Add comment")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/viewers/__tests__/SourceView.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement LineCommentMargin**

```typescript
// src/components/comments/LineCommentMargin.tsx
import { useState } from "react";
import { useStore } from "@/store";
import { CommentInput } from "./CommentInput";
import { CommentThread } from "./CommentThread";
import "@/styles/comments.css";

interface Props {
  filePath: string;
  lineNumber: number;
  lineHash: string;
  showInput?: boolean;
  onCloseInput?: () => void;
}

export function LineCommentMargin({ filePath, lineNumber, lineHash, showInput, onCloseInput }: Props) {
  const { commentsByFile, addComment } = useStore();
  const [expanded, setExpanded] = useState(false);

  const comments = (commentsByFile[filePath] ?? []).filter(
    (c) => c.anchorType === "line" && c.lineHash === lineHash
  );
  const unresolved = comments.filter((c) => !c.resolved);

  const handleSave = (text: string) => {
    addComment(
      filePath,
      { anchorType: "line", lineHash, lineNumber },
      text
    );
    onCloseInput?.();
    setExpanded(true);
  };

  if (!showInput && comments.length === 0) return null;

  return (
    <div className="line-comment-section">
      {showInput && (
        <CommentInput
          anchor={{ blockHash: lineHash, headingContext: null, fallbackLine: lineNumber }}
          onSave={handleSave}
          onClose={() => onCloseInput?.()}
        />
      )}
      {expanded && comments.map((c) => <CommentThread key={c.id} comment={c} />)}
      {!expanded && unresolved.length > 0 && (
        <button className="line-comment-count" onClick={() => setExpanded(true)}>
          {unresolved.length} comment{unresolved.length > 1 ? "s" : ""}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implement SourceView**

```typescript
// src/components/viewers/SourceView.tsx
import { useEffect, useState, useRef } from "react";
import { createHighlighter, type Highlighter } from "shiki";
import { extname } from "@/lib/path-utils";
import { fnv1a8 } from "@/lib/fnv1a";
import { useStore } from "@/store";
import { loadReviewComments, saveReviewComments } from "@/lib/tauri-commands";
import { LineCommentMargin } from "@/components/comments/LineCommentMargin";
import "@/styles/source-viewer.css";

const SIZE_WARN_THRESHOLD = 500 * 1024;

interface Props {
  content: string;
  path: string;
  filePath: string;
  fileSize?: number;
}

let highlighterInstance: Highlighter | null = null;

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterInstance) {
    highlighterInstance = await createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: [],
    });
  }
  return highlighterInstance;
}

function langFromPath(path: string): string {
  const ext = extname(path).slice(1);
  const map: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
    py: "python", rs: "rust", go: "go", java: "java",
    c: "c", cpp: "cpp", h: "c", css: "css", html: "html",
    json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
    sh: "bash", bash: "bash", md: "markdown", sql: "sql",
    rb: "ruby", php: "php", swift: "swift", kt: "kotlin", cs: "csharp",
    xml: "xml",
  };
  return map[ext] ?? "text";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function extractInnerCode(html: string): string {
  const match = /<code[^>]*>([\s\S]*?)<\/code>/.exec(html);
  return match ? match[1] : html;
}

export function SourceView({ content, path, filePath, fileSize }: Props) {
  const [highlightedLines, setHighlightedLines] = useState<string[]>([]);
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);
  const [commentingLine, setCommentingLine] = useState<number | null>(null);

  const setFileComments = useStore((s) => s.setFileComments);
  const comments = useStore((s) => s.commentsByFile[filePath]);
  const loadedRef = useRef<string | null>(null);

  const lines = content.split("\n");

  // Load comments from sidecar
  useEffect(() => {
    let cancelled = false;
    loadedRef.current = null;
    loadReviewComments(filePath)
      .then((result) => {
        if (!cancelled && result?.comments) {
          setFileComments(filePath, result.comments);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) loadedRef.current = filePath; });
    return () => { cancelled = true; };
  }, [filePath, setFileComments]);

  // Auto-save comments
  useEffect(() => {
    if (loadedRef.current !== filePath) return;
    const timer = setTimeout(() => {
      saveReviewComments(filePath, comments ?? []).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [comments, filePath]);

  // Theme tracking
  const [currentTheme, setCurrentTheme] = useState(
    () => document.documentElement.getAttribute("data-theme") ?? "light"
  );
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setCurrentTheme(document.documentElement.getAttribute("data-theme") ?? "light");
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  // Syntax highlighting per line
  useEffect(() => {
    const theme = currentTheme === "dark" ? "github-dark" : "github-light";
    const lang = langFromPath(path);
    getHighlighter()
      .then(async (hl) => {
        const loaded = hl.getLoadedLanguages();
        if (!loaded.includes(lang) && lang !== "text") {
          await hl.loadLanguage(lang).catch(() => {});
        }
        const htmlLines = lines.map((line) => {
          try {
            return hl.codeToHtml(line || " ", { lang, theme });
          } catch {
            return `<pre><code>${escapeHtml(line)}</code></pre>`;
          }
        });
        setHighlightedLines(htmlLines);
      })
      .catch(() => setHighlightedLines([]));
  }, [content, path, currentTheme]);

  const showSizeWarning = fileSize !== undefined && fileSize > SIZE_WARN_THRESHOLD;

  return (
    <div className="source-view">
      {showSizeWarning && (
        <div className="size-warning" role="alert">
          This file is large ({Math.round((fileSize ?? 0) / 1024)} KB) — rendering may be slow
        </div>
      )}
      <div className="source-lines">
        {lines.map((line, idx) => {
          const lineNum = idx + 1;
          const lineHash = fnv1a8(line.trim());
          const lineComments = (comments ?? []).filter(
            (c) => c.anchorType === "line" && c.lineHash === lineHash
          );
          return (
            <div key={idx}>
              <div
                className="source-line"
                onMouseEnter={() => setHoveredLine(lineNum)}
                onMouseLeave={() => setHoveredLine(null)}
              >
                <span className="source-line-gutter">
                  <span className="source-line-number">{lineNum}</span>
                  {(hoveredLine === lineNum || commentingLine === lineNum) && (
                    <button
                      className="comment-plus-btn source-line-add-comment"
                      aria-label="Add comment"
                      onClick={() => setCommentingLine(
                        commentingLine === lineNum ? null : lineNum
                      )}
                    >
                      +
                    </button>
                  )}
                </span>
                <span
                  className="source-line-content"
                  dangerouslySetInnerHTML={{
                    __html: highlightedLines[idx]
                      ? extractInnerCode(highlightedLines[idx])
                      : escapeHtml(line),
                  }}
                />
              </div>
              {(commentingLine === lineNum || lineComments.length > 0) && (
                <LineCommentMargin
                  filePath={filePath}
                  lineNumber={lineNum}
                  lineHash={lineHash}
                  showInput={commentingLine === lineNum}
                  onCloseInput={() => setCommentingLine(null)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/components/viewers/__tests__/SourceView.test.tsx`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/viewers/SourceView.tsx src/components/comments/LineCommentMargin.tsx src/components/viewers/__tests__/SourceView.test.tsx
git commit -m "feat: add SourceView with line-level comment support"
```

---

## Phase 3: Visualization Sub-Views

### Task 8: JsonTreeView

**Files:**
- Create: `src/components/viewers/JsonTreeView.tsx`
- Create: `src/styles/json-tree.css`
- Test: `src/components/viewers/__tests__/JsonTreeView.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// src/components/viewers/__tests__/JsonTreeView.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JsonTreeView } from "../JsonTreeView";

describe("JsonTreeView", () => {
  it("renders root object with key count", () => {
    render(<JsonTreeView content='{"a":1,"b":2}' />);
    expect(screen.getByText(/2 keys/)).toBeInTheDocument();
  });

  it("renders string values", () => {
    render(<JsonTreeView content='{"name":"hello"}' />);
    expect(screen.getByText(/"hello"/)).toBeInTheDocument();
  });

  it("expands/collapses on click", () => {
    render(<JsonTreeView content='{"obj":{"key":"value"}}' />);
    const toggles = screen.getAllByRole("button");
    fireEvent.click(toggles[0]);
  });

  it("handles arrays", () => {
    render(<JsonTreeView content='[1,2,3]' />);
    expect(screen.getByText(/3 items/)).toBeInTheDocument();
  });

  it("handles invalid JSON gracefully", () => {
    render(<JsonTreeView content="not json" />);
    expect(screen.getByText(/invalid json/i)).toBeInTheDocument();
  });

  it("handles empty object", () => {
    render(<JsonTreeView content='{}' />);
    expect(screen.getByText(/0 keys/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/viewers/__tests__/JsonTreeView.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement JsonTreeView**

Create `src/components/viewers/JsonTreeView.tsx` — a recursive React component with:
- `JsonNode` subcomponent for each value type (string/number/boolean/null/object/array)
- Expand/collapse toggle buttons (`▼`/`▶`)
- Key counts for objects, item counts for arrays
- Nodes collapsed by default past depth 2
- Color-coded value types via CSS classes

Create `src/styles/json-tree.css` with styles for:
- `.json-tree` container (monospace font, line-height)
- `.json-key`, `.json-string`, `.json-number`, `.json-boolean`, `.json-null` colors
- `.json-toggle` button styling
- `.json-children` indentation (padding-left: 20px)
- `.json-summary` for collapsed counts
- Dark theme overrides via `[data-theme="dark"]`

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components/viewers/__tests__/JsonTreeView.test.tsx`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/viewers/JsonTreeView.tsx src/styles/json-tree.css src/components/viewers/__tests__/JsonTreeView.test.tsx
git commit -m "feat: add JSON tree explorer visualization"
```

---

### Task 9: CsvTableView

**Files:**
- Create: `src/components/viewers/CsvTableView.tsx`
- Create: `src/styles/csv-table.css`
- Test: `src/components/viewers/__tests__/CsvTableView.test.tsx`

- [ ] **Step 1: Install papaparse**

Run: `npm install papaparse && npm install -D @types/papaparse`

- [ ] **Step 2: Write failing tests**

```typescript
// src/components/viewers/__tests__/CsvTableView.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CsvTableView } from "../CsvTableView";

describe("CsvTableView", () => {
  it("renders table with headers from first row", () => {
    render(<CsvTableView content={"Name,Age\nAlice,30\nBob,25"} path="/data.csv" />);
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Age")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("shows row and column count", () => {
    render(<CsvTableView content={"A,B\n1,2\n3,4"} path="/data.csv" />);
    expect(screen.getByText(/2 rows/)).toBeInTheDocument();
    expect(screen.getByText(/2 columns/)).toBeInTheDocument();
  });

  it("sorts columns on header click", () => {
    render(<CsvTableView content={"Name,Age\nBob,25\nAlice,30"} path="/data.csv" />);
    fireEvent.click(screen.getByText("Name"));
    const cells = screen.getAllByRole("cell");
    expect(cells[0].textContent).toBe("Alice");
  });

  it("handles TSV files", () => {
    render(<CsvTableView content={"Name\tAge\nAlice\t30"} path="/data.tsv" />);
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Implement CsvTableView**

Create `src/components/viewers/CsvTableView.tsx` with:
- `papaparse` for CSV parsing (detect delimiter from extension: comma for `.csv`, tab for `.tsv`)
- First row as headers
- Sortable columns (click to cycle asc/desc/unsorted)
- Numeric-aware sorting (numbers sort numerically, strings alphabetically)
- Row/column count footer

Create `src/styles/csv-table.css` with table styles.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components/viewers/__tests__/CsvTableView.test.tsx`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/viewers/CsvTableView.tsx src/styles/csv-table.css src/components/viewers/__tests__/CsvTableView.test.tsx package.json package-lock.json
git commit -m "feat: add CSV/TSV sortable table visualization"
```

---

### Task 10: HtmlPreviewView

**Files:**
- Create: `src/components/viewers/HtmlPreviewView.tsx`
- Test: `src/components/viewers/__tests__/HtmlPreviewView.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// src/components/viewers/__tests__/HtmlPreviewView.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HtmlPreviewView } from "../HtmlPreviewView";

describe("HtmlPreviewView", () => {
  it("renders sandboxed iframe with content", () => {
    const { container } = render(<HtmlPreviewView content="<h1>Hello</h1>" />);
    const iframe = container.querySelector("iframe");
    expect(iframe).toBeInTheDocument();
    expect(iframe?.getAttribute("sandbox")).toBe("allow-same-origin");
  });

  it("shows safety warning banner", () => {
    render(<HtmlPreviewView content="<p>test</p>" />);
    expect(screen.getByText(/sandboxed preview/i)).toBeInTheDocument();
  });

  it("toggles to unsafe mode", () => {
    const { container } = render(<HtmlPreviewView content="<p>test</p>" />);
    fireEvent.click(screen.getByRole("button", { name: /enable scripts/i }));
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("sandbox")).toContain("allow-scripts");
  });
});
```

- [ ] **Step 2: Implement HtmlPreviewView**

```typescript
// src/components/viewers/HtmlPreviewView.tsx
import { useState } from "react";

interface Props {
  content: string;
}

export function HtmlPreviewView({ content }: Props) {
  const [unsafeMode, setUnsafeMode] = useState(false);
  const sandbox = unsafeMode ? "allow-same-origin allow-scripts" : "allow-same-origin";

  return (
    <div className="html-preview" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="html-preview-banner" style={{ padding: "6px 12px", background: "var(--color-warning-bg, #fff3cd)", borderBottom: "1px solid var(--color-warning-border, #ffc107)", fontSize: 12 }}>
        ⚠ Sandboxed preview — scripts and external resources disabled
        <button
          className="comment-btn"
          aria-label={unsafeMode ? "Disable scripts" : "Enable scripts"}
          onClick={() => setUnsafeMode(!unsafeMode)}
          style={{ marginLeft: 8 }}
        >
          {unsafeMode ? "Disable scripts" : "Enable scripts"}
        </button>
      </div>
      <iframe
        srcDoc={content}
        sandbox={sandbox}
        title="HTML preview"
        style={{ width: "100%", border: "none", minHeight: 400, flex: 1, background: "white" }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/components/viewers/__tests__/HtmlPreviewView.test.tsx`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/viewers/HtmlPreviewView.tsx src/components/viewers/__tests__/HtmlPreviewView.test.tsx
git commit -m "feat: add sandboxed HTML preview visualization"
```

---

### Task 11: KQL Parser and KqlPlanView

**Files:**
- Create: `src/lib/kql-parser.ts`
- Create: `src/components/viewers/KqlPlanView.tsx`
- Create: `src/styles/kql-plan.css`
- Test: `src/lib/__tests__/kql-parser.test.ts`
- Test: `src/components/viewers/__tests__/KqlPlanView.test.tsx`

- [ ] **Step 1: Write failing parser tests**

```typescript
// src/lib/__tests__/kql-parser.test.ts
import { describe, it, expect } from "vitest";
import { parseKqlPipeline, formatKql } from "@/lib/kql-parser";

describe("parseKqlPipeline", () => {
  it("parses simple pipeline", () => {
    const result = parseKqlPipeline("StormEvents | where State == 'FL' | count");
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ operator: "StormEvents", isSource: true });
    expect(result[1]).toMatchObject({ operator: "where", details: "State == 'FL'" });
    expect(result[2]).toMatchObject({ operator: "count" });
  });

  it("handles multi-line input", () => {
    const input = "Logs\n| where Level == 'Error'\n| summarize count() by Source";
    const result = parseKqlPipeline(input);
    expect(result).toHaveLength(3);
    expect(result[1].operator).toBe("where");
    expect(result[2].operator).toBe("summarize");
  });

  it("handles empty input", () => {
    expect(parseKqlPipeline("")).toEqual([]);
  });
});

describe("formatKql", () => {
  it("adds line breaks at pipe operators", () => {
    const result = formatKql("T | where x > 1 | count");
    expect(result).toContain("\n| where");
    expect(result).toContain("\n| count");
  });

  it("preserves existing line breaks", () => {
    const input = "T\n| where x > 1\n| count";
    const result = formatKql(input);
    expect(result.split("\n")).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Implement kql-parser.ts**

Create `src/lib/kql-parser.ts` with:
- `parseKqlPipeline(input)` — splits on `|`, identifies operators vs source table, returns step/operator/details
- `formatKql(input)` — adds line breaks at pipe boundaries for readable display
- KQL_OPERATORS set for all known operators

- [ ] **Step 3: Write failing KqlPlanView tests**

```typescript
// src/components/viewers/__tests__/KqlPlanView.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KqlPlanView } from "../KqlPlanView";

describe("KqlPlanView", () => {
  it("renders formatted query and operator table", () => {
    render(<KqlPlanView content="Events | where Level == 'Error' | summarize count() by Source" />);
    expect(screen.getByText("where")).toBeInTheDocument();
    expect(screen.getByText("summarize")).toBeInTheDocument();
    expect(screen.getByText(/3 operators/)).toBeInTheDocument();
  });

  it("handles empty content", () => {
    render(<KqlPlanView content="" />);
    expect(screen.getByText(/no query/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Implement KqlPlanView**

Create `src/components/viewers/KqlPlanView.tsx` with:
- Formatted query block with keyword highlighting
- Operator plan table (step/operator/details)
- Operator count footer
Create `src/styles/kql-plan.css` with styles.

- [ ] **Step 5: Run all KQL tests**

Run: `npx vitest run src/lib/__tests__/kql-parser.test.ts src/components/viewers/__tests__/KqlPlanView.test.tsx`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/kql-parser.ts src/components/viewers/KqlPlanView.tsx src/styles/kql-plan.css src/lib/__tests__/kql-parser.test.ts src/components/viewers/__tests__/KqlPlanView.test.tsx
git commit -m "feat: add KQL parser and plan view visualization"
```

---

### Task 12: MermaidView

**Files:**
- Create: `src/components/viewers/MermaidView.tsx`
- Create: `src/styles/mermaid-view.css`
- Test: `src/components/viewers/__tests__/MermaidView.test.tsx`

- [ ] **Step 1: Install mermaid**

Run: `npm install mermaid`

- [ ] **Step 2: Write failing tests**

```typescript
// src/components/viewers/__tests__/MermaidView.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MermaidView } from "../MermaidView";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg>mock diagram</svg>' }),
  },
}));

describe("MermaidView", () => {
  it("renders mermaid diagram", async () => {
    render(<MermaidView content="graph TD; A-->B;" />);
    await waitFor(() => {
      expect(screen.getByTitle("Mermaid diagram")).toBeInTheDocument();
    });
  });

  it("shows error for invalid syntax", async () => {
    const mermaid = (await import("mermaid")).default;
    (mermaid.render as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Parse error"));
    render(<MermaidView content="invalid mermaid" />);
    await waitFor(() => {
      expect(screen.getByText(/error rendering/i)).toBeInTheDocument();
    });
  });

  it("provides export buttons", () => {
    render(<MermaidView content="graph TD; A-->B;" />);
    expect(screen.getByRole("button", { name: /png/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /svg/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Implement MermaidView**

Create `src/components/viewers/MermaidView.tsx` with:
- Lazy import of mermaid via `import("mermaid")`
- Theme-aware initialization (reads `data-theme`)
- SVG rendering into a container div
- Zoom controls (scale +/−/reset via CSS transform)
- Export to PNG (via canvas) and SVG (via Blob)
- Error display for invalid syntax
Create `src/styles/mermaid-view.css` with styles.

Note: `MermaidView` must be a **named export** (not default) so that `EnhancedViewer` can lazy-load it with:
```typescript
const MermaidView = lazy(() => import("./MermaidView").then((m) => ({ default: m.MermaidView })));
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components/viewers/__tests__/MermaidView.test.tsx`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/viewers/MermaidView.tsx src/styles/mermaid-view.css src/components/viewers/__tests__/MermaidView.test.tsx package.json package-lock.json
git commit -m "feat: add Mermaid diagram visualization with pan/zoom/export"
```

---

### Task 13: ImageViewer

**Files:**
- Create: `src/components/viewers/ImageViewer.tsx`
- Create: `src/styles/image-viewer.css`
- Modify: `src/hooks/useFileContent.ts`
- Test: `src/components/viewers/__tests__/ImageViewer.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// src/components/viewers/__tests__/ImageViewer.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ImageViewer } from "../ImageViewer";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => "asset://localhost/" + encodeURIComponent(path)),
}));

describe("ImageViewer", () => {
  it("renders image with asset URL", () => {
    render(<ImageViewer path="/photos/test.png" />);
    const img = screen.getByRole("img");
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("src")).toContain("asset://");
  });

  it("shows filename in header", () => {
    render(<ImageViewer path="/photos/test.png" />);
    expect(screen.getByText("test.png")).toBeInTheDocument();
  });

  it("does not render any comment UI", () => {
    const { container } = render(<ImageViewer path="/photos/test.png" />);
    expect(container.querySelector(".comment-plus-btn")).toBeNull();
    expect(container.querySelector(".comment-margin-wrapper")).toBeNull();
  });
});
```

- [ ] **Step 2: Implement ImageViewer**

Create `src/components/viewers/ImageViewer.tsx` with:
- `convertFileSrc(path)` for image URL
- Header showing filename, dimensions (from `onLoad`), and fit/original toggle
- No comment UI whatsoever
Create `src/styles/image-viewer.css` with styles.

- [ ] **Step 3: Update useFileContent for image detection**

In `src/hooks/useFileContent.ts`:
- Import `getFileCategory` from `@/lib/file-types`
- Add `"image"` to `FileStatus` type
- Early return `{ status: "image" }` when `getFileCategory(path) === "image"` before calling `readTextFile`

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components/viewers/__tests__/ImageViewer.test.tsx`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/viewers/ImageViewer.tsx src/styles/image-viewer.css src/hooks/useFileContent.ts src/components/viewers/__tests__/ImageViewer.test.tsx
git commit -m "feat: add image viewer for browser-native formats"
```

---

## Phase 4: Integration

### Task 14: EnhancedViewer Wrapper

**Files:**
- Create: `src/components/viewers/EnhancedViewer.tsx`
- Test: `src/components/viewers/__tests__/EnhancedViewer.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// src/components/viewers/__tests__/EnhancedViewer.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EnhancedViewer } from "../EnhancedViewer";

vi.mock("shiki", () => ({
  createHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: vi.fn().mockReturnValue("<pre><code>hi</code></pre>"),
    getLoadedLanguages: vi.fn().mockReturnValue([]),
    loadLanguage: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/logger");
vi.mock("@/lib/tauri-commands", () => ({
  loadReviewComments: vi.fn().mockResolvedValue(null),
  saveReviewComments: vi.fn().mockResolvedValue(undefined),
}));

describe("EnhancedViewer", () => {
  it("shows ViewerToolbar for JSON files", () => {
    render(<EnhancedViewer content='{"a":1}' path="/test.json" filePath="/test.json" />);
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
  });

  it("hides ViewerToolbar for plain text files", () => {
    render(<EnhancedViewer content="hello" path="/test.txt" filePath="/test.txt" />);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("defaults to visual view for JSON", () => {
    render(<EnhancedViewer content='{"a":1}' path="/test.json" filePath="/test.json" />);
    expect(screen.getByText(/1 key/)).toBeInTheDocument();
  });

  it("toggles to source view", async () => {
    render(<EnhancedViewer content='{"a":1}' path="/test.json" filePath="/test.json" />);
    fireEvent.click(screen.getByRole("button", { name: /source/i }));
    await waitFor(() => {
      expect(screen.queryByText(/1 key/)).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Implement EnhancedViewer**

Create `src/components/viewers/EnhancedViewer.tsx` with:
- `getFileCategory` / `hasVisualization` / `getDefaultView` for file detection
- `ViewerToolbar` (hidden when no visualization)
- View mode from store (`viewModeByTab`) with fallback to default
- Source mode → `SourceView`
- Visual mode → dispatch to appropriate sub-view based on category
- Lazy load `MermaidView`, `CsvTableView`, `KqlPlanView` via `React.lazy` + `Suspense`

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/components/viewers/__tests__/EnhancedViewer.test.tsx`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/viewers/EnhancedViewer.tsx src/components/viewers/__tests__/EnhancedViewer.test.tsx
git commit -m "feat: add EnhancedViewer unified wrapper with source/visual toggle"
```

---

### Task 15: Update ViewerRouter and App Integration

**Files:**
- Modify: `src/components/viewers/ViewerRouter.tsx`
- Modify: `src/components/comments/CommentsPanel.tsx`
- Modify: `src/App.tsx`
- Update: `src/components/viewers/__tests__/ViewerRouter.test.tsx`

- [ ] **Step 1: Update ViewerRouter**

Replace `ViewerRouter` to route through:
- `"loading"` → `SkeletonLoader`
- `"image"` → `ImageViewer`
- `"binary"` / `"too_large"` → `BinaryPlaceholder`
- `"error"` → error display
- `"ready"` → `EnhancedViewer` (replaces direct MarkdownViewer/SourceViewer)

Remove imports of `MarkdownViewer` and `SourceViewer` — they're now accessed through `EnhancedViewer`.
Remove `MD_EXTENSIONS` constant — file type detection is in `file-types.ts`.

- [ ] **Step 2: Update CommentsPanel for dual anchor types**

In `src/components/comments/CommentsPanel.tsx`:
- Group displayed comments into block vs line sections
- When both types exist, show section headers "Block Comments" and "Line Comments"
- For line comments, the `onClick` calls `onScrollToLine?.(comment.lineNumber)` (new optional prop)
- Add `onScrollToLine?: (lineNumber: number) => void` to Props

- [ ] **Step 3: Hide CommentsPanel for image files**

In `src/App.tsx`, around line 386, add image detection:
```typescript
import { getFileCategory } from "@/lib/file-types";
// ...
{commentsPaneVisible && activeTabPath && getFileCategory(activeTabPath) !== "image" && (
  <ErrorBoundary>
    <CommentsPanel filePath={activeTabPath} />
  </ErrorBoundary>
)}
```

- [ ] **Step 4: Update existing ViewerRouter tests**

Update `src/components/viewers/__tests__/ViewerRouter.test.tsx` to account for routing through `EnhancedViewer` and `ImageViewer`. Mock `EnhancedViewer` and `ImageViewer` as simple stubs.

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/viewers/ViewerRouter.tsx src/components/comments/CommentsPanel.tsx src/App.tsx src/components/viewers/__tests__/ViewerRouter.test.tsx
git commit -m "feat: integrate EnhancedViewer into ViewerRouter and hide comments for images"
```

---

### Task 16: KQL TextMate Grammar for Shiki

**Files:**
- Create: `src/lib/kql.tmLanguage.json`
- Modify: `src/components/viewers/SourceView.tsx`

- [ ] **Step 1: Create KQL TextMate grammar**

Create `src/lib/kql.tmLanguage.json` with TextMate scopes for:
- `keyword.control.kql` — operators (`where`, `summarize`, `project`, `extend`, `join`, `union`, `top`, `sort`, `order`, `take`, `limit`, `count`, `distinct`, `render`, `let`, `mv-expand`, `parse`)
- `support.function.kql` — built-in functions (`count()`, `sum()`, `avg()`, `min()`, `max()`, `dcount()`, `percentile()`, `ago()`, `now()`, `bin()`, etc.)
- `storage.type.kql` — types (`string`, `int`, `long`, `real`, `datetime`, `timespan`, `dynamic`, `bool`)
- `keyword.operator.kql` — `==`, `!=`, `has`, `contains`, `startswith`, `endswith`, `in`, `!in`, `and`, `or`, `not`
- `comment.line.double-slash.kql` — `//` comments
- `comment.block.kql` — `/* */` comments
- `string.quoted.double.kql` / `string.quoted.single.kql`
- `punctuation.separator.pipe.kql` — `|`
- `constant.numeric.kql` — numbers and timespan literals

- [ ] **Step 2: Register grammar in SourceView**

In `src/components/viewers/SourceView.tsx`, add `kql` and `csl` to the `langFromPath` map:
```typescript
kql: "kql",
csl: "kql",
```

Register the custom grammar in `getHighlighter()`:
```typescript
import kqlGrammar from "@/lib/kql.tmLanguage.json";
// After creating highlighter instance:
await highlighterInstance.loadLanguage({
  name: "kql",
  scopeName: "source.kql",
  ...kqlGrammar,
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/kql.tmLanguage.json src/components/viewers/SourceView.tsx
git commit -m "feat: add KQL TextMate grammar for syntax highlighting"
```

---

## Phase 5: E2E Tests and Final Validation

### Task 17: E2E Test Coverage

**Files:**
- Create: `e2e/file-viewer.spec.ts`
- Create: `e2e/fixtures/sample.json`
- Create: `e2e/fixtures/sample.csv`
- Create: `e2e/fixtures/sample.kql`
- Create: `e2e/fixtures/sample.html` (rename to avoid collision if one exists)

- [ ] **Step 1: Create test fixture files**

Create minimal fixture files for JSON, CSV, KQL, and HTML in `e2e/fixtures/`.

- [ ] **Step 2: Write E2E tests**

Create `e2e/file-viewer.spec.ts` testing:
- JSON file opens in visual mode with tree view, toggle to source works
- CSV file opens in visual mode with sortable table
- HTML file opens in source mode, toggle shows sandboxed preview
- Image file opens with image viewer, no comments panel visible
- Source/Visual toggle state persists per tab

Import `{ test, expect }` from `./fixtures` (not `@playwright/test`).
Use `page.addInitScript` to set up `__TAURI_IPC_MOCK__` per test.

- [ ] **Step 3: Run E2E tests**

Run: `npm run test:e2e`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add e2e/file-viewer.spec.ts e2e/fixtures/sample.json e2e/fixtures/sample.csv e2e/fixtures/sample.kql e2e/fixtures/sample.html
git commit -m "test: add E2E tests for enhanced file viewer"
```

---

### Task 18: Final Validation

- [ ] **Step 1: Run cargo test**

Run: `cd src-tauri && cargo test`
Expected: All PASS

- [ ] **Step 2: Run npm test**

Run: `npm test`
Expected: All PASS

- [ ] **Step 3: Run E2E tests**

Run: `npm run test:e2e`
Expected: All PASS

- [ ] **Step 4: Run lint**

Run: `npx eslint src/`
Expected: No errors

- [ ] **Step 5: Run build**

Run: `npm run build`
Expected: Build succeeds