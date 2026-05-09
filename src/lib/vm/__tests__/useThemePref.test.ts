import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useThemePref, type ThemePref } from "../useThemePref";
import { setTheme as setThemeIpcReal } from "@/lib/tauri-commands";
import { useStore } from "@/store";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@/lib/tauri-commands", () => ({
  setTheme: vi.fn(),
}));

// Mock useStore to a simple in-memory cell so we can observe writes and
// verify ordering (IPC must be awaited BEFORE the store is updated).
let storeTheme: ThemePref = "system";
const setThemeInStore = vi.fn((t: ThemePref) => {
  storeTheme = t;
});
vi.mock("@/store", () => ({
  useStore: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  storeTheme = "system";
  setThemeInStore.mockClear();
  vi.mocked(useStore).mockImplementation(
    ((selector: (s: { theme: ThemePref; setTheme: (t: ThemePref) => void }) => unknown) =>
      selector({ theme: storeTheme, setTheme: setThemeInStore })) as typeof useStore,
  );
});

describe("useThemePref", () => {
  it("setTheme calls setThemeIpc with the value, then updates the store", async () => {
    // Resolve order check: store must NOT be updated until IPC resolves.
    let ipcResolve!: () => void;
    const ipcPromise = new Promise<void>((res) => {
      ipcResolve = res;
    });
    vi.mocked(setThemeIpcReal).mockReturnValueOnce(ipcPromise);

    const { result } = renderHook(() => useThemePref());

    let setPromise!: Promise<void>;
    act(() => {
      setPromise = result.current.setTheme("dark");
    });

    expect(setThemeIpcReal).toHaveBeenCalledWith("dark");
    expect(setThemeInStore).not.toHaveBeenCalled();

    await act(async () => {
      ipcResolve();
      await setPromise;
    });

    expect(setThemeInStore).toHaveBeenCalledWith("dark");
  });

  it("setTheme rejects without updating store on InvalidTheme rejection", async () => {
    const err = { kind: "InvalidTheme", reason: "unknown_value" } as const;
    vi.mocked(setThemeIpcReal).mockRejectedValueOnce(err);

    const { result } = renderHook(() => useThemePref());

    await expect(result.current.setTheme("light")).rejects.toEqual(err);
    expect(setThemeInStore).not.toHaveBeenCalled();
  });

  it("setTheme rejects without updating store on IoError rejection", async () => {
    const err = { kind: "IoError", message: "disk full" } as const;
    vi.mocked(setThemeIpcReal).mockRejectedValueOnce(err);

    const { result } = renderHook(() => useThemePref());

    await expect(result.current.setTheme("dark")).rejects.toEqual(err);
    expect(setThemeInStore).not.toHaveBeenCalled();
  });

  it("theme getter reads from the Zustand store", () => {
    storeTheme = "light";
    const { result } = renderHook(() => useThemePref());
    expect(result.current.theme).toBe("light");
  });

  it("does NOT call get_theme IPC on mount (theme is in localStorage/persist)", async () => {
    renderHook(() => useThemePref());
    // Flush any pending microtasks an effectful hydration might enqueue.
    await new Promise((r) => setTimeout(r, 0));

    // The façade has no `getTheme` export — verify the underlying
    // `core.invoke` was never called with the IPC command name either.
    const calls = vi.mocked(invoke).mock.calls;
    expect(calls.find((c) => c[0] === "get_theme")).toBeUndefined();
    // And `setTheme` is not invoked on mount.
    expect(setThemeIpcReal).not.toHaveBeenCalled();
  });
});
