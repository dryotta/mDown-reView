/**
 * Iter 10 Group B — pendingScrollTarget slice contract.
 *
 * The cross-file scroll handoff between `CommentsPanel` (producer) and
 * the destination viewer's `useScrollToLine` (consumer) hinges on:
 *   - monotonic nonce so rapid clicks supersede earlier targets,
 *   - consume-by-filePath atomicity so a viewer mounting for the wrong
 *     file cannot accidentally drain someone else's queued target.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store";

beforeEach(() => {
  useStore.setState({ pendingScrollTarget: null });
});

describe("pendingScrollTarget slice", () => {
  it("starts null", () => {
    expect(useStore.getState().pendingScrollTarget).toBeNull();
  });

  it("set then consume by matching filePath returns target and clears", () => {
    useStore.getState().setPendingScrollTarget({ filePath: "/a.md", line: 12 });
    const t = useStore.getState().pendingScrollTarget;
    expect(t).not.toBeNull();
    expect(t!.filePath).toBe("/a.md");
    expect(t!.line).toBe(12);
    expect(typeof t!.nonce).toBe("number");

    const consumed = useStore.getState().consumePendingScrollTarget("/a.md");
    expect(consumed).toEqual({ line: 12, commentId: undefined });
    expect(useStore.getState().pendingScrollTarget).toBeNull();
  });

  it("consume with non-matching filePath returns null and leaves target intact", () => {
    useStore
      .getState()
      .setPendingScrollTarget({ filePath: "/a.md", line: 5, commentId: "c1" });
    const consumed = useStore.getState().consumePendingScrollTarget("/b.md");
    expect(consumed).toBeNull();
    const remaining = useStore.getState().pendingScrollTarget;
    expect(remaining).not.toBeNull();
    expect(remaining!.filePath).toBe("/a.md");
    expect(remaining!.line).toBe(5);
    expect(remaining!.commentId).toBe("c1");
  });

  it("subsequent set supersedes prior target with a fresh, larger nonce", () => {
    useStore.getState().setPendingScrollTarget({ filePath: "/a.md", line: 1 });
    const first = useStore.getState().pendingScrollTarget!;
    useStore.getState().setPendingScrollTarget({ filePath: "/a.md", line: 99 });
    const second = useStore.getState().pendingScrollTarget!;
    expect(second.line).toBe(99);
    expect(second.nonce).toBeGreaterThan(first.nonce);

    const consumed = useStore.getState().consumePendingScrollTarget("/a.md");
    expect(consumed).toEqual({ line: 99, commentId: undefined });
  });

  it("consume is one-shot — second consume returns null", () => {
    useStore.getState().setPendingScrollTarget({ filePath: "/a.md", line: 3 });
    expect(useStore.getState().consumePendingScrollTarget("/a.md")).not.toBeNull();
    expect(useStore.getState().consumePendingScrollTarget("/a.md")).toBeNull();
  });

  it("explicit null clear empties the field", () => {
    useStore.getState().setPendingScrollTarget({ filePath: "/a.md", line: 1 });
    useStore.getState().setPendingScrollTarget(null);
    expect(useStore.getState().pendingScrollTarget).toBeNull();
  });

  it("preserves commentId through consume", () => {
    useStore
      .getState()
      .setPendingScrollTarget({ filePath: "/a.md", line: 4, commentId: "abc" });
    expect(useStore.getState().consumePendingScrollTarget("/a.md")).toEqual({
      line: 4,
      commentId: "abc",
    });
  });
});
