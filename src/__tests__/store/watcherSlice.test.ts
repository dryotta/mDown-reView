import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store/index";

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

describe("watcherSlice — setGhostEntries equality short-circuit", () => {
  it("updates state when entries differ", () => {
    const entries = [{ sidecarPath: "/a.review.yaml", sourcePath: "/a.md" }];
    useStore.getState().setGhostEntries(entries);
    expect(useStore.getState().ghostEntries).toEqual(entries);
  });

  it("updates state when entries have different sidecarPath", () => {
    const initial = [{ sidecarPath: "/a.review.yaml", sourcePath: "/a.md" }];
    useStore.getState().setGhostEntries(initial);

    const changed = [{ sidecarPath: "/b.review.yaml", sourcePath: "/a.md" }];
    useStore.getState().setGhostEntries(changed);
    expect(useStore.getState().ghostEntries).toEqual(changed);
  });

  it("updates state when entries have different sourcePath", () => {
    const initial = [{ sidecarPath: "/a.review.yaml", sourcePath: "/a.md" }];
    useStore.getState().setGhostEntries(initial);

    const changed = [{ sidecarPath: "/a.review.yaml", sourcePath: "/b.md" }];
    useStore.getState().setGhostEntries(changed);
    expect(useStore.getState().ghostEntries).toEqual(changed);
  });

  it("updates state when entry count changes", () => {
    const one = [{ sidecarPath: "/a.review.yaml", sourcePath: "/a.md" }];
    useStore.getState().setGhostEntries(one);

    const two = [
      { sidecarPath: "/a.review.yaml", sourcePath: "/a.md" },
      { sidecarPath: "/b.review.yaml", sourcePath: "/b.md" },
    ];
    useStore.getState().setGhostEntries(two);
    expect(useStore.getState().ghostEntries).toHaveLength(2);
  });

  it("skips update when entries are identical (same reference preserved)", () => {
    const entries = [{ sidecarPath: "/a.review.yaml", sourcePath: "/a.md" }];
    useStore.getState().setGhostEntries(entries);
    const ref1 = useStore.getState().ghostEntries;

    // New array with same content
    useStore.getState().setGhostEntries([{ sidecarPath: "/a.review.yaml", sourcePath: "/a.md" }]);
    const ref2 = useStore.getState().ghostEntries;

    expect(ref1).toBe(ref2);
  });

  it("skips update when multiple entries are identical", () => {
    const entries = [
      { sidecarPath: "/a.review.yaml", sourcePath: "/a.md" },
      { sidecarPath: "/b.review.yaml", sourcePath: "/b.md" },
    ];
    useStore.getState().setGhostEntries(entries);
    const ref1 = useStore.getState().ghostEntries;

    useStore.getState().setGhostEntries([
      { sidecarPath: "/a.review.yaml", sourcePath: "/a.md" },
      { sidecarPath: "/b.review.yaml", sourcePath: "/b.md" },
    ]);
    const ref2 = useStore.getState().ghostEntries;

    expect(ref1).toBe(ref2);
  });

  it("skips update when both are empty", () => {
    const ref1 = useStore.getState().ghostEntries;
    useStore.getState().setGhostEntries([]);
    const ref2 = useStore.getState().ghostEntries;

    expect(ref1).toBe(ref2);
  });
});

describe("watcherSlice — recordSave", () => {
  it("sets a timestamp for the given path", () => {
    const before = Date.now();
    useStore.getState().recordSave("/test.md");
    const after = Date.now();

    const saved = useStore.getState().lastSaveByPath["/test.md"];
    expect(saved).toBeGreaterThanOrEqual(before);
    expect(saved).toBeLessThanOrEqual(after);
  });

  it("records timestamps independently for different paths", () => {
    useStore.getState().recordSave("/a.md");
    useStore.getState().recordSave("/b.md");

    expect(useStore.getState().lastSaveByPath["/a.md"]).toBeDefined();
    expect(useStore.getState().lastSaveByPath["/b.md"]).toBeDefined();
  });

  it("overwrites previous timestamp on re-save", () => {
    useStore.getState().recordSave("/test.md");
    const first = useStore.getState().lastSaveByPath["/test.md"];

    // Small delay to ensure different timestamp
    useStore.getState().recordSave("/test.md");
    const second = useStore.getState().lastSaveByPath["/test.md"];

    expect(second).toBeGreaterThanOrEqual(first);
  });

  it("timestamp is within save debounce window immediately after recording", () => {
    useStore.getState().recordSave("/test.md");
    const saved = useStore.getState().lastSaveByPath["/test.md"];
    const now = Date.now();
    // The SAVE_DEBOUNCE_MS in useFileWatcher is 1500ms
    expect(now - saved).toBeLessThan(1500);
  });
});
