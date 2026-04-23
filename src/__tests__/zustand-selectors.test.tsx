import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { useStore } from "@/store";
import { useShallow } from "zustand/shallow";
import { useRef } from "react";
import { readFileSync } from "fs";
import { resolve } from "path";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");
vi.mock("@/lib/tauri-commands", () => ({
  readDir: vi.fn().mockResolvedValue([]),
}));

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

/**
 * Verifies that components using fine-grained Zustand selectors
 * do not re-render when unrelated store state changes.
 */

describe("Zustand fine-grained selectors", () => {
  it("TabBar (tabs selector) does not re-render when theme changes", () => {
    function TestTabBar() {
      const count = useRef(0);
      count.current++;
      const tabs = useStore((s) => s.tabs);
      void tabs;
      return <div data-testid="render-count">{count.current}</div>;
    }

    const { getByTestId } = render(<TestTabBar />);
    expect(getByTestId("render-count").textContent).toBe("1");

    act(() => {
      useStore.setState({ theme: "dark" });
    });

    expect(getByTestId("render-count").textContent).toBe("1");
  });

  it("TabBar (tabs selector) re-renders when tabs change", () => {
    function TestTabBar() {
      const count = useRef(0);
      count.current++;
      const tabs = useStore((s) => s.tabs);
      void tabs;
      return <div data-testid="render-count">{count.current}</div>;
    }

    const { getByTestId } = render(<TestTabBar />);
    expect(getByTestId("render-count").textContent).toBe("1");

    act(() => {
      useStore.setState({ tabs: [{ path: "/test.md", scrollTop: 0 }] });
    });

    expect(getByTestId("render-count").textContent).toBe("2");
  });

  it("useShallow selector only re-renders when selected state values change", () => {
    function TestShallowSelector() {
      const count = useRef(0);
      count.current++;
      const { root, activeTabPath } = useStore(
        useShallow((s: ReturnType<typeof useStore.getState>) => ({
          root: s.root,
          activeTabPath: s.activeTabPath,
        }))
      );
      void root;
      void activeTabPath;
      return <div data-testid="render-count">{count.current}</div>;
    }

    const { getByTestId } = render(<TestShallowSelector />);
    expect(getByTestId("render-count").textContent).toBe("1");

    // Unrelated change should NOT cause re-render
    act(() => {
      useStore.setState({ theme: "dark" });
    });
    expect(getByTestId("render-count").textContent).toBe("1");

    // Related change SHOULD cause re-render
    act(() => {
      useStore.setState({ root: "/new/root" });
    });
    expect(getByTestId("render-count").textContent).toBe("2");
  });

  it("no bare useStore() calls remain in source components", () => {
    const files = [
      "src/App.tsx",
      "src/components/FolderTree/FolderTree.tsx",
      "src/components/comments/CommentsPanel.tsx",
      "src/components/comments/CommentThread.tsx",
      "src/components/TabBar/TabBar.tsx",
      "src/components/comments/LineCommentMargin.tsx",
    ];

    for (const file of files) {
      const content = readFileSync(resolve(file), "utf-8");
      // Match useStore() but not useStore((...) or useStore.getState()
      const bareCallPattern = /useStore\(\s*\)/g;
      const matches = content.match(bareCallPattern);
      expect(matches, `${file} still has bare useStore() call`).toBeNull();
    }
  });
});
