import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useApplyTheme } from "../useApplyTheme";

interface MockMQ {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  _trigger: () => void;
}

function installMatchMedia(systemPrefersDark: boolean): MockMQ {
  let listener: (() => void) | null = null;
  const mq: MockMQ = {
    matches: systemPrefersDark,
    addEventListener: vi.fn((_evt: string, cb: () => void) => {
      listener = cb;
    }),
    removeEventListener: vi.fn(),
    _trigger: () => listener?.(),
  };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue(mq),
  });
  return mq;
}

describe("useApplyTheme", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("sets data-theme=\"light\" when theme is explicit light", () => {
    installMatchMedia(true); // even if OS prefers dark, explicit wins
    renderHook(() => useApplyTheme("light"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("sets data-theme=\"dark\" when theme is explicit dark", () => {
    installMatchMedia(false);
    renderHook(() => useApplyTheme("dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("sets data-theme=\"dark\" when theme=system and OS prefers dark", () => {
    installMatchMedia(true);
    renderHook(() => useApplyTheme("system"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("sets data-theme=\"light\" when theme=system and OS prefers light", () => {
    installMatchMedia(false);
    renderHook(() => useApplyTheme("system"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("re-applies attribute when theme prop changes and removes media listener on cleanup", () => {
    const mq = installMatchMedia(true);
    const { rerender, unmount } = renderHook(
      ({ theme }: { theme: "light" | "dark" | "system" }) => useApplyTheme(theme),
      { initialProps: { theme: "light" as "light" | "dark" | "system" } }
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    rerender({ theme: "dark" });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    // Switching theme triggers cleanup of the previous effect, removing its listener.
    expect(mq.removeEventListener).toHaveBeenCalled();

    unmount();
    // Final unmount removes the most recent listener too.
    expect(mq.removeEventListener.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("updates data-theme when system media query change fires", () => {
    const mq = installMatchMedia(false);
    renderHook(() => useApplyTheme("system"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    mq.matches = true;
    mq._trigger();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
