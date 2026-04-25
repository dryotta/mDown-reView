import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store/index";
import { MAX_TAB_HISTORY } from "@/store/tabHistory";

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

describe("tabHistory slice", () => {
  it("initial state: empty history, cursor at -1", () => {
    const s = useStore.getState();
    expect(s.history).toEqual([]);
    expect(s.historyIndex).toBe(-1);
    expect(s.back()).toBeNull();
    expect(s.forward()).toBeNull();
  });

  it("pushHistory appends and updates cursor", () => {
    useStore.getState().pushHistory("/a.md");
    let s = useStore.getState();
    expect(s.history).toEqual(["/a.md"]);
    expect(s.historyIndex).toBe(0);

    useStore.getState().pushHistory("/b.md");
    s = useStore.getState();
    expect(s.history).toEqual(["/a.md", "/b.md"]);
    expect(s.historyIndex).toBe(1);
  });

  it("re-pushing the current head is a no-op", () => {
    useStore.getState().pushHistory("/a.md");
    useStore.getState().pushHistory("/a.md");
    expect(useStore.getState().history).toEqual(["/a.md"]);
    expect(useStore.getState().historyIndex).toBe(0);
  });

  it("back/forward navigate the cursor and return target paths", () => {
    const { pushHistory } = useStore.getState();
    pushHistory("/a.md");
    pushHistory("/b.md");
    pushHistory("/c.md");

    expect(useStore.getState().back()).toBe("/b.md");
    expect(useStore.getState().historyIndex).toBe(1);

    expect(useStore.getState().back()).toBe("/a.md");
    expect(useStore.getState().historyIndex).toBe(0);

    // Going past the start is a no-op.
    expect(useStore.getState().back()).toBeNull();
    expect(useStore.getState().historyIndex).toBe(0);

    expect(useStore.getState().forward()).toBe("/b.md");
    expect(useStore.getState().forward()).toBe("/c.md");
    expect(useStore.getState().forward()).toBeNull();
  });

  it("pushHistory while not at head truncates forward history", () => {
    const { pushHistory, back } = useStore.getState();
    pushHistory("/a.md");
    pushHistory("/b.md");
    pushHistory("/c.md");
    back(); // now at /b.md
    expect(useStore.getState().historyIndex).toBe(1);

    useStore.getState().pushHistory("/d.md");
    const s = useStore.getState();
    expect(s.history).toEqual(["/a.md", "/b.md", "/d.md"]);
    expect(s.historyIndex).toBe(2);
  });

  it("ring buffer caps at MAX_TAB_HISTORY entries (oldest dropped)", () => {
    const { pushHistory } = useStore.getState();
    for (let i = 0; i < MAX_TAB_HISTORY + 10; i++) {
      pushHistory(`/file-${i}.md`);
    }
    const s = useStore.getState();
    expect(s.history).toHaveLength(MAX_TAB_HISTORY);
    expect(s.history[0]).toBe("/file-10.md");
    expect(s.history[s.history.length - 1]).toBe(
      `/file-${MAX_TAB_HISTORY + 10 - 1}.md`,
    );
    expect(s.historyIndex).toBe(MAX_TAB_HISTORY - 1);
  });

  it("history is never persisted (not in partialize allowlist)", () => {
    useStore.getState().pushHistory("/a.md");
    const persistApi = (useStore as unknown as {
      persist: { getOptions: () => { partialize?: (s: unknown) => unknown } };
    }).persist;
    const opts = persistApi.getOptions();
    const snap = opts.partialize!(useStore.getState()) as Record<string, unknown>;
    expect(snap).not.toHaveProperty("history");
    expect(snap).not.toHaveProperty("historyIndex");
  });

  // B2: history is now centralized — `openFile` and `setActiveTab` push by
  // default. Sidebar-opened tabs (which call openFile) must therefore land
  // in history without callers needing to pushHistory manually.
  it("B2: openFile records history by default; recordHistory:false opts out", () => {
    useStore.getState().openFile("/a.md");
    expect(useStore.getState().history).toEqual(["/a.md"]);

    useStore.getState().openFile("/b.md", { recordHistory: false });
    expect(useStore.getState().history).toEqual(["/a.md"]);
    expect(useStore.getState().activeTabPath).toBe("/b.md");
  });

  it("B2: setActiveTab records history by default; recordHistory:false opts out", () => {
    useStore.getState().openFile("/a.md", { recordHistory: false });
    useStore.getState().openFile("/b.md", { recordHistory: false });
    // Empty history so far.
    expect(useStore.getState().history).toEqual([]);

    useStore.getState().setActiveTab("/a.md");
    expect(useStore.getState().history).toEqual(["/a.md"]);

    useStore.getState().setActiveTab("/b.md", { recordHistory: false });
    expect(useStore.getState().history).toEqual(["/a.md"]);
  });
});
