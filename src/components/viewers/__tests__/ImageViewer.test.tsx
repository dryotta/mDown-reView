import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { ImageViewer } from "../ImageViewer";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");
vi.mock("@/lib/tauri-commands", () => ({
  readBinaryFile: vi.fn().mockResolvedValue("iVBORw0KGgoAAAANSUhEUg=="),
}));

import { readBinaryFile } from "@/lib/tauri-commands";

describe("ImageViewer", () => {
  beforeEach(() => {
    vi.mocked(readBinaryFile).mockResolvedValue("iVBORw0KGgoAAAANSUhEUg==");
  });

  it("renders image with data URL after loading", async () => {
    render(<ImageViewer path="/photos/test.png" />);
    await waitFor(() => {
      const img = screen.getByRole("img");
      expect(img.getAttribute("src")).toContain("data:image/png;base64,");
    });
    expect(readBinaryFile).toHaveBeenCalledWith("/photos/test.png");
  });

  it("shows filename in header", async () => {
    render(<ImageViewer path="/photos/test.png" />);
    expect(screen.getByText("test.png")).toBeInTheDocument();
    // Wait for async readBinaryFile to resolve to avoid act() warning
    await waitFor(() => {
      expect(screen.getByRole("img")).toBeInTheDocument();
    });
  });

  it("shows loading state initially", async () => {
    // Use a never-resolving promise so the loading state persists
    vi.mocked(readBinaryFile).mockReturnValue(new Promise(() => {}));
    render(<ImageViewer path="/photos/test.png" />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    // Cleanup before the promise could resolve to avoid act() warning
    cleanup();
  });

  it("shows error for failed load", async () => {
    vi.mocked(readBinaryFile).mockRejectedValue(new Error("file_too_large"));
    render(<ImageViewer path="/photos/huge.png" />);
    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument();
    });
  });

  it("does not render any comment UI", async () => {
    const { container } = render(<ImageViewer path="/photos/test.png" />);
    await waitFor(() => {
      expect(screen.getByRole("img")).toBeInTheDocument();
    });
    expect(container.querySelector(".comment-plus-btn")).toBeNull();
  });
});
