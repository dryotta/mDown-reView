import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCommentActions } from "../use-comment-actions";
import {
  addComment as addCommentCmd,
  addReply as addReplyCmd,
  editComment as editCommentCmd,
  deleteComment as deleteCommentCmd,
  updateComment,
  computeAnchorHash,
} from "@/lib/tauri-commands";
import { useStore } from "@/store";
import { error as logError } from "@/logger";

vi.mock("@/store", () => ({
  useStore: vi.fn(((selector: (state: { authorName: string }) => string) => {
    const state = { authorName: "Test Author" };
    return selector ? selector(state) : state;
  }) as typeof useStore),
}));

vi.mock("@/lib/tauri-commands", () => ({
  addComment: vi.fn().mockResolvedValue(undefined),
  addReply: vi.fn().mockResolvedValue(undefined),
  editComment: vi.fn().mockResolvedValue(undefined),
  deleteComment: vi.fn().mockResolvedValue(undefined),
  updateComment: vi.fn().mockResolvedValue(undefined),
  computeAnchorHash: vi.fn().mockResolvedValue("auto-hash-123"),
}));

vi.mock("@/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();

  // Reset store mock to default author
  vi.mocked(useStore).mockImplementation(
    ((selector: (state: { authorName: string }) => string) => {
      const state = { authorName: "Test Author" };
      return selector ? selector(state) : state;
    }) as typeof useStore,
  );
});

