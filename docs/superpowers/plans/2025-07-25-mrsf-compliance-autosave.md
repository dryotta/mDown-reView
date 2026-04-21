# MRSF v1.0 Compliance & Auto-Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all MRSF v1.0 spec compliance gaps and make auto-save reliable (no lost comments on tab switch).

**Architecture:** Extract shared comment utilities (ID generation, validation, constants) into `src/lib/comment-utils.ts`. Extract duplicated auto-save logic from both viewers into `src/hooks/useAutoSaveComments.ts` with flush-on-unmount. Fix `deleteComment` in store to promote replies per §9.1. Add `selected_text` + hash to line comments and selection comments.

**Tech Stack:** React 18, TypeScript, Zustand, Vitest, Tauri v2

**Spec reference:** https://github.com/wictorwilen/MRSF/blob/main/MRSF-v1.0.md

**Build/test commands:**
- `npx vitest run` — run all Vitest tests
- `cd src-tauri && cargo test` — Rust tests
- `npm run test:e2e` — Playwright E2E tests

---

### Task 1: Comment Utilities — ID Generation, Constants, Validation

Create `src/lib/comment-utils.ts` with UUIDv4 ID generation, MRSF constants, and validation helpers. Update `src/store/index.ts` to use the new `generateCommentId()`.

**Files:**
- Create: `src/lib/comment-utils.ts`
- Create: `src/lib/__tests__/comment-utils.test.ts`
- Modify: `src/store/index.ts:123-125` (replace `generateId`)
- Modify: `src/store/index.ts:187,207` (call sites)

- [ ] **Step 1: Write failing tests for comment-utils**

Create `src/lib/__tests__/comment-utils.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import {
  SELECTED_TEXT_MAX_LENGTH,
  TEXT_MAX_LENGTH,
  truncateSelectedText,
  validateTargetingFields,
} from "@/lib/comment-utils";

describe("generateCommentId", () => {
  it("returns a valid UUIDv4 string", () => {
    const id = generateCommentId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("returns unique IDs on successive calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateCommentId()));
    expect(ids.size).toBe(100);
  });
});

describe("MRSF constants", () => {
  it("SELECTED_TEXT_MAX_LENGTH is 4096", () => {
    expect(SELECTED_TEXT_MAX_LENGTH).toBe(4096);
  });

  it("TEXT_MAX_LENGTH is 16384", () => {
    expect(TEXT_MAX_LENGTH).toBe(16384);
  });
});

describe("truncateSelectedText", () => {
  it("returns text unchanged when under limit", () => {
    expect(truncateSelectedText("short")).toBe("short");
  });

  it("truncates text exceeding 4096 characters", () => {
    const long = "x".repeat(5000);
    const result = truncateSelectedText(long);
    expect(result.length).toBe(4096);
  });

  it("returns empty string for empty input", () => {
    expect(truncateSelectedText("")).toBe("");
  });
});

describe("validateTargetingFields", () => {
  it("clamps end_line to be >= line", () => {
    const result = validateTargetingFields({ line: 10, end_line: 5 });
    expect(result.end_line).toBe(10);
  });

  it("clamps end_column to be >= start_column on same line", () => {
    const result = validateTargetingFields({
      line: 10,
      end_line: 10,
      start_column: 20,
      end_column: 5,
    });
    expect(result.end_column).toBe(20);
  });

  it("allows end_column < start_column on different lines", () => {
    const result = validateTargetingFields({
      line: 10,
      end_line: 12,
      start_column: 20,
      end_column: 5,
    });
    expect(result.end_column).toBe(5);
  });

  it("passes through valid fields unchanged", () => {
    const fields = { line: 5, end_line: 10, start_column: 0, end_column: 30 };
    expect(validateTargetingFields(fields)).toEqual(fields);
  });

  it("handles partial fields (line only)", () => {
    const result = validateTargetingFields({ line: 5 });
    expect(result).toEqual({ line: 5 });
  });

  it("logs warning when clamping", () => {
    const logger = { warn: vi.fn() };
    validateTargetingFields({ line: 10, end_line: 5 }, logger);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("clamped end_line"));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/comment-utils.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement comment-utils**

Create `src/lib/comment-utils.ts`:

```typescript
/// MRSF v1.0 comment utility functions and constants.

/** Spec §6.2: selected_text MUST NOT exceed 4096 characters. */
export const SELECTED_TEXT_MAX_LENGTH = 4096;

/** Spec §6.1: text SHOULD NOT exceed 16384 characters. */
export const TEXT_MAX_LENGTH = 16384;

/** Generate a UUIDv4 comment ID (spec §6.1: SHOULD be collision-resistant). */
export function generateCommentId(): string {
  return crypto.randomUUID();
}

/** Truncate selected_text to the spec maximum (4096 chars). */
export function truncateSelectedText(text: string): string {
  if (text.length <= SELECTED_TEXT_MAX_LENGTH) return text;
  return text.slice(0, SELECTED_TEXT_MAX_LENGTH);
}

