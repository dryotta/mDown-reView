import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDialogActions } from "../useDialogActions";
import { showOpenDialog, registerWindowFolder } from "@/lib/tauri-commands";
import { useStore } from "@/store";

vi.mock("@/lib/tauri-commands", () => ({
  showOpenDialog: vi.fn(),
  registerWindowFolder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/logger", () => ({
  error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(),
}));

const initialState = useStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState(initialState, true);
});

describe("useDialogActions", () => {
  it("handleOpenFile opens multiple files", async () => {
    vi.mocked(showOpenDialog).mockResolvedValue(["a.md", "b.md"]);
    const { result } = renderHook(() => useDialogActions());
    await act(async () => { await result.current.handleOpenFile(); });
    const state = useStore.getState();
    expect(state.tabs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "a.md" }),
        expect.objectContaining({ path: "b.md" }),
      ])
    );
  });

  it("handleOpenFile opens a single file string", async () => {
    vi.mocked(showOpenDialog).mockResolvedValue("single.md");
    const { result } = renderHook(() => useDialogActions());
    await act(async () => { await result.current.handleOpenFile(); });
    expect(useStore.getState().tabs).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "single.md" })])
    );
  });

  it("handleOpenFolder sets root", async () => {
    vi.mocked(showOpenDialog).mockResolvedValue("/test/folder");
    const { result } = renderHook(() => useDialogActions());
    await act(async () => { await result.current.handleOpenFolder(); });
    expect(useStore.getState().root).toBe("/test/folder");
  });

  it("handleOpenFolder adds recent item", async () => {
    vi.mocked(showOpenDialog).mockResolvedValue("/test/folder");
    const { result } = renderHook(() => useDialogActions());
    await act(async () => { await result.current.handleOpenFolder(); });
    const recents = useStore.getState().recentItems;
    expect(recents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/test/folder", type: "folder" }),
      ])
    );
  });

  it("handleOpenFolder calls registerWindowFolder", async () => {
    vi.mocked(showOpenDialog).mockResolvedValue("/test/folder");
    const { result } = renderHook(() => useDialogActions());
    await act(async () => { await result.current.handleOpenFolder(); });
    expect(registerWindowFolder).toHaveBeenCalledWith("/test/folder");
  });

  it("handleOpenFolder calls registerWindowFolder before setRoot", async () => {
    const callOrder: string[] = [];
    vi.mocked(registerWindowFolder).mockImplementation(async () => {
      callOrder.push("register");
    });
    vi.mocked(showOpenDialog).mockResolvedValue("/test/folder");
    const origSetRoot = useStore.getState().setRoot;
    const setRootSpy = vi.fn(async (root: string | null) => {
      callOrder.push("setRoot");
      await origSetRoot(root);
    });
    useStore.setState({ setRoot: setRootSpy });

    const { result } = renderHook(() => useDialogActions());
    await act(async () => { await result.current.handleOpenFolder(); });

    expect(callOrder).toEqual(["register", "setRoot"]);
    expect(registerWindowFolder).toHaveBeenCalledWith("/test/folder");
  });

  it("handleOpenFolder does not set root when registerWindowFolder rejects", async () => {
    vi.mocked(registerWindowFolder).mockRejectedValue(
      new Error("folder already open in window 'w1'")
    );
    vi.mocked(showOpenDialog).mockResolvedValue("/test/folder");
    const { result } = renderHook(() => useDialogActions());
    await act(async () => { await result.current.handleOpenFolder(); });
    // Root should remain null — registration was rejected
    expect(useStore.getState().root).toBeNull();
  });

  it("cancelled dialog (null) is no-op", async () => {
    vi.mocked(showOpenDialog).mockResolvedValue(null);
    const { result } = renderHook(() => useDialogActions());
    await act(async () => { await result.current.handleOpenFile(); });
    expect(useStore.getState().tabs).toHaveLength(0);
  });

  it("dialog error is silently caught", async () => {
    vi.mocked(showOpenDialog).mockRejectedValue(new Error("cancelled"));
    const { result } = renderHook(() => useDialogActions());
    await act(async () => { await result.current.handleOpenFile(); });
    expect(useStore.getState().tabs).toHaveLength(0);
  });

  // ── openFolderPath: shared by toolbar + welcome-view recent folders ──
  //
  // The original bug was WelcomeView reimplementing the open-folder
  // sequence in the wrong order (setRoot before registerWindowFolder),
  // so clicking a recent folder already open in another window cloned
  // the folder into the current window instead of activating the other
  // window. Fixing that recurrence requires both call sites to share
  // ONE callback — `openFolderPath` is that callback.

  it("openFolderPath calls registerWindowFolder before setRoot", async () => {
    const callOrder: string[] = [];
    vi.mocked(registerWindowFolder).mockImplementation(async () => {
      callOrder.push("register");
    });
    const origSetRoot = useStore.getState().setRoot;
    const setRootSpy = vi.fn(async (root: string | null) => {
      callOrder.push("setRoot");
      await origSetRoot(root);
    });
    useStore.setState({ setRoot: setRootSpy });

    const { result } = renderHook(() => useDialogActions());
    await act(async () => {
      await result.current.openFolderPath("/test/recent-folder");
    });

    expect(callOrder).toEqual(["register", "setRoot"]);
    expect(registerWindowFolder).toHaveBeenCalledWith("/test/recent-folder");
  });

  it("openFolderPath does NOT set root when registerWindowFolder rejects", async () => {
    vi.mocked(registerWindowFolder).mockRejectedValue(
      "folder already open in window 'w1'",
    );
    const { result } = renderHook(() => useDialogActions());
    await act(async () => {
      await result.current.openFolderPath("/test/recent-folder");
    });
    // Root should remain null — registration was rejected and the
    // current window's state must be untouched (the existing window
    // is focused by Rust before the rejection returns).
    expect(useStore.getState().root).toBeNull();
  });

  it("openFolderPath adds a recent item on success", async () => {
    vi.mocked(registerWindowFolder).mockResolvedValue(undefined);
    const { result } = renderHook(() => useDialogActions());
    await act(async () => {
      await result.current.openFolderPath("/test/recent-folder");
    });
    expect(useStore.getState().recentItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/test/recent-folder", type: "folder" }),
      ]),
    );
  });

  it("openFolderPath does NOT add a recent item when registration rejects", async () => {
    vi.mocked(registerWindowFolder).mockRejectedValue(
      "folder already open in window 'w1'",
    );
    const beforeCount = useStore.getState().recentItems.length;
    const { result } = renderHook(() => useDialogActions());
    await act(async () => {
      await result.current.openFolderPath("/test/recent-folder");
    });
    expect(useStore.getState().recentItems).toHaveLength(beforeCount);
  });
});
