import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ViewerToolbar } from "../ViewerToolbar";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

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

  it("does not render when hidden and no wrap toggle / zoom", () => {
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

  // L1 — file action buttons live in `FileActionsBar`, not in the toolbar.
  // The toolbar no longer accepts a `path` prop.
  it("does not accept a `path` prop / does not render reveal/open buttons", () => {
    render(<ViewerToolbar activeView="source" onViewChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /reveal in folder/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /open in default app/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /open externally/i })).toBeNull();
  });

  // ── G4: centerSlot composition ────────────────────────────────────────────
  describe("centerSlot (G4 — composition over prop-bag)", () => {
    it("renders the centerSlot inside .viewer-toolbar-center", () => {
      const { container } = render(
        <ViewerToolbar
          activeView="source"
          onViewChange={vi.fn()}
          centerSlot={<span data-testid="cs">x</span>}
        />,
      );
      const center = container.querySelector(".viewer-toolbar-center");
      expect(center).not.toBeNull();
      expect(center?.querySelector('[data-testid="cs"]')).not.toBeNull();
    });

    it("renders the toolbar (and centerSlot) even when hidden + no wrap + no zoom — entry point must be universal", () => {
      const { container } = render(
        <ViewerToolbar
          activeView="source"
          onViewChange={vi.fn()}
          hidden
          centerSlot={<span data-testid="cs">x</span>}
        />,
      );
      expect(container.querySelector(".viewer-toolbar")).not.toBeNull();
      expect(screen.getByTestId("cs")).toBeInTheDocument();
      // The Source/Visual toggle is still suppressed when `hidden` is set.
      expect(screen.queryByRole("button", { name: /^source$/i })).toBeNull();
    });
  });

  // ── Iter 3 of #252: visualDisabled markdown soft cap ─────────────────────
  describe("visualDisabled (markdown ≥ 1 MB clamp)", () => {
    it("disables the Visual button with aria-disabled + tooltip when visualDisabled is true", () => {
      render(
        <ViewerToolbar
          activeView="source"
          onViewChange={vi.fn()}
          visualDisabled
          visualDisabledReason="Markdown rendering disabled."
        />
      );
      const visualBtn = screen.getByRole("button", { name: /visual/i });
      expect(visualBtn).toBeDisabled();
      expect(visualBtn).toHaveAttribute("aria-disabled", "true");
      expect(visualBtn).toHaveAttribute("title", "Markdown rendering disabled.");
      expect(visualBtn).toHaveClass("is-disabled");
    });

    it("click on disabled Visual button does not fire onViewChange", () => {
      const onChange = vi.fn();
      render(
        <ViewerToolbar
          activeView="source"
          onViewChange={onChange}
          visualDisabled
          visualDisabledReason="nope"
        />
      );
      const visualBtn = screen.getByRole("button", { name: /visual/i });
      fireEvent.click(visualBtn);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("Source button stays clickable while Visual is disabled", () => {
      const onChange = vi.fn();
      render(
        <ViewerToolbar
          activeView="source"
          onViewChange={onChange}
          visualDisabled
          visualDisabledReason="nope"
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /source/i }));
      expect(onChange).toHaveBeenCalledWith("source");
    });

    it("does not disable the Visual button when visualDisabled is false / undefined", () => {
      render(<ViewerToolbar activeView="source" onViewChange={vi.fn()} />);
      const visualBtn = screen.getByRole("button", { name: /visual/i });
      expect(visualBtn).not.toBeDisabled();
      expect(visualBtn).not.toHaveAttribute("aria-disabled", "true");
      expect(visualBtn).not.toHaveClass("is-disabled");
    });
  });

  // ── Editor button (issue #352, canEdit gate) ──────────────────────────
  describe("canEdit (Excalidraw tri-state)", () => {
    it("does NOT render the Editor button by default (canEdit omitted)", () => {
      render(<ViewerToolbar activeView="source" onViewChange={vi.fn()} />);
      expect(screen.queryByRole("button", { name: /^editor$/i })).toBeNull();
    });

    it("renders an Editor button when canEdit is true", () => {
      render(<ViewerToolbar activeView="visual" onViewChange={vi.fn()} canEdit />);
      expect(screen.getByRole("button", { name: /^editor$/i })).toBeInTheDocument();
    });

    it("highlights the Editor button when activeView is editor", () => {
      render(<ViewerToolbar activeView="editor" onViewChange={vi.fn()} canEdit />);
      const btn = screen.getByRole("button", { name: /^editor$/i });
      expect(btn).toHaveClass("active");
      expect(btn).toHaveAttribute("aria-pressed", "true");
    });

    it("emits onViewChange('editor') when clicked", () => {
      const onChange = vi.fn();
      render(<ViewerToolbar activeView="visual" onViewChange={onChange} canEdit />);
      fireEvent.click(screen.getByRole("button", { name: /^editor$/i }));
      expect(onChange).toHaveBeenCalledWith("editor");
    });
  });

});
