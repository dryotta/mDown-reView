import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store/index";
import type { CommentWithOrphan } from "@/store/index";

const initialState = useStore.getState();
const FILE = "/docs/notes.md";

beforeEach(() => {
  useStore.setState(initialState, true);
});

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
    expect((c as unknown as Record<string, unknown>).anchorType).toBeUndefined();
    expect((c as unknown as Record<string, unknown>).lineHash).toBeUndefined();
    expect((c as unknown as Record<string, unknown>).createdAt).toBeUndefined();
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

  it("addReply inherits parent line", () => {
    const store = useStore.getState();
    store.setAuthorName("U (u)");
    store.addComment("f.md", { line: 42 }, "Root");
    const rootId = useStore.getState().commentsByFile["f.md"][0].id;
    store.addReply("f.md", rootId, "Reply");
    const reply = useStore.getState().commentsByFile["f.md"][1];
    expect(reply.line).toBe(42);
  });

  it("resolveComment sets resolved to true", () => {
    const store = useStore.getState();
    store.setAuthorName("U (u)");
    store.addComment("f.md", { line: 1 }, "Test");
    const id = useStore.getState().commentsByFile["f.md"][0].id;
    store.resolveComment(id);
    expect(useStore.getState().commentsByFile["f.md"][0].resolved).toBe(true);
  });

  it("unresolveComment sets resolved back to false", () => {
    const store = useStore.getState();
    store.setAuthorName("U (u)");
    store.addComment("f.md", { line: 1 }, "Test");
    const id = useStore.getState().commentsByFile["f.md"][0].id;
    store.resolveComment(id);
    store.unresolveComment(id);
    expect(useStore.getState().commentsByFile["f.md"][0].resolved).toBe(false);
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

  it("addComment defaults to Anonymous when no author set", () => {
    const store = useStore.getState();
    store.addComment("f.md", { line: 1 }, "anon comment");
    const c = useStore.getState().commentsByFile["f.md"][0];
    expect(c.author).toBe("Anonymous");
  });

  it("editComment preserves all fields", () => {
    const store = useStore.getState();
    store.setAuthorName("A (a)");
    store.addComment("f.md", { line: 5 }, "original");
    const id = useStore.getState().commentsByFile["f.md"][0].id;
    store.editComment(id, "updated");
    const c = useStore.getState().commentsByFile["f.md"][0];
    expect(c.text).toBe("updated");
    expect(c.line).toBe(5);
    expect(c.author).toBe("A (a)");
  });

  it("generates unique ids", () => {
    const store = useStore.getState();
    store.addComment("f.md", { line: 1 }, "first");
    store.addComment("f.md", { line: 2 }, "second");
    const [c1, c2] = useStore.getState().commentsByFile["f.md"];
    expect(c1.id).not.toBe(c2.id);
  });
});

describe("orphaned flag preservation (MRSF)", () => {
  it("editing preserves isOrphaned", () => {
    const orphaned: CommentWithOrphan = {
      id: "orph-1",
      author: "A",
      timestamp: new Date().toISOString(),
      text: "original",
      resolved: false,
      line: 1,
      isOrphaned: true,
    };
    useStore.getState().setFileComments(FILE, [orphaned]);
    useStore.getState().editComment("orph-1", "new text");
    const [updated] = useStore.getState().commentsByFile[FILE];
    expect(updated.isOrphaned).toBe(true);
    expect(updated.text).toBe("new text");
  });

  it("resolving preserves matchedLineNumber", () => {
    const comment: CommentWithOrphan = {
      id: "ml-1",
      author: "A",
      timestamp: new Date().toISOString(),
      text: "test",
      resolved: false,
      line: 10,
      matchedLineNumber: 15,
    };
    useStore.getState().setFileComments(FILE, [comment]);
    useStore.getState().resolveComment("ml-1");
    const [updated] = useStore.getState().commentsByFile[FILE];
    expect(updated.matchedLineNumber).toBe(15);
    expect(updated.resolved).toBe(true);
  });
});

