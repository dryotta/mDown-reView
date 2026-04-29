import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

vi.mock("@/lib/vm/use-comments", () => ({
  useComments: () => ({ threads: [], comments: [], loading: false, reload: () => {} }),
}));
vi.mock("@/lib/vm/use-comment-actions", () => ({
  useCommentActions: () => ({ addComment: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("@/hooks/useFileBadges", () => ({
  useFileBadges: () => ({}),
}));

import { invoke } from "@tauri-apps/api/core";
import { BinaryViewerShell } from "../BinaryViewerShell";

const invokeMock = invoke as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockClear();
  invokeMock.mockResolvedValue(undefined);
});

describe("BinaryViewerShell", () => {
  it("renders a ViewerToolbar with FileActionsBar", () => {
    render(<BinaryViewerShell path="/ws/sample.bin" size={512} />);
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reveal in folder/i })).toBeInTheDocument();
  });

  it("renders Comment on file button when onCommentOnFile is provided", () => {
    const onCof = vi.fn();
    render(<BinaryViewerShell path="/ws/sample.bin" size={512} onCommentOnFile={onCof} />);
    const btn = screen.getByRole("button", { name: /comment on file/i });
    fireEvent.click(btn);
    expect(onCof).toHaveBeenCalledOnce();
  });

  it("clicking reveal in folder invokes reveal_in_folder", () => {
    render(<BinaryViewerShell path="/ws/sample.bin" size={100} />);
    fireEvent.click(screen.getByRole("button", { name: /reveal in folder/i }));
    expect(invokeMock).toHaveBeenCalledWith("reveal_in_folder", { path: "/ws/sample.bin" });
  });
});
