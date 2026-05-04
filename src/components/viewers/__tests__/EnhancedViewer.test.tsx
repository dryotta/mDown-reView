import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EnhancedViewer } from "../EnhancedViewer";
import { useStore } from "@/store";

// Mock all sub-views as simple stubs
vi.mock("../MarkdownViewer", () => ({
  MarkdownViewer: () => <div data-testid="markdown-viewer">MarkdownViewer</div>,
}));
vi.mock("../SourceView", () => ({
  SourceView: ({ zoom }: { zoom: number }) => (
    <div data-testid="source-view" data-zoom={zoom}>SourceView</div>
  ),
}));
vi.mock("../JsonTreeView", () => ({
  JsonTreeView: ({ content }: { content: string }) => {
    // Parse to show key count
    try {
      const parsed = JSON.parse(content);
      const keys = Object.keys(parsed).length;
      return <div data-testid="json-tree">{keys} key{keys !== 1 ? "s" : ""}</div>;
    } catch {
      return <div data-testid="json-tree">Invalid JSON</div>;
    }
  },
}));
vi.mock("../CsvTableView", () => ({
  CsvTableView: () => <div data-testid="csv-table">CsvTableView</div>,
}));
vi.mock("../HtmlPreviewView", () => ({
  HtmlPreviewView: () => <div data-testid="html-preview">HtmlPreviewView</div>,
}));
vi.mock("../MermaidView", () => ({
  MermaidView: () => <div data-testid="mermaid-view">MermaidView</div>,
}));
vi.mock("../KqlPlanView", () => ({
  KqlPlanView: () => <div data-testid="kql-plan">KqlPlanView</div>,
}));
vi.mock("../ExcalidrawView", () => ({
  ExcalidrawView: ({ filePath, mode }: { filePath: string; mode: string }) => (
    <div data-testid="excalidraw-view-stub" data-path={filePath} data-mode={mode}>
      ExcalidrawView
    </div>
  ),
}));
// Issue #352 / iter-5 BLOCKER (test-expert) — mock the iter-4 wrapper
// so the binary-Source-mode integration path is testable without
// pulling the lazy chunk into vitest.
vi.mock("../ExcalidrawSourceMode", () => ({
  ExcalidrawSourceMode: ({ filePath, syntaxPath }: { filePath: string; syntaxPath: string }) => (
    <div data-testid="excalidraw-source-mode-stub" data-path={filePath} data-syntax={syntaxPath}>
      ExcalidrawSourceMode
    </div>
  ),
}));
vi.mock("@/logger");

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

