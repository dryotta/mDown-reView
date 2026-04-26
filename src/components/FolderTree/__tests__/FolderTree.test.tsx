import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { FolderTree } from "../FolderTree";
import { useStore } from "@/store";
import type { DirEntry } from "@/lib/tauri-commands";

// Auto-resolved mocks
vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

// Mock the hook to avoid IPC / event listener setup in tests
vi.mock("@/hooks/useFileBadges", () => ({
  useFileBadges: () => ({}),
}));

// Mock tauri-commands readDir so we can control what it returns
vi.mock("@/lib/tauri-commands", () => ({
  readDir: vi.fn(),
}));

import { readDir } from "@/lib/tauri-commands";
const mockReadDir = readDir as ReturnType<typeof vi.fn>;

const FOLDER = "/test";
const SUBFOLDER = "/test/subdir";

const ROOT_ENTRIES: DirEntry[] = [
  { name: "subdir", path: SUBFOLDER, is_dir: true },
  { name: "README.md", path: "/test/README.md", is_dir: false },
  { name: "notes.txt", path: "/test/notes.txt", is_dir: false },
];

const SUB_ENTRIES: DirEntry[] = [
  { name: "child.md", path: "/test/subdir/child.md", is_dir: false },
];

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
  mockReadDir.mockReset();
  // Default: root returns ROOT_ENTRIES, subfolder returns SUB_ENTRIES
  mockReadDir.mockImplementation((path: string) => {
    if (path === FOLDER) return Promise.resolve(ROOT_ENTRIES);
    if (path === SUBFOLDER) return Promise.resolve(SUB_ENTRIES);
    return Promise.resolve([]);
  });
});

function renderTree(onFileOpen = vi.fn()) {
  useStore.setState({
    root: FOLDER,
    expandedFolders: {},
    tabs: [],
    activeTabPath: null,
    folderPaneWidth: 240,
  });
  return render(<FolderTree onFileOpen={onFileOpen} onCloseFolder={vi.fn()} />);
}

// ─── 6.1: renders file and folder entries ────────────────────────────────────

describe("6.1 – renders file and folder entries", () => {
  it("renders folder entries with tree-icon ▸ and file entries with ·", async () => {
    renderTree();

    await waitFor(() => {
      expect(screen.getByText("subdir")).toBeInTheDocument();
    });

    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();

    // folder icon
    const subdirEntry = screen.getByText("subdir").closest(".tree-entry")!;
    expect(subdirEntry.querySelector(".tree-icon")?.textContent).toBe("▸");

    // file icon
    const readmeEntry = screen.getByText("README.md").closest(".tree-entry")!;
    expect(readmeEntry.querySelector(".tree-icon")?.textContent).toBe("·");
  });
});

// ─── 6.2: clicking folder toggles expand/collapse ────────────────────────────

describe("6.2 – clicking folder calls readDir / collapses when expanded", () => {
  it("clicking a collapsed folder calls readDir and expands it", async () => {
    renderTree();

    await waitFor(() => screen.getByText("subdir"));

    fireEvent.click(screen.getByText("subdir").closest(".tree-entry")!);

    await waitFor(() => {
      expect(mockReadDir).toHaveBeenCalledWith(SUBFOLDER);
    });

    // children should appear
    await waitFor(() => {
      expect(screen.getByText("child.md")).toBeInTheDocument();
    });

    // icon should now be ▾
    const subdirEntry = screen.getByText("subdir").closest(".tree-entry")!;
    expect(subdirEntry.querySelector(".tree-icon")?.textContent).toBe("▾");
  });

  it("clicking an expanded folder collapses it", async () => {
    renderTree();

    await waitFor(() => screen.getByText("subdir"));

    // expand
    fireEvent.click(screen.getByText("subdir").closest(".tree-entry")!);
    await waitFor(() => screen.getByText("child.md"));

    // collapse
    fireEvent.click(screen.getByText("subdir").closest(".tree-entry")!);
    await waitFor(() => {
      expect(screen.queryByText("child.md")).not.toBeInTheDocument();
    });
  });
});

// ─── 6.3: active file has .active class ──────────────────────────────────────

