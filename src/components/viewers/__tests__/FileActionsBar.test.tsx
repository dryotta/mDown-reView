import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileActionsBar } from "../FileActionsBar";
import { revealInFolder, openInDefaultApp } from "@/lib/tauri-commands";

vi.mock("@/lib/tauri-commands", () => ({
  revealInFolder: vi.fn().mockResolvedValue(undefined),
  openInDefaultApp: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/logger", () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }));

const revealMock = revealInFolder as unknown as ReturnType<typeof vi.fn>;
const openMock = openInDefaultApp as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  revealMock.mockClear();
  openMock.mockClear();
});

describe("FileActionsBar (L1)", () => {
  it("renders the reveal + open icon buttons with aria-labels", () => {
    render(<FileActionsBar path="/ws/x.png" />);
    expect(screen.getByRole("button", { name: /reveal in folder/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open in default app/i })).toBeInTheDocument();
  });

  it("dispatches revealInFolder with the absolute path", () => {
    render(<FileActionsBar path="/ws/doc.md" />);
    fireEvent.click(screen.getByRole("button", { name: /reveal in folder/i }));
    expect(revealMock).toHaveBeenCalledWith("/ws/doc.md");
    expect(openMock).not.toHaveBeenCalled();
  });

  it("dispatches openInDefaultApp with the absolute path", () => {
    render(<FileActionsBar path="/ws/doc.md" />);
    fireEvent.click(screen.getByRole("button", { name: /open in default app/i }));
    expect(openMock).toHaveBeenCalledWith("/ws/doc.md");
    expect(revealMock).not.toHaveBeenCalled();
  });

  it("renders the optional MIME hint before the buttons", () => {
    render(<FileActionsBar path="/m/song.mp3" mime="audio/mpeg" />);
    expect(screen.getByText("audio/mpeg")).toBeInTheDocument();
  });

  it("omits the MIME hint when not provided", () => {
    const { container } = render(<FileActionsBar path="/x" />);
    expect(container.querySelector(".file-actions-bar__mime")).toBeNull();
  });

  it("exposes title attributes for hover tooltips", () => {
    render(<FileActionsBar path="/ws/doc.md" />);
    expect(screen.getByRole("button", { name: /reveal in folder/i })).toHaveAttribute("title", "Reveal in folder");
    expect(screen.getByRole("button", { name: /open in default app/i })).toHaveAttribute("title", "Open in default app");
  });
});
