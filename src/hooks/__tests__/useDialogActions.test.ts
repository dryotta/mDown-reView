import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDialogActions } from "../useDialogActions";
import { showOpenDialog } from "@/lib/tauri-commands";
import { useStore } from "@/store";

vi.mock("@/lib/tauri-commands", () => ({
  showOpenDialog: vi.fn(),
}));

vi.mock("@/logger", () => ({
  error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(),
}));

const initialState = useStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState(initialState, true);
});

describe("useDialogActions — toolbar dialog wrappers", () => {
  // The hook is now a thin showOpenDialog wrapper that pipes the
  // user-selected path into the workspace slice's `openFilePath` /
  // `openFolderPath`. Slice-level behaviour (register-then-setRoot
  // ordering, rejection handling, observability) is tested at
  // `src/store/__tests__/workspace.test.ts`.

  it("handleOpenFile pipes multiple files into openFilePath", async () => {
    vi.mocked(showOpenDialog).mockResolvedValue(["a.md", "b.md"]);
    const openFilePath = vi.fn();
    useStore.setState({ openFilePath } as Partial<ReturnType<typeof useStore.getState>>);
    const { result } = renderHook(() => useDialogActions());
    await act(async () => { await result.current.handleOpenFile(); });
    expect(openFilePath).toHaveBeenNthCalledWith(1, "a.md");
    expect(openFilePath).toHaveBeenNthCalledWith(2, "b.md");
  });

  it("handleOpenFile pipes a single file string into openFilePath", async () => {
    vi.mocked(showOpenDialog).mockResolvedValue("single.md");
    const openFilePath = vi.fn();
    useStore.setState({ openFilePath } as Partial<ReturnType<typeof useStore.getState>>);
    const { result } = renderHook(() => useDialogActions());
    await act(async () => { await result.current.handleOpenFile(); });
    expect(openFilePath).toHaveBeenCalledExactlyOnceWith("single.md");
  });

  it("handleOpenFolder pipes the selected path into openFolderPath", async () => {
    vi.mocked(showOpenDialog).mockResolvedValue("/test/folder");
    const openFolderPath = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ openFolderPath } as Partial<ReturnType<typeof useStore.getState>>);
    const { result } = renderHook(() => useDialogActions());
    await act(async () => { await result.current.handleOpenFolder(); });
    expect(openFolderPath).toHaveBeenCalledExactlyOnceWith("/test/folder");
  });

  it("cancelled file dialog (null) is no-op", async () => {
    vi.mocked(showOpenDialog).mockResolvedValue(null);
    const openFilePath = vi.fn();
    useStore.setState({ openFilePath } as Partial<ReturnType<typeof useStore.getState>>);
    const { result } = renderHook(() => useDialogActions());
    await act(async () => { await result.current.handleOpenFile(); });
    expect(openFilePath).not.toHaveBeenCalled();
  });

  it("cancelled folder dialog (null) is no-op", async () => {
    vi.mocked(showOpenDialog).mockResolvedValue(null);
    const openFolderPath = vi.fn();
    useStore.setState({ openFolderPath } as Partial<ReturnType<typeof useStore.getState>>);
    const { result } = renderHook(() => useDialogActions());
    await act(async () => { await result.current.handleOpenFolder(); });
    expect(openFolderPath).not.toHaveBeenCalled();
  });

  it("dialog error (user cancellation throw) is silently caught", async () => {
    vi.mocked(showOpenDialog).mockRejectedValue(new Error("cancelled"));
    const { result } = renderHook(() => useDialogActions());
    await act(async () => { await result.current.handleOpenFile(); });
    // Test passes if no unhandled rejection.
  });
});