describe("EnhancedViewer", () => {
  it("shows ViewerToolbar for JSON files", () => {
    render(<EnhancedViewer content='{"a":1}' path="/test.json" filePath="/test.json" />);
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
  });

  it("shows toolbar with only wrap button for plain text files", () => {
    render(<EnhancedViewer content="hello" path="/test.txt" filePath="/test.txt" />);
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /source/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /visual/i })).toBeNull();
    expect(screen.getByRole("button", { name: /wrap/i })).toBeInTheDocument();
  });

  it("defaults to visual view for JSON", () => {
    render(<EnhancedViewer content='{"a":1}' path="/test.json" filePath="/test.json" />);
    expect(screen.getByTestId("json-tree")).toBeInTheDocument();
    expect(screen.getByText("1 key")).toBeInTheDocument();
  });

  it("toggles to source view", () => {
    render(<EnhancedViewer content='{"a":1}' path="/test.json" filePath="/test.json" />);
    fireEvent.click(screen.getByRole("button", { name: /source/i }));
    expect(screen.getByTestId("source-view")).toBeInTheDocument();
    expect(screen.queryByTestId("json-tree")).toBeNull();
  });

  it("defaults to visual view for markdown", () => {
    render(<EnhancedViewer content="# Hello" path="/test.md" filePath="/test.md" />);
    expect(screen.getByTestId("markdown-viewer")).toBeInTheDocument();
  });

  it("defaults to visual (preview) view for HTML", () => {
    render(<EnhancedViewer content="<h1>hi</h1>" path="/test.html" filePath="/test.html" />);
    expect(screen.getByTestId("html-preview")).toBeInTheDocument();
  });

  it("shows source view for plain text with wrap toggle", () => {
    render(<EnhancedViewer content="hello" path="/test.txt" filePath="/test.txt" />);
    expect(screen.getByTestId("source-view")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /wrap/i })).toBeInTheDocument();
  });

  // #92 — single owner of `useZoom` lives in EnhancedViewer; SourceView
  // accepts `zoom` as a prop. Clicking the toolbar zoom-in must update
  // the value the SourceView receives so its `--source-zoom` CSS var
  // (and thus the visible source text) actually scales.
  it("forwards zoom to SourceView and updates it on toolbar Zoom in click (#92)", () => {
    render(<EnhancedViewer content="hello" path="/test.txt" filePath="/test.txt" />);
    const sv = screen.getByTestId("source-view");
    expect(sv.getAttribute("data-zoom")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: /zoom in/i }));
    const after = Number(sv.getAttribute("data-zoom"));
    expect(after).toBeGreaterThan(1);
  });

  // ── Iter 3 of #252: markdown 1 MB soft cap ─────────────────────────────
  describe("markdown soft cap (≥ 1 MB)", () => {
    const ONE_MB = 1 * 1024 * 1024;

    it("renders SourceView (not MarkdownViewer) for .md at fileSize >= 1 MB", () => {
      render(
        <EnhancedViewer
          content="# Hello"
          path="/big.md"
          filePath="/big.md"
          fileSize={ONE_MB}
        />
      );
      expect(screen.getByTestId("source-view")).toBeInTheDocument();
      expect(screen.queryByTestId("markdown-viewer")).toBeNull();
    });

    it("disables the Visual button with tooltip for .md at fileSize >= 1 MB", () => {
      render(
        <EnhancedViewer
          content="# Hello"
          path="/big.md"
          filePath="/big.md"
          fileSize={ONE_MB}
        />
      );
      const visualBtn = screen.getByRole("button", { name: /visual/i });
      expect(visualBtn).toBeDisabled();
      expect(visualBtn).toHaveAttribute("aria-disabled", "true");
      expect(visualBtn.getAttribute("title") ?? "").toMatch(/disabled/i);
    });

    it("does NOT clamp .md just under 1 MB", () => {
      render(
        <EnhancedViewer
          content="# Hello"
          path="/small.md"
          filePath="/small.md"
          fileSize={ONE_MB - 1}
        />
      );
      // Default view for markdown is visual → MarkdownViewer renders.
      expect(screen.getByTestId("markdown-viewer")).toBeInTheDocument();
      const visualBtn = screen.getByRole("button", { name: /visual/i });
      expect(visualBtn).not.toBeDisabled();
    });

    it("clicking disabled Visual is a no-op (does not switch back to visual)", () => {
      render(
        <EnhancedViewer
          content="# Hello"
          path="/big.md"
          filePath="/big.md"
          fileSize={ONE_MB}
        />
      );
      // Already clamped to source. Clicking Visual must NOT swap views.
      fireEvent.click(screen.getByRole("button", { name: /visual/i }));
      expect(screen.getByTestId("source-view")).toBeInTheDocument();
      expect(screen.queryByTestId("markdown-viewer")).toBeNull();
    });

    // Iter 3 of #252 / test-expert review (rec'd-not-blocking): the clamp
    // must be render-time-only and must NOT mutate persisted view state.
    // If a future edit drops the early return in `handleViewChange`, the
    // user's persisted preference would silently flip to "visual" while
    // the file is large; the next time the file shrinks below the cap
    // they would land on "broken visual" instead of source-mode default.
    it("clicking disabled Visual does NOT write to viewModeByTab (persistence guard)", () => {
      render(
        <EnhancedViewer
          content="# Hello"
          path="/big.md"
          filePath="/big.md"
          fileSize={ONE_MB}
        />
      );
      // Pre-condition: the store has no view-mode entry for this path.
      expect(useStore.getState().viewModeByTab["/big.md"]).toBeUndefined();
      fireEvent.click(screen.getByRole("button", { name: /visual/i }));
      // Post-condition: still nothing persisted — the click was suppressed
      // BEFORE setViewMode could fire.
      expect(useStore.getState().viewModeByTab["/big.md"]).toBeUndefined();
    });

    it("does NOT clamp non-markdown files at >= 1 MB", () => {
      // 1 MB JSON should keep its default visual (JsonTreeView).
      render(
        <EnhancedViewer
          content='{"a":1}'
          path="/big.json"
          filePath="/big.json"
          fileSize={ONE_MB}
        />
      );
      expect(screen.getByTestId("json-tree")).toBeInTheDocument();
      const visualBtn = screen.getByRole("button", { name: /visual/i });
      expect(visualBtn).not.toBeDisabled();
    });
  });

  // Issue #352 / iter-5 — Save button MOVED from per-viewer toolbar to
  // top app toolbar. EnhancedViewer no longer renders a Save button at
  // all; that responsibility now belongs to App.tsx. We retain the
  // read-only tab tests because read-only behaviour is still scoped
  // to the viewer (Editor button hidden, mode demoted).
  describe("Excalidraw read-only tab behaviour (#352 / iter-5)", () => {
    it("does NOT render an in-viewer Save button in any mode (Save lives in app toolbar)", () => {
      useStore.setState({
        viewModeByTab: { "/ws/a.excalidraw": "editor" },
      });
      render(
        <EnhancedViewer
          content='{"type":"excalidraw"}'
          path="/ws/a.excalidraw"
          filePath="/ws/a.excalidraw"
        />,
      );
      expect(screen.queryByTestId("excalidraw-save")).not.toBeInTheDocument();
      // The viewer's segmented-control row + its trailing FileActionsBar
      // must still render.
      expect(screen.getByRole("button", { name: /^source$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^editor$/i })).toBeInTheDocument();
    });

    // Issue #352 / iter-5 BLOCKER (product B2) — read-only tabs cannot
    // route through the workspace-write IPC. The viewer hides the
    // Editor segmented-control button + demotes stored editor mode.
    it("HIDES Editor segmented-control button when tab is read-only", () => {
      useStore.setState({
        tabs: [{ path: "/outside/a.excalidraw", scrollTop: 0, readOnly: true }],
        activeTabPath: "/outside/a.excalidraw",
        viewModeByTab: { "/outside/a.excalidraw": "visual" },
      });
      render(
        <EnhancedViewer
          content='{"type":"excalidraw"}'
          path="/outside/a.excalidraw"
          filePath="/outside/a.excalidraw"
        />,
      );
      expect(
        screen.queryByRole("button", { name: /^editor$/i }),
      ).not.toBeInTheDocument();
    });

    it("DEMOTES stored editor mode to visual for read-only tabs (canvas stays viewable)", () => {
      useStore.setState({
        tabs: [{ path: "/outside/a.excalidraw", scrollTop: 0, readOnly: true }],
        activeTabPath: "/outside/a.excalidraw",
        viewModeByTab: { "/outside/a.excalidraw": "editor" },
      });
      render(
        <EnhancedViewer
          content='{"type":"excalidraw"}'
          path="/outside/a.excalidraw"
          filePath="/outside/a.excalidraw"
        />,
      );
      const stub = screen.getByTestId("excalidraw-view-stub");
      expect(stub).toHaveAttribute("data-mode", "visual");
    });

    // Iter-22 redesign (user feedback) — `.excalidrawlib` files are
    // view-only. Libraries are reusable shape collections, not
    // documents authored line-by-line; the Editor segmented-control
    // button is hidden and any stored `editor` mode is demoted to
    // `visual`. The library sidebar stays open in Visual mode (driven
    // by `appState.openSidebar` in `useExcalidrawScene`) so the user
    // can browse the curated shapes without entering the editor.
    it("[iter-22] HIDES Editor segmented-control button for .excalidrawlib (libraries are view-only)", () => {
      useStore.setState({
        tabs: [{ path: "/ws/icons.excalidrawlib", scrollTop: 0 }],
        activeTabPath: "/ws/icons.excalidrawlib",
        viewModeByTab: { "/ws/icons.excalidrawlib": "visual" },
      });
      render(
        <EnhancedViewer
          content='{"type":"excalidrawlib","libraryItems":[]}'
          path="/ws/icons.excalidrawlib"
          filePath="/ws/icons.excalidrawlib"
        />,
      );
      // Source + Visual remain; Editor is hidden.
      expect(
        screen.getByRole("button", { name: /^source$/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /^visual$/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /^editor$/i }),
      ).not.toBeInTheDocument();
    });

    it("[iter-22] DEMOTES stored editor mode to visual for .excalidrawlib", () => {
      useStore.setState({
        tabs: [{ path: "/ws/icons.excalidrawlib", scrollTop: 0 }],
        activeTabPath: "/ws/icons.excalidrawlib",
        // Pre-iter-22 a session may have persisted "editor" mode for a
        // library tab. The view-only redesign demotes this on render.
        viewModeByTab: { "/ws/icons.excalidrawlib": "editor" },
      });
      render(
        <EnhancedViewer
          content='{"type":"excalidrawlib","libraryItems":[]}'
          path="/ws/icons.excalidrawlib"
          filePath="/ws/icons.excalidrawlib"
        />,
      );
      const stub = screen.getByTestId("excalidraw-view-stub");
      expect(stub).toHaveAttribute("data-mode", "visual");
    });
  });

  // Issue #352 / iter-5 BLOCKER (test-expert) — Source-mode routing
  // for `.excalidraw.png` / `.excalidraw.svg` mounts the
  // `ExcalidrawSourceMode` lazy wrapper (which extracts the embedded
  // scene) instead of plain `<SourceView>`. Iter-4 added the routing
  // but had no integration test at the EnhancedViewer boundary.
  describe("Excalidraw Source-mode binary-routing (#352 / iter-5)", () => {
    it("routes .excalidraw.png Source mode to ExcalidrawSourceMode (NOT plain SourceView)", async () => {
      useStore.setState({
        viewModeByTab: { "/ws/diagram.excalidraw.png": "source" },
      });
      render(
        <EnhancedViewer
          content=""
          path="/ws/diagram.excalidraw.png"
          filePath="/ws/diagram.excalidraw.png"
        />,
      );
      const stub = await screen.findByTestId("excalidraw-source-mode-stub");
      expect(stub).toBeInTheDocument();
      expect(screen.queryByTestId("source-view")).not.toBeInTheDocument();
      // Synthetic .json syntax path so the highlighter picks JSON.
      expect(stub).toHaveAttribute("data-syntax", "/ws/diagram.excalidraw.png.json");
    });

    it("routes .excalidraw.svg Source mode to ExcalidrawSourceMode", async () => {
      useStore.setState({
        viewModeByTab: { "/ws/icons.excalidraw.svg": "source" },
      });
      render(
        <EnhancedViewer
          content=""
          path="/ws/icons.excalidraw.svg"
          filePath="/ws/icons.excalidraw.svg"
        />,
      );
      expect(await screen.findByTestId("excalidraw-source-mode-stub")).toBeInTheDocument();
      expect(screen.queryByTestId("source-view")).not.toBeInTheDocument();
    });

    it("canonical .excalidraw Source mode stays on plain SourceView (no extraction wrapper)", () => {
      useStore.setState({
        viewModeByTab: { "/ws/scene.excalidraw": "source" },
      });
      render(
        <EnhancedViewer
          content='{"type":"excalidraw"}'
          path="/ws/scene.excalidraw"
          filePath="/ws/scene.excalidraw"
        />,
      );
      expect(screen.getByTestId("source-view")).toBeInTheDocument();
      expect(screen.queryByTestId("excalidraw-source-mode-stub")).not.toBeInTheDocument();
    });
  });
});
