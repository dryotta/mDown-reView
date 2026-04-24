import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SkeletonLoader } from "../SkeletonLoader";

describe("SkeletonLoader", () => {
  it("renders with progressbar role", () => {
    render(<SkeletonLoader />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("has correct aria-label", () => {
    render(<SkeletonLoader />);
    expect(screen.getByLabelText("Loading\u2026")).toBeInTheDocument();
  });

  it("renders 8 skeleton lines", () => {
    const { container } = render(<SkeletonLoader />);
    const lines = container.querySelectorAll(".skeleton-line");
    expect(lines).toHaveLength(8);
  });
});
