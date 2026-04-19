# Comment System Revision — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the comment system around line-based and selection-based anchoring with robust re-anchoring for AI agent workflows, consistent UX across views, and batch scripts for comment operations.

**Architecture:** Replace block-based comments with a unified line/selection model using `lineNumber + lineHash` compound anchoring plus `contextBefore/contextAfter` for robust re-anchoring. Add a multi-strategy matching cascade (6 levels), selection toolbar, response tracking, and Python/PowerShell scripts. Sidecar version bumps to 3.

**Tech Stack:** TypeScript, React 18, Zustand, Vitest + RTL, Playwright, Rust (Tauri v2), Python 3, PowerShell

**Spec:** `docs/superpowers/specs/2026-04-19-comment-system-revision-design.md`

---

## File Map

### New files
- `src/lib/comment-matching.ts` — Pure matching algorithm (6-strategy cascade)
- `src/lib/comment-anchors.ts` — Anchor creation: lineHash, context capture, selection offsets
- `src/lib/__tests__/comment-matching.test.ts` — 13 matching algorithm tests
- `src/lib/__tests__/comment-anchors.test.ts` — Anchor creation + context capture tests
- `src/components/comments/SelectionToolbar.tsx` — Floating "💬 Comment" toolbar on text select
- `src/components/comments/__tests__/SelectionToolbar.test.tsx` — SelectionToolbar tests
- `scripts/scan-comments.py` — Scan and display comments
- `scripts/scan-comments.ps1` — PowerShell version
- `scripts/respond-comments.py` — Add responses to comments
- `scripts/respond-comments.ps1` — PowerShell version
- `scripts/resolve-comments.py` — Resolve comments by ID/respondent/all
- `scripts/resolve-comments.ps1` — PowerShell version
- `scripts/clean-comments.py` — Delete resolved or all comments
- `scripts/clean-comments.ps1` — PowerShell version

### Modified files
- `src/lib/tauri-commands.ts` — Update `ReviewComment` interface for v3
- `src/lib/fnv1a.ts` — Add `normalizeLine()` export
- `src/store/index.ts` — Update CommentsSlice for v3 model + addResponse action
- `src/components/viewers/SourceView.tsx` — Use matching algorithm, selection support
- `src/components/viewers/MarkdownViewer.tsx` — Remove block wrappers, add line-based gutter
- `src/components/viewers/EnhancedViewer.tsx` — Pass content lines for matching, wire CommentsPanel scroll
- `src/components/comments/CommentsPanel.tsx` — Click-to-scroll with flash, sort by lineNumber, show responses
- `src/components/comments/CommentThread.tsx` — Display responses
- `src/components/comments/CommentInput.tsx` — Accept line anchor props
- `src/components/comments/LineCommentMargin.tsx` — Use matching algorithm
- `src/styles/comments.css` — Remove block styles, add selection highlight, toolbar, flash animation
- `src/styles/source-viewer.css` — Selection highlight overlay
- `src-tauri/src/commands.rs` — Update Rust ReviewComment struct for v3 fields
- `src-tauri/tests/commands_integration.rs` — v3 round-trip and migration tests

### Removed files
- `src/components/comments/CommentMargin.tsx` — Block-level gutter (replaced by unified line gutter)

---

## Task 1: Update Data Model & Interfaces

**Files:**
- Modify: `src/lib/tauri-commands.ts:17-33`
- Modify: `src/lib/fnv1a.ts`
- Create: `src/lib/comment-anchors.ts`
- Create: `src/lib/__tests__/comment-anchors.test.ts`

- [ ] **Step 1: Write tests for normalizeLine and context capture**

