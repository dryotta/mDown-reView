import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DragDropOverlay } from "../DragDropOverlay";

describe("<DragDropOverlay>", () => {
  it("renders nothing when isDragging is false", () => {
    const { container } = render(<DragDropOverlay isDragging={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the overlay when isDragging is true", () => {
    const { container, getByText } = render(<DragDropOverlay isDragging={true} />);
    expect(container.querySelector(".drag-drop-overlay")).not.toBeNull();
    expect(getByText("Drop to open")).toBeInTheDocument();
  });

  it("includes the file/folder hint", () => {
    const { getByText } = render(<DragDropOverlay isDragging={true} />);
    // The hint text reassures the user that mixed drops work.
    expect(getByText(/Files open as tabs/i)).toBeInTheDocument();
    expect(getByText(/Folders open as workspaces/i)).toBeInTheDocument();
  });

  it("is hidden from assistive tech (presentational affordance only)", () => {
    const { container } = render(<DragDropOverlay isDragging={true} />);
    const overlay = container.querySelector(".drag-drop-overlay") as HTMLElement | null;
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");
    expect(overlay?.getAttribute("role")).toBe("presentation");
  });
});
