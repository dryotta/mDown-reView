import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const refreshOnboarding = vi.fn(async () => {});

vi.mock("@/store", () => ({
  useStore: {
    getState: () => ({ refreshOnboarding }),
  },
}));

vi.mock("@/logger", () => ({
  error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(),
}));

import { useOnboardingBootstrap } from "../useOnboardingBootstrap";

beforeEach(() => {
  vi.useFakeTimers();
  refreshOnboarding.mockClear();
  refreshOnboarding.mockImplementation(async () => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useOnboardingBootstrap", () => {
  it("calls refreshOnboarding on mount", async () => {
    renderHook(() => useOnboardingBootstrap());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(refreshOnboarding).toHaveBeenCalled();
  });

  it("re-polls (debounced) on window focus", async () => {
    renderHook(() => useOnboardingBootstrap());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    refreshOnboarding.mockClear();

    // Rapid focus events should collapse into one refresh after debounce.
    act(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(refreshOnboarding).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(refreshOnboarding).toHaveBeenCalledTimes(1);
  });

  it("removes focus listener on unmount", async () => {
    const { unmount } = renderHook(() => useOnboardingBootstrap());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    refreshOnboarding.mockClear();
    unmount();
    act(() => { window.dispatchEvent(new Event("focus")); });
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(refreshOnboarding).not.toHaveBeenCalled();
  });

  it("swallows refreshOnboarding errors via logger", async () => {
    refreshOnboarding.mockRejectedValueOnce(new Error("boom"));
    expect(() => renderHook(() => useOnboardingBootstrap())).not.toThrow();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  });
});
