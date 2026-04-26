import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CommentInput } from "../CommentInput";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

beforeEach(() => {
  localStorage.clear();
});

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

// ─── Group E: draft persistence in localStorage ───────────────────────────────

describe("CommentInput – draft persistence (Group E)", () => {
  const KEY = "/repo/file.md::new::abcd1234";

  it("typing writes the draft to localStorage under draftKey", () => {
    render(<CommentInput onSave={() => {}} onClose={() => {}} draftKey={KEY} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "draft content" } });
    expect(localStorage.getItem(KEY)).toBe("draft content");
  });

  it("remount with same draftKey restores the previously typed text", () => {
    const { unmount } = render(
      <CommentInput onSave={() => {}} onClose={() => {}} draftKey={KEY} />
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "in progress" } });
    unmount();

    render(<CommentInput onSave={() => {}} onClose={() => {}} draftKey={KEY} />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("in progress");
  });

  it("onSave clears the draft key", () => {
    const onSave = vi.fn();
    render(<CommentInput onSave={onSave} onClose={() => {}} draftKey={KEY} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "to save" } });
    expect(localStorage.getItem(KEY)).toBe("to save");

    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith("to save");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("onCancel clears the draft key", () => {
    const onClose = vi.fn();
    render(<CommentInput onSave={() => {}} onClose={onClose} draftKey={KEY} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "discarded" } });
    expect(localStorage.getItem(KEY)).toBe("discarded");

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("absent draftKey leaves localStorage untouched", () => {
    const before = { ...localStorage };
    render(<CommentInput onSave={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "stateless" } });
    // No new keys should have appeared.
    expect(Object.keys(localStorage).length).toBe(Object.keys(before).length);
  });

  it("survives a localStorage quota error without crashing the input", () => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = vi.fn(() => {
      throw new DOMException("quota", "QuotaExceededError");
    }) as typeof Storage.prototype.setItem;
    try {
      const onSave = vi.fn();
      render(<CommentInput onSave={onSave} onClose={() => {}} draftKey={KEY} />);
      // Typing must still update the state and Save must still call onSave —
      // even though the persistence write threw.
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "robust" } });
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
      expect(onSave).toHaveBeenCalledWith("robust");
    } finally {
      Storage.prototype.setItem = setItem;
    }
  });
});
