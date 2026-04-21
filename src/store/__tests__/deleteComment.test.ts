import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store";

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

    const r1 = comments.find((c) => c.id === "reply1")!;
    expect(r1.reply_to).toBeUndefined();
    expect(r1.line).toBe(10);

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
