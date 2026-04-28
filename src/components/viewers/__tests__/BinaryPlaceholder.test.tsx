import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

vi.mock("@/lib/vm/use-comments", () => ({
  useComments: () => ({ threads: [], comments: [], loading: false, reload: () => {} }),
}));
vi.mock("@/lib/vm/use-comment-actions", () => ({
  useCommentActions: () => ({ addComment: vi.fn().mockResolvedValue(undefined) }),
}));

import { BinaryPlaceholder } from "../BinaryPlaceholder";

describe("BinaryPlaceholder — pure metadata display", () => {
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

  it("does not render any action buttons — actions surface through BinaryViewerShell toolbar", () => {
    render(<BinaryPlaceholder path="/ws/sample.bin" size={512} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders mtime row when mtime prop is present", () => {
    const mtime = Date.UTC(2024, 0, 15, 12, 0, 0);
    render(<BinaryPlaceholder path="/ws/sample.bin" size={100} mtime={mtime} />);
    const row = screen.getByTestId("binary-mtime");
    expect(row).toBeInTheDocument();
    expect(row.textContent).toBe(new Date(mtime).toLocaleString());
  });

  it("omits mtime row when mtime undefined", () => {
    render(<BinaryPlaceholder path="/ws/sample.bin" size={100} />);
    expect(screen.queryByTestId("binary-mtime")).toBeNull();
  });

  it("omits mtime row when mtime null", () => {
    render(<BinaryPlaceholder path="/ws/sample.bin" size={100} mtime={null} />);
    expect(screen.queryByTestId("binary-mtime")).toBeNull();
  });
});
