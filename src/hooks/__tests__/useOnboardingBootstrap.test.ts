import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const refreshOnboarding = vi.fn(async () => {});
const openWelcome = vi.fn();
const onboardingShouldWelcome = vi.fn(async () => false);

vi.mock("@/store", () => ({
  useStore: {
    getState: () => ({ refreshOnboarding, openWelcome }),
  },
}));

vi.mock("@/lib/tauri-commands", () => ({
  onboardingShouldWelcome: () => onboardingShouldWelcome(),
}));

vi.mock("@/logger", () => ({
  error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(),
}));

import { useOnboardingBootstrap } from "../useOnboardingBootstrap";

beforeEach(() => {
  vi.useFakeTimers();
  refreshOnboarding.mockClear();
  openWelcome.mockClear();
  onboardingShouldWelcome.mockReset();
  onboardingShouldWelcome.mockResolvedValue(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useOnboardingBootstrap", () => {
  it("calls refreshOnboarding on mount and does not auto-open when not welcome-due", async () => {
    renderHook(() => useOnboardingBootstrap());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(refreshOnboarding).toHaveBeenCalled();
    expect(openWelcome).not.toHaveBeenCalled();
  });

  it("opens welcome panel when onboardingShouldWelcome returns true", async () => {
    onboardingShouldWelcome.mockResolvedValue(true);
    renderHook(() => useOnboardingBootstrap());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(openWelcome).toHaveBeenCalledOnce();
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
    renderHook(() => useOnboardingBootstrap());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // openWelcome must not be called when bootstrap path errors out.
    expect(openWelcome).not.toHaveBeenCalled();
  });
});
