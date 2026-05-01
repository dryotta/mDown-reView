/**
 * Workspace slice unit tests — `openFolderPath` + `openFilePath`.
 *
 * These are the single canonical entry points for "open this folder/file"
 * actions from any UI surface (toolbar dialog flow, welcome-view recents,
 * future drag-drop). Pin the contract so a future regression cannot
 * re-introduce bug #2 (drift between toolbar and welcome paths) by
 * inlining a different sequence elsewhere.
 *
 * Critical invariants:
 *  - `openFolderPath` calls `registerWindowFolder` BEFORE `setRoot`.
 *  - On rejection from registry (folder claimed by another window), the
 *    current window's state is NOT mutated and the rejection is logged.
 *  - On success, `addRecentItem` is recorded.
 *  - `openFilePath` opens the file as a tab AND records in recents in
 *    one call (single canonical entry).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useStore } from "@/store";
import { registerWindowFolder } from "@/lib/tauri-commands";
import { warn } from "@/logger";

vi.mock("@/lib/tauri-commands", () => ({
  registerWindowFolder: vi.fn().mockResolvedValue(undefined),
  // canonicalizeOrFallback uses canonicalize_path; mock it too.
  canonicalize_path: vi.fn().mockImplementation(async (p: string) => p),
}));

vi.mock("@/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

const initialState = useStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState(initialState, true);
});

describe("workspaceSlice.openFolderPath", () => {
  it("registers BEFORE setting root", async () => {
    const callOrder: string[] = [];
    vi.mocked(registerWindowFolder).mockImplementation(async () => {
      callOrder.push("register");
    });
    const origSetRoot = useStore.getState().setRoot;
    useStore.setState({
      setRoot: vi.fn(async (root: string | null) => {
        callOrder.push("setRoot");
        await origSetRoot(root);
      }),
    } as Partial<ReturnType<typeof useStore.getState>>);

    await useStore.getState().openFolderPath("/test/folder");

    expect(callOrder).toEqual(["register", "setRoot"]);
    expect(registerWindowFolder).toHaveBeenCalledExactlyOnceWith("/test/folder");
  });

  it("does NOT set root when register_window_folder rejects with 'already open' (Error wrapped)", async () => {
    // Tauri's IPC chokepoint at `src/lib/tauri-commands.ts::unwrap`
    // rewraps `Result<_, String>` rejections in `new Error(string)`.
    // The slice MUST handle that production shape — pre-PR the check
    // was `typeof err === "string"` which is dead code in production.
    vi.mocked(registerWindowFolder).mockRejectedValue(
      new Error("folder already open in window 'w1'"),
    );

    await useStore.getState().openFolderPath("/test/folder");

    expect(useStore.getState().root).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("already open in another window"),
    );
  });

  it("logs unexpected rejections (NOT just 'already open') so observability is preserved", async () => {
    // BUG-4 REGRESSION GUARD. Pre-fix, only the "already open"
    // branch logged. Permission-denied / IO errors / panics were
    // silently swallowed for both toolbar AND welcome callers — the
    // user saw nothing happen and no diagnostic appeared.
    vi.mocked(registerWindowFolder).mockRejectedValue(
      new Error("permission denied: /restricted/folder"),
    );

    await useStore.getState().openFolderPath("/restricted/folder");

    expect(useStore.getState().root).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("permission denied"),
    );
  });

  it("does NOT add a recent item when registration rejects", async () => {
    vi.mocked(registerWindowFolder).mockRejectedValue(
      new Error("folder already open in window 'w1'"),
    );
    const before = useStore.getState().recentItems.length;
    await useStore.getState().openFolderPath("/test/folder");
    expect(useStore.getState().recentItems).toHaveLength(before);
  });

  it("adds a recent item on success", async () => {
    vi.mocked(registerWindowFolder).mockResolvedValue(undefined);
    await useStore.getState().openFolderPath("/test/folder");
    expect(useStore.getState().recentItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/test/folder", type: "folder" }),
      ]),
    );
  });

  it("handles raw-string rejections too (defensive against IPC layer changes)", async () => {
    // Some Tauri rejection paths surface raw strings instead of Error.
    // The slice handles both shapes so a future IPC chokepoint refactor
    // doesn't silently change observability.
    vi.mocked(registerWindowFolder).mockRejectedValue(
      "folder already open in window 'w1'",
    );
    await useStore.getState().openFolderPath("/test/folder");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("already open in another window"),
    );
  });
});

describe("workspaceSlice.openFilePath", () => {
  it("opens the file as a tab AND records it in recents in one call", () => {
    const before = useStore.getState().tabs.length;
    useStore.getState().openFilePath("/test/notes.md");
    const state = useStore.getState();
    expect(state.tabs.length).toBe(before + 1);
    expect(state.tabs[state.tabs.length - 1]).toEqual(
      expect.objectContaining({ path: "/test/notes.md" }),
    );
    expect(state.recentItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/test/notes.md", type: "file" }),
      ]),
    );
  });
});
