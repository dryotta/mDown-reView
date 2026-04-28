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

vi.mock("../HexView", () => ({
  HexView: ({ path }: { path: string }) => (
    <div data-testid="hex-view-mock" data-path={path}>HEX</div>
  ),
}));

import { invoke } from "@tauri-apps/api/core";
import { BinaryViewerShell } from "../BinaryViewerShell";

const invokeMock = invoke as ReturnType<typeof vi.fn>;

const writeText = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText }));

beforeEach(() => {
  invokeMock.mockClear();
  invokeMock.mockResolvedValue(undefined);
  writeText.mockClear();
});

describe("BinaryViewerShell", () => {
  it("renders a ViewerToolbar with hex toggle, copy path, and FileActionsBar", () => {
    render(<BinaryViewerShell path="/ws/sample.bin" size={512} />);
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show as hex/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy path/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reveal in folder/i })).toBeInTheDocument();
  });

  it("renders Comment on file button when onCommentOnFile is provided", () => {
    const onCof = vi.fn();
    render(<BinaryViewerShell path="/ws/sample.bin" size={512} onCommentOnFile={onCof} />);
    const btn = screen.getByRole("button", { name: /comment on file/i });
    fireEvent.click(btn);
    expect(onCof).toHaveBeenCalledOnce();
  });

  it("clicking hex toggle switches to HexView", () => {
    render(<BinaryViewerShell path="/ws/sample.bin" size={100} />);
    fireEvent.click(screen.getByRole("button", { name: /show as hex/i }));
    expect(screen.getByTestId("hex-view-mock")).toBeInTheDocument();
  });

  it("clicking hex toggle again switches back to metadata", () => {
    render(<BinaryViewerShell path="/ws/sample.bin" size={100} />);
    fireEvent.click(screen.getByRole("button", { name: /show as hex/i }));
    expect(screen.getByTestId("hex-view-mock")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /back to metadata/i }));
    expect(screen.queryByTestId("hex-view-mock")).not.toBeInTheDocument();
    expect(screen.getByText("sample.bin")).toBeInTheDocument();
  });

  it("disables hex toggle when size ≥ 1 MB", () => {
    render(<BinaryViewerShell path="/ws/big.bin" size={1024 * 1024} />);
    expect(screen.getByRole("button", { name: /show as hex/i })).toBeDisabled();
  });

  it("disables hex toggle when size is unknown", () => {
    render(<BinaryViewerShell path="/ws/unknown.bin" />);
    expect(screen.getByRole("button", { name: /show as hex/i })).toBeDisabled();
  });

  it("clicking copy path delegates to the clipboard plugin", async () => {
    render(<BinaryViewerShell path="/ws/sample.bin" size={100} />);
    fireEvent.click(screen.getByRole("button", { name: /copy path/i }));
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("/ws/sample.bin");
    });
  });

  it("clicking reveal in folder invokes reveal_in_folder", () => {
    render(<BinaryViewerShell path="/ws/sample.bin" size={100} />);
    fireEvent.click(screen.getByRole("button", { name: /reveal in folder/i }));
    expect(invokeMock).toHaveBeenCalledWith("reveal_in_folder", { path: "/ws/sample.bin" });
  });
});
