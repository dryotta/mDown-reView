import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SelectionToolbar } from "@/components/comments/SelectionToolbar";

describe("SelectionToolbar", () => {
  it("renders comment button", () => {
    render(
      <SelectionToolbar
        position={{ top: 100, left: 200 }}
        onAddComment={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /comment/i })).toBeInTheDocument();
  });

  it("calls onAddComment when clicked", () => {
    const onAdd = vi.fn();
    render(
      <SelectionToolbar
        position={{ top: 100, left: 200 }}
        onAddComment={onAdd}
        onDismiss={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /comment/i }));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("calls onDismiss on Escape", () => {
    const onDismiss = vi.fn();
    render(
      <SelectionToolbar
        position={{ top: 100, left: 200 }}
        onAddComment={vi.fn()}
        onDismiss={onDismiss}
      />
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
