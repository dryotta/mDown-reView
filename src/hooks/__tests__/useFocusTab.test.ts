/**
 * Tests for `useFocusTab` (issue #352 / iter-15).
 *
 * Listens for `focus-tab` events emitted by Rust's `claim_open_file`
 * when another window tries to open a file already owned here. On
 * receive, calls `setActiveTab(path)` if the path is in this
 * window's tabs.
 */

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useStore } from "@/store";

let capturedHandler: ((path: string) => void) | null = null;
const unlistenMock = vi.fn();
vi.mock("@/lib/tauri-events", () => ({
  listenEvent: vi.fn(
    async (name: string, cb: (path: string) => void) => {
      if (name === "focus-tab") {
        capturedHandler = cb;
      }
      return unlistenMock;
    },
  ),
}));

import { useFocusTab } from "../useFocusTab";

beforeEach(() => {
  capturedHandler = null;
  unlistenMock.mockReset();
  useStore.setState({
    tabs: [
      { path: "/ws/a.md", scrollTop: 0, lastAccessedAt: 1 },
      { path: "/ws/b.md", scrollTop: 0, lastAccessedAt: 2 },
    ],
    activeTabPath: "/ws/a.md",
  });
});

afterEach(() => {
  capturedHandler = null;
  vi.clearAllMocks();
});

describe("useFocusTab", () => {
  it("registers a listener for focus-tab on mount", () => {
    renderHook(() => useFocusTab());
    expect(capturedHandler).toBeTypeOf("function");
  });

  it("activates the tab matching the event payload", () => {
    renderHook(() => useFocusTab());
    expect(capturedHandler).toBeTypeOf("function");

    capturedHandler!("/ws/b.md");

    expect(useStore.getState().activeTabPath).toBe("/ws/b.md");
  });

  it("ignores payloads for paths NOT open in this window (defensive)", () => {
    renderHook(() => useFocusTab());

    capturedHandler!("/ws/never-opened.md");

    // Active stays where it was — no spurious activation, no tab add.
    expect(useStore.getState().activeTabPath).toBe("/ws/a.md");
    expect(useStore.getState().tabs).toHaveLength(2);
  });

  it("invokes unlisten on unmount", async () => {
    const { unmount } = renderHook(() => useFocusTab());
    await Promise.resolve();
    await Promise.resolve();
    unmount();
    await Promise.resolve();
    expect(unlistenMock).toHaveBeenCalled();
  });
});
