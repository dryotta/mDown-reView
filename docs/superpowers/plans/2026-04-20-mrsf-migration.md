# MRSF Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate mdownreview from custom v3 sidecar format to MRSF v1.0 so that VS Code Sidemark and mdownreview are fully interchangeable on the same `.review.yaml` files.

**Architecture:** Big-bang migration — replace all v3 types, serde, and logic with MRSF-compliant equivalents. Write `.review.yaml` (YAML primary), read both `.review.yaml` and `.review.json`. Flat `reply_to` threading. MRSF 4-step re-anchoring. Python skills switch to `pip install mrsf`.

**Tech Stack:** Rust (serde_yaml, sha2), TypeScript/React (Zustand), Python (mrsf library), Vitest, Cargo test

**Spec:** `docs/superpowers/specs/2026-04-20-mrsf-migration-design.md`

---

### Task 1: Rust types and YAML read/write

Replace all v3 Rust types with MRSF-compliant structs, add YAML serde, and update save/load commands.

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/commands.rs`
- Test: `src-tauri/tests/commands_integration.rs`

- [ ] **Step 1: Add serde_yaml and sha2 dependencies**

In `src-tauri/Cargo.toml`, add to `[dependencies]`:

```toml
serde_yaml = "0.9"
sha2 = "0.10"
```

- [ ] **Step 2: Replace Rust types in commands.rs**

Replace lines 6-92 of `src-tauri/src/commands.rs` (everything from `// ── Types` through `LegacyReviewComments`) with:

```rust
// ── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LaunchArgs {
    pub files: Vec<String>,
    pub folders: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MrsfComment {
    pub id: String,
    pub author: String,
    pub timestamp: String,
    pub text: String,
    pub resolved: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_column: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_column: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchored_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_text_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub comment_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub severity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MrsfSidecar {
    pub mrsf_version: String,
    pub document: String,
    pub comments: Vec<MrsfComment>,
}
```

Remove `default_anchor_type()` and `default_author()` functions (lines 74-80).

- [ ] **Step 3: Update save_review_comments to write YAML**

Replace the `save_review_comments` command (lines 194-227) with:

```rust
/// Save review comments as MRSF YAML sidecar (atomic via temp + rename).
#[tauri::command]
pub fn save_review_comments(file_path: String, document: String, comments: Vec<MrsfComment>) -> Result<(), String> {
    let sidecar_path = std::path::PathBuf::from(format!("{}.review.yaml", file_path));
    let payload = MrsfSidecar {
        mrsf_version: "1.0".to_string(),
        document,
        comments,
    };
    let yaml = serde_yaml::to_string(&payload).map_err(|e| {
        tracing::error!("[rust] command error: {}", e);
        e.to_string()
    })?;

    // Write to temp file in same directory, then rename for atomicity
    let dir = sidecar_path.parent().unwrap_or(std::path::Path::new("."));
    let tmp_path = dir.join(format!(
        ".review-{}.tmp",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    std::fs::write(&tmp_path, &yaml).map_err(|e| {
        tracing::error!("[rust] command error: {}", e);
        e.to_string()
    })?;
    std::fs::rename(&tmp_path, &sidecar_path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        tracing::error!("[rust] command error: {}", e);
        e.to_string()
    })?;
    Ok(())
}
```

- [ ] **Step 4: Update load_review_comments to read YAML-first with JSON fallback**

Replace the `load_review_comments` command (lines 229-250) with:

```rust
/// Load review comments sidecar; tries .review.yaml first, then .review.json.
#[tauri::command]
pub fn load_review_comments(file_path: String) -> Result<Option<MrsfSidecar>, String> {
    let yaml_path = format!("{}.review.yaml", file_path);
    let json_path = format!("{}.review.json", file_path);

    // Try YAML first
    match std::fs::read_to_string(&yaml_path) {
        Ok(content) => {
            let sidecar: MrsfSidecar = serde_yaml::from_str(&content).map_err(|e| {
                tracing::error!("[rust] YAML parse error: {}", e);
                e.to_string()
            })?;
            return Ok(Some(sidecar));
        }
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            tracing::error!("[rust] command error: {}", e);
            return Err(e.to_string());
        }
        _ => {} // Not found, try JSON
    }

    // Try JSON fallback
    match std::fs::read_to_string(&json_path) {
        Ok(content) => {
            let sidecar: MrsfSidecar = serde_json::from_str(&content).map_err(|e| {
                tracing::error!("[rust] JSON parse error: {}", e);
                e.to_string()
            })?;
            Ok(Some(sidecar))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => {
            tracing::error!("[rust] command error: {}", e);
            Err(e.to_string())
        }
    }
}
```

- [ ] **Step 5: Update read_dir to hide both .review.yaml and .review.json**

In `read_dir` (line 132), replace:
```rust
if name.ends_with(".review.json") {
```
with:
```rust
if name.ends_with(".review.yaml") || name.ends_with(".review.json") {
```

- [ ] **Step 6: Update scan_review_files to find both suffixes**

Replace the `scan_review_files` command (lines 269-297) with:

