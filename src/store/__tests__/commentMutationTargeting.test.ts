import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store";
import type { CommentWithOrphan } from "@/store";

const makeComment = (overrides: Partial<CommentWithOrphan> = {}): CommentWithOrphan => ({
  id: "c1",
  author: "Tester",
  timestamp: "2026-01-01T00:00:00Z",
  text: "original",
  resolved: false,
  line: 1,
  ...overrides,
});

/** Seed the store with comments in two files so we can check referential identity. */
function seedTwoFiles() {
  const fileAComments: CommentWithOrphan[] = [
    makeComment({ id: "a1", text: "comment in A" }),
    makeComment({ id: "a2", text: "second in A" }),
  ];
  const fileBComments: CommentWithOrphan[] = [
    makeComment({ id: "b1", text: "comment in B" }),
  ];
  useStore.setState({
    commentsByFile: {
      "/fileA.md": fileAComments,
      "/fileB.md": fileBComments,
    },
    authorName: "Tester",
  });
  return { fileAComments, fileBComments };
}

beforeEach(() => {
  useStore.setState({ commentsByFile: {}, authorName: "Tester" });
});

// ── editComment ────────────────────────────────────────────────────────────

describe("editComment — targeted mutation", () => {
  it("updates the correct comment text", () => {
    seedTwoFiles();
    useStore.getState().editComment("a1", "updated text");

    const a1 = useStore.getState().commentsByFile["/fileA.md"].find((c) => c.id === "a1")!;
    expect(a1.text).toBe("updated text");
  });

  it("preserves referential identity of unaffected file arrays", () => {
    const { fileBComments } = seedTwoFiles();
    const beforeB = useStore.getState().commentsByFile["/fileB.md"];
    expect(beforeB).toBe(fileBComments);

    useStore.getState().editComment("a1", "new text");

    const afterB = useStore.getState().commentsByFile["/fileB.md"];
    expect(afterB).toBe(beforeB);
  });

  it("creates a new reference for the affected file array", () => {
    seedTwoFiles();
    const beforeA = useStore.getState().commentsByFile["/fileA.md"];

    useStore.getState().editComment("a1", "new text");

    const afterA = useStore.getState().commentsByFile["/fileA.md"];
    expect(afterA).not.toBe(beforeA);
  });

  it("is a no-op when comment ID does not exist", () => {
    seedTwoFiles();
    const before = useStore.getState().commentsByFile;

    useStore.getState().editComment("nonexistent", "whatever");

    const after = useStore.getState().commentsByFile;
    expect(after).toBe(before);
  });
});

// ── deleteComment ──────────────────────────────────────────────────────────

describe("deleteComment — targeted mutation", () => {
  it("removes the correct comment", () => {
    seedTwoFiles();
    useStore.getState().deleteComment("a1");

    const commentsA = useStore.getState().commentsByFile["/fileA.md"];
    expect(commentsA).toHaveLength(1);
    expect(commentsA[0].id).toBe("a2");
  });

  it("preserves referential identity of unaffected file arrays", () => {
    const { fileBComments } = seedTwoFiles();
    const beforeB = useStore.getState().commentsByFile["/fileB.md"];
    expect(beforeB).toBe(fileBComments);

    useStore.getState().deleteComment("a1");

    const afterB = useStore.getState().commentsByFile["/fileB.md"];
    expect(afterB).toBe(beforeB);
  });

  it("is a no-op when comment ID does not exist", () => {
    seedTwoFiles();
    const before = useStore.getState().commentsByFile;

    useStore.getState().deleteComment("nonexistent");

    const after = useStore.getState().commentsByFile;
    expect(after).toBe(before);
  });
});

// ── resolveComment ─────────────────────────────────────────────────────────

describe("resolveComment — targeted mutation", () => {
  it("marks the correct comment as resolved", () => {
    seedTwoFiles();
    useStore.getState().resolveComment("a1");

    const a1 = useStore.getState().commentsByFile["/fileA.md"].find((c) => c.id === "a1")!;
    expect(a1.resolved).toBe(true);
  });

  it("preserves referential identity of unaffected file arrays", () => {
    const { fileBComments } = seedTwoFiles();
    const beforeB = useStore.getState().commentsByFile["/fileB.md"];
    expect(beforeB).toBe(fileBComments);

    useStore.getState().resolveComment("a1");

    const afterB = useStore.getState().commentsByFile["/fileB.md"];
    expect(afterB).toBe(beforeB);
  });

  it("is a no-op when comment ID does not exist", () => {
    seedTwoFiles();
    const before = useStore.getState().commentsByFile;

    useStore.getState().resolveComment("nonexistent");

    const after = useStore.getState().commentsByFile;
    expect(after).toBe(before);
  });
});

// ── unresolveComment ───────────────────────────────────────────────────────

describe("unresolveComment — targeted mutation", () => {
  it("marks the correct comment as unresolved", () => {
    seedTwoFiles();
    // First resolve it, then unresolve
    useStore.getState().resolveComment("b1");
    expect(useStore.getState().commentsByFile["/fileB.md"][0].resolved).toBe(true);

    useStore.getState().unresolveComment("b1");

    const b1 = useStore.getState().commentsByFile["/fileB.md"].find((c) => c.id === "b1")!;
    expect(b1.resolved).toBe(false);
  });

  it("preserves referential identity of unaffected file arrays", () => {
    seedTwoFiles();
    // Resolve b1 first so unresolve has something to do
    useStore.getState().resolveComment("b1");
    const beforeA = useStore.getState().commentsByFile["/fileA.md"];

    useStore.getState().unresolveComment("b1");

    const afterA = useStore.getState().commentsByFile["/fileA.md"];
    expect(afterA).toBe(beforeA);
  });

  it("is a no-op when comment ID does not exist", () => {
    seedTwoFiles();
    const before = useStore.getState().commentsByFile;

    useStore.getState().unresolveComment("nonexistent");

    const after = useStore.getState().commentsByFile;
    expect(after).toBe(before);
  });
});