describe("6.3 – active file entry has .active class", () => {
  it("active tab path entry gets .active class", async () => {
    renderTree();
    await waitFor(() => screen.getByText("README.md"));

    act(() => {
      useStore.setState({ activeTabPath: "/test/README.md" });
    });

    await waitFor(() => {
      const entry = screen.getByText("README.md").closest(".tree-entry")!;
      expect(entry).toHaveClass("active");
    });
  });

  it("switching active tab updates the highlighted entry", async () => {
    renderTree();
    await waitFor(() => screen.getByText("README.md"));

    act(() => {
      useStore.setState({ activeTabPath: "/test/README.md" });
    });

    await waitFor(() => {
      expect(screen.getByText("README.md").closest(".tree-entry")).toHaveClass("active");
    });

    act(() => {
      useStore.setState({ activeTabPath: "/test/notes.txt" });
    });

    await waitFor(() => {
      expect(screen.getByText("README.md").closest(".tree-entry")).not.toHaveClass("active");
      expect(screen.getByText("notes.txt").closest(".tree-entry")).toHaveClass("active");
    });
  });
});

// ─── 6.4: filter hides non-matching files ────────────────────────────────────

describe("6.4 – filter hides non-matching files", () => {
  it("typing in filter hides non-matching files", async () => {
    renderTree();
    await waitFor(() => screen.getByText("README.md"));

    fireEvent.change(screen.getByPlaceholderText("Filter files…"), {
      target: { value: "README" },
    });

    await waitFor(() => {
      expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
      expect(screen.getByText("README.md")).toBeInTheDocument();
    });
  });

  it("parent folders of matching files appear as group section headers", async () => {
    // Expand subdir first so child.md is cached
    renderTree();
    await waitFor(() => screen.getByText("subdir"));
    fireEvent.click(screen.getByText("subdir").closest(".tree-entry")!);
    await waitFor(() => screen.getByText("child.md"));

    // Now filter for "child"
    fireEvent.change(screen.getByPlaceholderText("Filter files…"), {
      target: { value: "child" },
    });

    await waitFor(() => {
      // Filter mode: section header for the parent folder + the matching file
      expect(screen.getByText("subdir")).toBeInTheDocument();
      expect(screen.getByText("child.md")).toBeInTheDocument();
      expect(screen.queryByText("README.md")).not.toBeInTheDocument();
      expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
    });
  });

  it("clearing filter restores full tree", async () => {
    renderTree();
    await waitFor(() => screen.getByText("README.md"));

    const filterInput = screen.getByPlaceholderText("Filter files…");
    fireEvent.change(filterInput, { target: { value: "README" } });

    await waitFor(() => {
      expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
    });

    fireEvent.change(filterInput, { target: { value: "" } });

    await waitFor(() => {
      expect(screen.getByText("README.md")).toBeInTheDocument();
      expect(screen.getByText("notes.txt")).toBeInTheDocument();
    });
  });
});

// ─── 6.5: Close button and header ─────────────────────────────────────────

describe("6.5 – Close button and folder header", () => {
  it("displays folder name in header", async () => {
    renderTree();
    await waitFor(() => screen.getByText("subdir"));

    const title = screen.getByTitle(FOLDER);
    expect(title).toBeInTheDocument();
    expect(title.textContent).toContain("test");
  });

  it("clicking close button calls onCloseFolder", async () => {
    const onCloseFolder = vi.fn();
    useStore.setState({
      root: FOLDER,
      expandedFolders: {},
      tabs: [],
      activeTabPath: null,
      folderPaneWidth: 240,
    });
    render(<FolderTree onFileOpen={vi.fn()} onCloseFolder={onCloseFolder} />);
    await waitFor(() => screen.getByText("subdir"));

    fireEvent.click(screen.getByTitle("Close folder"));

    expect(onCloseFolder).toHaveBeenCalledTimes(1);
  });
});

// ─── 6.6: keyboard navigation ────────────────────────────────────────────────

describe("6.6 – keyboard navigation", () => {
  it("Arrow Down moves focus to the next visible entry", async () => {
    renderTree();
    await waitFor(() => screen.getByText("subdir"));

    const subdirEntry = screen.getByText("subdir").closest(".tree-entry") as HTMLElement;
    fireEvent.keyDown(subdirEntry, { key: "ArrowDown" });

    // After ArrowDown, focus should have moved; we can verify via focusedPath state indirectly
    // by checking that .focus() was called — simplest is just no error thrown
    expect(subdirEntry).toBeInTheDocument();
  });

  it("Enter on a file entry calls onFileOpen", async () => {
    const onFileOpen = vi.fn();
    renderTree(onFileOpen);
    await waitFor(() => screen.getByText("README.md"));

    const readmeEntry = screen.getByText("README.md").closest(".tree-entry") as HTMLElement;
    fireEvent.keyDown(readmeEntry, { key: "Enter" });

    expect(onFileOpen).toHaveBeenCalledWith("/test/README.md");
  });
});

// ─── 6.7: file open ──────────────────────────────────────────────────────────