```rust
/// Scan a directory tree for MRSF sidecar files (.review.yaml and .review.json).
/// Returns pairs of (sidecar_path, source_file_path).
#[tauri::command]
pub fn scan_review_files(root: String) -> Result<Vec<(String, String)>, String> {
    let mut results = Vec::new();
    let walker = walkdir::WalkDir::new(&root)
        .max_depth(50)
        .into_iter()
        .filter_map(|e| e.ok());

    for entry in walker {
        let path = entry.path();
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            let (is_sidecar, suffix) = if name.ends_with(".review.yaml") {
                (true, ".review.yaml")
            } else if name.ends_with(".review.json") {
                (true, ".review.json")
            } else {
                (false, "")
            };
            if is_sidecar {
                let sidecar = path.to_string_lossy().to_string();
                let source = sidecar.trim_end_matches(suffix).to_string();
                results.push((sidecar, source));
            }
        }
        if results.len() >= 10_000 {
            tracing::warn!("[scan] capped at 10,000 review files");
            break;
        }
    }
    Ok(results)
}
```

- [ ] **Step 7: Add get_git_head command**

Add this new command after `scan_review_files`:

```rust
/// Get the current git HEAD SHA, if in a git repository.
#[tauri::command]
pub fn get_git_head(path: String) -> Result<Option<String>, String> {
    let output = std::process::Command::new("git")
        .arg("rev-parse")
        .arg("HEAD")
        .current_dir(&path)
        .output();
    match output {
        Ok(out) if out.status.success() => {
            let sha = String::from_utf8_lossy(&out.stdout).trim().to_string();
            Ok(if sha.is_empty() { None } else { Some(sha) })
        }
        _ => Ok(None),
    }
}
```

Register the new command in `src-tauri/src/lib.rs` by adding `commands::get_git_head` to the `invoke_handler` list.

- [ ] **Step 8: Write Rust integration tests**

Replace the contents of `src-tauri/tests/commands_integration.rs` with tests for the new MRSF types:

```rust
use mdown_review_lib::commands::{MrsfComment, MrsfSidecar};

#[test]
fn mrsf_sidecar_yaml_roundtrip() {
    let sidecar = MrsfSidecar {
        mrsf_version: "1.0".to_string(),
        document: "docs/test.md".to_string(),
        comments: vec![MrsfComment {
            id: "abc-123".to_string(),
            author: "Test User (test)".to_string(),
            timestamp: "2026-04-20T12:00:00-07:00".to_string(),
            text: "Test comment".to_string(),
            resolved: false,
            line: Some(10),
            end_line: None,
            start_column: None,
            end_column: None,
            selected_text: Some("some text".to_string()),
            anchored_text: None,
            selected_text_hash: None,
            commit: None,
            comment_type: Some("suggestion".to_string()),
            severity: Some("high".to_string()),
            reply_to: None,
        }],
    };
    let yaml = serde_yaml::to_string(&sidecar).unwrap();
    let parsed: MrsfSidecar = serde_yaml::from_str(&yaml).unwrap();
    assert_eq!(parsed.mrsf_version, "1.0");
    assert_eq!(parsed.comments.len(), 1);
    assert_eq!(parsed.comments[0].line, Some(10));
    assert_eq!(parsed.comments[0].comment_type.as_deref(), Some("suggestion"));
}

#[test]
fn mrsf_sidecar_json_roundtrip() {
    let sidecar = MrsfSidecar {
        mrsf_version: "1.0".to_string(),
        document: "docs/test.md".to_string(),
        comments: vec![],
    };
    let json = serde_json::to_string_pretty(&sidecar).unwrap();
    let parsed: MrsfSidecar = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.mrsf_version, "1.0");
    assert_eq!(parsed.document, "docs/test.md");
}

#[test]
fn mrsf_comment_type_field_serializes_as_type() {
    let comment = MrsfComment {
        id: "c1".to_string(),
        author: "A".to_string(),
        timestamp: "2026-01-01T00:00:00Z".to_string(),
        text: "t".to_string(),
        resolved: false,
        line: None, end_line: None, start_column: None, end_column: None,
        selected_text: None, anchored_text: None, selected_text_hash: None,
        commit: None, comment_type: Some("issue".to_string()),
        severity: None, reply_to: None,
    };
    let yaml = serde_yaml::to_string(&comment).unwrap();
    assert!(yaml.contains("type: issue"), "should serialize as 'type' not 'comment_type'");
}

#[test]
fn mrsf_optional_fields_omitted_when_none() {
    let comment = MrsfComment {
        id: "c1".to_string(),
        author: "A".to_string(),
        timestamp: "2026-01-01T00:00:00Z".to_string(),
        text: "t".to_string(),
        resolved: false,
        line: None, end_line: None, start_column: None, end_column: None,
        selected_text: None, anchored_text: None, selected_text_hash: None,
        commit: None, comment_type: None, severity: None, reply_to: None,
    };
    let yaml = serde_yaml::to_string(&comment).unwrap();
    assert!(!yaml.contains("line:"), "None fields should be omitted");
    assert!(!yaml.contains("selected_text:"), "None fields should be omitted");
}
```

