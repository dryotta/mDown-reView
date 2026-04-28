import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommentBadge } from "../comments/CommentBadge";
import type { Severity } from "@/lib/tauri-commands";

describe("CommentBadge", () => {
  it("renders nothing when count is 0", () => {
    const { container } = render(<CommentBadge count={0} className="tab-badge" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when count is negative", () => {
    const { container } = render(<CommentBadge count={-3} className="tab-badge" />);
    expect(container.firstChild).toBeNull();
  });

  it.each<[number, Severity | undefined, string, string]>([
    [1, undefined, "1 unresolved comment", "none"],
    [2, "none", "2 unresolved comments", "none"],
    [3, "low", "3 unresolved comments (low severity)", "low"],
    [4, "medium", "4 unresolved comments (medium severity)", "medium"],
    [5, "high", "5 unresolved comments (high severity)", "high"],
  ])(
    "renders count=%s severity=%s with aria-label %j and data-severity=%s",
    (count, severity, label, sev) => {
      render(<CommentBadge count={count} severity={severity} className="tree-comment-badge" />);
      const el = screen.getByLabelText(label);
      expect(el).toHaveTextContent(String(count));
      expect(el).toHaveAttribute("data-severity", sev);
      expect(el).toHaveClass("tree-comment-badge");
    },
  );

  it("applies the className prop verbatim", () => {
    render(<CommentBadge count={9} severity="high" className="tab-badge" />);
    expect(screen.getByLabelText(/unresolved/)).toHaveClass("tab-badge");
  });

  it("displays 99 without capping", () => {
    render(<CommentBadge count={99} className="tree-comment-badge" />);
    const el = screen.getByLabelText("99 unresolved comments");
    expect(el).toHaveTextContent("99");
    expect(el).not.toHaveClass("badge-capped");
  });

  it("caps display at 99+ for counts over 99", () => {
    render(<CommentBadge count={100} className="tree-comment-badge" />);
    const el = screen.getByLabelText("100 unresolved comments");
    expect(el).toHaveTextContent("99+");
    expect(el).toHaveClass("badge-capped");
  });

  it("uses exact count in aria-label even when display is capped", () => {
    render(<CommentBadge count={250} severity="high" className="tab-badge" />);
    const el = screen.getByLabelText("250 unresolved comments (high severity)");
    expect(el).toHaveTextContent("99+");
    expect(el).toHaveClass("tab-badge", "badge-capped");
  });
});