describe("useCommentActions", () => {
  // ── addComment ───────────────────────────────────────────────────────────

  describe("addComment", () => {
    it("calls addComment command with author from store", async () => {
      const { result } = renderHook(() => useCommentActions());

      await act(async () => {
        await result.current.addComment("/test.md", "hello world");
      });

      expect(addCommentCmd).toHaveBeenCalledWith(
        "/test.md",
        "Test Author",
        "hello world",
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });

    it('uses "Anonymous" when authorName is empty', async () => {
      vi.mocked(useStore).mockImplementation(
        ((selector: (state: { authorName: string }) => string) => {
          const state = { authorName: "" };
          return selector ? selector(state) : state;
        }) as typeof useStore,
      );

      const { result } = renderHook(() => useCommentActions());

      await act(async () => {
        await result.current.addComment("/test.md", "hello");
      });

      expect(addCommentCmd).toHaveBeenCalledWith(
        "/test.md",
        "Anonymous",
        "hello",
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });

    it("passes anchor, commentType, severity, document when provided", async () => {
      const { result } = renderHook(() => useCommentActions());
      const anchor = { line: 5, selected_text: "code" };

      await act(async () => {
        await result.current.addComment(
          "/test.md",
          "issue here",
          anchor,
          "issue",
          "high",
          "README.md",
        );
      });

      expect(computeAnchorHash).toHaveBeenCalledWith("code");
      expect(addCommentCmd).toHaveBeenCalledWith(
        "/test.md",
        "Test Author",
        "issue here",
        { line: 5, selected_text: "code", selected_text_hash: "auto-hash-123" },
        "issue",
        "high",
        "README.md",
      );
    });

    it("auto-computes hash when anchor has selected_text but no selected_text_hash", async () => {
      const { result } = renderHook(() => useCommentActions());

      await act(async () => {
        await result.current.addComment(
          "/test.md",
          "comment",
          { line: 10, selected_text: "some text" },
        );
      });

      expect(computeAnchorHash).toHaveBeenCalledWith("some text");
      expect(addCommentCmd).toHaveBeenCalledWith(
        "/test.md",
        "Test Author",
        "comment",
        { line: 10, selected_text: "some text", selected_text_hash: "auto-hash-123" },
        undefined,
        undefined,
        undefined,
      );
    });

    it("skips hash computation when selected_text_hash is already provided", async () => {
      const { result } = renderHook(() => useCommentActions());
      const anchor = { line: 5, selected_text: "code", selected_text_hash: "existing-hash" };

      await act(async () => {
        await result.current.addComment("/test.md", "note", anchor);
      });

      expect(computeAnchorHash).not.toHaveBeenCalled();
      expect(addCommentCmd).toHaveBeenCalledWith(
        "/test.md",
        "Test Author",
        "note",
        anchor,
        undefined,
        undefined,
        undefined,
      );
    });

    it("skips hash computation when anchor has no selected_text", async () => {
      const { result } = renderHook(() => useCommentActions());
      const anchor = { line: 5 };

      await act(async () => {
        await result.current.addComment("/test.md", "note", anchor);
      });

      expect(computeAnchorHash).not.toHaveBeenCalled();
      expect(addCommentCmd).toHaveBeenCalledWith(
        "/test.md",
        "Test Author",
        "note",
        anchor,
        undefined,
        undefined,
        undefined,
      );
    });

    it("throws and logs error when command fails", async () => {
      const err = new Error("add failed");
      vi.mocked(addCommentCmd).mockRejectedValueOnce(err);

      const { result } = renderHook(() => useCommentActions());

      let thrownError: unknown;
      await act(async () => {
        try {
          await result.current.addComment("/test.md", "hello");
        } catch (e) {
          thrownError = e;
        }
      });

      expect(thrownError).toBe(err);
      expect(logError).toHaveBeenCalled();
    });
  });

  // ── addReply ─────────────────────────────────────────────────────────────

  describe("addReply", () => {
    it("calls addReply command with correct args", async () => {
      const { result } = renderHook(() => useCommentActions());

      await act(async () => {
        await result.current.addReply("/test.md", "parent-1", "reply text");
      });

      expect(addReplyCmd).toHaveBeenCalledWith(
        "/test.md",
        "parent-1",
        "Test Author",
        "reply text",
      );
    });

    it('uses "Anonymous" for empty author', async () => {
      vi.mocked(useStore).mockImplementation(
        ((selector: (state: { authorName: string }) => string) => {
          const state = { authorName: "" };
          return selector ? selector(state) : state;
        }) as typeof useStore,
      );

      const { result } = renderHook(() => useCommentActions());

      await act(async () => {
        await result.current.addReply("/test.md", "parent-1", "reply");
      });

      expect(addReplyCmd).toHaveBeenCalledWith(
        "/test.md",
        "parent-1",
        "Anonymous",
        "reply",
      );
    });

    it("throws and logs error on failure", async () => {
      const err = new Error("reply failed");
      vi.mocked(addReplyCmd).mockRejectedValueOnce(err);

      const { result } = renderHook(() => useCommentActions());

      let thrownError: unknown;
      await act(async () => {
        try {
          await result.current.addReply("/test.md", "p1", "text");
        } catch (e) {
          thrownError = e;
        }
      });

      expect(thrownError).toBe(err);
      expect(logError).toHaveBeenCalled();
    });
  });

  // ── editComment ──────────────────────────────────────────────────────────

  describe("editComment", () => {
    it("calls editComment command with filePath, commentId, text", async () => {
      const { result } = renderHook(() => useCommentActions());

      await act(async () => {
        await result.current.editComment("/test.md", "c1", "updated text");
      });

      expect(editCommentCmd).toHaveBeenCalledWith(
        "/test.md",
        "c1",
        "updated text",
      );
    });

    it("throws on failure", async () => {
      const err = new Error("edit failed");
      vi.mocked(editCommentCmd).mockRejectedValueOnce(err);

      const { result } = renderHook(() => useCommentActions());

      let thrownError: unknown;
      await act(async () => {
        try {
          await result.current.editComment("/test.md", "c1", "text");
        } catch (e) {
          thrownError = e;
        }
      });

      expect(thrownError).toBe(err);
      expect(logError).toHaveBeenCalled();
    });
  });

  // ── deleteComment ────────────────────────────────────────────────────────

  describe("deleteComment", () => {
    it("calls deleteComment command", async () => {
      const { result } = renderHook(() => useCommentActions());

      await act(async () => {
        await result.current.deleteComment("/test.md", "c1");
      });

      expect(deleteCommentCmd).toHaveBeenCalledWith("/test.md", "c1");
    });

    it("throws on failure", async () => {
      const err = new Error("delete failed");
      vi.mocked(deleteCommentCmd).mockRejectedValueOnce(err);

      const { result } = renderHook(() => useCommentActions());

      let thrownError: unknown;
      await act(async () => {
        try {
          await result.current.deleteComment("/test.md", "c1");
        } catch (e) {
          thrownError = e;
        }
      });

      expect(thrownError).toBe(err);
      expect(logError).toHaveBeenCalled();
    });
  });

  // ── resolveComment ───────────────────────────────────────────────────────

  describe("resolveComment", () => {
    it("dispatches updateComment with set_resolved patch (true)", async () => {
      const { result } = renderHook(() => useCommentActions());

      await act(async () => {
        await result.current.resolveComment("/test.md", "c1");
      });

      expect(updateComment).toHaveBeenCalledWith("/test.md", "c1", {
        kind: "set_resolved",
        data: { resolved: true },
      });
    });

    it("throws on failure", async () => {
      const err = new Error("resolve failed");
      vi.mocked(updateComment).mockRejectedValueOnce(err);

      const { result } = renderHook(() => useCommentActions());

      let thrownError: unknown;
      await act(async () => {
        try {
          await result.current.resolveComment("/test.md", "c1");
        } catch (e) {
          thrownError = e;
        }
      });

      expect(thrownError).toBe(err);
      expect(logError).toHaveBeenCalled();
    });
  });

  // ── unresolveComment ─────────────────────────────────────────────────────

  describe("unresolveComment", () => {
    it("dispatches updateComment with set_resolved patch (false)", async () => {
      const { result } = renderHook(() => useCommentActions());

      await act(async () => {
        await result.current.unresolveComment("/test.md", "c1");
      });

      expect(updateComment).toHaveBeenCalledWith("/test.md", "c1", {
        kind: "set_resolved",
        data: { resolved: false },
      });
    });

    it("throws on failure", async () => {
      const err = new Error("unresolve failed");
      vi.mocked(updateComment).mockRejectedValueOnce(err);

      const { result } = renderHook(() => useCommentActions());

      let thrownError: unknown;
      await act(async () => {
        try {
          await result.current.unresolveComment("/test.md", "c1");
        } catch (e) {
          thrownError = e;
        }
      });

      expect(thrownError).toBe(err);
      expect(logError).toHaveBeenCalled();
    });
  });

  // ── commitMoveAnchor ─────────────────────────────────────────────────────

  describe("commitMoveAnchor", () => {
    it("dispatches updateComment with move_anchor patch carrying tagged Anchor", async () => {
      const { result } = renderHook(() => useCommentActions());

      await act(async () => {
        await result.current.commitMoveAnchor("/test.md", "c1", { kind: "line", line: 7 });
      });

      expect(updateComment).toHaveBeenCalledWith("/test.md", "c1", {
        kind: "move_anchor",
        data: { new_anchor: { kind: "line", line: 7 } },
      });
    });

    it("throws and logs on failure", async () => {
      const err = new Error("move failed");
      vi.mocked(updateComment).mockRejectedValueOnce(err);

      const { result } = renderHook(() => useCommentActions());

      let thrownError: unknown;
      await act(async () => {
        try {
          await result.current.commitMoveAnchor("/test.md", "c1", { kind: "line", line: 1 });
        } catch (e) {
          thrownError = e;
        }
      });

      expect(thrownError).toBe(err);
      expect(logError).toHaveBeenCalled();
    });
  });

  // ── addReaction ──────────────────────────────────────────────────────────

  describe("addReaction", () => {
    it("dispatches updateComment with add_reaction patch carrying user/kind/ts", async () => {
      const { result } = renderHook(() => useCommentActions());

      await act(async () => {
        await result.current.addReaction("/test.md", "c1", "thumbsup");
      });

      expect(updateComment).toHaveBeenCalledTimes(1);
      const [path, id, patch] = vi.mocked(updateComment).mock.calls[0];
      expect(path).toBe("/test.md");
      expect(id).toBe("c1");
      expect(patch.kind).toBe("add_reaction");
      const data = (patch as { data: { user: string; kind: string; ts: string } }).data;
      expect(data.user).toBe("Test Author");
      expect(data.kind).toBe("thumbsup");
      // ts is an ISO date string
      expect(typeof data.ts).toBe("string");
      expect(Number.isNaN(Date.parse(data.ts))).toBe(false);
    });

    it('uses "Anonymous" when authorName is empty', async () => {
      vi.mocked(useStore).mockImplementation(
        ((selector: (state: { authorName: string }) => string) => {
          const state = { authorName: "" };
          return selector ? selector(state) : state;
        }) as typeof useStore,
      );

      const { result } = renderHook(() => useCommentActions());

      await act(async () => {
        await result.current.addReaction("/test.md", "c1", "ack");
      });

      const data = vi.mocked(updateComment).mock.calls[0][2] as {
        data: { user: string };
      };
      expect(data.data.user).toBe("Anonymous");
    });

    it("throws and logs on IPC failure", async () => {
      const err = new Error("react failed");
      vi.mocked(updateComment).mockRejectedValueOnce(err);

      const { result } = renderHook(() => useCommentActions());

      let thrownError: unknown;
      await act(async () => {
        try {
          await result.current.addReaction("/test.md", "c1", "dismiss");
        } catch (e) {
          thrownError = e;
        }
      });

      expect(thrownError).toBe(err);
      expect(logError).toHaveBeenCalled();
    });
  });
});
