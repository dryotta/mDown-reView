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
});
