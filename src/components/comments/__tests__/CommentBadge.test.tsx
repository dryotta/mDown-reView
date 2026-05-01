import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { CommentBadge } from "../CommentBadge";

describe("CommentBadge — zero-count guard (issue #280 AC2)", () => {
  it("renders nothing when count === 0", () => {
    const { container } = render(
      <CommentBadge count={0} className="tab-badge" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when count is negative", () => {
    const { container } = render(
      <CommentBadge count={-3} className="tab-badge" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the badge when count > 0", () => {
    const { container } = render(
      <CommentBadge count={4} className="tab-badge" />,
    );
    expect(container.firstChild).not.toBeNull();
    expect(container.textContent).toBe("4");
  });

  it("forwards severity into data-severity", () => {
    const { container } = render(
      <CommentBadge count={1} severity="medium" className="tab-badge" />,
    );
    const span = container.firstChild as HTMLElement | null;
    expect(span?.getAttribute("data-severity")).toBe("medium");
  });
});