/** Validate and clamp MRSF targeting fields per spec §7.1. Logs warning on clamping. */
export function validateTargetingFields(
  fields: {
    line?: number;
    end_line?: number;
    start_column?: number;
    end_column?: number;
  },
  logger?: { warn: (msg: string) => void }
): typeof fields {
  const result = { ...fields };

  // end_line MUST be >= line
  if (result.line !== undefined && result.end_line !== undefined && result.end_line < result.line) {
    logger?.warn(`MRSF: clamped end_line (${result.end_line}) to line (${result.line})`);
    result.end_line = result.line;
  }

  // end_column MUST be >= start_column when on the same line
  if (
    result.line !== undefined &&
    result.end_line !== undefined &&
    result.line === result.end_line &&
    result.start_column !== undefined &&
    result.end_column !== undefined &&
    result.end_column < result.start_column
  ) {
    logger?.warn(`MRSF: clamped end_column (${result.end_column}) to start_column (${result.start_column})`);
    result.end_column = result.start_column;
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/comment-utils.test.ts`
Expected: all PASS

- [ ] **Step 5: Update store to use generateCommentId**

In `src/store/index.ts`:

Replace the old `generateId` function (lines 123-125):
```typescript
function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}
```

With an import and usage:
```typescript
import { generateCommentId } from "@/lib/comment-utils";
```

Then replace `id: generateId()` with `id: generateCommentId()` at both call sites (line 187 in `addComment` and line 207 in `addReply`). Remove the old `generateId` function entirely.

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: all existing tests pass (no regressions)

- [ ] **Step 7: Commit**

```
git add src/lib/comment-utils.ts src/lib/__tests__/comment-utils.test.ts src/store/index.ts
git commit -m "feat: UUIDv4 comment IDs, MRSF constants, and validation helpers

- Replace Math.random() ID generator with crypto.randomUUID() (spec §6.1)
- Add SELECTED_TEXT_MAX_LENGTH (4096) and TEXT_MAX_LENGTH (16384) constants
- Add truncateSelectedText() and validateTargetingFields() helpers
- Add comprehensive unit tests

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Delete Comment → Promote Replies (§9.1)

Fix `deleteComment` in the Zustand store to promote direct replies when a parent is deleted, per MRSF spec §9.1.

**Files:**
- Modify: `src/store/index.ts:231-239` (`deleteComment` action)
- Modify: `src/lib/__tests__/comment-matching.test.ts` or create new store test file

**Context:** The `deleteComment` action currently does:
```typescript
deleteComment: (id) =>
  set((s) => ({
    commentsByFile: Object.fromEntries(
      Object.entries(s.commentsByFile).map(([fp, comments]) => [
        fp,
        comments.filter((c) => c.id !== id),
      ])
    ),
  })),
```

This just removes the comment. Per MRSF §9.1, it MUST:
1. Copy targeting fields from the deleted parent to direct replies that lack their own.
2. Reparent `reply_to` to the grandparent (or remove if parent was root).
3. Then remove the parent.

- [ ] **Step 1: Write failing tests**

Add tests to a file for store logic. Since the store tests live in various `__tests__` directories, create `src/store/__tests__/deleteComment.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store";

// Reset store before each test
beforeEach(() => {
  useStore.setState({
    commentsByFile: {},
    authorName: "Tester (test)",
  });
});

describe("deleteComment — MRSF §9.1 reply promotion", () => {
  it("promotes direct replies to root when parent is root comment", () => {
    useStore.setState({
      commentsByFile: {
        "/file.md": [
          {
            id: "parent",
            author: "A",
            timestamp: "2026-01-01T00:00:00Z",
            text: "parent",
            resolved: false,
            line: 10,
            selected_text: "target text",
            selected_text_hash: "abc123",
          },
          {
            id: "reply1",
            author: "B",
            timestamp: "2026-01-01T00:01:00Z",
            text: "reply",
            resolved: false,
            reply_to: "parent",
            line: 10,
          },
          {
            id: "reply2",
            author: "C",
            timestamp: "2026-01-01T00:02:00Z",
            text: "reply without own targeting",
            resolved: false,
            reply_to: "parent",
          },
        ],
      },
    });

    useStore.getState().deleteComment("parent");

    const comments = useStore.getState().commentsByFile["/file.md"];
    expect(comments).toHaveLength(2);

    // reply1 already had line: 10, should keep it, reply_to removed (parent was root)
    const r1 = comments.find((c) => c.id === "reply1")!;
    expect(r1.reply_to).toBeUndefined();
    expect(r1.line).toBe(10);

    // reply2 had no targeting fields — should inherit from parent
    const r2 = comments.find((c) => c.id === "reply2")!;
    expect(r2.reply_to).toBeUndefined();
    expect(r2.line).toBe(10);
    expect(r2.selected_text).toBe("target text");
    expect(r2.selected_text_hash).toBe("abc123");
  });

  it("reparents replies to grandparent when parent has reply_to", () => {
    useStore.setState({
      commentsByFile: {
        "/file.md": [
          {
            id: "grandparent",
            author: "A",
            timestamp: "2026-01-01T00:00:00Z",
            text: "gp",
            resolved: false,
            line: 5,
          },
          {
            id: "parent",
            author: "A",
            timestamp: "2026-01-01T00:00:00Z",
            text: "parent",
            resolved: false,
            reply_to: "grandparent",
            line: 10,
          },
          {
            id: "child",
            author: "B",
            timestamp: "2026-01-01T00:01:00Z",
            text: "child",
            resolved: false,
            reply_to: "parent",
          },
        ],
      },
    });

    useStore.getState().deleteComment("parent");

    const comments = useStore.getState().commentsByFile["/file.md"];
    expect(comments).toHaveLength(2);

    const child = comments.find((c) => c.id === "child")!;
    expect(child.reply_to).toBe("grandparent");
    // child had no targeting, should inherit from parent
    expect(child.line).toBe(10);
  });

  it("deleting a comment with no replies just removes it", () => {
    useStore.setState({
      commentsByFile: {
        "/file.md": [
          {
            id: "solo",
            author: "A",
            timestamp: "2026-01-01T00:00:00Z",
            text: "solo",
            resolved: false,
            line: 1,
          },
        ],
      },
    });

    useStore.getState().deleteComment("solo");

    const comments = useStore.getState().commentsByFile["/file.md"];
    expect(comments).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/store/__tests__/deleteComment.test.ts`
Expected: FAIL — reply promotion not implemented

- [ ] **Step 3: Implement reply promotion in deleteComment**

In `src/store/index.ts`, replace the `deleteComment` action (lines 231-239) with:

```typescript
      deleteComment: (id) =>
        set((s) => ({
          commentsByFile: Object.fromEntries(
            Object.entries(s.commentsByFile).map(([fp, comments]) => {
              const parent = comments.find((c) => c.id === id);
              if (!parent) return [fp, comments];

              // MRSF §9.1: Promote direct replies before removing parent
              const promoted = comments.map((c) => {
                if (c.reply_to !== id) return c;
                const updated = { ...c };

                // Copy targeting fields from parent if reply omits them
                if (updated.line === undefined && parent.line !== undefined)
                  updated.line = parent.line;
                if (updated.end_line === undefined && parent.end_line !== undefined)
                  updated.end_line = parent.end_line;
                if (updated.start_column === undefined && parent.start_column !== undefined)
                  updated.start_column = parent.start_column;
                if (updated.end_column === undefined && parent.end_column !== undefined)
                  updated.end_column = parent.end_column;
                // Only copy selected_text + hash together to avoid mismatched pairs
                if (updated.selected_text === undefined && parent.selected_text !== undefined) {
                  updated.selected_text = parent.selected_text;
                  if (parent.selected_text_hash !== undefined)
                    updated.selected_text_hash = parent.selected_text_hash;
                }

                // Reparent to grandparent (or remove reply_to if parent was root)
                updated.reply_to = parent.reply_to;
                if (!updated.reply_to) delete updated.reply_to;

                return updated;
              });

              return [fp, promoted.filter((c) => c.id !== id)];
            })
          ),
        })),
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/store/__tests__/deleteComment.test.ts`
Expected: all PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: all pass

- [ ] **Step 6: Commit**

```
git add src/store/index.ts src/store/__tests__/deleteComment.test.ts
git commit -m "fix: promote replies when deleting parent comment (MRSF §9.1)

- Copy targeting fields from parent to replies that omit them
- Reparent reply_to to grandparent (or remove if parent was root)
- Add unit tests for all promotion scenarios

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Selection Anchors — Add Hash, Truncation, and Validation

Fix both viewers to compute `selected_text_hash` when creating selection anchors, and add truncation/validation to `createSelectionAnchor`.

**Files:**
- Modify: `src/lib/comment-anchors.ts` (add truncation + validation)
- Modify: `src/lib/__tests__/comment-anchors.test.ts` (add new tests)
- Modify: `src/components/viewers/SourceView.tsx:338-348` (compute hash in `handleAddSelectionComment`)
- Modify: `src/components/viewers/MarkdownViewer.tsx:399-411` (compute hash in `handleAddSelectionComment`)

**Context:** Neither viewer currently computes `selected_text_hash` when creating selection-based comment anchors. The hash function `computeSelectedTextHash` exists in `comment-anchors.ts` but is never called from the selection flows.

- [ ] **Step 1: Write failing tests for enhanced createSelectionAnchor**

Add to `src/lib/__tests__/comment-anchors.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  computeSelectedTextHash,
  createLineAnchor,
  createSelectionAnchor,
} from "@/lib/comment-anchors";

