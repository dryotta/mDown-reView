import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileActionsBar } from "../FileActionsBar";
import { revealInFolder } from "@/lib/tauri-commands";

vi.mock("@/lib/tauri-commands", () => ({
  revealInFolder: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/logger", () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }));

const revealMock = revealInFolder as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  revealMock.mockClear();
});

describe("FileActionsBar (L1)", () => {
  it("renders the reveal icon button with aria-label", () => {
    render(<FileActionsBar path="/ws/x.png" />);
    expect(screen.getByRole("button", { name: /reveal in folder/i })).toBeInTheDocument();
  });

  it("dispatches revealInFolder with the absolute path", () => {
    render(<FileActionsBar path="/ws/doc.md" />);
    fireEvent.click(screen.getByRole("button", { name: /reveal in folder/i }));
    expect(revealMock).toHaveBeenCalledWith("/ws/doc.md");
  });

  it("renders the optional MIME hint before the buttons", () => {
    render(<FileActionsBar path="/m/song.mp3" mime="audio/mpeg" />);
    expect(screen.getByText("audio/mpeg")).toBeInTheDocument();
  });

  it("omits the MIME hint when not provided", () => {
    const { container } = render(<FileActionsBar path="/x" />);
    expect(container.querySelector(".file-actions-bar__mime")).toBeNull();
  });

  it("exposes title attribute for hover tooltip", () => {
    render(<FileActionsBar path="/ws/doc.md" />);
    expect(screen.getByRole("button", { name: /reveal in folder/i })).toHaveAttribute("title", "Reveal in folder");
  });
});
