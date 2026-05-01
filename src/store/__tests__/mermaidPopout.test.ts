/**
 * mermaidPopoutSlice unit tests.
 *
 * Locks down:
 *   1. Open/close lifecycle and shape of `mermaidPopoutOpenFor`.
 *   2. `closeMermaidPopout` is a referential no-op when already closed
 *      (matches the `setGhostEntries` no-op pattern in src/store/index.ts).
 *   3. Persistence allowlist (`partialize` in src/store/index.ts) excludes
 *      `mermaidPopoutOpenFor` — UI state must never persist.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useStore } from "@/store";

beforeEach(() => {
  useStore.setState({ mermaidPopoutOpenFor: null });
});

describe("mermaidPopoutSlice.openMermaidPopout", () => {
  it("opens with null path when path is omitted", () => {
    useStore.getState().openMermaidPopout("graph TD; A-->B;");
    expect(useStore.getState().mermaidPopoutOpenFor).toEqual({
      content: "graph TD; A-->B;",
      path: null,
    });
  });

  it("opens with explicit path", () => {
    useStore.getState().openMermaidPopout("graph TD; A-->B;", "/foo/bar.mmd");
    expect(useStore.getState().mermaidPopoutOpenFor).toEqual({
      content: "graph TD; A-->B;",
      path: "/foo/bar.mmd",
    });
  });

  it("replaces content when called twice (latest wins)", () => {
    useStore.getState().openMermaidPopout("first", "/a.mmd");
    useStore.getState().openMermaidPopout("second", "/b.mmd");
    expect(useStore.getState().mermaidPopoutOpenFor).toEqual({
      content: "second",
      path: "/b.mmd",
    });
  });
});

describe("mermaidPopoutSlice.closeMermaidPopout", () => {
  it("clears mermaidPopoutOpenFor to null", () => {
    useStore.getState().openMermaidPopout("graph TD; A-->B;");
    useStore.getState().closeMermaidPopout();
    expect(useStore.getState().mermaidPopoutOpenFor).toBeNull();
  });

  it("is a referential no-op when already closed", () => {
    const before = useStore.getState().mermaidPopoutOpenFor;
    useStore.getState().closeMermaidPopout();
    const after = useStore.getState().mermaidPopoutOpenFor;
    expect(before).toBeNull();
    expect(after).toBeNull();
    expect(after).toBe(before);
  });
});

/**
 * Persistence contract — same crude-but-stable text scan used by
 * `viewerPrefs.test.ts`: extract the `partialize` body from
 * `src/store/index.ts` and assert the slice's UI state is not persisted.
 */
describe("mermaidPopout persistence allowlist", () => {
  const storeIndex = readFileSync(resolve(process.cwd(), "src/store/index.ts"), "utf8");
  const partializeBody = storeIndex.match(/partialize:\s*\(state\)\s*=>\s*\(\{([\s\S]*?)\}\)/)?.[1] ?? "";

  it("excludes mermaidPopoutOpenFor (UI state — never persisted)", () => {
    expect(partializeBody).not.toMatch(/mermaidPopoutOpenFor/);
  });
});

describe("close-on-context-change", () => {
  it("setRoot(null) closes the popout", async () => {
    useStore.getState().openMermaidPopout("graph TD; A-->B;");
    expect(useStore.getState().mermaidPopoutOpenFor).not.toBeNull();
    await useStore.getState().setRoot(null);
    expect(useStore.getState().mermaidPopoutOpenFor).toBeNull();
  });

  it("closeFolder closes the popout", () => {
    useStore.getState().openMermaidPopout("graph TD; A-->B;");
    expect(useStore.getState().mermaidPopoutOpenFor).not.toBeNull();
    useStore.getState().closeFolder();
    expect(useStore.getState().mermaidPopoutOpenFor).toBeNull();
  });

  it("toggleCommentsPane closes the popout", () => {
    useStore.getState().openMermaidPopout("graph TD; A-->B;");
    expect(useStore.getState().mermaidPopoutOpenFor).not.toBeNull();
    useStore.getState().toggleCommentsPane();
    expect(useStore.getState().mermaidPopoutOpenFor).toBeNull();
  });
});