// ... keep existing tests ...

describe("createSelectionAnchor — truncation and validation", () => {
  it("truncates selected_text exceeding 4096 characters", () => {
    const longText = "x".repeat(5000);
    const anchor = createSelectionAnchor(1, 1, 0, 5000, longText, "hash");
    expect(anchor.selected_text.length).toBe(4096);
  });

  it("clamps end_line to be >= line", () => {
    const anchor = createSelectionAnchor(10, 5, 0, 10, "text", "hash");
    expect(anchor.end_line).toBe(10);
  });

  it("clamps end_column to >= start_column on same line", () => {
    const anchor = createSelectionAnchor(10, 10, 20, 5, "text", "hash");
    expect(anchor.end_column).toBe(20);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/comment-anchors.test.ts`
Expected: FAIL for new truncation/validation tests

- [ ] **Step 3: Update createSelectionAnchor with truncation and validation**

Replace `src/lib/comment-anchors.ts` contents:

```typescript
/// MRSF anchor creation helpers.

import { truncateSelectedText, validateTargetingFields } from "./comment-utils";

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
  const validated = validateTargetingFields({
    line: startLine,
    end_line: endLine,
    start_column: startColumn,
    end_column: endColumn,
  });

  return {
    line: validated.line!,
    end_line: validated.end_line!,
    start_column: validated.start_column!,
    end_column: validated.end_column!,
    selected_text: truncateSelectedText(selectedText),
    selected_text_hash: selectedTextHash,
  };
}
```

- [ ] **Step 4: Run comment-anchors tests**

Run: `npx vitest run src/lib/__tests__/comment-anchors.test.ts`
Expected: all PASS

- [ ] **Step 5: Fix SourceView.tsx — compute hash in handleAddSelectionComment**

In `src/components/viewers/SourceView.tsx`, the `handleAddSelectionComment` function (line 338) creates `pendingSelectionAnchor` without `selected_text_hash`. Fix it:

Add import at top:
```typescript
import { computeSelectedTextHash } from "@/lib/comment-anchors";
import { truncateSelectedText } from "@/lib/comment-utils";
```

Change `handleAddSelectionComment` (line 338) to be async and compute the hash:

```typescript
  const handleAddSelectionComment = async () => {
    if (!selectionToolbar) return;
    const { lineNumber, selectedText, startOffset, endLine, endOffset } = selectionToolbar;

    const truncated = truncateSelectedText(selectedText);
    const hash = await computeSelectedTextHash(truncated);

    setPendingSelectionAnchor({
      line: lineNumber,
      end_line: endLine,
      start_column: startOffset,
      end_column: endOffset,
      selected_text: truncated,
      selected_text_hash: hash,
    });

    // Highlight selected lines
    const startLine = lineNumber;
    const endLineNum = endLine ?? lineNumber;
    const highlighted = new Set<number>();
    for (let i = startLine; i <= endLineNum; i++) highlighted.add(i);
    setHighlightedSelectionLines(highlighted);

    setSelectionToolbar(null);
    setCommentingLine(lineNumber);
  };
```

- [ ] **Step 6: Fix MarkdownViewer.tsx — compute hash in handleAddSelectionComment**

In `src/components/viewers/MarkdownViewer.tsx`, the `handleAddSelectionComment` (line 399) also needs hash computation.

Add import at top (near other imports):
```typescript
import { computeSelectedTextHash } from "@/lib/comment-anchors";
import { truncateSelectedText } from "@/lib/comment-utils";
```

Replace `handleAddSelectionComment`:

```typescript
  const handleAddSelectionComment = useCallback(async () => {
    if (!selectionToolbar) return;
    const { lineNumber, selectedText } = selectionToolbar;

    const truncated = truncateSelectedText(selectedText);
    const hash = await computeSelectedTextHash(truncated);

    setPendingSelectionAnchor({
      line: lineNumber,
      selected_text: truncated,
      selected_text_hash: hash,
    });

    setSelectionToolbar(null);
    setCommentingLine(lineNumber);
    setExpandedLine(null);
  }, [selectionToolbar]);
```

- [ ] **Step 7: Run full test suite**

Run: `npx vitest run`
Expected: all pass

- [ ] **Step 8: Commit**

```
git add src/lib/comment-anchors.ts src/lib/__tests__/comment-anchors.test.ts src/components/viewers/SourceView.tsx src/components/viewers/MarkdownViewer.tsx
git commit -m "fix: compute selected_text_hash for selection comments, add truncation

- Both viewers now compute SHA-256 hash when creating selection anchors
- selected_text truncated to 4096 chars per MRSF spec §6.2
- createSelectionAnchor validates end_line >= line, end_column >= start_column

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Line Comments Include Full Line as Selected Text

When a line comment is created (no text selection), include the full line text as `selected_text` with its SHA-256 hash. Per spec §6.2: "For line-only comments, `selected_text` SHOULD contain the full content of the referenced line."

**Files:**
- Modify: `src/components/comments/LineCommentMargin.tsx` (make `handleSave` async, add selected_text)

**Context:** `LineCommentMargin` has a `lineText` prop (the line content) and calls `addComment(filePath, { line: lineNumber }, text)`. It needs to also pass `selected_text` and `selected_text_hash`. Since computing the hash is async, `handleSave` must become async.

- [ ] **Step 1: Update LineCommentMargin to include selected_text for line comments**

In `src/components/comments/LineCommentMargin.tsx`:

Add import:
```typescript
import { computeSelectedTextHash } from "@/lib/comment-anchors";
import { truncateSelectedText } from "@/lib/comment-utils";
```

Replace `handleSave` (lines 30-38):

```typescript
  const handleSave = async (text: string) => {
    if (onSaveComment) {
      onSaveComment(text);
    } else {
      // MRSF §6.2: line-only comments SHOULD include full line as selected_text
      const selectedText = truncateSelectedText(lineText);
      const hash = await computeSelectedTextHash(selectedText);
      addComment(filePath, { line: lineNumber, selected_text: selectedText, selected_text_hash: hash }, text);
    }
    onCloseInput?.();
    setExpanded(true);
  };
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: all pass

- [ ] **Step 3: Commit**

```
git add src/components/comments/LineCommentMargin.tsx
git commit -m "fix: line comments include full line as selected_text (MRSF §6.2)

- Compute selected_text (line content) and selected_text_hash for line comments
- Truncate to 4096 chars per spec
- Improves re-anchoring durability when lines move

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Auto-Populate `commit` Field

Enrich comments with the git HEAD SHA when creating them. Since `getGitHead` is async and store actions are synchronous, add a post-creation enrichment effect in the auto-save hook.

**Files:**
- Create: `src/hooks/useCommitEnricher.ts`
- Create: `src/hooks/__tests__/useCommitEnricher.test.ts`

**Context:** `getGitHead(path)` in `tauri-commands.ts` takes a directory path and returns the full SHA (or null). We'll call it once per file's directory, cache the result, and patch comments that lack a `commit` field before saving.

- [ ] **Step 1: Write failing test**

Create `src/hooks/__tests__/useCommitEnricher.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { enrichCommentsWithCommit, resetCommitCache } from "@/hooks/useCommitEnricher";
import type { MrsfComment } from "@/lib/tauri-commands";
import * as commands from "@/lib/tauri-commands";

vi.mock("@/lib/tauri-commands");

function makeComment(overrides: Partial<MrsfComment> = {}): MrsfComment {
  return {
    id: "c1",
    author: "Test (t)",
    timestamp: "2026-01-01T00:00:00Z",
    text: "test",
    resolved: false,
    ...overrides,
  };
}

describe("enrichCommentsWithCommit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCommitCache();
  });

  it("adds commit SHA to comments that lack it", async () => {
    vi.mocked(commands.getGitHead).mockResolvedValue("abc123def456");
    const comments = [makeComment({ id: "c1" })];
    const result = await enrichCommentsWithCommit(comments, "/path/to/file.md");
    expect(result[0].commit).toBe("abc123def456");
  });

  it("does not overwrite existing commit field", async () => {
    vi.mocked(commands.getGitHead).mockResolvedValue("newsha");
    const comments = [makeComment({ id: "c1", commit: "oldsha" })];
    const result = await enrichCommentsWithCommit(comments, "/path/to/file.md");
    expect(result[0].commit).toBe("oldsha");
  });

  it("returns comments unchanged when git is unavailable", async () => {
    vi.mocked(commands.getGitHead).mockResolvedValue(null);
    const comments = [makeComment({ id: "c1" })];
    const result = await enrichCommentsWithCommit(comments, "/other/path/file.md");
    expect(result[0].commit).toBeUndefined();
  });

  it("returns comments unchanged on error", async () => {
    vi.mocked(commands.getGitHead).mockRejectedValue(new Error("git not found"));
    const comments = [makeComment({ id: "c1" })];
    const result = await enrichCommentsWithCommit(comments, "/another/path/file.md");
    expect(result[0].commit).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/useCommitEnricher.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement enrichCommentsWithCommit**

Create `src/hooks/useCommitEnricher.ts`:

```typescript
import type { MrsfComment } from "@/lib/tauri-commands";
import { getGitHead } from "@/lib/tauri-commands";

// Cache git HEAD per directory with 60s TTL to handle new commits
interface CacheEntry {
  sha: string | null;
  timestamp: number;
}
const CACHE_TTL_MS = 60_000;
const commitCache = new Map<string, CacheEntry>();

/** Reset the cache (for testing). */
export function resetCommitCache(): void {
  commitCache.clear();
}

function dirOf(filePath: string): string {
  const sep = filePath.lastIndexOf("/") !== -1 ? "/" : "\\";
  const idx = filePath.lastIndexOf(sep);
  return idx > 0 ? filePath.slice(0, idx) : filePath;
}

/**
 * Enrich comments that lack a `commit` field with the current git HEAD SHA.
 * Best-effort: returns comments unchanged if git is unavailable.
 */
export async function enrichCommentsWithCommit(
  comments: MrsfComment[],
  filePath: string
): Promise<MrsfComment[]> {
  // Skip if all comments already have commits
  if (comments.every((c) => c.commit)) return comments;

  const dir = dirOf(filePath);
  const cached = commitCache.get(dir);
  let sha: string | null;

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    sha = cached.sha;
  } else {
    try {
      sha = await getGitHead(dir);
    } catch {
      sha = null;
    }
    commitCache.set(dir, { sha, timestamp: Date.now() });
  }

  if (!sha) return comments;

  return comments.map((c) => (c.commit ? c : { ...c, commit: sha }));
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/hooks/__tests__/useCommitEnricher.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```
git add src/hooks/useCommitEnricher.ts src/hooks/__tests__/useCommitEnricher.test.ts
git commit -m "feat: auto-populate commit field from git HEAD (MRSF §6.2)

- enrichCommentsWithCommit() adds git SHA to comments lacking commit field
- Caches git HEAD per directory to avoid repeated calls
- Best-effort: gracefully handles missing git

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Shared useAutoSaveComments Hook with Flush-on-Unmount

Extract the duplicated auto-save `useEffect` from both viewers into a shared hook. Fix the reliability bug: flush pending saves on unmount instead of canceling them. Add error logging and relative document path computation. Integrate commit enrichment.

**Files:**
- Create: `src/hooks/useAutoSaveComments.ts`
- Create: `src/hooks/__tests__/useAutoSaveComments.test.ts`
- Modify: `src/components/viewers/MarkdownViewer.tsx` (remove inline save effect, add hook call)
- Modify: `src/components/viewers/SourceView.tsx` (remove inline save effect, add hook call)

**Context:** Both viewers have this identical pattern:
```typescript
useEffect(() => {
  if (loadedRef.current !== filePath) return;
  const timer = setTimeout(() => {
    const document = filePath.split(/[/\\]/).pop() ?? filePath;
    saveReviewComments(filePath, document, comments ?? [])
      .then(() => setLastSaveTimestamp(Date.now()))
      .catch(() => {});
  }, 500);
  return () => clearTimeout(timer);
}, [comments, filePath, setLastSaveTimestamp]);
```

The bug: when the component unmounts (tab switch), `clearTimeout` cancels the pending save. Comments added within the last 500ms before switching tabs are lost.

The fix: on unmount, fire the save immediately instead of clearing it.

- [ ] **Step 1: Write failing tests**

Create `src/hooks/__tests__/useAutoSaveComments.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutoSaveComments } from "@/hooks/useAutoSaveComments";
import * as commands from "@/lib/tauri-commands";
import * as enricher from "@/hooks/useCommitEnricher";
import { useStore } from "@/store";

vi.mock("@/lib/tauri-commands");
vi.mock("@/hooks/useCommitEnricher");
vi.mock("@/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.mocked(commands.saveReviewComments).mockResolvedValue(undefined);
  vi.mocked(enricher.enrichCommentsWithCommit).mockImplementation(async (c) => c);
  useStore.setState({ root: null, lastSaveTimestamp: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

const comment1 = { id: "c1", author: "A", timestamp: "2026-01-01T00:00:00Z", text: "test", resolved: false };

describe("useAutoSaveComments", () => {
  it("does not save on initial load (not dirty)", async () => {
    // Render with loaded=true but comments haven't changed since load
    renderHook(() => useAutoSaveComments("/path/file.md", [comment1], true));

    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(commands.saveReviewComments).not.toHaveBeenCalled();
  });

  it("saves after comments change post-load", async () => {
    const { rerender } = renderHook(
      ({ comments, loaded }) => useAutoSaveComments("/path/file.md", comments, loaded),
      { initialProps: { comments: [comment1], loaded: true } }
    );

    // Change comments (dirty)
    const comment2 = { ...comment1, id: "c2", text: "new" };
    rerender({ comments: [comment1, comment2], loaded: true });

    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(commands.saveReviewComments).toHaveBeenCalledTimes(1);
  });

  it("uses relative path when workspace root is set", async () => {
    useStore.setState({ root: "/path" });
    const { rerender } = renderHook(
      ({ comments, loaded }) => useAutoSaveComments("/path/sub/file.md", comments, loaded),
      { initialProps: { comments: [comment1], loaded: true } }
    );

    const comment2 = { ...comment1, id: "c2" };
    rerender({ comments: [comment1, comment2], loaded: true });

    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(commands.saveReviewComments).toHaveBeenCalledWith(
      "/path/sub/file.md",
      "sub/file.md",
      expect.any(Array),
    );
  });

  it("flushes save on unmount instead of canceling", async () => {
    const { rerender, unmount } = renderHook(
      ({ comments, loaded }) => useAutoSaveComments("/path/file.md", comments, loaded),
      { initialProps: { comments: [comment1], loaded: true } }
    );

    // Make dirty
    const comment2 = { ...comment1, id: "c2" };
    rerender({ comments: [comment1, comment2], loaded: true });

    // Unmount before debounce fires
    unmount();

    await act(async () => { await vi.runAllTimersAsync(); });

    expect(commands.saveReviewComments).toHaveBeenCalledTimes(1);
  });

  it("does not save when loaded is false", async () => {
    renderHook(() => useAutoSaveComments("/path/file.md", [comment1], false));

    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(commands.saveReviewComments).not.toHaveBeenCalled();
  });

  it("does not create empty sidecar when opening file with no sidecar", async () => {
    renderHook(() => useAutoSaveComments("/path/file.md", undefined, true));

    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(commands.saveReviewComments).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/__tests__/useAutoSaveComments.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement useAutoSaveComments**

Create `src/hooks/useAutoSaveComments.ts`:

```typescript
import { useEffect, useRef, useCallback } from "react";
import { saveReviewComments } from "@/lib/tauri-commands";
import type { MrsfComment } from "@/lib/tauri-commands";
import { enrichCommentsWithCommit } from "./useCommitEnricher";
import { useStore } from "@/store";
import { error as logError } from "@/logger";

function computeDocumentPath(filePath: string, root: string | null): string {
  if (root) {
    // Normalize separators for comparison
    const normalizedFile = filePath.replace(/\\/g, "/");
    const normalizedRoot = root.replace(/\\/g, "/").replace(/\/$/, "") + "/";
    if (normalizedFile.startsWith(normalizedRoot)) {
      return normalizedFile.slice(normalizedRoot.length);
    }
  }
  // Fallback: just the filename
  return filePath.split(/[/\\]/).pop() ?? filePath;
}

/**
 * Auto-save comments to MRSF sidecar file with 500ms debounce.
 * Flushes pending save on unmount to prevent data loss on tab switch.
 *
 * The `loaded` flag prevents saving before the initial sidecar load completes.
 * It uses a ref (not state) to avoid triggering a save on load completion.
 */
export function useAutoSaveComments(
  filePath: string,
  comments: MrsfComment[] | undefined,
  loaded: boolean
) {
  const root = useStore((s) => s.root);
  const setLastSaveTimestamp = useStore((s) => s.setLastSaveTimestamp);

  // Track whether initial load is complete (ref, not state, to avoid triggering saves)
  const loadedRef = useRef(false);
  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  // Track whether comments have changed since initial load (dirty flag)
  const dirtyRef = useRef(false);
  const initialCommentsRef = useRef<MrsfComment[] | undefined>(undefined);

  useEffect(() => {
    // When loaded transitions to true, capture the initial comments
    if (loaded) {
      initialCommentsRef.current = comments;
      dirtyRef.current = false;
    }
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mark dirty when comments change after initial load
  useEffect(() => {
    if (!loadedRef.current) return;
    if (comments !== initialCommentsRef.current) {
      dirtyRef.current = true;
    }
  }, [comments]);

  // Stable save function
  const doSave = useCallback(() => {
    if (!loadedRef.current || !dirtyRef.current) return;
    const document = computeDocumentPath(filePath, root);
    const commentsToSave = comments ?? [];

    enrichCommentsWithCommit(commentsToSave, filePath)
      .then((enriched) => saveReviewComments(filePath, document, enriched))
      .then(() => setLastSaveTimestamp(Date.now()))
      .catch((err) => logError(`Failed to save review comments for ${filePath}: ${err}`));
  }, [comments, filePath, root, setLastSaveTimestamp]);

  // Store latest doSave in a ref for the unmount effect
  const doSaveRef = useRef(doSave);
  useEffect(() => { doSaveRef.current = doSave; }, [doSave]);

  // Debounced save effect — only handles the timer, cleanup just cancels timer
  useEffect(() => {
    if (!loadedRef.current || !dirtyRef.current) return;

    const timer = setTimeout(() => {
      doSave();
    }, 500);

    return () => clearTimeout(timer);
  }, [comments, filePath, doSave]);

  // Separate unmount-only flush effect — runs once, flushes on unmount
  useEffect(() => {
    return () => {
      doSaveRef.current();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
```

Key design decisions:
- **`loadedRef` (ref, not state)**: Prevents a re-render when load completes, which would trigger an immediate save of just-loaded comments.
- **`dirtyRef`**: Tracks whether comments have actually changed since initial load. Prevents saving on file open and prevents creating empty sidecars.
- **Separate unmount effect**: The `[]` dependency array means its cleanup only runs on true unmount, not on every re-render. It calls `doSaveRef.current()` which has the latest save function.
- **Debounce effect cleanup just clears the timer**: No flush on dependency change — only the unmount effect flushes.
```

- [ ] **Step 4: Run hook tests**

Run: `npx vitest run src/hooks/__tests__/useAutoSaveComments.test.ts`
Expected: all PASS

- [ ] **Step 5: Replace inline save effect in SourceView.tsx**

In `src/components/viewers/SourceView.tsx`:

Add import at top:
```typescript
import { useAutoSaveComments } from "@/hooks/useAutoSaveComments";
```

Remove `saveReviewComments` from the import:
Change the import line from:
```typescript
import { loadReviewComments, saveReviewComments } from "@/lib/tauri-commands";
```
to:
```typescript
import { loadReviewComments } from "@/lib/tauri-commands";
```

Remove the `setLastSaveTimestamp` selector (no longer needed — handled by hook):
```typescript
  // Remove: const setLastSaveTimestamp = useStore((s) => s.setLastSaveTimestamp);
```

Delete the entire auto-save `useEffect` block (lines 160-170):
```typescript
  // Auto-save comments to sidecar (debounced, only after initial load)
  useEffect(() => {
    if (loadedRef.current !== filePath) return;
    const timer = setTimeout(() => {
      const document = filePath.split(/[/\\]/).pop() ?? filePath;
      saveReviewComments(filePath, document, comments ?? [])
        .then(() => setLastSaveTimestamp(Date.now()))
        .catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [comments, filePath, setLastSaveTimestamp]);
```

Replace with:
```typescript
  // Auto-save comments to sidecar (shared hook with flush-on-unmount)
  useAutoSaveComments(filePath, comments, loadedRef.current === filePath);
```

Keep `loadedRef` — it's still used by the load effect and can remain as the source of truth for the loaded state.

- [ ] **Step 6: Replace inline save effect in MarkdownViewer.tsx**

Same pattern. In `src/components/viewers/MarkdownViewer.tsx`:

Add import:
```typescript
import { useAutoSaveComments } from "@/hooks/useAutoSaveComments";
```

Remove `saveReviewComments` from the import:
```typescript
import { loadReviewComments } from "@/lib/tauri-commands";
```

Remove `setLastSaveTimestamp`:
```typescript
  // Remove: const setLastSaveTimestamp = useStore((s) => s.setLastSaveTimestamp);
```

Delete the entire auto-save effect block (lines 298-308) and replace with:
```typescript
  useAutoSaveComments(filePath, comments, loadedRef.current === filePath);
```

Keep `loadedRef` — it's still used by the load effect.

- [ ] **Step 7: Run full test suite**

Run: `npx vitest run`
Expected: all pass

- [ ] **Step 8: Commit**

```
git add src/hooks/useAutoSaveComments.ts src/hooks/__tests__/useAutoSaveComments.test.ts src/components/viewers/SourceView.tsx src/components/viewers/MarkdownViewer.tsx
git commit -m "fix: shared auto-save hook with flush-on-unmount

- Extract duplicated auto-save logic into useAutoSaveComments hook
- Flush pending save on unmount (fixes lost comments on tab switch)
- Compute document path relative to workspace root (MRSF §4)
- Enrich comments with git commit SHA before saving
- Log save errors instead of silently swallowing

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Comment Text Length Cap in CommentInput

Add a 16384-character soft limit to the comment textarea per MRSF §6.1.

**Files:**
- Modify: `src/components/comments/CommentInput.tsx`

- [ ] **Step 1: Add text length enforcement to CommentInput**

In `src/components/comments/CommentInput.tsx`:

Add import:
```typescript
import { TEXT_MAX_LENGTH } from "@/lib/comment-utils";
```

Add `maxLength` to the textarea and a character counter when approaching limit:

```typescript
export function CommentInput({ onSave, onClose, placeholder }: Props) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (text.trim() && text.length <= TEXT_MAX_LENGTH) onSave(text.trim());
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const overLimit = text.length > TEXT_MAX_LENGTH;
  const showCounter = text.length > TEXT_MAX_LENGTH - 1000;

  return (
    <div className="comment-input">
      <textarea
        ref={textareaRef}
        className="comment-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? "Add a comment… (Ctrl+Enter to save, Escape to cancel)"}
        rows={3}
      />
      {showCounter && (
        <div className={`comment-char-count${overLimit ? " over-limit" : ""}`}>
          {text.length.toLocaleString()} / {TEXT_MAX_LENGTH.toLocaleString()}
        </div>
      )}
      <div className="comment-input-actions">
        <button
          className="comment-btn comment-btn-primary"
          onClick={() => text.trim() && !overLimit && onSave(text.trim())}
          disabled={!text.trim() || overLimit}
        >
          Save
        </button>
        <button className="comment-btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add CSS for character counter**

In `src/styles/comments.css`, add at the end:

```css
.comment-char-count {
  font-size: 11px;
  text-align: right;
  padding: 0 4px;
  color: var(--text-muted, #888);
}

.comment-char-count.over-limit {
  color: var(--error-color, #d32f2f);
  font-weight: 600;
}
```

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: all pass

- [ ] **Step 4: Commit**

```
git add src/components/comments/CommentInput.tsx src/styles/comments.css
git commit -m "feat: enforce 16384-char text limit in CommentInput (MRSF §6.1)

- Show character counter when approaching limit
- Disable save button when over limit
- Visual feedback for over-limit state

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: Update AGENTS.md Enum Values

Fix the incorrect `type` and `severity` enum values in AGENTS.md to match the MRSF v1.0 spec.

**Files:**
- Modify: `AGENTS.md:170-171`

- [ ] **Step 1: Fix enum values**

In `AGENTS.md`, find:
```
    type: "suggestion"          # issue | suggestion | question | note | praise
    severity: "warning"         # critical | warning | info | nitpick
```

Replace with:
```
    type: "suggestion"          # suggestion | issue | question | accuracy | style | clarity
    severity: "low"             # low | medium | high
```

- [ ] **Step 2: Commit**

```
git add AGENTS.md
git commit -m "docs: fix type/severity enum values to match MRSF v1.0 spec

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 9: Integration Verification

Run all test suites to verify nothing is broken. Check that generated YAML output contains all required fields.

**Files:** None (verification only)

- [ ] **Step 1: Run Vitest**

Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 2: Run Rust tests**

Run: `cd src-tauri && cargo test`
Expected: all tests pass

- [ ] **Step 3: Run E2E tests**

Run: `npm run test:e2e`
Expected: all tests pass
