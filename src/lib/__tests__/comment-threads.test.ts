import { describe, it, expect } from "vitest";
import { groupCommentsIntoThreads } from "@/lib/comment-threads";
import type { MatchedComment } from "@/lib/tauri-commands";

function makeComment(id: string, overrides: Partial<MatchedComment> = {}): MatchedComment {
  return {
    id,
    author: "Tester (test)",
    timestamp: "2026-01-01T00:00:00Z",
    text: `Comment ${id}`,
    resolved: false,
    ...overrides,
  };
}

describe("groupCommentsIntoThreads", () => {
  it("returns empty array for empty input", () => {
    expect(groupCommentsIntoThreads([])).toEqual([]);
  });

  it("treats comments without reply_to as individual root threads with no replies", () => {
    const comments = [makeComment("a"), makeComment("b")];
    const threads = groupCommentsIntoThreads(comments);
    expect(threads).toHaveLength(2);
    expect(threads[0].root.id).toBe("a");
    expect(threads[0].replies).toHaveLength(0);
    expect(threads[1].root.id).toBe("b");
    expect(threads[1].replies).toHaveLength(0);
  });

  it("groups a reply under its root thread", () => {
    const comments = [makeComment("root"), makeComment("reply", { reply_to: "root" })];
    const threads = groupCommentsIntoThreads(comments);
    expect(threads).toHaveLength(1);
    expect(threads[0].root.id).toBe("root");
    expect(threads[0].replies).toHaveLength(1);
    expect(threads[0].replies[0].id).toBe("reply");
  });

  it("groups multiple replies under the same root", () => {
    const comments = [
      makeComment("root"),
      makeComment("r1", { reply_to: "root" }),
      makeComment("r2", { reply_to: "root" }),
    ];
    const threads = groupCommentsIntoThreads(comments);
    expect(threads).toHaveLength(1);
    expect(threads[0].replies).toHaveLength(2);
    const replyIds = threads[0].replies.map((r) => r.id);
    expect(replyIds).toContain("r1");
    expect(replyIds).toContain("r2");
  });

  it("sorts replies by timestamp ascending", () => {
    const comments = [
      makeComment("root"),
      makeComment("r-later", { reply_to: "root", timestamp: "2026-01-03T00:00:00Z" }),
      makeComment("r-earlier", { reply_to: "root", timestamp: "2026-01-02T00:00:00Z" }),
    ];
    const threads = groupCommentsIntoThreads(comments);
    expect(threads[0].replies[0].id).toBe("r-earlier");
    expect(threads[0].replies[1].id).toBe("r-later");
  });

  it("promotes orphaned replies (reply_to points to non-existent parent) to root threads", () => {
    const comments = [makeComment("orphan", { reply_to: "nonexistent" })];
    const threads = groupCommentsIntoThreads(comments);
    expect(threads).toHaveLength(1);
    expect(threads[0].root.id).toBe("orphan");
    expect(threads[0].replies).toHaveLength(0);
  });

  it("mixes root threads and orphaned replies correctly", () => {
    const comments = [
      makeComment("real-root"),
      makeComment("real-reply", { reply_to: "real-root" }),
      makeComment("orphan", { reply_to: "gone" }),
    ];
    const threads = groupCommentsIntoThreads(comments);
    // real-root thread + orphan promoted to root
    expect(threads).toHaveLength(2);
    const rootThread = threads.find((t) => t.root.id === "real-root")!;
    expect(rootThread.replies).toHaveLength(1);
    const orphanThread = threads.find((t) => t.root.id === "orphan")!;
    expect(orphanThread.replies).toHaveLength(0);
  });

  it("reply whose reply_to is its own id is treated as an orphan (not infinite loop)", () => {
    const comments = [makeComment("self-ref", { reply_to: "self-ref" })];
    const threads = groupCommentsIntoThreads(comments);
    // self-ref is not in rootIds (it has reply_to), so its reply_to won't be found in rootIds
    expect(threads).toHaveLength(1);
    expect(threads[0].root.id).toBe("self-ref");
  });
});