- [ ] **Step 9: Run Rust tests**

Run: `cd src-tauri && cargo test`
Expected: All tests pass.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: replace v3 Rust types with MRSF v1.0, YAML read/write

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: TypeScript types and Tauri command wrappers

Replace all v3 TypeScript types with MRSF equivalents and update command wrappers.

**Files:**
- Modify: `src/lib/tauri-commands.ts`

- [ ] **Step 1: Replace TypeScript types**

Replace lines 17-53 of `src/lib/tauri-commands.ts` (from `CommentResponse` through `ReviewComments`) with:

```typescript
export interface MrsfComment {
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

export interface MrsfSidecar {
  mrsf_version: string;
  document: string;
  comments: MrsfComment[];
}
```

- [ ] **Step 2: Update command wrappers**

Replace `saveReviewComments` and `loadReviewComments` wrappers (lines 72-79) with:

```typescript
export const saveReviewComments = (
  filePath: string,
  document: string,
  comments: MrsfComment[]
): Promise<void> =>
  invoke<void>("save_review_comments", { filePath, document, comments });

export const loadReviewComments = (filePath: string): Promise<MrsfSidecar | null> =>
  invoke<MrsfSidecar | null>("load_review_comments", { filePath });

export const getGitHead = (path: string): Promise<string | null> =>
  invoke<string | null>("get_git_head", { path });
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: replace v3 TS types with MRSF interfaces

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Store migration — flat threading, MRSF fields, author management

Rewrite the comments slice to use MRSF fields, flat `reply_to` threading, and author management.

**Files:**
- Modify: `src/store/index.ts`
- Test: `src/__tests__/store/comments.test.ts`

- [ ] **Step 1: Write failing tests for MRSF store**

Replace the contents of `src/__tests__/store/comments.test.ts` with:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store";

describe("Comments slice (MRSF)", () => {
  beforeEach(() => {
    useStore.setState({ commentsByFile: {}, authorName: "" });
  });

  it("addComment creates MrsfComment with MRSF fields", () => {
    const store = useStore.getState();
    store.setAuthorName("Test User (test)");
    store.addComment("file.md", { line: 10 }, "Hello");
    const comments = useStore.getState().commentsByFile["file.md"];
    expect(comments).toHaveLength(1);
    const c = comments[0];
    expect(c.id).toBeTruthy();
    expect(c.author).toBe("Test User (test)");
    expect(c.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(c.text).toBe("Hello");
    expect(c.resolved).toBe(false);
    expect(c.line).toBe(10);
    // v3 fields should NOT exist
    expect((c as any).anchorType).toBeUndefined();
    expect((c as any).lineHash).toBeUndefined();
    expect((c as any).createdAt).toBeUndefined();
  });

  it("addComment with selection fields", () => {
    const store = useStore.getState();
    store.setAuthorName("Reviewer (rev)");
    store.addComment("file.md", {
      line: 5, end_line: 7, start_column: 2, end_column: 15,
      selected_text: "some code", selected_text_hash: "abcdef1234",
    }, "Fix this");
    const c = useStore.getState().commentsByFile["file.md"][0];
    expect(c.line).toBe(5);
    expect(c.end_line).toBe(7);
    expect(c.start_column).toBe(2);
    expect(c.end_column).toBe(15);
    expect(c.selected_text).toBe("some code");
  });

  it("addReply creates a top-level comment with reply_to", () => {
    const store = useStore.getState();
    store.setAuthorName("User (u)");
    store.addComment("file.md", { line: 1 }, "Root");
    const rootId = useStore.getState().commentsByFile["file.md"][0].id;
    store.addReply("file.md", rootId, "Reply text");
    const comments = useStore.getState().commentsByFile["file.md"];
    expect(comments).toHaveLength(2);
    const reply = comments[1];
    expect(reply.reply_to).toBe(rootId);
    expect(reply.text).toBe("Reply text");
    expect(reply.author).toBe("User (u)");
  });

  it("resolveComment sets resolved to true", () => {
    const store = useStore.getState();
    store.setAuthorName("U (u)");
    store.addComment("f.md", { line: 1 }, "Test");
    const id = useStore.getState().commentsByFile["f.md"][0].id;
    store.resolveComment(id);
    expect(useStore.getState().commentsByFile["f.md"][0].resolved).toBe(true);
  });

  it("deleteComment removes comment", () => {
    const store = useStore.getState();
    store.setAuthorName("U (u)");
    store.addComment("f.md", { line: 1 }, "Test");
    const id = useStore.getState().commentsByFile["f.md"][0].id;
    store.deleteComment(id);
    expect(useStore.getState().commentsByFile["f.md"]).toHaveLength(0);
  });

  it("setAuthorName persists", () => {
    const store = useStore.getState();
    store.setAuthorName("Alice (alice)");
    expect(useStore.getState().authorName).toBe("Alice (alice)");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/store/comments.test.ts`
