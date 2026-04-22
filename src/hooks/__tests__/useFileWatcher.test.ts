import { useStore } from "@/store";
import { beforeEach, describe, expect, it } from "vitest";

describe("WatcherSlice", () => {
  beforeEach(() => {
    useStore.setState({
      ghostEntries: [],
      autoReveal: true,
      lastSaveByPath: {},
    });
  });

  it("ghostEntries defaults to empty", () => {
    expect(useStore.getState().ghostEntries).toEqual([]);
  });

  it("setGhostEntries updates entries", () => {
    const entries = [
      { sidecarPath: "/a.review.json", sourcePath: "/a" },
      { sidecarPath: "/b.review.json", sourcePath: "/b" },
    ];
    useStore.getState().setGhostEntries(entries);
    expect(useStore.getState().ghostEntries).toEqual(entries);
  });

  it("autoReveal defaults to true", () => {
    expect(useStore.getState().autoReveal).toBe(true);
  });

  it("toggleAutoReveal toggles", () => {
    useStore.getState().toggleAutoReveal();
    expect(useStore.getState().autoReveal).toBe(false);
    useStore.getState().toggleAutoReveal();
    expect(useStore.getState().autoReveal).toBe(true);
  });

  it("lastSaveByPath defaults to empty object", () => {
    expect(useStore.getState().lastSaveByPath).toEqual({});
  });

  it("recordSave records timestamp for the given path", () => {
    const before = Date.now();
    useStore.getState().recordSave("/some/file.md");
    const after = Date.now();
    const ts = useStore.getState().lastSaveByPath["/some/file.md"];
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
