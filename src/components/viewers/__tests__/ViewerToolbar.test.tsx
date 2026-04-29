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

  // ── Iter 5 Group B: Comment on file button ────────────────────────────────
  describe("onCommentOnFile (iter 5 group B)", () => {
    it("does NOT render the button when no callback is provided", () => {
      render(<ViewerToolbar activeView="source" onViewChange={vi.fn()} />);
      expect(screen.queryByRole("button", { name: /comment on file/i })).toBeNull();
    });

    it("renders the button when a callback is provided", () => {
      render(
        <ViewerToolbar activeView="source" onViewChange={vi.fn()} onCommentOnFile={vi.fn()} />,
      );
      expect(screen.getByRole("button", { name: /comment on file/i })).toBeInTheDocument();
    });

    it("invokes onCommentOnFile when clicked", () => {
      const onCommentOnFile = vi.fn();
      render(
        <ViewerToolbar activeView="source" onViewChange={vi.fn()} onCommentOnFile={onCommentOnFile} />,
      );
      fireEvent.click(screen.getByRole("button", { name: /comment on file/i }));
      expect(onCommentOnFile).toHaveBeenCalledTimes(1);
    });

    it("renders the toolbar (and button) even when hidden, no wrap toggle, and no zoom — entry point must be universal", () => {
      const { container } = render(
        <ViewerToolbar activeView="source" onViewChange={vi.fn()} hidden onCommentOnFile={vi.fn()} />,
      );
      expect(container.querySelector(".viewer-toolbar")).not.toBeNull();
      expect(screen.getByRole("button", { name: /comment on file/i })).toBeInTheDocument();
      // The Source/Visual toggle is still suppressed when `hidden` is set.
      expect(screen.queryByRole("button", { name: /^source$/i })).toBeNull();
    });
  });

  // ── File-level badge (next to "Comment on file") ──────────────────────────
  describe("file-level badge", () => {
    it("does NOT render a badge when fileCommentCount is 0", () => {
      const { container } = render(
        <ViewerToolbar activeView="source" onViewChange={vi.fn()} onCommentOnFile={vi.fn()} fileCommentCount={0} />,
      );
      expect(container.querySelector(".viewer-toolbar-file-badge")).toBeNull();
    });

    it("renders the badge with the count when fileCommentCount > 0", () => {
      const { container } = render(
        <ViewerToolbar activeView="source" onViewChange={vi.fn()} onCommentOnFile={vi.fn()} fileCommentCount={3} fileCommentSeverity="high" />,
      );
      const badge = container.querySelector(".viewer-toolbar-file-badge");
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toBe("3");
      expect(badge?.getAttribute("data-severity")).toBe("high");
      expect(badge?.getAttribute("aria-label")).toMatch(/3 unresolved comments/i);
    });

    it("does NOT render the badge when no `onCommentOnFile` callback is provided (button is hidden)", () => {
      // The badge lives inside the button — without the button, no badge.
      const { container } = render(
        <ViewerToolbar activeView="source" onViewChange={vi.fn()} fileCommentCount={5} />,
      );
      expect(container.querySelector(".viewer-toolbar-file-badge")).toBeNull();
    });

    it("uses singular wording in aria-label when count is 1", () => {
      const { container } = render(
        <ViewerToolbar activeView="source" onViewChange={vi.fn()} onCommentOnFile={vi.fn()} fileCommentCount={1} />,
      );
      const badge = container.querySelector(".viewer-toolbar-file-badge");
      expect(badge?.getAttribute("aria-label")).toMatch(/1 unresolved comment(?!s)/);
    });
  });

});