Expected: FAIL (addReply, setAuthorName don't exist yet)

- [ ] **Step 3: Update store types and implementation**

In `src/store/index.ts`:

1. Replace the import (line 4):
```typescript
import type { MrsfComment } from "@/lib/tauri-commands";
```

2. Replace `CommentWithOrphan` (lines 38-41):
```typescript
export interface CommentWithOrphan extends MrsfComment {
  isOrphaned?: boolean;
  matchedLineNumber?: number;
}
```

3. Replace `CommentsSlice` (lines 43-52):
```typescript
interface CommentsSlice {
  commentsByFile: Record<string, CommentWithOrphan[]>;
  authorName: string;
  setAuthorName: (name: string) => void;
  setFileComments: (filePath: string, comments: CommentWithOrphan[]) => void;
  addComment: (filePath: string, anchor: Partial<Pick<MrsfComment, "line" | "end_line" | "start_column" | "end_column" | "selected_text" | "selected_text_hash" | "commit" | "type" | "severity">>, text: string) => void;
  addReply: (filePath: string, parentId: string, text: string) => void;
  editComment: (id: string, text: string) => void;
  deleteComment: (id: string) => void;
  resolveComment: (id: string) => void;
  unresolveComment: (id: string) => void;
}
```

4. Replace the comments implementation (lines 161-235):
```typescript
      // Comments
      commentsByFile: {},
      authorName: "",
      setAuthorName: (name) => set({ authorName: name }),
      setFileComments: (filePath, comments) =>
        set((s) => ({ commentsByFile: { ...s.commentsByFile, [filePath]: comments } })),
      addComment: (filePath, anchor, text) => {
        const state = get();
        const comment: CommentWithOrphan = {
          id: generateId(),
          author: state.authorName || "Anonymous",
          timestamp: new Date().toISOString(),
          text,
          resolved: false,
          ...anchor,
        };
        set((s) => ({
          commentsByFile: {
            ...s.commentsByFile,
            [filePath]: [...(s.commentsByFile[filePath] ?? []), comment],
          },
        }));
      },
      addReply: (filePath, parentId, text) => {
        const state = get();
        const parent = Object.values(state.commentsByFile)
          .flat()
          .find((c) => c.id === parentId);
        const reply: CommentWithOrphan = {
          id: generateId(),
          author: state.authorName || "Anonymous",
          timestamp: new Date().toISOString(),
          text,
          resolved: false,
          reply_to: parentId,
          line: parent?.line,
        };
        set((s) => ({
          commentsByFile: {
            ...s.commentsByFile,
            [filePath]: [...(s.commentsByFile[filePath] ?? []), reply],
          },
        }));
      },
```

Keep `editComment`, `deleteComment`, `resolveComment`, `unresolveComment` unchanged. Remove `addResponse` entirely.

5. Add `authorName` to the `persist` partialize list so it's saved across sessions.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/store/comments.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: MRSF store with flat reply_to threading and author management

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Re-anchoring — MRSF 4-step algorithm

Rewrite `comment-anchors.ts` and `comment-matching.ts` with the MRSF re-anchoring algorithm.

**Files:**
- Modify: `src/lib/comment-anchors.ts`
- Modify: `src/lib/comment-matching.ts`
- Test: `src/lib/__tests__/comment-matching.test.ts`

- [ ] **Step 1: Write failing tests for MRSF matching**

Replace the contents of `src/lib/__tests__/comment-matching.test.ts` with:

```typescript
import { describe, it, expect } from "vitest";
import { matchComments } from "@/lib/comment-matching";
import type { MrsfComment } from "@/lib/tauri-commands";

function makeComment(overrides: Partial<MrsfComment>): MrsfComment {
  return {
    id: "c1", author: "Test (t)", timestamp: "2026-01-01T00:00:00Z",
    text: "test", resolved: false, ...overrides,
  };
}

describe("matchComments (MRSF 4-step)", () => {
  const lines = ["line one", "target text here", "line three", "line four", "line five"];

  it("Step 1: exact selected_text match at original line", () => {
    const c = makeComment({ line: 2, selected_text: "target text here" });
    const [matched] = matchComments([c], lines);
    expect(matched.isOrphaned).toBe(false);
    expect(matched.matchedLineNumber).toBe(2);
  });

  it("Step 1: selected_text found at different line → relocate", () => {
    const c = makeComment({ line: 5, selected_text: "target text here" });
    const [matched] = matchComments([c], lines);
    expect(matched.isOrphaned).toBe(false);
    expect(matched.matchedLineNumber).toBe(2);
  });

  it("Step 2: no selected_text, line still exists → fallback", () => {
    const c = makeComment({ line: 3 });
    const [matched] = matchComments([c], lines);
    expect(matched.isOrphaned).toBe(false);
    expect(matched.matchedLineNumber).toBe(3);
  });

  it("Step 2: line beyond document → orphan", () => {
    const c = makeComment({ line: 100 });
    const [matched] = matchComments([c], lines);
    expect(matched.isOrphaned).toBe(true);
  });

  it("Step 3: fuzzy match — slightly changed text", () => {
    const c = makeComment({ line: 2, selected_text: "target text Here" }); // case diff
    const [matched] = matchComments([c], lines);
    // Should fuzzy-match to line 2
    expect(matched.isOrphaned).toBe(false);
    expect(matched.matchedLineNumber).toBe(2);
  });

  it("Step 4: text completely gone → orphan", () => {
    const c = makeComment({ line: 2, selected_text: "totally nonexistent text" });
    const [matched] = matchComments([c], lines);
    expect(matched.isOrphaned).toBe(true);
  });

  it("no line, no selected_text → orphan", () => {
    const c = makeComment({});
    const [matched] = matchComments([c], lines);
    expect(matched.isOrphaned).toBe(true);
  });

  it("empty file → all orphaned", () => {
    const c = makeComment({ line: 1, selected_text: "anything" });
    const [matched] = matchComments([c], []);
    expect(matched.isOrphaned).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/comment-matching.test.ts`
Expected: FAIL

- [ ] **Step 3: Rewrite comment-anchors.ts**

Replace the entire contents of `src/lib/comment-anchors.ts`:

```typescript
/// MRSF anchor creation helpers.

export async function computeSelectedTextHash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function createLineAnchor(lineNumber: number): { line: number } {
  return { line: lineNumber };
}

export function createSelectionAnchor(
  startLine: number,
  endLine: number,
  startColumn: number,
  endColumn: number,
  selectedText: string,
  selectedTextHash: string
): {
  line: number;
  end_line: number;
  start_column: number;
  end_column: number;
  selected_text: string;
  selected_text_hash: string;
} {
  return {
    line: startLine,
    end_line: endLine,
    start_column: startColumn,
    end_column: endColumn,
    selected_text: selectedText,
    selected_text_hash: selectedTextHash,
  };
}
```

- [ ] **Step 4: Rewrite comment-matching.ts**

Replace the entire contents of `src/lib/comment-matching.ts`:

```typescript
import type { MrsfComment } from "@/lib/tauri-commands";
import type { CommentWithOrphan } from "@/store";

export type MatchedComment = CommentWithOrphan;

const FUZZY_THRESHOLD = 0.6;

export function matchComments(
  comments: MrsfComment[],
  fileLines: string[]
): MatchedComment[] {
  const lineCount = fileLines.length;

  return comments.map((comment) => {
    if (lineCount === 0) {
      return { ...comment, matchedLineNumber: 1, isOrphaned: true };
    }

    const origLine = comment.line;
    const selectedText = comment.selected_text;

    // Step 1: Exact selected_text match
    if (selectedText) {
      // Try exact match at original line first
      if (origLine && origLine >= 1 && origLine <= lineCount) {
        if (fileLines[origLine - 1].includes(selectedText)) {
          return { ...comment, matchedLineNumber: origLine, isOrphaned: false };
        }
      }
      // Search entire document for exact match
      for (let i = 0; i < lineCount; i++) {
        if (fileLines[i].includes(selectedText)) {
          const newLine = i + 1;
          return { ...comment, matchedLineNumber: newLine, line: newLine, isOrphaned: false };
        }
      }
    }

    // Step 2: Line/column fallback (no selected_text or not found)
    if (origLine && origLine >= 1 && origLine <= lineCount) {
      // If we had selected_text but couldn't find it, try fuzzy before falling back
      if (selectedText) {
        // Step 3: Fuzzy match
        const fuzzyResult = findFuzzyMatch(fileLines, selectedText, origLine);
        if (fuzzyResult) {
          return {
            ...comment,
            matchedLineNumber: fuzzyResult.line,
            line: fuzzyResult.line,
            anchored_text: fuzzyResult.anchoredText,
            isOrphaned: false,
          };
        }
      }
      // Pure line fallback
      return { ...comment, matchedLineNumber: origLine, isOrphaned: false };
    }

    // Step 3: Fuzzy match (when no valid line)
    if (selectedText) {
      const fuzzyResult = findFuzzyMatch(fileLines, selectedText, origLine ?? 1);
      if (fuzzyResult) {
        return {
          ...comment,
          matchedLineNumber: fuzzyResult.line,
          line: fuzzyResult.line,
          anchored_text: fuzzyResult.anchoredText,
          isOrphaned: false,
        };
      }
    }

    // Step 4: Orphan
    const fallbackLine = origLine ? Math.min(origLine, lineCount) : 1;
    return { ...comment, matchedLineNumber: fallbackLine, isOrphaned: true };
  });
}

function findFuzzyMatch(
  fileLines: string[],
  selectedText: string,
  centerLine: number
): { line: number; anchoredText: string } | null {
  let bestLine: number | null = null;
  let bestScore = 0;
  let bestText = "";

  for (let i = 0; i < fileLines.length; i++) {
    const score = fuzzyScore(selectedText, fileLines[i]);
    if (score >= FUZZY_THRESHOLD && score > bestScore) {
      bestScore = score;
      bestLine = i + 1;
      bestText = fileLines[i];
    } else if (score >= FUZZY_THRESHOLD && score === bestScore && bestLine !== null) {
      // Prefer closer to original line
      const newDist = Math.abs(i - (centerLine - 1));
      const oldDist = Math.abs((bestLine - 1) - (centerLine - 1));
      if (newDist < oldDist) {
        bestLine = i + 1;
        bestText = fileLines[i];
      }
    }
  }

  return bestLine !== null ? { line: bestLine, anchoredText: bestText } : null;
}

function fuzzyScore(a: string, b: string): number {
  const al = a.toLowerCase().trim();
  const bl = b.toLowerCase().trim();
  if (al === bl) return 1.0;
  if (bl.includes(al) || al.includes(bl)) return 0.9;

  // Levenshtein-based similarity
  const maxLen = Math.max(al.length, bl.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshtein(al, bl);
  return 1 - dist / maxLen;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/lib/__tests__/comment-matching.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: MRSF 4-step re-anchoring algorithm

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Watcher — support both sidecar suffixes

Update the Rust watcher to detect both `.review.yaml` and `.review.json`.

**Files:**
- Modify: `src-tauri/src/watcher.rs`

- [ ] **Step 1: Update sidecar detection in watcher event handler**

In `src-tauri/src/watcher.rs`, replace line 74:
```rust
let is_review = path_str.ends_with(".review.json");
```
with:
```rust
let is_review = path_str.ends_with(".review.yaml") || path_str.ends_with(".review.json");
```

- [ ] **Step 2: Update watched sidecar path construction**

Replace line 160:
```rust
let sidecar = PathBuf::from(format!("{}.review.json", path_str));
```
with:
```rust
// Watch both YAML (primary) and JSON (fallback) sidecars
let sidecar_yaml = PathBuf::from(format!("{}.review.yaml", path_str));
if let Ok(canonical) = std::fs::canonicalize(&sidecar_yaml) {
    watched.insert(canonical);
} else {
    watched.insert(sidecar_yaml);
}
let sidecar_json = PathBuf::from(format!("{}.review.json", path_str));
```

And adjust the remaining lines 161-164 to use `sidecar_json` instead of `sidecar`.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: watcher detects both .review.yaml and .review.json

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: UI — CommentThread with flat reply_to and type/severity badges

Rewrite CommentThread to render MRSF flat threading with type/severity badges.

**Files:**
- Modify: `src/components/comments/CommentThread.tsx`
- Modify: `src/styles/comments.css`
- Test: `src/components/comments/__tests__/CommentThread.test.tsx`

- [ ] **Step 1: Write failing tests**

Replace the contents of `src/components/comments/__tests__/CommentThread.test.tsx` with tests that verify:
- Author name rendered (not "human"/"agent")
- Type badge rendered when present
- Severity badge rendered when present
- Reply action calls `addReply` (not `addResponse`)
- Orphan banner shown when `isOrphaned`
- No `responses[]` rendering (flat model)

- [ ] **Step 2: Rewrite CommentThread.tsx**

Replace `src/components/comments/CommentThread.tsx` with a new implementation that:
- Takes `comment: CommentWithOrphan` prop
- Renders `comment.author` as the badge text
- Shows `comment.type` as a color-coded badge (suggestion=blue, issue=red, question=yellow, accuracy=orange, style=purple, clarity=green)
- Shows `comment.severity` as a pill badge (high=red, medium=orange, low=gray)
- Renders `comment.timestamp` formatted as locale date
- Reply action calls `useStore().addReply(filePath, comment.id, text)` — needs `filePath` prop
- Removes all `comment.responses` rendering
- Keeps: orphan banner, edit/delete/resolve actions

The component now needs `filePath` as a prop (for `addReply`).

- [ ] **Step 3: Add type/severity badge CSS to comments.css**

Add to `src/styles/comments.css`:

```css
/* Type badges */
.comment-type-badge { font-size: 0.7em; padding: 1px 6px; border-radius: 3px; font-weight: 600; }
.comment-type-badge--suggestion { background: #dbeafe; color: #1d4ed8; }
.comment-type-badge--issue { background: #fee2e2; color: #dc2626; }
.comment-type-badge--question { background: #fef9c3; color: #a16207; }
.comment-type-badge--accuracy { background: #ffedd5; color: #c2410c; }
.comment-type-badge--style { background: #f3e8ff; color: #7c3aed; }
.comment-type-badge--clarity { background: #dcfce7; color: #16a34a; }

/* Severity badges */
.comment-severity-badge { font-size: 0.65em; padding: 1px 5px; border-radius: 8px; font-weight: 600; }
.comment-severity-badge--high { background: #dc2626; color: white; }
.comment-severity-badge--medium { background: #ea580c; color: white; }
.comment-severity-badge--low { background: #9ca3af; color: white; }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components/comments/__tests__/CommentThread.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: CommentThread with MRSF reply_to threading, type/severity badges

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: UI — CommentsPanel thread grouping

Update CommentsPanel to group flat comments into threads by `reply_to`.

**Files:**
- Modify: `src/components/comments/CommentsPanel.tsx`
- Test: `src/components/comments/__tests__/CommentsPanel.test.tsx`

- [ ] **Step 1: Rewrite CommentsPanel.tsx**

Group comments into threads:
- Root comments: those without `reply_to`
- Replies: those with `reply_to` matching a root's `id`
- Sort threads by root's `line` number
- Render each thread as: root CommentThread + replies below it
- Update `handleClick` to use `comment.line` instead of `comment.lineNumber`
- Pass `filePath` to `CommentThread`

- [ ] **Step 2: Update CommentsPanel tests**

Update `src/components/comments/__tests__/CommentsPanel.test.tsx` to use MRSF fields (`line` instead of `lineNumber`, `timestamp` instead of `createdAt`, no `anchorType`).

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/components/comments/__tests__/CommentsPanel.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: CommentsPanel groups flat comments into reply_to threads

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: UI — LineCommentMargin with MRSF anchors and type/severity

Update comment creation flow with MRSF anchor fields and type/severity selection.

**Files:**
- Modify: `src/components/comments/LineCommentMargin.tsx`

- [ ] **Step 1: Rewrite LineCommentMargin.tsx**

Replace imports — remove `computeLineHash, captureContext` from `comment-anchors`. The default `handleSave` should:

```typescript
const handleSave = (text: string) => {
  if (onSaveComment) {
    onSaveComment(text);
  } else {
    addComment(filePath, { line: lineNumber }, text);
  }
  onCloseInput?.();
  setExpanded(true);
};
```

Remove all `anchorType`, `lineHash`, `contextBefore`, `contextAfter` references. Pass `filePath` to `CommentThread`.

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat: LineCommentMargin uses MRSF line anchors

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 9: Viewers — SourceView and MarkdownViewer MRSF integration

Update both viewers to use `.review.yaml` paths, MRSF types, and the new save/load signatures.

**Files:**
- Modify: `src/components/viewers/SourceView.tsx`
- Modify: `src/components/viewers/MarkdownViewer.tsx`
- Modify: `src/components/viewers/DeletedFileViewer.tsx`

- [ ] **Step 1: Update SourceView.tsx**

1. Replace sidecar path references: `${filePath}.review.json` → `${filePath}.review.yaml` (and also check `.review.json` for events)
2. Update `loadReviewComments` call — it now returns `MrsfSidecar | null`, access `.comments`
3. Update `saveReviewComments` call — add `document` parameter (relative path)
4. Update comment creation to use MRSF selection anchor fields:
   - Replace `anchorType: "selection"` with MRSF fields
   - Replace `lineHash`, `contextBefore/After` with `selected_text`, `selected_text_hash`, `start_column`, `end_column`, `end_line`
   - Use `computeSelectedTextHash()` from new `comment-anchors.ts`
5. Update `addComment` calls to pass `filePath` to `CommentThread`

- [ ] **Step 2: Update MarkdownViewer.tsx**

Same changes as SourceView.tsx:
1. Sidecar path → `.review.yaml`
2. `loadReviewComments` → access `.comments` from `MrsfSidecar`
3. `saveReviewComments` → add `document` parameter
4. Selection anchor → MRSF fields
5. Pass `filePath` to `CommentThread`

- [ ] **Step 3: Update DeletedFileViewer.tsx**

Update `loadReviewComments` handling — it now returns `MrsfSidecar | null`, access `.comments`.

- [ ] **Step 4: Run full TS test suite**

Run: `npx vitest run`
Expected: All tests pass (may need to fix remaining test files that use old field names)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: viewers use MRSF .review.yaml paths and types

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 10: useFileWatcher — both sidecar suffixes

Update the file watcher hook to detect both sidecar suffixes.

**Files:**
- Modify: `src/hooks/useFileWatcher.ts`
- Test: `src/hooks/__tests__/useFileWatcher.test.ts`

- [ ] **Step 1: Update useFileWatcher.ts**

If any code checks for `.review.json` in event paths, update to also check `.review.yaml`. The `scanReviewFiles` output already handles both suffixes (from Task 1).

- [ ] **Step 2: Update watcher tests**

Update `src/hooks/__tests__/useFileWatcher.test.ts` to verify both `.review.yaml` and `.review.json` events are handled.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: useFileWatcher handles both MRSF sidecar suffixes

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 11: Python skills — switch to mrsf library

Migrate `mdownreview.py` to use the official MRSF Python library.

**Files:**
- Modify: `../mdownreview-skills/skills/mdownreview.py`
- Modify: `../mdownreview-skills/skills/test_mdownreview.py`

- [ ] **Step 1: Rewrite mdownreview.py**

Replace the file discovery, load, and save helpers to use the `mrsf` library. Add auto-install:

```python
try:
    import mrsf
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", "mrsf"])
    import mrsf
```

Update:
- `find_review_files()` → look for `.review.yaml` AND `.review.json`
- `load_review()` → use `mrsf.parse_sidecar()` (or keep manual YAML/JSON load)
- `save_review()` → write YAML using `mrsf` library or `yaml.dump()`
- `source_file_for()` → strip `.review.yaml` or `.review.json`
- `cmd_respond()` → create a new top-level comment with `reply_to` instead of appending to `responses[]`
- `iso_now()` → include timezone offset (RFC 3339)
- Update help text references from `.review.json` to MRSF sidecar files
- `cmd_read()` → use `comment.get("line", "?")` instead of `comment.get("lineNumber", "?")`

- [ ] **Step 2: Rewrite test_mdownreview.py**

Update all test fixtures to use MRSF schema (YAML format, `mrsf_version`, `document`, `timestamp`, `line`, `reply_to`).

- [ ] **Step 3: Run Python tests**

Run: `cd ../mdownreview-skills && python -m pytest skills/test_mdownreview.py -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd ../mdownreview-skills && git add -A && git commit -m "feat: switch to MRSF format and mrsf Python library

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 12: MRSF reference fixtures and interop tests

Add MRSF example sidecars as test fixtures and validate round-trip compliance.

**Files:**
- Create: `src/__tests__/fixtures/mrsf/architecture.md.review.yaml`
- Create: `src/__tests__/fixtures/mrsf/contributing.md.review.yaml`
- Create: `src/__tests__/fixtures/mrsf/mrsf.schema.json`
- Test: `src/lib/__tests__/mrsf-roundtrip.test.ts`

- [ ] **Step 1: Copy MRSF reference fixtures**

Download and save to `src/__tests__/fixtures/mrsf/`:
1. `architecture.md.review.yaml` from `https://github.com/wictorwilen/MRSF/blob/main/examples/architecture.md.review.yaml`
2. `contributing.md.review.yaml` from `https://github.com/wictorwilen/MRSF/blob/main/examples/contributing.md.review.yaml`
3. `mrsf.schema.json` from `https://github.com/wictorwilen/MRSF/blob/main/mrsf.schema.json`

- [ ] **Step 2: Write round-trip interop tests**

Create `src/lib/__tests__/mrsf-roundtrip.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import type { MrsfSidecar } from "@/lib/tauri-commands";

const fixturesDir = join(__dirname, "../__tests__/fixtures/mrsf");

describe("MRSF round-trip", () => {
  it("parses architecture.md.review.yaml", () => {
    const raw = readFileSync(join(fixturesDir, "architecture.md.review.yaml"), "utf-8");
    const sidecar = yaml.load(raw) as MrsfSidecar;
    expect(sidecar.mrsf_version).toBe("1.0");
    expect(sidecar.document).toBe("examples/architecture.md");
    expect(sidecar.comments.length).toBeGreaterThan(0);
    expect(sidecar.comments[0].author).toContain("Wictor");
  });

  it("parses contributing.md.review.yaml with re-anchoring scenarios", () => {
    const raw = readFileSync(join(fixturesDir, "contributing.md.review.yaml"), "utf-8");
    const sidecar = yaml.load(raw) as MrsfSidecar;
    expect(sidecar.comments.length).toBe(5);
    // Comment B has selected_text that no longer exists
    const commentB = sidecar.comments.find((c) => c.id?.includes("0002"));
    expect(commentB?.selected_text).toContain("Tag the release");
  });

  it("round-trips YAML → object → YAML preserving required fields", () => {
    const raw = readFileSync(join(fixturesDir, "architecture.md.review.yaml"), "utf-8");
    const sidecar = yaml.load(raw) as MrsfSidecar;
    const rewritten = yaml.dump(sidecar, { quotingType: '"', forceQuotes: false });
    const reparsed = yaml.load(rewritten) as MrsfSidecar;
    expect(reparsed.mrsf_version).toBe(sidecar.mrsf_version);
    expect(reparsed.comments.length).toBe(sidecar.comments.length);
  });
});
```

Install `js-yaml` as dev dependency: `npm install -D js-yaml @types/js-yaml`

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/lib/__tests__/mrsf-roundtrip.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test: MRSF reference fixtures and round-trip interop tests

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 13: Documentation

Update AGENTS.md files with MRSF format documentation.

**Files:**
- Modify: `AGENTS.md`
- Modify: `../mdownreview2/AGENTS.md`

- [ ] **Step 1: Update mdownreview AGENTS.md**

Replace the v3 schema documentation section with MRSF v1.0:
- `.review.yaml` as primary format
- MRSF schema fields (id, author, timestamp, text, resolved, line, end_line, selected_text, etc.)
- Threading via `reply_to`
- Author convention: `"Display Name (identifier)"`
- Type/severity fields
- Link to https://sidemark.org/specification.html

- [ ] **Step 2: Update mdownreview2 AGENTS.md**

Replace the old block-comment schema section with a reference to MRSF v1.0.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "docs: update AGENTS.md with MRSF v1.0 format documentation

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 14: Full test pass and cleanup

Run all tests, fix any remaining issues, clean up dead code.

**Files:**
- Various

- [ ] **Step 1: Delete dead code**

Remove `src/lib/fnv1a.ts` (or its contents) if it exists and is only used by the old comment-anchors.

- [ ] **Step 2: Run full Rust test suite**

Run: `cd src-tauri && cargo test`
Expected: All pass

- [ ] **Step 3: Run full TypeScript test suite**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 4: Run Python tests**

Run: `cd ../mdownreview-skills && python -m pytest skills/test_mdownreview.py -v`
Expected: All pass

- [ ] **Step 5: Final commit**

```bash
git add -A && git commit -m "chore: clean up dead v3 code, all tests passing

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
