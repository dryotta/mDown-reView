import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommentThread } from "../CommentThread";
import { useStore } from "@/store";
import type { CommentWithOrphan } from "@/store";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

function makeComment(overrides: Partial<CommentWithOrphan> = {}): CommentWithOrphan {
  return {
    id: "comment-1",
    anchorType: "block" as const,
    blockHash: "abc123",
    headingContext: null,
    fallbackLine: 1,
    text: "This is a comment",
    createdAt: new Date("2024-06-15T12:00:00Z").toISOString(),
    resolved: false,
    isOrphaned: false,
    ...overrides,
  };
}

// ─── 14.2: CommentThread behavior ────────────────────────────────────────────

describe("14.2 – CommentThread", () => {
  it("renders comment text", () => {
    render(<CommentThread comment={makeComment()} />);
    expect(screen.getByText("This is a comment")).toBeInTheDocument();
  });

  it("renders a timestamp", () => {
    render(<CommentThread comment={makeComment()} />);
    // Some locale-formatted date string should appear
    const dateEl = document.querySelector(".comment-timestamp");
    expect(dateEl).toBeInTheDocument();
    expect(dateEl?.textContent).not.toBe("");
  });

  it("Edit button makes comment editable", () => {
    render(<CommentThread comment={makeComment()} />);

    fireEvent.click(screen.getByRole("button", { name: /edit/i }));

    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
  });

  it("saving edit calls editComment in store", () => {
    const editCommentSpy = vi.fn();
    useStore.setState({ editComment: editCommentSpy } as never);

    render(<CommentThread comment={makeComment()} />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "updated text" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(editCommentSpy).toHaveBeenCalledWith("comment-1", "updated text");
  });

  it("Delete button calls deleteComment in store", () => {
    const deleteCommentSpy = vi.fn();
    useStore.setState({ deleteComment: deleteCommentSpy } as never);

    render(<CommentThread comment={makeComment()} />);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));

    expect(deleteCommentSpy).toHaveBeenCalledWith("comment-1");
  });

  it("Resolve button calls resolveComment in store", () => {
    const resolveCommentSpy = vi.fn();
    useStore.setState({ resolveComment: resolveCommentSpy } as never);

    render(<CommentThread comment={makeComment({ resolved: false })} />);
    fireEvent.click(screen.getByRole("button", { name: /resolve/i }));

    expect(resolveCommentSpy).toHaveBeenCalledWith("comment-1");
  });

  it("resolved comment shows 'Unresolve' button instead of 'Resolve'", () => {
    const unresolveCommentSpy = vi.fn();
    useStore.setState({ unresolveComment: unresolveCommentSpy } as never);

    render(<CommentThread comment={makeComment({ resolved: true })} />);

    expect(screen.getByRole("button", { name: /unresolve/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^resolve$/i })).not.toBeInTheDocument();
  });

  it("resolved comment calls unresolveComment when Unresolve is clicked", () => {
    const unresolveCommentSpy = vi.fn();
    useStore.setState({ unresolveComment: unresolveCommentSpy } as never);

    render(<CommentThread comment={makeComment({ resolved: true })} />);
    fireEvent.click(screen.getByRole("button", { name: /unresolve/i }));

    expect(unresolveCommentSpy).toHaveBeenCalledWith("comment-1");
  });

  it("orphaned comment shows warning icon ⚠", () => {
    render(<CommentThread comment={makeComment({ isOrphaned: true })} />);
    expect(screen.getByTitle(/not found/i)).toBeInTheDocument();
    expect(screen.getByText("⚠")).toBeInTheDocument();
  });

  it("non-orphaned comment does not show warning icon", () => {
    render(<CommentThread comment={makeComment({ isOrphaned: false })} />);
    expect(screen.queryByText("⚠")).not.toBeInTheDocument();
  });
});

// ─── v3: Response display ─────────────────────────────────────────────────────

describe("CommentThread – response display", () => {
  it("renders responses when present", () => {
    render(<CommentThread comment={makeComment({
      responses: [
        { author: "agent-1", text: "Acknowledged", createdAt: "2026-01-01T00:00:00Z" },
        { author: "agent-2", text: "Fixed", createdAt: "2026-01-02T00:00:00Z" },
      ]
    })} />);
    expect(screen.getByText("agent-1")).toBeInTheDocument();
    expect(screen.getByText("Acknowledged")).toBeInTheDocument();
    expect(screen.getByText("agent-2")).toBeInTheDocument();
    expect(screen.getByText("Fixed")).toBeInTheDocument();
  });

  it("does not render response section when no responses", () => {
    render(<CommentThread comment={makeComment()} />);
    expect(document.querySelector(".comment-responses")).not.toBeInTheDocument();
  });

  it("does not render response section when responses is empty array", () => {
    render(<CommentThread comment={makeComment({ responses: [] })} />);
    expect(document.querySelector(".comment-responses")).not.toBeInTheDocument();
  });
});
