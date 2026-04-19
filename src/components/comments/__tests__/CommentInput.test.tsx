import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CommentInput } from "../CommentInput";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

// ─── 14.1: CommentInput behavior ─────────────────────────────────────────────

describe("14.1 – CommentInput", () => {
  it("textarea is focused on mount", async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();

    render(<CommentInput onSave={onSave} onClose={onClose} />);

    await waitFor(() => {
      const textarea = screen.getByRole("textbox");
      expect(textarea).toHaveFocus();
    });
  });

  it("Save button calls onSave with trimmed text when clicked", async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();

    render(<CommentInput onSave={onSave} onClose={onClose} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "  My comment  " } });

    const saveBtn = screen.getByRole("button", { name: /save/i });
    fireEvent.click(saveBtn);

    expect(onSave).toHaveBeenCalledWith("My comment");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Save button is disabled when text is empty/whitespace", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();

    render(<CommentInput onSave={onSave} onClose={onClose} />);

    const saveBtn = screen.getByRole("button", { name: /save/i });
    expect(saveBtn).toBeDisabled();
  });

  it("Escape key calls onClose without saving", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();

    render(<CommentInput onSave={onSave} onClose={onClose} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "some text" } });
    fireEvent.keyDown(textarea, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Ctrl+Enter calls onSave with trimmed text", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();

    render(<CommentInput onSave={onSave} onClose={onClose} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "keyboard save" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

    expect(onSave).toHaveBeenCalledWith("keyboard save");
  });

  it("Cancel button calls onClose", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();

    render(<CommentInput onSave={onSave} onClose={onClose} />);

    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelBtn);

    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
