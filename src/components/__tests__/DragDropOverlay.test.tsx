import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DragDropOverlay } from "../DragDropOverlay";

describe("<DragDropOverlay>", () => {
  it("renders nothing visible when not dragging and no rejection", () => {
    const { container } = render(
      <DragDropOverlay isDragging={false} hasWorkspace={false} lastRejection={null} />,
    );
    expect(container.querySelector(".drag-drop-overlay")).toBeNull();
    expect(container.querySelector(".drag-drop-rejection-toast")).toBeNull();
  });

  it("renders the overlay when isDragging is true", () => {
    const { container, getByText } = render(
      <DragDropOverlay isDragging={true} hasWorkspace={false} lastRejection={null} />,
    );
    expect(container.querySelector(".drag-drop-overlay")).not.toBeNull();
    expect(getByText("Drop to open")).toBeInTheDocument();
  });

  it("uses 'open as this workspace' copy when no workspace is open", () => {
    const { getByText } = render(
      <DragDropOverlay isDragging={true} hasWorkspace={false} lastRejection={null} />,
    );
    expect(getByText(/Folders open as this workspace/)).toBeInTheDocument();
  });

  it("uses 'open in a new window' copy when a workspace is already open", () => {
    const { getByText } = render(
      <DragDropOverlay isDragging={true} hasWorkspace={true} lastRejection={null} />,
    );
    // The new-window copy explains the actual behavior — toolbar Open
    // Folder replaces, drag-drop spawns. Without this, the user is
    // surprised when drop-folder spawns instead of replacing.
    expect(getByText(/Folders open in a new window/)).toBeInTheDocument();
  });

  it("includes the file hint in both states", () => {
    const { getByText: getByTextEmpty } = render(
      <DragDropOverlay isDragging={true} hasWorkspace={false} lastRejection={null} />,
    );
    expect(getByTextEmpty(/Files open as tabs/)).toBeInTheDocument();
  });

  it("is hidden from assistive tech (presentational affordance only)", () => {
    const { container } = render(
      <DragDropOverlay isDragging={true} hasWorkspace={false} lastRejection={null} />,
    );
    const overlay = container.querySelector(".drag-drop-overlay") as HTMLElement | null;
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");
    expect(overlay?.getAttribute("role")).toBe("presentation");
  });

  it("includes a sr-only live region announcement when dragging", () => {
    const { container } = render(
      <DragDropOverlay isDragging={true} hasWorkspace={false} lastRejection={null} />,
    );
    const live = container.querySelector(".drag-drop-overlay-sr-only") as HTMLElement | null;
    expect(live).not.toBeNull();
    expect(live?.getAttribute("aria-live")).toBe("polite");
    expect(live?.textContent).toBe("Drop files or folders to open");
  });

  it("clears the live region announcement when not dragging", () => {
    const { container } = render(
      <DragDropOverlay isDragging={false} hasWorkspace={false} lastRejection={null} />,
    );
    const live = container.querySelector(".drag-drop-overlay-sr-only") as HTMLElement | null;
    expect(live?.textContent).toBe("");
  });

  it("shows a singular rejection toast when count is 1", () => {
    const { getByText } = render(
      <DragDropOverlay
        isDragging={false}
        hasWorkspace={false}
        lastRejection={{ count: 1, reason: "no usable file or folder" }}
      />,
    );
    expect(getByText(/Couldn't open the dropped item/)).toBeInTheDocument();
    expect(getByText(/no usable file or folder/)).toBeInTheDocument();
  });

  it("pluralizes the rejection toast for multiple items", () => {
    const { getByText } = render(
      <DragDropOverlay
        isDragging={false}
        hasWorkspace={false}
        lastRejection={{ count: 5, reason: "x" }}
      />,
    );
    expect(getByText(/Couldn't open 5 dropped items/)).toBeInTheDocument();
  });

  it("hides the rejection toast while dragging (overlay takes priority)", () => {
    const { container } = render(
      <DragDropOverlay
        isDragging={true}
        hasWorkspace={false}
        lastRejection={{ count: 1, reason: "x" }}
      />,
    );
    expect(container.querySelector(".drag-drop-rejection-toast")).toBeNull();
  });
});
