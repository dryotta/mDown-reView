import { useStore } from "@/store";
import { beforeEach, describe, expect, it } from "vitest";

describe("WatcherSlice", () => {
  beforeEach(() => {
    useStore.setState({
      ghostEntries: [],
      autoReveal: true,
      lastSaveTimestamp: 0,
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

  it("lastSaveTimestamp defaults to 0", () => {
    expect(useStore.getState().lastSaveTimestamp).toBe(0);
  });

  it("setLastSaveTimestamp updates value", () => {
    useStore.getState().setLastSaveTimestamp(12345);
    expect(useStore.getState().lastSaveTimestamp).toBe(12345);
  });
});
