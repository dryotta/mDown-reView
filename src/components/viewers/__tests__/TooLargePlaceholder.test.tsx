import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

import { TooLargePlaceholder } from "../TooLargePlaceholder";

describe("TooLargePlaceholder — pure metadata display", () => {
  it("renders the file name, the size, and the 10 MB cap message", () => {
    render(<TooLargePlaceholder path="/ws/huge.csv" size={42 * 1024 * 1024} />);
    expect(screen.getByText("huge.csv")).toBeInTheDocument();
    expect(screen.getByText(/42\.0+ MB/)).toBeInTheDocument();
    expect(screen.getByText(/exceeds the 10 MB read cap/i)).toBeInTheDocument();
  });

  it("renders no action buttons — actions surface through ViewerRouter toolbar", () => {
    render(<TooLargePlaceholder path="/ws/huge.csv" size={42 * 1024 * 1024} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders without a size when none is provided", () => {
    render(<TooLargePlaceholder path="/ws/x.bin" />);
    expect(screen.getByText("x.bin")).toBeInTheDocument();
    expect(document.querySelector(".binary-size")).not.toBeInTheDocument();
  });
});
