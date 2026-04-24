import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUpdateActions } from "../use-update-actions";
import { installUpdate } from "@/lib/tauri-commands";
import { useStore } from "@/store";

vi.mock("@/lib/tauri-commands", () => ({
  installUpdate: vi.fn().mockResolvedValue(undefined),
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

describe("useUpdateActions", () => {
  it("sets downloading status and calls installUpdate", async () => {
    vi.mocked(installUpdate).mockResolvedValue(undefined);

    const { result } = renderHook(() => useUpdateActions());

    await act(async () => {
      await result.current.install();
    });

    expect(installUpdate).toHaveBeenCalledOnce();
    // Status should have been set to "downloading" before the call
    // After success, status stays as "downloading" (listen handler sets "ready")
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
