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

vi.mock("../HexView", () => ({
  HexView: ({ path }: { path: string }) => (
    <div data-testid="hex-view-mock" data-path={path}>HEX</div>
  ),
}));

import { invoke } from "@tauri-apps/api/core";
import { BinaryPlaceholder } from "../BinaryPlaceholder";

const invokeMock = invoke as ReturnType<typeof vi.fn>;

const writeText = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText }));

beforeEach(() => {
  invokeMock.mockClear();
  invokeMock.mockResolvedValue(undefined);
  writeText.mockClear();
});

describe("BinaryPlaceholder — Section E", () => {
  it("renders all five action buttons", () => {
    render(<BinaryPlaceholder path="/ws/sample.bin" size={512} />);
    expect(screen.getByRole("button", { name: /open in default app/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reveal in folder/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy path/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show as hex/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /comment on this file/i })).toBeInTheDocument();
  });

  it("renders the file name, MIME hint and human-readable size", () => {
    render(<BinaryPlaceholder path="/ws/song.mp3" size={2 * 1024 * 1024} />);
    expect(screen.getByText("song.mp3")).toBeInTheDocument();
    expect(screen.getByText("audio/mpeg")).toBeInTheDocument();
    expect(screen.getByText(/2\.0+ MB/)).toBeInTheDocument();
  });

  it("picks an icon by category", () => {
    render(<BinaryPlaceholder path="/ws/archive.zip" size={100} />);
    expect(screen.getByTestId("binary-icon-archive")).toBeInTheDocument();
  });

  it("disables 'Show as hex' when size ≥ 1 MB", () => {
    render(<BinaryPlaceholder path="/ws/big.bin" size={1024 * 1024} />);
    expect(screen.getByRole("button", { name: /show as hex/i })).toBeDisabled();
  });

  it("disables 'Show as hex' when size is unknown", () => {
    render(<BinaryPlaceholder path="/ws/unknown.bin" />);
    expect(screen.getByRole("button", { name: /show as hex/i })).toBeDisabled();
  });

  it("enables 'Show as hex' when size < 1 MB", () => {
    render(<BinaryPlaceholder path="/ws/tiny.bin" size={1024} />);
    expect(screen.getByRole("button", { name: /show as hex/i })).toBeEnabled();
  });

  it("clicking 'Open in default app' invokes open_in_default_app", () => {
    render(<BinaryPlaceholder path="/ws/sample.bin" size={100} />);
    fireEvent.click(screen.getByRole("button", { name: /open in default app/i }));
    expect(invokeMock).toHaveBeenCalledWith("open_in_default_app", { path: "/ws/sample.bin" });
  });

  it("clicking 'Reveal in folder' invokes reveal_in_folder", () => {
    render(<BinaryPlaceholder path="/ws/sample.bin" size={100} />);
    fireEvent.click(screen.getByRole("button", { name: /reveal in folder/i }));
    expect(invokeMock).toHaveBeenCalledWith("reveal_in_folder", { path: "/ws/sample.bin" });
  });

  it("clicking 'Copy path' delegates to the clipboard plugin", async () => {
    const { findByRole } = render(<BinaryPlaceholder path="/ws/sample.bin" size={100} />);
    fireEvent.click(await findByRole("button", { name: /copy path/i }));
    // Two microtasks: dynamic import resolution + writeText invocation.
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("/ws/sample.bin");
    });
  });

  it("clicking 'Show as hex' switches to HexView", () => {
    render(<BinaryPlaceholder path="/ws/sample.bin" size={100} />);
    fireEvent.click(screen.getByRole("button", { name: /show as hex/i }));
    expect(screen.getByTestId("hex-view-mock")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open in default app/i })).not.toBeInTheDocument();
  });

  it("clicking 'Comment on this file' opens the file-level CommentInput", () => {
    render(<BinaryPlaceholder path="/ws/sample.bin" size={100} />);
    expect(screen.queryByPlaceholderText(/comment on this file/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /comment on this file/i }));
    expect(screen.getByPlaceholderText(/comment on this file/i)).toBeInTheDocument();
  });
});
