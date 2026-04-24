import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUpdateActions, useUpdateProgress } from "../use-update-actions";
import { installUpdate, checkUpdate } from "@/lib/tauri-commands";
import { useStore } from "@/store";

vi.mock("@/lib/tauri-commands", () => ({
  installUpdate: vi.fn().mockResolvedValue(undefined),
  checkUpdate: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

// Mock @tauri-apps/api/event
const mockUnlisten = vi.fn();
let listenCallback: ((event: { payload: unknown }) => void) | null = null;
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_event: string, cb: (event: { payload: unknown }) => void) => {
    listenCallback = cb;
    return Promise.resolve(mockUnlisten);
  }),
}));

const initialState = useStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  listenCallback = null;
  useStore.setState(initialState, true);
});

describe("useUpdateActions", () => {
  describe("install", () => {
    it("sets downloading status and calls installUpdate", async () => {
      vi.mocked(installUpdate).mockResolvedValue(undefined);
      const { result } = renderHook(() => useUpdateActions());
      await act(async () => {
        await result.current.install();
      });
      expect(installUpdate).toHaveBeenCalledOnce();
      expect(useStore.getState().updateStatus).toBe("downloading");
    });

    it("resets to available on error", async () => {
      vi.mocked(installUpdate).mockRejectedValue(new Error("network error"));
      const { result } = renderHook(() => useUpdateActions());
      await act(async () => {
        await result.current.install();
      });
      expect(useStore.getState().updateStatus).toBe("available");
      expect(useStore.getState().updateProgress).toBe(0);
    });
  });

  describe("checkForUpdate", () => {
    it("sets checking then available when update exists", async () => {
      vi.mocked(checkUpdate).mockResolvedValue({ version: "2.0.0", body: null });
      const { result } = renderHook(() => useUpdateActions());
      await act(async () => {
        await result.current.checkForUpdate();
      });
      expect(checkUpdate).toHaveBeenCalledWith("stable");
      expect(useStore.getState().updateStatus).toBe("available");
      expect(useStore.getState().updateVersion).toBe("2.0.0");
    });

    it("sets idle when no update available", async () => {
      vi.mocked(checkUpdate).mockResolvedValue(null);
      const { result } = renderHook(() => useUpdateActions());
      await act(async () => {
        await result.current.checkForUpdate();
      });
      expect(useStore.getState().updateStatus).toBe("idle");
    });

    it("sets idle on error", async () => {
      vi.mocked(checkUpdate).mockRejectedValue(new Error("network"));
      const { result } = renderHook(() => useUpdateActions());
      await act(async () => {
        await result.current.checkForUpdate();
      });
      expect(useStore.getState().updateStatus).toBe("idle");
    });

    it("uses explicit channel when provided", async () => {
      vi.mocked(checkUpdate).mockResolvedValue(null);
      const { result } = renderHook(() => useUpdateActions());
      await act(async () => {
        await result.current.checkForUpdate("canary");
      });
      expect(checkUpdate).toHaveBeenCalledWith("canary");
    });

    it("falls back to store channel when no channel provided", async () => {
      useStore.setState({ updateChannel: "canary" });
      vi.mocked(checkUpdate).mockResolvedValue(null);
      const { result } = renderHook(() => useUpdateActions());
      await act(async () => {
        await result.current.checkForUpdate();
      });
      expect(checkUpdate).toHaveBeenCalledWith("canary");
    });
  });

  describe("progress listener (useUpdateProgress)", () => {
    it("tracks download progress", async () => {
      const { listen } = await import("@tauri-apps/api/event");
      renderHook(() => useUpdateProgress());

      expect(listen).toHaveBeenCalledWith("update-progress", expect.any(Function));

      // Simulate progress events
      act(() => {
        listenCallback?.({ payload: { event: "Started", content_length: 1000, chunk_length: 0 } });
      });
      act(() => {
        listenCallback?.({ payload: { event: "Progress", content_length: null, chunk_length: 500 } });
      });
      expect(useStore.getState().updateProgress).toBe(50);

      act(() => {
        listenCallback?.({ payload: { event: "Finished", content_length: null, chunk_length: 0 } });
      });
      expect(useStore.getState().updateStatus).toBe("ready");
    });

    it("calls unlisten on unmount", async () => {
      const { unmount } = renderHook(() => useUpdateProgress());
      unmount();
      // Wait for the promise to resolve
      await vi.waitFor(() => {
        expect(mockUnlisten).toHaveBeenCalled();
      });
    });
  });
});
