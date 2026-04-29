/**
 * `pendingFragment` slice contract.
 *
 * Fragment-aware cross-file link navigation (markdown + HTML preview):
 * the producer (link click handler) stashes `{path, fragment}`; the
 * destination viewer consumes by matching path on first render. Tests
 * mirror the `pendingScrollTarget` contract so the two transient slots
 * behave identically.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store";

beforeEach(() => {
  useStore.setState({ pendingFragment: null });
});

describe("pendingFragment slice", () => {
  it("starts null", () => {
    expect(useStore.getState().pendingFragment).toBeNull();
  });

  it("set then consume by matching path returns fragment and clears", () => {
    useStore.getState().setPendingFragment({ path: "/wk/a.md", fragment: "intro" });
    expect(useStore.getState().pendingFragment).toEqual({
      path: "/wk/a.md",
      fragment: "intro",
    });

    expect(useStore.getState().consumePendingFragment("/wk/a.md")).toBe("intro");
    expect(useStore.getState().pendingFragment).toBeNull();
  });

  it("consume with non-matching path returns null and leaves entry intact", () => {
    useStore.getState().setPendingFragment({ path: "/wk/a.md", fragment: "x" });
    expect(useStore.getState().consumePendingFragment("/wk/b.md")).toBeNull();
    expect(useStore.getState().pendingFragment).toEqual({
      path: "/wk/a.md",
      fragment: "x",
    });
  });

  it("subsequent set supersedes prior entry", () => {
    useStore.getState().setPendingFragment({ path: "/wk/a.md", fragment: "first" });
    useStore.getState().setPendingFragment({ path: "/wk/b.md", fragment: "second" });
    expect(useStore.getState().pendingFragment).toEqual({
      path: "/wk/b.md",
      fragment: "second",
    });
  });

  it("consume is one-shot — second call returns null", () => {
    useStore.getState().setPendingFragment({ path: "/wk/a.md", fragment: "x" });
    expect(useStore.getState().consumePendingFragment("/wk/a.md")).toBe("x");
    expect(useStore.getState().consumePendingFragment("/wk/a.md")).toBeNull();
  });

  it("explicit null clear empties the field", () => {
    useStore.getState().setPendingFragment({ path: "/wk/a.md", fragment: "x" });
    useStore.getState().setPendingFragment(null);
    expect(useStore.getState().pendingFragment).toBeNull();
  });
});
