import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ViewerToolbar } from "../ViewerToolbar";
import { revealInFolder, openInDefaultApp } from "@/lib/tauri-commands";

vi.mock("@/lib/tauri-commands", () => ({
  revealInFolder: vi.fn().mockResolvedValue(undefined),
  openInDefaultApp: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/logger", () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }));

const revealMock = revealInFolder as unknown as ReturnType<typeof vi.fn>;
const openMock = openInDefaultApp as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  revealMock.mockClear();
  openMock.mockClear();
});

describe("ViewerToolbar", () => {
  it("renders source and visual toggle buttons", () => {
    render(<ViewerToolbar activeView="source" onViewChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /source/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /visual/i })).toBeInTheDocument();
  });

  it("highlights the active view", () => {
    render(<ViewerToolbar activeView="visual" onViewChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /visual/i })).toHaveClass("active");
    expect(screen.getByRole("button", { name: /source/i })).not.toHaveClass("active");
  });

  it("calls onViewChange when toggling", () => {
    const onChange = vi.fn();
    render(<ViewerToolbar activeView="source" onViewChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /visual/i }));
    expect(onChange).toHaveBeenCalledWith("visual");
  });

  it("does not render when hidden and no wrap toggle", () => {
    const { container } = render(
      <ViewerToolbar activeView="source" onViewChange={vi.fn()} hidden />
    );
    expect(container.querySelector(".viewer-toolbar")).toBeNull();
  });

  it("renders wrap button when showWrapToggle is true", () => {
    render(
      <ViewerToolbar activeView="source" onViewChange={vi.fn()} hidden showWrapToggle wordWrap={false} onToggleWrap={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: /wrap/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /source/i })).toBeNull();
  });

  it("declares sticky positioning so it stays visible while scrolling content", () => {
    // jsdom does not compute `position: sticky`, so verify the rule exists in the source CSS.
    const css = readFileSync(
      resolve(__dirname, "../../../styles/viewer-toolbar.css"),
      "utf8",
    );
    const block = css.match(/\.viewer-toolbar\s*\{[^}]*\}/)?.[0] ?? "";
    expect(block).toMatch(/position:\s*sticky/);
    expect(block).toMatch(/top:\s*0/);
    // Opaque background is required so scrolled content does not bleed through the sticky bar.
    expect(block).toMatch(/background:\s*var\(--color-bg\)/);
    expect(block).toMatch(/z-index:\s*\d+/);
  });

  // ── G4 — reveal / open file actions ────────────────────────────────────
  describe("file action buttons (G4)", () => {
    it("renders reveal + open buttons when path is provided", () => {
      render(
        <ViewerToolbar activeView="source" onViewChange={vi.fn()} path="/ws/file.md" />
      );
      expect(screen.getByRole("button", { name: /reveal in folder/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /open externally/i })).toBeInTheDocument();
    });

    it("does not render file action buttons when path is omitted", () => {
      render(<ViewerToolbar activeView="source" onViewChange={vi.fn()} />);
      expect(screen.queryByRole("button", { name: /reveal in folder/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /open externally/i })).toBeNull();
    });

    it("renders even when hidden + no other groups, as long as path is provided", () => {
      const { container } = render(
        <ViewerToolbar activeView="source" onViewChange={vi.fn()} hidden path="/ws/x.png" />
      );
      expect(container.querySelector(".viewer-toolbar")).not.toBeNull();
      expect(screen.getByRole("button", { name: /reveal in folder/i })).toBeInTheDocument();
    });

    it("dispatches to revealInFolder on click with the absolute path", () => {
      render(
        <ViewerToolbar activeView="source" onViewChange={vi.fn()} path="/ws/doc.md" />
      );
      fireEvent.click(screen.getByRole("button", { name: /reveal in folder/i }));
      expect(revealMock).toHaveBeenCalledTimes(1);
      expect(revealMock).toHaveBeenCalledWith("/ws/doc.md");
      expect(openMock).not.toHaveBeenCalled();
    });

    it("dispatches to openInDefaultApp on click with the absolute path", () => {
      render(
        <ViewerToolbar activeView="source" onViewChange={vi.fn()} path="/ws/doc.md" />
      );
      fireEvent.click(screen.getByRole("button", { name: /open externally/i }));
      expect(openMock).toHaveBeenCalledTimes(1);
      expect(openMock).toHaveBeenCalledWith("/ws/doc.md");
      expect(revealMock).not.toHaveBeenCalled();
    });

    it("exposes title attributes for hover tooltips", () => {
      render(
        <ViewerToolbar activeView="source" onViewChange={vi.fn()} path="/ws/doc.md" />
      );
      expect(screen.getByRole("button", { name: /reveal in folder/i })).toHaveAttribute(
        "title",
        "Reveal in folder",
      );
      expect(screen.getByRole("button", { name: /open externally/i })).toHaveAttribute(
        "title",
        "Open externally",
      );
    });

    it("renders alongside the source/visual toggle (markdown viewer shape)", () => {
      render(
        <ViewerToolbar
          activeView="visual"
          onViewChange={vi.fn()}
          path="/ws/doc.md"
        />
      );
      expect(screen.getByRole("button", { name: /source/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /reveal in folder/i })).toBeInTheDocument();
    });

    it("renders for hidden-toolbar viewers (image/audio/video/pdf shape)", () => {
      // ViewerRouter wraps non-EnhancedViewer cases with hidden=true and only path.
      render(
        <ViewerToolbar activeView="visual" onViewChange={vi.fn()} hidden path="/ws/img.png" />
      );
      // No view-toggle, no wrap, no zoom — but reveal/open are present.
      expect(screen.queryByRole("button", { name: /^source$/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /^visual$/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /wrap/i })).toBeNull();
      expect(screen.getByRole("button", { name: /reveal in folder/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /open externally/i })).toBeInTheDocument();
    });
  });
});