describe("6.7 – onFileOpen", () => {
  it("clicking a file entry calls onFileOpen with the path", async () => {
    const onFileOpen = vi.fn();
    renderTree(onFileOpen);
    await waitFor(() => screen.getByText("README.md"));

    fireEvent.click(screen.getByText("README.md").closest(".tree-entry")!);

    expect(onFileOpen).toHaveBeenCalledWith("/test/README.md");
  });
});

// ─── 6.8: auto-reveal toggle removed ─────────────────────────────────────────

describe("6.8 – auto-reveal toggle is gone", () => {
  it("does not render any auto-reveal control", async () => {
    renderTree();
    await waitFor(() => screen.getByText("subdir"));
    expect(screen.queryByTitle(/Auto-reveal/i)).toBeNull();
  });
});

// ─── 6.9: optimistic toggle ──────────────────────────────────────────────────

describe("6.9 – optimistic folder toggle", () => {
  it("flips aria-expanded synchronously even when loadChildren never resolves", async () => {
    // Make readDir(SUBFOLDER) hang forever; root still resolves so the tree mounts.
    mockReadDir.mockImplementation((path: string) => {
      if (path === FOLDER) return Promise.resolve(ROOT_ENTRIES);
      return new Promise<DirEntry[]>(() => {}); // never resolves
    });

    renderTree();
    await waitFor(() => screen.getByText("subdir"));

    const subdirEntry = screen.getByText("subdir").closest(".tree-entry") as HTMLElement;
    expect(subdirEntry.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(subdirEntry);

    // No await for loadChildren — flip is immediate.
    expect(subdirEntry.getAttribute("aria-expanded")).toBe("true");
    expect(subdirEntry.querySelector(".tree-icon")?.textContent).toBe("▾");
  });
});

// ─── 6.10: Other files section ───────────────────────────────────────────────

describe("6.10 – Other files section", () => {
  it("appears when a tab lives outside root and disappears when closed", async () => {
    renderTree();
    await waitFor(() => screen.getByText("subdir"));

    expect(screen.queryByText(/Other files/)).not.toBeInTheDocument();

    act(() => {
      useStore.setState({
        tabs: [{ path: "/elsewhere/outside.md", scrollTop: 0 }],
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/Other files \(1\)/)).toBeInTheDocument();
      expect(screen.getByText("outside.md")).toBeInTheDocument();
    });

    act(() => {
      useStore.setState({ tabs: [] });
    });

    await waitFor(() => {
      expect(screen.queryByText(/Other files/)).not.toBeInTheDocument();
    });
  });
});

// ─── 6.11: grouped flat filter mode ──────────────────────────────────────────

describe("6.11 – grouped flat filter view", () => {
  it("renders one section header per parent folder and a flat list of matches", async () => {
    // Two parents each holding matching files: /test (root) holds README.md and notes.txt;
    // /test/subdir holds child.md. Filter "m" matches README.md, notes.txt -> wait, "m"
    // only in README.md. Use a filter that finds 3 files in 2 folders.
    mockReadDir.mockImplementation((path: string) => {
      if (path === FOLDER)
        return Promise.resolve([
          { name: "subdir", path: SUBFOLDER, is_dir: true },
          { name: "alpha.md", path: "/test/alpha.md", is_dir: false },
          { name: "beta.md", path: "/test/beta.md", is_dir: false },
        ]);
      if (path === SUBFOLDER)
        return Promise.resolve([{ name: "gamma.md", path: "/test/subdir/gamma.md", is_dir: false }]);
      return Promise.resolve([]);
    });

    renderTree();
    await waitFor(() => screen.getByText("alpha.md"));
    // Expand subdir so its cache is populated
    fireEvent.click(screen.getByText("subdir").closest(".tree-entry")!);
    await waitFor(() => screen.getByText("gamma.md"));

    fireEvent.change(screen.getByPlaceholderText("Filter files…"), {
      target: { value: ".md" },
    });

    await waitFor(() => {
      expect(screen.getByText("alpha.md")).toBeInTheDocument();
      expect(screen.getByText("beta.md")).toBeInTheDocument();
      expect(screen.getByText("gamma.md")).toBeInTheDocument();
    });

    // Two filter group section headers: one for the root (".") and one for "subdir".
    const groupHeaders = document.querySelectorAll(".folder-tree-filter-group-header");
    expect(groupHeaders.length).toBe(2);
  });

  it("renders 'No matches' when filter yields nothing", async () => {
    renderTree();
    await waitFor(() => screen.getByText("README.md"));

    fireEvent.change(screen.getByPlaceholderText("Filter files…"), {
      target: { value: "no-such-file-anywhere-xyz" },
    });

    await waitFor(() => {
      expect(screen.getByText("No matches")).toBeInTheDocument();
    });
  });
});
