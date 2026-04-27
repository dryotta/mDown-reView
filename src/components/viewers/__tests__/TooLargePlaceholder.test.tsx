import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

import { invoke } from "@tauri-apps/api/core";
import { TooLargePlaceholder } from "../TooLargePlaceholder";

const invokeMock = invoke as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

describe("TooLargePlaceholder — Section E", () => {
  it("renders the file name, the size, and the 10 MB cap message", () => {
    render(<TooLargePlaceholder path="/ws/huge.csv" size={42 * 1024 * 1024} />);
    expect(screen.getByText("huge.csv")).toBeInTheDocument();
    expect(screen.getByText(/42\.0+ MB/)).toBeInTheDocument();
    expect(screen.getByText(/exceeds the 10 MB read cap/i)).toBeInTheDocument();
  });

  it("renders only the reveal-in-folder CTA (no hex toggle, no open-in-default)", () => {
    render(<TooLargePlaceholder path="/ws/huge.csv" size={42 * 1024 * 1024} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName(/reveal in folder/i);
    expect(screen.queryByRole("button", { name: /show as hex/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open in default app/i })).not.toBeInTheDocument();
  });

  it("clicking the CTA invokes reveal_in_folder", () => {
    render(<TooLargePlaceholder path="/ws/huge.csv" size={42 * 1024 * 1024} />);
    fireEvent.click(screen.getByRole("button", { name: /reveal in folder/i }));
    expect(invokeMock).toHaveBeenCalledWith("reveal_in_folder", { path: "/ws/huge.csv" });
  });

  it("renders without a size when none is provided", () => {
    render(<TooLargePlaceholder path="/ws/x.bin" />);
    expect(screen.getByText("x.bin")).toBeInTheDocument();
    expect(document.querySelector(".binary-size")).not.toBeInTheDocument();
  });
});
