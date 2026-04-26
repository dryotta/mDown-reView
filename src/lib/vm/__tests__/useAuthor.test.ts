import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAuthor } from "../useAuthor";
import { getAuthor, setAuthor as setAuthorIpc } from "@/lib/tauri-commands";
import { useStore } from "@/store";

vi.mock("@/lib/tauri-commands", () => ({
  getAuthor: vi.fn(),
  setAuthor: vi.fn(),
}));

// Mock useStore to a simple in-memory cell so we can observe writes.
let storeAuthor = "";
const setAuthorInStore = vi.fn((name: string) => {
  storeAuthor = name;
});
vi.mock("@/store", () => ({
  useStore: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  storeAuthor = "";
  setAuthorInStore.mockClear();
  vi.mocked(useStore).mockImplementation(
    ((selector: (s: { authorName: string; setAuthorName: (n: string) => void }) => unknown) =>
      selector({ authorName: storeAuthor, setAuthorName: setAuthorInStore })) as typeof useStore,
  );
});

describe("useAuthor", () => {
  it("hydrates from disk on mount when store value is empty", async () => {
    vi.mocked(getAuthor).mockResolvedValueOnce("OS-User");
    renderHook(() => useAuthor());
    await waitFor(() => expect(setAuthorInStore).toHaveBeenCalledWith("OS-User"));
    expect(getAuthor).toHaveBeenCalledTimes(1);
  });

  it("does not call get_author when store already has a value", async () => {
    storeAuthor = "Already-Set";
    renderHook(() => useAuthor());
    // Give any pending microtasks a chance to flush.
    await new Promise((r) => setTimeout(r, 0));
    expect(getAuthor).not.toHaveBeenCalled();
  });

  it("setAuthor persists via IPC then updates the store", async () => {
    vi.mocked(setAuthorIpc).mockResolvedValueOnce("Reviewer-2");
    storeAuthor = "old";
    const { result } = renderHook(() => useAuthor());
    await act(async () => {
      await result.current.setAuthor("Reviewer-2");
    });
    expect(setAuthorIpc).toHaveBeenCalledWith("Reviewer-2");
    expect(setAuthorInStore).toHaveBeenLastCalledWith("Reviewer-2");
  });

  it("propagates ConfigError from setAuthor and does NOT update store on failure", async () => {
    const err = { kind: "InvalidAuthor", reason: "empty" } as const;
    vi.mocked(setAuthorIpc).mockRejectedValueOnce(err);
    storeAuthor = "Original";
    const { result } = renderHook(() => useAuthor());
    setAuthorInStore.mockClear();
    await expect(result.current.setAuthor("   ")).rejects.toEqual(err);
    expect(setAuthorInStore).not.toHaveBeenCalled();
  });

  it("swallows hydration failures without throwing", async () => {
    vi.mocked(getAuthor).mockRejectedValueOnce("disk error");
    renderHook(() => useAuthor());
    // Wait one tick for the rejected promise to settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(setAuthorInStore).not.toHaveBeenCalled();
  });
});
