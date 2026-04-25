import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMenuListeners } from "../useMenuListeners";
import { useStore } from "@/store";

const mockUnlisten = vi.fn();
const listeners = new Map<string, (...args: unknown[]) => void>();

vi.mock("@/lib/tauri-events", () => ({
  listenEvent: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    listeners.set(event, cb);
    return Promise.resolve(mockUnlisten);
  }),
}));

vi.mock("@/logger", () => ({
  error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
});

describe("useMenuListeners", () => {
  const callbacks = {
    handleOpenFile: vi.fn(),
    handleOpenFolder: vi.fn(),
    toggleCommentsPane: vi.fn(),
    setTheme: vi.fn(),
    setAboutOpen: vi.fn(),
    checkForUpdate: vi.fn(),
  };

  it("subscribes to all 15 menu events", () => {
    renderHook(() => useMenuListeners(callbacks));
    expect(listeners.size).toBe(15);
    expect(listeners.has("menu-open-file")).toBe(true);
    expect(listeners.has("menu-open-folder")).toBe(true);
    expect(listeners.has("menu-close-folder")).toBe(true);
    expect(listeners.has("menu-toggle-comments-pane")).toBe(true);
    expect(listeners.has("menu-close-tab")).toBe(true);
    expect(listeners.has("menu-close-all-tabs")).toBe(true);
    expect(listeners.has("menu-next-tab")).toBe(true);
    expect(listeners.has("menu-prev-tab")).toBe(true);
    expect(listeners.has("menu-theme-system")).toBe(true);
    expect(listeners.has("menu-theme-light")).toBe(true);
    expect(listeners.has("menu-theme-dark")).toBe(true);
    expect(listeners.has("menu-about")).toBe(true);
    expect(listeners.has("menu-check-updates")).toBe(true);
    expect(listeners.has("menu-help-welcome")).toBe(true);
    expect(listeners.has("menu-help-setup")).toBe(true);
  });

  it("calls handleOpenFile on menu-open-file event", () => {
    renderHook(() => useMenuListeners(callbacks));
    listeners.get("menu-open-file")?.();
    expect(callbacks.handleOpenFile).toHaveBeenCalledOnce();
  });

  it("calls handleOpenFolder on menu-open-folder event", () => {
    renderHook(() => useMenuListeners(callbacks));
    listeners.get("menu-open-folder")?.();
    expect(callbacks.handleOpenFolder).toHaveBeenCalledOnce();
  });

  it("calls toggleCommentsPane on menu-toggle-comments-pane event", () => {
    renderHook(() => useMenuListeners(callbacks));
    listeners.get("menu-toggle-comments-pane")?.();
    expect(callbacks.toggleCommentsPane).toHaveBeenCalledOnce();
  });

  it("calls setTheme with correct value on theme events", () => {
    renderHook(() => useMenuListeners(callbacks));
    listeners.get("menu-theme-system")?.();
    expect(callbacks.setTheme).toHaveBeenCalledWith("system");
    listeners.get("menu-theme-light")?.();
    expect(callbacks.setTheme).toHaveBeenCalledWith("light");
    listeners.get("menu-theme-dark")?.();
    expect(callbacks.setTheme).toHaveBeenCalledWith("dark");
  });

  it("calls setAboutOpen(true) on menu-about event", () => {
    renderHook(() => useMenuListeners(callbacks));
    listeners.get("menu-about")?.();
    expect(callbacks.setAboutOpen).toHaveBeenCalledWith(true);
  });

  it("calls checkForUpdate on menu-check-updates event", () => {
    renderHook(() => useMenuListeners(callbacks));
    listeners.get("menu-check-updates")?.();
    expect(callbacks.checkForUpdate).toHaveBeenCalledOnce();
  });

  it("calls openWelcome on menu-help-welcome event", () => {
    const openWelcome = vi.fn();
    useStore.setState({ openWelcome } as Partial<ReturnType<typeof useStore.getState>>);
    renderHook(() => useMenuListeners(callbacks));
    listeners.get("menu-help-welcome")?.();
    expect(openWelcome).toHaveBeenCalledOnce();
  });

  it("calls openSetup on menu-help-setup event", () => {
    const openSetup = vi.fn();
    useStore.setState({ openSetup } as Partial<ReturnType<typeof useStore.getState>>);
    renderHook(() => useMenuListeners(callbacks));
    listeners.get("menu-help-setup")?.();
    expect(openSetup).toHaveBeenCalledOnce();
  });

  it("cleans up all listeners on unmount", async () => {
    const { unmount } = renderHook(() => useMenuListeners(callbacks));
    unmount();
    await vi.waitFor(() => {
      expect(mockUnlisten).toHaveBeenCalledTimes(15);
    });
  });
});
