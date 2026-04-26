/**
 * Issue #89 regression — persisted-store migration v0 → v1.
 *
 * Old clients (pre-fix) wrote `\\?\C:\…` verbatim Windows paths into
 * localStorage for `root`, `activeTabPath`, every `tabs[].path`, every
 * `recentItems[].path`, and every key of `expandedFolders`. The fix adds
 * a `migrate` callback that strips the verbatim prefix from all five
 * surfaces and re-dedupes `recentItems` by post-strip path so an entry
 * stored in both forms collapses to one (newest timestamp wins).
 *
 * Test method: pre-seed localStorage with a v0 snapshot before the store
 * module is loaded, then dynamically import and assert the rehydrated
 * state matches bare-form expectations.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const PERSIST_KEY = "mdownreview-ui";

const VERBATIM_ROOT = "\\\\?\\C:\\proj";
const BARE_ROOT = "C:\\proj";
const VERBATIM_FILE = "\\\\?\\C:\\proj\\a.md";
const BARE_FILE = "C:\\proj\\a.md";

const V0_SNAPSHOT = {
  state: {
    theme: "system",
    folderPaneWidth: 240,
    commentsPaneVisible: true,
    root: VERBATIM_ROOT,
    expandedFolders: {
      [VERBATIM_ROOT + "\\sub"]: true,
      "C:\\other": false,
    },
    authorName: "",
    readingWidth: 720,
    recentItems: [
      // Older verbatim form for `b.md` (will be deduped against the bare
      // entry below; bare wins because its timestamp is newer).
      { path: "\\\\?\\C:\\proj\\b.md", type: "file", timestamp: 1000 },
      { path: "C:\\proj\\b.md", type: "file", timestamp: 2000 },
      // Standalone verbatim folder — must be stripped, not deduped.
      { path: VERBATIM_ROOT, type: "folder", timestamp: 1500 },
    ],
    tabs: [
      { path: VERBATIM_FILE, scrollTop: 0, lastAccessedAt: 1 },
    ],
    activeTabPath: VERBATIM_FILE,
    updateChannel: "stable",
    zoomByFiletype: {},
  },
  version: 0,
};

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

describe("issue #89 — store migration v0 → v1 strips `\\\\?\\` prefixes", () => {
  it("strips verbatim prefix from root, activeTabPath, every tab, every recentItem, and every expandedFolders key", async () => {
    localStorage.setItem(PERSIST_KEY, JSON.stringify(V0_SNAPSHOT));
    const { useStore } = await import("@/store");
    const state = useStore.getState();

    expect(state.root).toBe(BARE_ROOT);
    expect(state.activeTabPath).toBe(BARE_FILE);
    expect(state.tabs.map((t) => t.path)).toEqual([BARE_FILE]);

    // Every key of expandedFolders is bare-form.
    const expandedKeys = Object.keys(state.expandedFolders);
    for (const k of expandedKeys) {
      expect(k.startsWith("\\\\?\\")).toBe(false);
    }
    expect(state.expandedFolders[BARE_ROOT + "\\sub"]).toBe(true);
    expect(state.expandedFolders["C:\\other"]).toBe(false);

    // recentItems: post-strip dedupe by path, newest timestamp wins,
    // sorted newest-first.
    const recents = state.recentItems;
    expect(recents.map((r) => r.path)).toEqual([
      "C:\\proj\\b.md", // timestamp 2000 (newer of the two cross-form b.md entries)
      BARE_ROOT,        // timestamp 1500
    ]);
    const bMd = recents.find((r) => r.path === "C:\\proj\\b.md")!;
    expect(bMd.timestamp).toBe(2000);
    // No verbatim leftover.
    for (const r of recents) {
      expect(r.path.startsWith("\\\\?\\")).toBe(false);
    }
  });

  it("bumps the persisted version to 1 after migration", async () => {
    localStorage.setItem(PERSIST_KEY, JSON.stringify(V0_SNAPSHOT));
    await import("@/store");
    // Persist middleware writes the new snapshot synchronously on rehydrate.
    const raw = localStorage.getItem(PERSIST_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBe(1);
  });
});
