/**
 * Tests for the multi-window file singleton (issue #352 / iter-15).
 *
 * The renderer's `openFile` action calls `claim_open_file` after
 * synchronously adding the tab. On `OwnedElsewhere` (another live
 * window already has the path), the helper reverts the local tab —
 * Rust has already focused the owner window and emitted `focus-tab`
 * to it.
 *
 * These tests exercise the claim flow at the store layer with a
 * mocked `claimOpenFile` IPC.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useStore } from "@/store";

const claimMock = vi.fn();
const releaseMock = vi.fn();
const releaseManyMock = vi.fn();
vi.mock("@/lib/tauri-commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri-commands")>();
  return {
    ...actual,
    claimOpenFile: (path: string) => claimMock(path),
    releaseOpenFile: (path: string) => releaseMock(path),
    releaseOpenFiles: (paths: string[]) => releaseManyMock(paths),
    // Issue #359 — openFile awaits this. Inline a stable success
    // shape so the multi-window singleton tests don't have to thread
    // a register mock through every assertion.
    registerWindowFile: async (path: string) => ({
      canonical: path,
      classification: { tier: "inside", canonical: path },
    }),
  };
});

beforeEach(() => {
  claimMock.mockReset();
  claimMock.mockResolvedValue({ kind: "claimed" });
  releaseMock.mockReset();
  releaseMock.mockResolvedValue(undefined);
  releaseManyMock.mockReset();
  releaseManyMock.mockResolvedValue(undefined);
  useStore.setState({
    tabs: [],
    activeTabPath: null,
    viewModeByTab: {},
    fileMetaByPath: {},
    excalidrawDirtyByTab: {},
    externalChangePendingByTab: {},
    excalidrawEditorMounts: [],
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("openFile multi-window singleton (iter-15)", () => {
  it("Claimed: tab is added and stays open", async () => {
    claimMock.mockResolvedValue({ kind: "claimed" });
    await useStore.getState().openFile("/ws/owned-locally.md", { recordHistory: false });
    // Synchronous: the tab is added immediately for instant UX.
    expect(useStore.getState().tabs.map((t) => t.path)).toEqual([
      "/ws/owned-locally.md",
    ]);
    // Drain microtasks so the awaited claim settles.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(claimMock).toHaveBeenCalledWith("/ws/owned-locally.md");
    // Still open after Claimed.
    expect(useStore.getState().tabs.map((t) => t.path)).toEqual([
      "/ws/owned-locally.md",
    ]);
    expect(useStore.getState().activeTabPath).toBe("/ws/owned-locally.md");
  });

  it("OwnedElsewhere: revert removes the local tab and clears active path", async () => {
    claimMock.mockResolvedValue({
      kind: "owned-elsewhere",
      window_label: "win-1",
    });
    await useStore.getState().openFile("/ws/owned-by-other.md", { recordHistory: false });

    // Issue #359 — openFile is now async (awaits register_window_file
    // before inserting the tab). Pending microtasks (incl. claimOrRevert)
    // may have already drained between insert and the resumption of the
    // test's await; assert only the post-drain state.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Revert: tab gone, active back to null (no other tabs).
    expect(useStore.getState().tabs).toEqual([]);
    expect(useStore.getState().activeTabPath).toBeNull();
  });

  it("OwnedElsewhere: revert preserves OTHER unrelated tabs and re-points active to most-recent", async () => {
    claimMock.mockResolvedValue({ kind: "claimed" });
    await useStore.getState().openFile("/ws/keep.md", { recordHistory: false });
    await Promise.resolve();
    await Promise.resolve();

    // Now try to open a path owned by another window.
    claimMock.mockResolvedValueOnce({
      kind: "owned-elsewhere",
      window_label: "win-1",
    });
    await useStore.getState().openFile("/ws/owned-elsewhere.md", { recordHistory: false });
    // Issue #359 — claimOrRevert may already have drained between the
    // tab insert and this assertion under the new async openFile flow.
    // The post-drain expectation below remains the source of truth.

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Revert: only the duplicate is gone; the other tab survives and
    // active points to the most-recently-accessed survivor.
    expect(useStore.getState().tabs.map((t) => t.path)).toEqual(["/ws/keep.md"]);
    expect(useStore.getState().activeTabPath).toBe("/ws/keep.md");
  });

  it("OwnedElsewhere: revert is a no-op if the user closed the tab before the claim resolved", async () => {
    let resolveClaim: (v: { kind: "owned-elsewhere"; window_label: string }) => void = () => {};
    claimMock.mockImplementation(
      () =>
        new Promise((res) => {
          resolveClaim = res;
        }),
    );
    await useStore.getState().openFile("/ws/quick-close.md", { recordHistory: false });
    expect(useStore.getState().tabs).toHaveLength(1);

    // User closes the tab BEFORE the claim resolves.
    useStore.getState().closeTab("/ws/quick-close.md");
    expect(useStore.getState().tabs).toEqual([]);

    // Claim resolves (after the close) with OwnedElsewhere.
    resolveClaim({ kind: "owned-elsewhere", window_label: "win-1" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Still empty — the revert correctly bailed because the path was
    // no longer in the tab list.
    expect(useStore.getState().tabs).toEqual([]);
  });

  it("closeTab fires releaseOpenFile for the closed path", async () => {
    claimMock.mockResolvedValue({ kind: "claimed" });
    await useStore.getState().openFile("/ws/release-me.md", { recordHistory: false });
    await Promise.resolve();
    expect(releaseMock).not.toHaveBeenCalled();

    useStore.getState().closeTab("/ws/release-me.md");
    expect(releaseMock).toHaveBeenCalledWith("/ws/release-me.md");
  });

  it("closeAllTabs fires releaseOpenFiles for every open path", async () => {
    claimMock.mockResolvedValue({ kind: "claimed" });
    await useStore.getState().openFile("/ws/a.md", { recordHistory: false });
    await Promise.resolve();
    await useStore.getState().openFile("/ws/b.md", { recordHistory: false });
    await Promise.resolve();
    await useStore.getState().openFile("/ws/c.md", { recordHistory: false });
    await Promise.resolve();

    useStore.getState().closeAllTabs();
    expect(releaseManyMock).toHaveBeenCalledTimes(1);
    expect(releaseManyMock.mock.calls[0][0]).toEqual([
      "/ws/a.md",
      "/ws/b.md",
      "/ws/c.md",
    ]);
  });

  it("closeAllTabs on empty store does NOT fire bulk release", async () => {
    useStore.getState().closeAllTabs();
    expect(releaseManyMock).not.toHaveBeenCalled();
  });

  it("Claim IPC failure leaves the local tab open (graceful degradation)", async () => {
    claimMock.mockRejectedValue(new Error("registry missing"));
    await useStore.getState().openFile("/ws/no-rust.md", { recordHistory: false });
    expect(useStore.getState().tabs).toHaveLength(1);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // Tab still open — pre-iter-15 behaviour is the floor on failure.
    expect(useStore.getState().tabs.map((t) => t.path)).toEqual([
      "/ws/no-rust.md",
    ]);
  });
});