Create `src/lib/__tests__/comment-anchors.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { normalizeLine, computeLineHash, captureContext } from "@/lib/comment-anchors";

describe("normalizeLine", () => {
  it("trims whitespace", () => {
    expect(normalizeLine("  hello  ")).toBe("hello");
  });
  it("collapses internal whitespace", () => {
    expect(normalizeLine("hello   world  foo")).toBe("hello world foo");
  });
  it("preserves case", () => {
    expect(normalizeLine("Hello World")).toBe("Hello World");
  });
  it("handles empty string", () => {
    expect(normalizeLine("")).toBe("");
  });
  it("handles whitespace-only", () => {
    expect(normalizeLine("   ")).toBe("");
  });
});

describe("computeLineHash", () => {
  it("returns 8-char hex", () => {
    const hash = computeLineHash("hello world");
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });
  it("normalizes before hashing", () => {
    expect(computeLineHash("  hello   world  ")).toBe(computeLineHash("hello world"));
  });
  it("different text produces different hash", () => {
    expect(computeLineHash("hello")).not.toBe(computeLineHash("world"));
  });
});

describe("captureContext", () => {
  const lines = ["line0", "line1", "line2", "line3", "line4"];

  it("captures 2 lines before and after", () => {
    const ctx = captureContext(lines, 2); // 0-indexed, line "line2"
    expect(ctx.contextBefore).toBe("line0\nline1");
    expect(ctx.contextAfter).toBe("line3\nline4");
  });
  it("handles first line (no before)", () => {
    const ctx = captureContext(lines, 0);
    expect(ctx.contextBefore).toBe("");
    expect(ctx.contextAfter).toBe("line1\nline2");
  });
  it("handles second line (1 before)", () => {
    const ctx = captureContext(lines, 1);
    expect(ctx.contextBefore).toBe("line0");
    expect(ctx.contextAfter).toBe("line2\nline3");
  });
  it("handles last line (no after)", () => {
    const ctx = captureContext(lines, 4);
    expect(ctx.contextBefore).toBe("line2\nline3");
    expect(ctx.contextAfter).toBe("");
  });
  it("handles 2-line file", () => {
    const ctx = captureContext(["a", "b"], 0);
    expect(ctx.contextBefore).toBe("");
    expect(ctx.contextAfter).toBe("b");
  });
  it("normalizes context lines", () => {
    const ctx = captureContext(["  a  ", "  b  ", "  c  "], 1);
    expect(ctx.contextBefore).toBe("a");
    expect(ctx.contextAfter).toBe("c");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx vitest run src/lib/__tests__/comment-anchors.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Add normalizeLine to fnv1a.ts, create comment-anchors.ts**

Update `src/lib/fnv1a.ts`:
```typescript
export function fnv1a8(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function normalizeLine(line: string): string {
  return line.trim().replace(/\s+/g, " ");
}
```

Create `src/lib/comment-anchors.ts`:
```typescript
import { fnv1a8, normalizeLine } from "@/lib/fnv1a";

export { normalizeLine };

export function computeLineHash(lineText: string): string {
  return fnv1a8(normalizeLine(lineText));
}

export function captureContext(
  lines: string[],
  lineIndex: number
): { contextBefore: string; contextAfter: string } {
  const beforeLines: string[] = [];
  for (let i = Math.max(0, lineIndex - 2); i < lineIndex; i++) {
    beforeLines.push(normalizeLine(lines[i]));
  }

  const afterLines: string[] = [];
  for (let i = lineIndex + 1; i <= Math.min(lines.length - 1, lineIndex + 2); i++) {
    afterLines.push(normalizeLine(lines[i]));
  }

  return {
    contextBefore: beforeLines.join("\n"),
    contextAfter: afterLines.join("\n"),
  };
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx vitest run src/lib/__tests__/comment-anchors.test.ts`
Expected: all pass.

- [ ] **Step 5: Update ReviewComment interface in tauri-commands.ts**

Replace `ReviewComment` in `src/lib/tauri-commands.ts`:
```typescript
export interface CommentResponse {
  author: string;
  text: string;
  createdAt: string;
}

export interface ReviewComment {
  id: string;
  anchorType: "line" | "selection" | "block"; // block kept for legacy read
  // Line anchor (always present for line/selection)
  lineNumber?: number;
  lineHash?: string;
  // Context for re-anchoring
  contextBefore?: string;
  contextAfter?: string;
  // Selection fields
  selectedText?: string;
  selectionStartOffset?: number;
  selectionEndLine?: number;
  selectionEndOffset?: number;
  // Legacy block fields (read-only, not created by new code)
  blockHash?: string;
  headingContext?: string | null;
  fallbackLine?: number;
  // Content
  text: string;
  createdAt: string;
  resolved: boolean;
  responses?: CommentResponse[];
}
```

- [ ] **Step 6: Update CommentWithOrphan in store/index.ts**

In `src/store/index.ts`, update the interface and add `addResponse` action:
```typescript
export interface CommentWithOrphan extends ReviewComment {
  isOrphaned?: boolean;
  matchedLineNumber?: number; // resolved position after matching algorithm
}

// In CommentsSlice interface, add:
addResponse: (commentId: string, author: string, text: string) => void;

// In the store implementation, add after unresolveComment:
addResponse: (commentId, author, text) =>
  set((s) => ({
    commentsByFile: Object.fromEntries(
      Object.entries(s.commentsByFile).map(([fp, comments]) => [
        fp,
        comments.map((c) =>
          c.id === commentId
            ? {
                ...c,
                responses: [
                  ...(c.responses ?? []),
                  { author, text, createdAt: new Date().toISOString() },
                ],
              }
            : c
        ),
      ])
    ),
  })),
```

- [ ] **Step 7: Run full test suite to check for type errors**

Run: `npx vitest run`
Expected: some tests may fail due to type changes in test mocks — note which ones need updating but don't fix yet (later tasks handle test updates).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: update comment data model for v3 (line/selection anchoring)

- Add normalizeLine, computeLineHash, captureContext utilities
- Update ReviewComment interface with contextBefore/After, selection fields, responses
- Add addResponse store action
- Keep legacy block fields for backward compatibility

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 2: Comment Matching Algorithm

**Files:**
- Create: `src/lib/comment-matching.ts`
- Create: `src/lib/__tests__/comment-matching.test.ts`

- [ ] **Step 1: Write all 13 matching algorithm tests**

Create `src/lib/__tests__/comment-matching.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { matchComments, type MatchedComment } from "@/lib/comment-matching";
import { computeLineHash, captureContext } from "@/lib/comment-anchors";
import type { ReviewComment } from "@/lib/tauri-commands";

function makeLineComment(lineNumber: number, lineText: string, lines: string[]): ReviewComment {
  const idx = lineNumber - 1;
  const ctx = captureContext(lines, idx);
  return {
    id: `c${lineNumber}`,
    anchorType: "line",
    lineNumber,
    lineHash: computeLineHash(lineText),
    contextBefore: ctx.contextBefore,
    contextAfter: ctx.contextAfter,
    text: `comment on line ${lineNumber}`,
    createdAt: new Date().toISOString(),
    resolved: false,
  };
}

function makeSelectionComment(
  lineNumber: number,
  lineText: string,
  selectedText: string,
  lines: string[]
): ReviewComment {
  const idx = lineNumber - 1;
  const ctx = captureContext(lines, idx);
  return {
    id: `sel${lineNumber}`,
    anchorType: "selection",
    lineNumber,
    lineHash: computeLineHash(lineText),
    contextBefore: ctx.contextBefore,
    contextAfter: ctx.contextAfter,
    selectedText,
    selectionStartOffset: lineText.indexOf(selectedText),
    selectionEndLine: lineNumber,
    selectionEndOffset: lineText.indexOf(selectedText) + selectedText.length,
    text: `selection comment on line ${lineNumber}`,
    createdAt: new Date().toISOString(),
    resolved: false,
  };
}

describe("matchComments", () => {
  it("1. exact match — lineHash matches at lineNumber", () => {
    const lines = ["alpha", "beta", "gamma"];
    const comment = makeLineComment(2, "beta", lines);
    const result = matchComments([comment], lines);
    expect(result[0].matchedLineNumber).toBe(2);
    expect(result[0].isOrphaned).toBeFalsy();
  });

  it("2. nearby hash match — line moved ±5 lines", () => {
    const original = ["alpha", "beta", "gamma", "delta"];
    const comment = makeLineComment(2, "beta", original);
    const modified = ["alpha", "new1", "new2", "new3", "beta", "gamma"];
    const result = matchComments([comment], modified);
    expect(result[0].matchedLineNumber).toBe(5);
    expect(result[0].isOrphaned).toBeFalsy();
  });

  it("3. context-based match — commented line rewritten, context intact", () => {
    const original = ["alpha", "beta", "gamma", "delta", "epsilon"];
    const comment = makeLineComment(3, "gamma", original);
    // gamma rewritten to "CHANGED", but alpha/beta before and delta/epsilon after are same
    const modified = ["alpha", "beta", "CHANGED", "delta", "epsilon"];
    const result = matchComments([comment], modified);
    expect(result[0].matchedLineNumber).toBe(3);
    expect(result[0].isOrphaned).toBeFalsy();
  });

  it("4. global hash fallback — line moved >30 lines", () => {
    const lines: string[] = [];
    for (let i = 0; i < 60; i++) lines.push(`line${i}`);
    const comment = makeLineComment(5, "line4", lines);
    // Move line4 to position 55
    const modified = lines.filter((_, i) => i !== 4);
    modified.splice(54, 0, "line4");
    const result = matchComments([comment], modified);
    expect(result[0].matchedLineNumber).toBe(55);
    expect(result[0].isOrphaned).toBeFalsy();
  });

  it("5. selected text fallback — selection comment, hash gone, text found", () => {
    const original = ["const x = fetchData(url);", "doSomething();"];
    const comment = makeSelectionComment(1, original[0], "fetchData(url)", original);
    // Line rewritten but selectedText still present elsewhere
    const modified = ["const y = 42;", "const result = fetchData(url);"];
    const result = matchComments([comment], modified);
    expect(result[0].matchedLineNumber).toBe(2);
    expect(result[0].isOrphaned).toBeFalsy();
  });

  it("6. duplicate lines — comment stays on correct one", () => {
    const lines = ["alpha", "dup", "beta", "dup", "gamma"];
    const comment = makeLineComment(2, "dup", lines);
    const result = matchComments([comment], lines);
    expect(result[0].matchedLineNumber).toBe(2);
  });

  it("7. orphaned gracefully — line and context deleted", () => {
    const original = ["alpha", "beta", "gamma", "delta"];
    const comment = makeLineComment(2, "beta", original);
    const modified = ["completely", "different", "content"];
    const result = matchComments([comment], modified);
    expect(result[0].isOrphaned).toBe(true);
    expect(result[0].matchedLineNumber).toBeLessThanOrEqual(modified.length);
  });

  it("8. file truncated — lineNumber beyond EOF", () => {
    const original = ["a", "b", "c", "d", "e"];
    const comment = makeLineComment(5, "e", original);
    const modified = ["a", "b"];
    const result = matchComments([comment], modified);
    expect(result[0].matchedLineNumber).toBeLessThanOrEqual(2);
    expect(result[0].isOrphaned).toBe(true);
  });

  it("9. file empty — all comments orphaned at line 1", () => {
    const original = ["a", "b", "c"];
    const comment = makeLineComment(2, "b", original);
    const result = matchComments([comment], []);
    expect(result[0].isOrphaned).toBe(true);
    expect(result[0].matchedLineNumber).toBe(1);
  });

  it("10. multiple comments, mixed matching", () => {
    const original = ["a", "b", "c", "d"];
    const c1 = makeLineComment(1, "a", original);
    const c2 = makeLineComment(2, "b", original);
    const c3 = makeLineComment(4, "d", original);
    const modified = ["a", "X", "Y", "c", "d"];
    const result = matchComments([c1, c2, c3], modified);
    expect(result[0].matchedLineNumber).toBe(1); // exact
    expect(result[0].isOrphaned).toBeFalsy();
    expect(result[2].matchedLineNumber).toBe(5); // moved
    expect(result[2].isOrphaned).toBeFalsy();
  });

  it("11. re-anchor updates lineNumber on returned comment", () => {
    const original = ["a", "b", "c"];
    const comment = makeLineComment(2, "b", original);
    const modified = ["new", "a", "b", "c"];
    const result = matchComments([comment], modified);
    expect(result[0].lineNumber).toBe(3); // updated from 2 to 3
  });

  it("12. context match disambiguates identical lines", () => {
    const lines = ["before1", "dup", "after1", "before2", "dup", "after2"];
    const comment = makeLineComment(5, "dup", lines);
    const result = matchComments([comment], lines);
    expect(result[0].matchedLineNumber).toBe(5);
  });

  it("13. selection degradation — selectedText not found", () => {
    const original = ["const x = fetchData(url);"];
    const comment = makeSelectionComment(1, original[0], "fetchData(url)", original);
    const modified = ["completely rewritten line"];
    const result = matchComments([comment], modified);
    expect(result[0].isOrphaned).toBe(true);
  });

  it("legacy block comment — displayed at fallbackLine as orphaned", () => {
    const blockComment: ReviewComment = {
      id: "legacy1",
      anchorType: "block",
      blockHash: "abcd1234",
      headingContext: null,
      fallbackLine: 3,
      text: "old block comment",
      createdAt: new Date().toISOString(),
      resolved: false,
    };
    const lines = ["a", "b", "c", "d"];
    const result = matchComments([blockComment], lines);
    expect(result[0].matchedLineNumber).toBe(3);
    expect(result[0].isOrphaned).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx vitest run src/lib/__tests__/comment-matching.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement matching algorithm**

Create `src/lib/comment-matching.ts`:
```typescript
import { computeLineHash, normalizeLine } from "@/lib/comment-anchors";
import type { ReviewComment } from "@/lib/tauri-commands";
import type { CommentWithOrphan } from "@/store";

export type MatchedComment = CommentWithOrphan;

export function matchComments(
  comments: ReviewComment[],
  fileLines: string[]
): MatchedComment[] {
  const lineCount = fileLines.length;
  const lineHashes = fileLines.map((l) => computeLineHash(l));

  return comments.map((comment) => {
    // Legacy block comments → orphaned at fallbackLine
    if (comment.anchorType === "block") {
      const pos = Math.min(comment.fallbackLine ?? 1, Math.max(lineCount, 1));
      return { ...comment, matchedLineNumber: pos, isOrphaned: true };
    }

    if (lineCount === 0) {
      return { ...comment, matchedLineNumber: 1, isOrphaned: true, lineNumber: 1 };
    }

    const origLine = comment.lineNumber ?? 1;
    const hash = comment.lineHash ?? "";

    // Strategy 1: Exact match at lineNumber
    if (origLine >= 1 && origLine <= lineCount && lineHashes[origLine - 1] === hash) {
      return { ...comment, matchedLineNumber: origLine, isOrphaned: false };
    }

    // Strategy 2: Nearby hash match (±30)
    const nearbyResult = findNearestHash(lineHashes, hash, origLine, 30);
    if (nearbyResult !== null) {
      return {
        ...comment,
        lineNumber: nearbyResult,
        matchedLineNumber: nearbyResult,
        isOrphaned: false,
      };
    }

    // Strategy 3: Context match (±30)
    const contextResult = findByContext(fileLines, comment, origLine, 30);
    if (contextResult !== null) {
      return {
        ...comment,
        lineNumber: contextResult,
        matchedLineNumber: contextResult,
        isOrphaned: false,
      };
    }

    // Strategy 4: Global hash search
    const globalResult = findNearestHash(lineHashes, hash, origLine, lineCount);
    if (globalResult !== null) {
      return {
        ...comment,
        lineNumber: globalResult,
        matchedLineNumber: globalResult,
        isOrphaned: false,
      };
    }

    // Strategy 5: Selected text search (selection comments only)
    if (comment.anchorType === "selection" && comment.selectedText) {
      const textResult = findBySelectedText(fileLines, comment.selectedText, origLine);
      if (textResult !== null) {
        return {
          ...comment,
          lineNumber: textResult,
          matchedLineNumber: textResult,
          isOrphaned: false,
        };
      }
    }

    // Strategy 6: Orphaned
    const clampedLine = Math.min(origLine, Math.max(lineCount, 1));
    return {
      ...comment,
      lineNumber: clampedLine,
      matchedLineNumber: clampedLine,
      isOrphaned: true,
    };
  });
}

function findNearestHash(
  lineHashes: string[],
  targetHash: string,
  centerLine: number,
  radius: number
): number | null {
  const start = Math.max(0, centerLine - 1 - radius);
  const end = Math.min(lineHashes.length - 1, centerLine - 1 + radius);
  let bestLine: number | null = null;
  let bestDist = Infinity;

  for (let i = start; i <= end; i++) {
    if (lineHashes[i] === targetHash) {
      const dist = Math.abs(i - (centerLine - 1));
      if (dist < bestDist || (dist === bestDist && i < (bestLine ?? Infinity) - 1)) {
        bestDist = dist;
        bestLine = i + 1; // 1-indexed
      }
    }
  }

  return bestLine !== null && bestLine !== centerLine ? bestLine : null;
}

function findByContext(
  fileLines: string[],
  comment: ReviewComment,
  centerLine: number,
  radius: number
): number | null {
  const ctxBefore = comment.contextBefore;
  const ctxAfter = comment.contextAfter;
  if (!ctxBefore && !ctxAfter) return null;

  const start = Math.max(0, centerLine - 1 - radius);
  const end = Math.min(fileLines.length - 1, centerLine - 1 + radius);
  let bestLine: number | null = null;
  let bestDist = Infinity;

  for (let i = start; i <= end; i++) {
    let matchScore = 0;

    // Check contextBefore: the 2 lines before position i should match
    if (ctxBefore) {
      const ctxLines = ctxBefore.split("\n");
      let beforeMatch = true;
      for (let j = 0; j < ctxLines.length; j++) {
        const checkIdx = i - ctxLines.length + j;
        if (checkIdx < 0 || normalizeLine(fileLines[checkIdx]) !== ctxLines[j]) {
          beforeMatch = false;
          break;
        }
      }
      if (beforeMatch) matchScore++;
    }

    // Check contextAfter: the 2 lines after position i should match
    if (ctxAfter) {
      const ctxLines = ctxAfter.split("\n");
      let afterMatch = true;
      for (let j = 0; j < ctxLines.length; j++) {
        const checkIdx = i + 1 + j;
        if (checkIdx >= fileLines.length || normalizeLine(fileLines[checkIdx]) !== ctxLines[j]) {
          afterMatch = false;
          break;
        }
      }
      if (afterMatch) matchScore++;
    }

    if (matchScore > 0) {
      const dist = Math.abs(i - (centerLine - 1));
      if (matchScore > (bestLine !== null ? 0 : -1) &&
          (dist < bestDist || bestLine === null)) {
        bestDist = dist;
        bestLine = i + 1;
      }
    }
  }

  return bestLine;
}

function findBySelectedText(
  fileLines: string[],
  selectedText: string,
  centerLine: number
): number | null {
  let bestLine: number | null = null;
  let bestDist = Infinity;

  for (let i = 0; i < fileLines.length; i++) {
    if (fileLines[i].includes(selectedText)) {
      const dist = Math.abs(i - (centerLine - 1));
      if (dist < bestDist) {
        bestDist = dist;
        bestLine = i + 1;
      }
    }
  }

  return bestLine;
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx vitest run src/lib/__tests__/comment-matching.test.ts`
Expected: all 14 tests pass. Adjust implementation if any fail.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: implement comment matching algorithm with 6-strategy cascade

- Exact match, nearby hash, context match, global search, selected text, orphaned
- Handles legacy block comments as orphaned at fallbackLine
- 14 test cases covering all strategies and edge cases

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 3: Update Rust Sidecar for v3

**Files:**
- Modify: `src-tauri/src/commands.rs:20-49`
- Modify: `src-tauri/tests/commands_integration.rs`

- [ ] **Step 1: Update Rust ReviewComment struct**

In `src-tauri/src/commands.rs`, replace the `ReviewComment` struct:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommentResponse {
    pub author: String,
    pub text: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewComment {
    pub id: String,
    #[serde(rename = "anchorType", default = "default_anchor_type")]
    pub anchor_type: String,
    // Line anchor fields
    #[serde(rename = "lineHash", skip_serializing_if = "Option::is_none")]
    pub line_hash: Option<String>,
    #[serde(rename = "lineNumber", skip_serializing_if = "Option::is_none")]
    pub line_number: Option<u32>,
    // Context for re-anchoring
    #[serde(rename = "contextBefore", skip_serializing_if = "Option::is_none")]
    pub context_before: Option<String>,
    #[serde(rename = "contextAfter", skip_serializing_if = "Option::is_none")]
    pub context_after: Option<String>,
    // Selection fields
    #[serde(rename = "selectedText", skip_serializing_if = "Option::is_none")]
    pub selected_text: Option<String>,
    #[serde(rename = "selectionStartOffset", skip_serializing_if = "Option::is_none")]
    pub selection_start_offset: Option<u32>,
    #[serde(rename = "selectionEndLine", skip_serializing_if = "Option::is_none")]
    pub selection_end_line: Option<u32>,
    #[serde(rename = "selectionEndOffset", skip_serializing_if = "Option::is_none")]
    pub selection_end_offset: Option<u32>,
    // Legacy block fields (preserved for migration)
    #[serde(rename = "blockHash", skip_serializing_if = "Option::is_none")]
    pub block_hash: Option<String>,
    #[serde(rename = "headingContext", skip_serializing_if = "Option::is_none")]
    pub heading_context: Option<String>,
    #[serde(rename = "fallbackLine", skip_serializing_if = "Option::is_none")]
    pub fallback_line: Option<u32>,
    // Content
    pub text: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub resolved: bool,
    // Responses
    #[serde(skip_serializing_if = "Option::is_none")]
    pub responses: Option<Vec<CommentResponse>>,
}
```

Update `save_review_comments` to write version 3:
```rust
let payload = ReviewComments {
    version: 3,
    comments,
};
```

- [ ] **Step 2: Add Rust integration tests for v3**

Add to `src-tauri/tests/commands_integration.rs`:
```rust
#[test]
fn save_and_load_v3_comment_with_new_fields() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("test.md");
    std::fs::write(&file, "test content").unwrap();
    let file_str = file.to_str().unwrap().to_string();

    let comment = ReviewComment {
        id: "v3test".into(),
        anchor_type: "line".into(),
        line_hash: Some("abcd1234".into()),
        line_number: Some(5),
        context_before: Some("line3\nline4".into()),
        context_after: Some("line6\nline7".into()),
        selected_text: None,
        selection_start_offset: None,
        selection_end_line: None,
        selection_end_offset: None,
        block_hash: None,
        heading_context: None,
        fallback_line: None,
        text: "v3 comment".into(),
        created_at: "2026-01-01T00:00:00Z".into(),
        resolved: false,
        responses: Some(vec![CommentResponse {
            author: "copilot".into(),
            text: "Fixed it".into(),
            created_at: "2026-01-01T01:00:00Z".into(),
        }]),
    };

    save_review_comments(file_str.clone(), vec![comment]).unwrap();
    let loaded = load_review_comments(file_str).unwrap().unwrap();
    assert_eq!(loaded.version, 3);
    assert_eq!(loaded.comments.len(), 1);
    assert_eq!(loaded.comments[0].context_before, Some("line3\nline4".into()));
    assert_eq!(loaded.comments[0].responses.as_ref().unwrap().len(), 1);
    assert_eq!(loaded.comments[0].responses.as_ref().unwrap()[0].author, "copilot");
}

#[test]
fn load_v2_sidecar_preserves_all_fields() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("test.md");
    std::fs::write(&file, "").unwrap();
    let sidecar = dir.path().join("test.md.review.json");
    std::fs::write(&sidecar, r#"{"version":2,"comments":[{"id":"old","anchorType":"block","blockHash":"aabb","headingContext":null,"fallbackLine":3,"text":"old comment","createdAt":"2025-01-01T00:00:00Z","resolved":false}]}"#).unwrap();

    let loaded = load_review_comments(file.to_str().unwrap().to_string()).unwrap().unwrap();
    assert_eq!(loaded.comments[0].anchor_type, "block");
    assert_eq!(loaded.comments[0].block_hash, Some("aabb".into()));
    assert_eq!(loaded.comments[0].fallback_line, Some(3));
}

#[test]
fn v3_without_optional_fields_loads_cleanly() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("test.md");
    std::fs::write(&file, "").unwrap();
    let sidecar = dir.path().join("test.md.review.json");
    std::fs::write(&sidecar, r#"{"version":3,"comments":[{"id":"min","anchorType":"line","lineHash":"1234","lineNumber":1,"text":"minimal","createdAt":"2026-01-01T00:00:00Z","resolved":false}]}"#).unwrap();

    let loaded = load_review_comments(file.to_str().unwrap().to_string()).unwrap().unwrap();
    assert_eq!(loaded.comments[0].context_before, None);
    assert_eq!(loaded.comments[0].responses, None);
}
```

- [ ] **Step 3: Run Rust tests**

Run: `cd src-tauri && cargo test`
Expected: all tests pass (existing + 3 new).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: update Rust sidecar to v3 with context, selection, and response fields

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 4: Rewrite SourceView Comment Integration

**Files:**
- Modify: `src/components/viewers/SourceView.tsx`
- Modify: `src/components/comments/LineCommentMargin.tsx`
- Modify: `src/components/comments/CommentInput.tsx`

- [ ] **Step 1: Update SourceView to use matching algorithm**

In `src/components/viewers/SourceView.tsx`:

1. Add imports:
```typescript
import { matchComments } from "@/lib/comment-matching";
import { computeLineHash, captureContext } from "@/lib/comment-anchors";
```

2. Replace the `fnv1a8` import with the new imports (remove `import { fnv1a8 } from "@/lib/fnv1a";`).

3. Add matched comments memo after the load/save effects:
```typescript
const matchedComments = useMemo(() => {
  if (!comments || comments.length === 0) return [];
  return matchComments(comments, lines);
}, [comments, lines]);

const commentsByLine = useMemo(() => {
  const map = new Map<number, typeof matchedComments>();
  for (const c of matchedComments) {
    const ln = c.matchedLineNumber ?? c.lineNumber ?? 1;
    const arr = map.get(ln) ?? [];
    arr.push(c);
    map.set(ln, arr);
  }
  return map;
}, [matchedComments]);
```

4. In the render loop, replace the lineHash computation and comment filtering:
```typescript
// Replace:
// const lineHash = fnv1a8(line.trim());
// const lineComments = (comments ?? []).filter(
//   (c) => c.anchorType === "line" && c.lineHash === lineHash
// );
// With:
const lineHash = computeLineHash(line);
const lineComments = commentsByLine.get(lineNum) ?? [];
```

5. Update the `addComment` call in `handleAddComment` to include context:
```typescript
const handleAddLineComment = (lineNum: number) => {
  setCommentingLine(commentingLine === lineNum ? null : lineNum);
};
```

- [ ] **Step 2: Update LineCommentMargin to accept matched comments directly**

Rewrite `src/components/comments/LineCommentMargin.tsx`:
```typescript
import { useState } from "react";
import { useStore } from "@/store";
import { computeLineHash, captureContext } from "@/lib/comment-anchors";
import { CommentInput } from "./CommentInput";
import { CommentThread } from "./CommentThread";
import type { CommentWithOrphan } from "@/store";
import "@/styles/comments.css";

interface Props {
  filePath: string;
  lineNumber: number;
  lineText: string;
  fileLines: string[];
  matchedComments: CommentWithOrphan[];
  showInput?: boolean;
  onCloseInput?: () => void;
}

export function LineCommentMargin({
  filePath, lineNumber, lineText, fileLines, matchedComments, showInput, onCloseInput,
}: Props) {
  const { addComment } = useStore();
  const [expanded, setExpanded] = useState(false);

  const unresolved = matchedComments.filter((c) => !c.resolved);

  const handleSave = (text: string) => {
    const idx = lineNumber - 1;
    const ctx = captureContext(fileLines, idx);
    addComment(
      filePath,
      {
        anchorType: "line",
        lineHash: computeLineHash(lineText),
        lineNumber,
        contextBefore: ctx.contextBefore,
        contextAfter: ctx.contextAfter,
      },
      text
    );
    onCloseInput?.();
    setExpanded(true);
  };

  if (!showInput && matchedComments.length === 0) return null;

  return (
    <div className="line-comment-section">
      {showInput && (
        <CommentInput onSave={handleSave} onClose={() => onCloseInput?.()} />
      )}
      {expanded && matchedComments.map((c) => <CommentThread key={c.id} comment={c} />)}
      {!expanded && unresolved.length > 0 && (
        <button className="line-comment-count" onClick={() => setExpanded(true)}>
          {unresolved.length} comment{unresolved.length > 1 ? "s" : ""}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Simplify CommentInput — remove legacy anchor prop**

Update `src/components/comments/CommentInput.tsx` to remove the `anchor` prop (the caller provides `onSave` which already handles anchor creation):
```typescript
import { useRef, useEffect } from "react";
import "@/styles/comments.css";

interface Props {
  onSave: (text: string) => void;
  onClose: () => void;
  placeholder?: string;
}

export function CommentInput({ onSave, onClose, placeholder }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      const text = ref.current?.value.trim();
      if (text) onSave(text);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  const handleSave = () => {
    const text = ref.current?.value.trim();
    if (text) onSave(text);
  };

  return (
    <div className="comment-input">
      <textarea
        ref={ref}
        className="comment-textarea"
        placeholder={placeholder ?? "Add a comment… (Ctrl+Enter to save)"}
        rows={3}
        onKeyDown={handleKeyDown}
      />
      <div className="comment-input-actions">
        <button className="comment-btn comment-btn-primary" onClick={handleSave}>Save</button>
        <button className="comment-btn" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Update SourceView render to pass new props to LineCommentMargin**

In the SourceView render loop, update the LineCommentMargin usage:
```typescript
{(commentingLine === lineNum || lineComments.length > 0) && (
  <LineCommentMargin
    filePath={filePath}
    lineNumber={lineNum}
    lineText={line}
    fileLines={lines}
    matchedComments={lineComments}
    showInput={commentingLine === lineNum}
    onCloseInput={() => setCommentingLine(null)}
  />
)}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run`
Expected: some existing tests may fail — fix mock data to match new interfaces.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: integrate matching algorithm into SourceView

- SourceView uses matchComments for comment positioning
- LineCommentMargin accepts pre-matched comments and file context
- CommentInput simplified (anchor logic moved to callers)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 5: Rewrite MarkdownViewer — Remove Blocks, Add Line Gutter

**Files:**
- Modify: `src/components/viewers/MarkdownViewer.tsx`
- Delete: `src/components/comments/CommentMargin.tsx`
- Modify: `src/styles/comments.css`

- [ ] **Step 1: Rewrite MarkdownViewer to use data-source-line and line-based comments**

Replace the block-based comment system in `MarkdownViewer.tsx`:

1. Remove imports: `CommentMargin`, `buildHeadingContextMap`, `extractText`, `fnv1a8`
2. Add imports: `computeLineHash, captureContext` from `@/lib/comment-anchors`, `matchComments` from `@/lib/comment-matching`, `LineCommentMargin` from `@/components/comments/LineCommentMargin`
3. Remove `useMarkdownComponents` hook entirely (the complex block wrapper logic)
4. Replace `makeBlock`, `ListItemWithComment`, `BlockContent`, `makeAnchor` with simple components that add `data-source-line` attributes

The new approach:
- Each block element gets `data-source-line={node.position.start.line}` via custom components
- A comment gutter is rendered alongside the markdown body (not inside block wrappers)
- Comments are matched to source lines using the matching algorithm
- The `+` button appears on hover of a gutter row aligned to block elements

Create new custom components:
```typescript
function makeSourceLineBlock(Tag: string) {
  return function SourceLineBlock({ children, node, ...props }: ComponentPropsWithoutRef<any> & ExtraProps) {
    const line = node?.position?.start.line ?? 0;
    return <Tag {...props} data-source-line={line}>{children}</Tag>;
  };
}

// li variant (same idea)
function SourceLineLi({ children, node, ...props }: ComponentPropsWithoutRef<"li"> & ExtraProps) {
  const line = node?.position?.start.line ?? 0;
  return <li {...props} data-source-line={line}>{children}</li>;
}
```

Add a line-comment gutter overlay that reads `data-source-line` from rendered DOM elements and positions `+` buttons alongside them. This can be a separate component `MarkdownCommentGutter` that queries `[data-source-line]` elements after render.

- [ ] **Step 2: Remove CommentMargin component**

Delete `src/components/comments/CommentMargin.tsx`.

- [ ] **Step 3: Clean up block-based CSS from comments.css**

Remove from `src/styles/comments.css`:
- `.comment-block-wrapper` and all its children/variants
- `.comment-margin-wrapper` 
- `.comment-margin-indicator`
- `li.comment-block-wrapper` special rules
- `.has-selection` rules tied to block wrappers
- `.comment-ctx-backdrop`, `.comment-ctx-menu`, `.comment-ctx-item`

Keep: `.comment-plus-btn`, `.line-comment-section`, `.line-comment-count`, `.comment-thread`, `.comment-input`, `.comments-panel`, `.comment-panel-item`, and all other line/panel styles.

- [ ] **Step 4: Run tests, fix failures**

Run: `npx vitest run`
Fix any test failures due to removed components/classes. Update MarkdownViewer tests if they reference block wrappers.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: replace block comments with line-based gutter in MarkdownViewer

- Remove CommentMargin, makeBlock, ListItemWithComment, block CSS
- Add data-source-line attributes to rendered markdown elements
- Line-based comment gutter aligned to block start lines

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 6: Selection Comments & Toolbar (Source View)

**Files:**
- Create: `src/components/comments/SelectionToolbar.tsx`
- Create: `src/components/comments/__tests__/SelectionToolbar.test.tsx`
- Modify: `src/components/viewers/SourceView.tsx`
- Modify: `src/styles/comments.css`

- [ ] **Step 1: Write SelectionToolbar tests**

Create `src/components/comments/__tests__/SelectionToolbar.test.tsx`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SelectionToolbar } from "@/components/comments/SelectionToolbar";

describe("SelectionToolbar", () => {
  it("renders comment button", () => {
    render(
      <SelectionToolbar
        position={{ top: 100, left: 200 }}
        onAddComment={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /comment/i })).toBeInTheDocument();
  });

  it("calls onAddComment when clicked", () => {
    const onAdd = vi.fn();
    render(
      <SelectionToolbar
        position={{ top: 100, left: 200 }}
        onAddComment={onAdd}
        onDismiss={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /comment/i }));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("calls onDismiss on Escape", () => {
    const onDismiss = vi.fn();
    render(
      <SelectionToolbar
        position={{ top: 100, left: 200 }}
        onAddComment={vi.fn()}
        onDismiss={onDismiss}
      />
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Implement SelectionToolbar**

Create `src/components/comments/SelectionToolbar.tsx`:
```typescript
import { useEffect } from "react";
import "@/styles/comments.css";

interface Props {
  position: { top: number; left: number };
  onAddComment: () => void;
  onDismiss: () => void;
}

export function SelectionToolbar({ position, onAddComment, onDismiss }: Props) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".selection-toolbar")) onDismiss();
    };
    document.addEventListener("keydown", handleKeyDown);
    // Delay click listener to avoid immediate dismiss from the mouseup that created the selection
    const timer = setTimeout(() => document.addEventListener("click", handleClick), 100);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("click", handleClick);
      clearTimeout(timer);
    };
  }, [onDismiss]);

  return (
    <div
      className="selection-toolbar"
      style={{ top: position.top, left: position.left }}
    >
      <button
        className="selection-toolbar-btn"
        aria-label="Add comment on selection"
        onClick={onAddComment}
      >
        💬 Comment
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Add selection CSS to comments.css**

Append to `src/styles/comments.css`:
```css
/* Selection toolbar */
.selection-toolbar {
  position: fixed;
  z-index: 100;
  background: var(--color-bg-elevated, #fff);
  border: 1px solid var(--color-border, #d0d7de);
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  padding: 4px 8px;
}

.selection-toolbar-btn {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 13px;
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--color-fg-default, #1f2328);
}

.selection-toolbar-btn:hover {
  background: var(--color-bg-hover, #f3f4f6);
}

/* Selection highlight */
.comment-selection-highlight {
  background: rgba(255, 186, 0, 0.2);
  border-bottom: 2px solid rgba(255, 186, 0, 0.6);
  border-radius: 2px;
}

.comment-selection-highlight.resolved {
  background: rgba(0, 180, 0, 0.1);
  border-bottom-color: rgba(0, 180, 0, 0.3);
}

/* Flash animation for scroll-to-comment */
@keyframes comment-flash {
  0% { background: rgba(255, 186, 0, 0.3); }
  100% { background: transparent; }
}

.comment-flash {
  animation: comment-flash 1.5s ease-out;
}
```

- [ ] **Step 4: Integrate selection into SourceView**

In `src/components/viewers/SourceView.tsx`, add selection detection and toolbar:

1. Add state:
```typescript
const [selectionToolbar, setSelectionToolbar] = useState<{
  position: { top: number; left: number };
  lineNumber: number;
  selectedText: string;
  startOffset: number;
  endLine: number;
  endOffset: number;
} | null>(null);
```

2. Add mouseup handler on the source lines container:
```typescript
const handleMouseUp = () => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) { setSelectionToolbar(null); return; }
  const range = sel.getRangeAt(0);
  const selectedText = sel.toString();
  if (!selectedText.trim()) { setSelectionToolbar(null); return; }

  // Find start and end line elements
  const startEl = range.startContainer.parentElement?.closest("[data-line-idx]");
  const endEl = range.endContainer.parentElement?.closest("[data-line-idx]");
  if (!startEl || !endEl) { setSelectionToolbar(null); return; }

  const startIdx = Number(startEl.getAttribute("data-line-idx"));
  const endIdx = Number(endEl.getAttribute("data-line-idx"));
  const rect = range.getBoundingClientRect();

  setSelectionToolbar({
    position: { top: rect.top - 40, left: rect.left },
    lineNumber: startIdx + 1,
    selectedText,
    startOffset: range.startOffset,
    endLine: endIdx + 1,
    endOffset: range.endOffset,
  });
};
```

3. Add the selection comment handler:
```typescript
const handleAddSelectionComment = () => {
  if (!selectionToolbar) return;
  const { lineNumber, selectedText, startOffset, endLine, endOffset } = selectionToolbar;
  const idx = lineNumber - 1;
  const ctx = captureContext(lines, idx);
  addComment(filePath, {
    anchorType: "selection",
    lineHash: computeLineHash(lines[idx] ?? ""),
    lineNumber,
    contextBefore: ctx.contextBefore,
    contextAfter: ctx.contextAfter,
    selectedText,
    selectionStartOffset: startOffset,
    selectionEndLine: endLine,
    selectionEndOffset: endOffset,
  }, "");
  setSelectionToolbar(null);
  setCommentingLine(lineNumber); // open input for the comment text
};
```

4. Render the toolbar:
```typescript
{selectionToolbar && (
  <SelectionToolbar
    position={selectionToolbar.position}
    onAddComment={handleAddSelectionComment}
    onDismiss={() => setSelectionToolbar(null)}
  />
)}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add selection-based comments with floating toolbar in source view

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 7: CommentsPanel — Click-to-Scroll, Responses, Sort

**Files:**
- Modify: `src/components/comments/CommentsPanel.tsx`
- Modify: `src/components/comments/CommentThread.tsx`
- Modify: `src/components/viewers/EnhancedViewer.tsx`

- [ ] **Step 1: Update CommentThread to display responses**

In `src/components/comments/CommentThread.tsx`, add response display after the comment text:
```typescript
{comment.responses && comment.responses.length > 0 && (
  <div className="comment-responses">
    {comment.responses.map((r, i) => (
      <div key={i} className="comment-response">
        <span className="comment-response-author">{r.author}</span>
        <span className="comment-response-time">{new Date(r.createdAt).toLocaleString()}</span>
        <p className="comment-response-text">{r.text}</p>
      </div>
    ))}
  </div>
)}
```

Add CSS for responses in `src/styles/comments.css`:
```css
.comment-responses {
  margin-top: 6px;
  padding-left: 12px;
  border-left: 2px solid var(--color-border, #d0d7de);
}

.comment-response {
  margin-bottom: 6px;
  font-size: 12px;
}

.comment-response-author {
  font-weight: 600;
  margin-right: 6px;
  color: var(--color-accent, #0969da);
}

.comment-response-time {
  color: var(--color-fg-muted, #656d76);
  font-size: 11px;
}

.comment-response-text {
  margin: 2px 0 0;
}
```

- [ ] **Step 2: Rewrite CommentsPanel for line-based navigation**

Rewrite `src/components/comments/CommentsPanel.tsx`:
```typescript
import { useState } from "react";
import { useStore } from "@/store";
import { CommentThread } from "./CommentThread";
import type { CommentWithOrphan } from "@/store";
import "@/styles/comments.css";

interface Props {
  filePath: string;
  onScrollToLine?: (lineNumber: number) => void;
}

export function CommentsPanel({ filePath, onScrollToLine }: Props) {
  const { commentsByFile } = useStore();
  const [showResolved, setShowResolved] = useState(false);

  const allComments = commentsByFile[filePath] ?? [];
  const sorted = [...allComments].sort(
    (a, b) => (a.matchedLineNumber ?? a.lineNumber ?? 0) - (b.matchedLineNumber ?? b.lineNumber ?? 0)
  );
  const unresolved = sorted.filter((c) => !c.resolved);
  const resolved = sorted.filter((c) => c.resolved);
  const displayed = showResolved ? sorted : unresolved;

  const handleClick = (comment: CommentWithOrphan) => {
    const line = comment.matchedLineNumber ?? comment.lineNumber ?? 1;
    onScrollToLine?.(line);
  };

  return (
    <div className="comments-panel">
      <div className="comments-panel-header">
        <span className="comments-panel-title">Comments ({unresolved.length})</span>
        <button className="comment-btn" onClick={() => setShowResolved((v) => !v)}>
          {showResolved ? "Hide resolved" : `Show resolved (${resolved.length})`}
        </button>
      </div>
      <div className="comments-panel-body">
        {displayed.length === 0 ? (
          <div className="comments-empty">No comments yet</div>
        ) : (
          displayed.map((comment) => (
            <div
              key={comment.id}
              className="comment-panel-item"
              onClick={() => handleClick(comment)}
            >
              <div className="comment-panel-item-line">
                Line {comment.matchedLineNumber ?? comment.lineNumber ?? "?"}
                {comment.isOrphaned && <span className="comment-orphaned-icon" title="Orphaned">⚠</span>}
              </div>
              <CommentThread comment={comment} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire scroll-to-line in EnhancedViewer**

In `src/components/viewers/EnhancedViewer.tsx`, add a ref-based scroll mechanism:
- Pass `onScrollToLine` callback from CommentsPanel to SourceView/MarkdownViewer
- SourceView scrolls to `[data-line-idx="${lineNumber - 1}"]` and adds `.comment-flash` class
- MarkdownViewer scrolls to `[data-source-line="${lineNumber}"]` and adds `.comment-flash` class

- [ ] **Step 4: Run tests, fix failures**

Run: `npx vitest run`
Fix any test failures in CommentsPanel tests (prop changes, sort behavior).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: CommentsPanel click-to-scroll, response display, line-number sort

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 8: Update All Tests for v3 Model

**Files:**
- Modify: `src/__tests__/store/comments.test.ts`
- Modify: `src/components/comments/__tests__/CommentInput.test.tsx`
- Modify: `src/components/comments/__tests__/CommentThread.test.tsx`
- Modify: `src/components/comments/__tests__/CommentsPanel.test.tsx`
- Modify: `src/components/viewers/__tests__/SourceView.test.tsx`
- Modify: `src/__mocks__/@tauri-apps/api/core.ts`

- [ ] **Step 1: Update store tests for v3 model**

In `src/__tests__/store/comments.test.ts`:
- Update all `addComment` calls to use `{ anchorType: "line", lineHash: "...", lineNumber: N }` instead of `{ anchorType: "block", blockHash: "...", headingContext: null, fallbackLine: N }`
- Add test for `addResponse` action
- Add test for `matchedLineNumber` propagation
- Remove block-specific test cases (or convert them to line-based)

- [ ] **Step 2: Update component tests**

- `CommentInput.test.tsx`: Remove `anchor` prop from test renders, use new `onSave`/`onClose` interface
- `CommentThread.test.tsx`: Add test for response display
- `CommentsPanel.test.tsx`: Update `onScrollToBlock` → `onScrollToLine`, add line number display test
- `SourceView.test.tsx`: Ensure mock data uses v3 format

- [ ] **Step 3: Update invoke mock**

In `src/__mocks__/@tauri-apps/api/core.ts`, update the `load_review_comments` mock to return v3 format:
```typescript
case "load_review_comments":
  return { version: 3, comments: [] };
```

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: update all comment tests for v3 data model

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 9: Python Scripts (scan, respond, resolve, clean)

**Files:**
- Create: `scripts/scan-comments.py`
- Create: `scripts/respond-comments.py`
- Create: `scripts/resolve-comments.py`
- Create: `scripts/clean-comments.py`

- [ ] **Step 1: Create scan-comments.py**

```python
#!/usr/bin/env python3
"""Scan .review.json sidecar files and display comments."""
import argparse, json, os, sys

def scan_directory(directory, status_filter=None, as_json=False):
    results = []
    for root, _, files in os.walk(directory):
        for f in files:
            if not f.endswith(".review.json"):
                continue
            sidecar_path = os.path.join(root, f)
            reviewed_file = sidecar_path[:-len(".review.json")]
            rel_path = os.path.relpath(reviewed_file, directory)
            try:
                with open(sidecar_path, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
            except (json.JSONDecodeError, OSError) as e:
                print(f"WARNING: {sidecar_path}: {e}", file=sys.stderr)
                continue

            # Read source file for reference text
            source_lines = []
            try:
                with open(reviewed_file, "r", encoding="utf-8") as fh:
                    source_lines = fh.read().splitlines()
            except OSError:
                pass

            for c in data.get("comments", []):
                anchor = c.get("anchorType", "block")
                line_num = c.get("lineNumber") or c.get("fallbackLine") or 1
                status = "resolved" if c.get("resolved") else "unresolved"
                if anchor == "block":
                    status = "orphaned"

                if status_filter and status != status_filter:
                    continue

                if anchor == "selection":
                    ref = c.get("selectedText", "")[:60]
                elif anchor == "line" and 1 <= line_num <= len(source_lines):
                    ref = source_lines[line_num - 1][:60]
                else:
                    ref = "<n/a>"

                comment_text = c.get("text", "").replace("\n", "\\n")

                if as_json:
                    results.append({
                        "file": rel_path, "line": line_num, "status": status,
                        "anchor": anchor, "reference": ref, "comment": c.get("text", ""),
                        "id": c.get("id"), "responses": c.get("responses", []),
                    })
                else:
                    results.append(f"{rel_path}\t{line_num}\t{status}\t{anchor}\t{ref}\t{comment_text}")

    return results

def main():
    parser = argparse.ArgumentParser(description="Scan review comments")
    parser.add_argument("directory", nargs="?", default=".")
    parser.add_argument("--unresolved", action="store_true")
    parser.add_argument("--resolved", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    status_filter = None
    if args.unresolved: status_filter = "unresolved"
    elif args.resolved: status_filter = "resolved"

    results = scan_directory(args.directory, status_filter, args.json)

    if args.json:
        print(json.dumps(results, indent=2))
    else:
        if results:
            print("FILE\tLINE\tSTATUS\tANCHOR\tREFERENCE\tCOMMENT")
        for r in results:
            print(r)

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Create respond-comments.py**

```python
#!/usr/bin/env python3
"""Add responses to review comments."""
import argparse, json, os, sys, tempfile

def atomic_write(path, data):
    dir_name = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(dir=dir_name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, path)
    except:
        os.unlink(tmp)
        raise

def respond(sidecar_path, comment_id, author, text):
    with open(sidecar_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    found = False
    for c in data.get("comments", []):
        if c["id"] == comment_id:
            if "responses" not in c: c["responses"] = []
            c["responses"].append({
                "author": author, "text": text,
                "createdAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
            })
            found = True
            break
    if not found:
        print(f"ERROR: comment {comment_id} not found in {sidecar_path}", file=sys.stderr)
        return False
    atomic_write(sidecar_path, data)
    return True

def main():
    parser = argparse.ArgumentParser(description="Respond to review comments")
    parser.add_argument("--file", required=True, help="Path to reviewed file")
    parser.add_argument("--id", help="Comment ID to respond to")
    parser.add_argument("--author", required=True)
    parser.add_argument("--text", help="Response text")
    parser.add_argument("--from-json", help="JSON file with batch responses")
    args = parser.parse_args()

    sidecar = args.file + ".review.json"
    if not os.path.exists(sidecar):
        print(f"ERROR: {sidecar} not found", file=sys.stderr)
        sys.exit(1)

    if args.from_json:
        with open(args.from_json, "r") as f:
            responses = json.load(f)
        ok = all(respond(sidecar, r["id"], args.author, r["text"]) for r in responses)
        sys.exit(0 if ok else 1)
    elif args.id and args.text:
        ok = respond(sidecar, args.id, args.author, args.text)
        sys.exit(0 if ok else 1)
    else:
        parser.error("Provide --id and --text, or --from-json")

if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Create resolve-comments.py**

```python
#!/usr/bin/env python3
"""Resolve review comments."""
import argparse, json, os, sys, tempfile

def atomic_write(path, data):
    dir_name = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(dir=dir_name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, path)
    except:
        os.unlink(tmp)
        raise

def resolve_in_file(sidecar_path, ids=None, responded_by=None, all_comments=False, dry_run=False):
    try:
        with open(sidecar_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"WARNING: {sidecar_path}: {e}", file=sys.stderr)
        return 0

    count = 0
    for c in data.get("comments", []):
        if c.get("resolved"):
            continue
        should_resolve = False
        if all_comments:
            should_resolve = True
        elif ids and c["id"] in ids:
            should_resolve = True
        elif responded_by:
            for r in c.get("responses", []):
                if r.get("author") == responded_by:
                    should_resolve = True
                    break
        if should_resolve:
            if not dry_run:
                c["resolved"] = True
            count += 1

    if count > 0 and not dry_run:
        atomic_write(sidecar_path, data)
    return count

def main():
    parser = argparse.ArgumentParser(description="Resolve review comments")
    parser.add_argument("directory", nargs="?", default=None)
    parser.add_argument("--file", help="Specific file")
    parser.add_argument("--id", action="append", help="Comment IDs to resolve")
    parser.add_argument("--responded-by", help="Resolve comments responded to by author")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    total = 0
    if args.file:
        sidecar = args.file + ".review.json"
        total = resolve_in_file(sidecar, args.id, args.responded_by, args.all, args.dry_run)
    else:
        directory = args.directory or "."
        for root, _, files in os.walk(directory):
            for f in files:
                if f.endswith(".review.json"):
                    total += resolve_in_file(
                        os.path.join(root, f), args.id, args.responded_by, args.all, args.dry_run
                    )

    prefix = "[DRY RUN] " if args.dry_run else ""
    print(f"{prefix}Resolved {total} comment(s)")

if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Create clean-comments.py**

```python
#!/usr/bin/env python3
"""Clean up review comment sidecar files."""
import argparse, json, os, sys, tempfile

def atomic_write(path, data):
    dir_name = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(dir=dir_name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, path)
    except:
        os.unlink(tmp)
        raise

def main():
    parser = argparse.ArgumentParser(description="Clean review comments")
    parser.add_argument("directory", nargs="?", default=".")
    parser.add_argument("--all", action="store_true", help="Delete all sidecar files")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    modified = deleted = 0
    for root, _, files in os.walk(args.directory):
        for f in files:
            if not f.endswith(".review.json"):
                continue
            path = os.path.join(root, f)

            if args.all:
                if args.dry_run:
                    print(f"[DRY RUN] Would delete {path}")
                else:
                    os.remove(path)
                deleted += 1
                continue

            try:
                with open(path, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
            except (json.JSONDecodeError, OSError) as e:
                print(f"WARNING: {path}: {e}", file=sys.stderr)
                continue

            original_count = len(data.get("comments", []))
            data["comments"] = [c for c in data.get("comments", []) if not c.get("resolved")]

            if len(data["comments"]) == 0:
                if args.dry_run:
                    print(f"[DRY RUN] Would delete {path} (all {original_count} resolved)")
                else:
                    os.remove(path)
                deleted += 1
            elif len(data["comments"]) < original_count:
                if args.dry_run:
                    print(f"[DRY RUN] Would remove {original_count - len(data['comments'])} resolved from {path}")
                else:
                    atomic_write(path, data)
                modified += 1

    prefix = "[DRY RUN] " if args.dry_run else ""
    print(f"{prefix}Modified {modified} file(s), deleted {deleted} file(s)")

if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Test scripts manually**

```bash
# Create a test sidecar
echo '{"version":3,"comments":[{"id":"test1","anchorType":"line","lineHash":"abc","lineNumber":1,"text":"test","createdAt":"2026-01-01T00:00:00Z","resolved":false}]}' > /tmp/test.md.review.json
echo "line1" > /tmp/test.md

python scripts/scan-comments.py /tmp
python scripts/respond-comments.py --file /tmp/test.md --id test1 --author copilot --text "Fixed"
python scripts/scan-comments.py /tmp --json
python scripts/resolve-comments.py --file /tmp/test.md --responded-by copilot
python scripts/clean-comments.py /tmp --dry-run
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Python scripts for scan, respond, resolve, clean comments

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 10: PowerShell Scripts

**Files:**
- Create: `scripts/scan-comments.ps1`
- Create: `scripts/respond-comments.ps1`
- Create: `scripts/resolve-comments.ps1`
- Create: `scripts/clean-comments.ps1`

- [ ] **Step 1: Create all 4 PowerShell scripts**

Implement PowerShell equivalents of the Python scripts using `ConvertFrom-Json` / `ConvertTo-Json`. Same functionality, same flags, same output format.

Key patterns:
```powershell
# Atomic write
$tmp = [System.IO.Path]::GetTempFileName()
$data | ConvertTo-Json -Depth 10 | Set-Content -Path $tmp -Encoding UTF8
Move-Item -Path $tmp -Destination $path -Force
```

- [ ] **Step 2: Test scripts**

```powershell
python scripts/scan-comments.py . | Out-Null  # compare with:
./scripts/scan-comments.ps1
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add PowerShell scripts for scan, respond, resolve, clean comments

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 11: E2E Tests

**Files:**
- Modify: `e2e/comments.spec.ts`
- Modify: `e2e/helpers/mock-tauri.ts`

- [ ] **Step 1: Update E2E mock to return v3 format**

In `e2e/helpers/mock-tauri.ts`, update the `load_review_comments` mock to return v3 format with line-based comments.

- [ ] **Step 2: Write E2E tests**

Update `e2e/comments.spec.ts` with:
- Add line comment in source view → verify sidecar
- Duplicate line handling → comment only on one
- CommentsPanel click → scrolls to line
- Resolve/delete → UI updates
- Comment with responses displays author

- [ ] **Step 3: Run E2E**

Run: `npx playwright test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: update E2E tests for v3 comment system

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 12: Final Validation

- [ ] **Step 1: Run all test suites**

```bash
cd src-tauri && cargo test
cd .. && npx vitest run
npx playwright test
```

All must pass.

- [ ] **Step 2: Manual smoke test checklist**

- Source view: hover line → `+` appears → click → add comment → saved
- Source view: select text → toolbar appears → click Comment → add selection comment → highlight shown
- Visual (markdown) view: `+` appears at block starts → click → add comment
- CommentsPanel: shows comments sorted by line → click → scrolls to line with flash
- Responses: comment with responses shows author name
- Duplicate lines: comment only shows on one
- Legacy block comments: shown as orphaned

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "fix: final adjustments from validation

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
