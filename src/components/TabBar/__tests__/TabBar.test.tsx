import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TabBar } from "../TabBar";
import { useStore } from "@/store";
import type { CommentWithOrphan } from "@/store";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

function setup(tabs: { path: string; scrollTop?: number }[], activeTabPath: string | null) {
  useStore.setState({
    tabs: tabs.map((t) => ({ path: t.path, scrollTop: t.scrollTop ?? 0 })),
    activeTabPath,
    commentsByFile: {},
  });
  return render(<TabBar />);
}

// ─── 8.1: Tab display ────────────────────────────────────────────────────────

describe("8.1 – tab display", () => {
  it("shows file base name in each tab", () => {
    setup(
      [
        { path: "/docs/README.md" },
        { path: "/docs/notes.txt" },
      ],
      "/docs/README.md"
    );

    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
  });

  it("active tab has .active class", () => {
    setup([{ path: "/docs/README.md" }, { path: "/docs/notes.txt" }], "/docs/README.md");

    const tabs = screen.getAllByRole("tab");
    const activeTab = tabs.find((t) => t.classList.contains("active"))!;
    expect(activeTab).toBeDefined();
    expect(activeTab).toHaveTextContent("README.md");
  });

  it("title attribute contains full path", () => {
    setup([{ path: "/docs/README.md" }], "/docs/README.md");

    const tab = screen.getByRole("tab");
    expect(tab).toHaveAttribute("title", "/docs/README.md");
  });

  it("renders nothing when tabs array is empty", () => {
    setup([], null);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });
});

// ─── 8.2: Tab interactions and badges ────────────────────────────────────────

describe("8.2 – tab interactions and unresolved comment badge", () => {
  it("clicking an inactive tab calls setActiveTab", () => {
    setup(
      [{ path: "/docs/README.md" }, { path: "/docs/notes.txt" }],
      "/docs/README.md"
    );

    const notesTab = screen.getByRole("tab", { name: /notes\.txt/ });
    fireEvent.click(notesTab);

    expect(useStore.getState().activeTabPath).toBe("/docs/notes.txt");
  });

  it("clicking close × button calls closeTab", () => {
    setup([{ path: "/docs/README.md" }, { path: "/docs/notes.txt" }], "/docs/README.md");

    const closeBtn = screen.getByRole("button", { name: "Close README.md" });
    fireEvent.click(closeBtn);

    const paths = useStore.getState().tabs.map((t) => t.path);
    expect(paths).not.toContain("/docs/README.md");
  });

  it("tab shows numeric badge when there are unresolved comments", () => {
    useStore.setState({
      tabs: [{ path: "/docs/README.md", scrollTop: 0 }],
      activeTabPath: "/docs/README.md",
      commentsByFile: {
        "/docs/README.md": [
          {
            id: "c1",
            author: "Test User (human)",
            timestamp: new Date().toISOString(),
            text: "comment 1",
            resolved: false,
            line: 1,
          } as CommentWithOrphan,
          {
            id: "c2",
            author: "Test User (human)",
            timestamp: new Date().toISOString(),
            text: "comment 2",
            resolved: false,
            line: 2,
          } as CommentWithOrphan,
        ],
      },
    });

    render(<TabBar />);

    const badge = screen.getByTestId("comment-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("2");
  });

  it("badge absent when unresolved count is zero", () => {
    useStore.setState({
      tabs: [{ path: "/docs/README.md", scrollTop: 0 }],
      activeTabPath: "/docs/README.md",
      commentsByFile: {
        "/docs/README.md": [
          {
            id: "c1",
            author: "Test User (human)",
            timestamp: new Date().toISOString(),
            text: "resolved",
            resolved: true,
            line: 1,
          } as CommentWithOrphan,
        ],
      },
    });

    render(<TabBar />);
    expect(screen.queryByTestId("comment-badge")).not.toBeInTheDocument();
  });
});
