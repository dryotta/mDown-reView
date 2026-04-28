import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");
vi.mock("@/lib/tauri-commands", () => ({
  readBinaryFile: vi.fn().mockResolvedValue("iVBORw0KGgoAAAANSUhEUg=="),
}));

vi.mock("@/lib/vm/use-comments", () => ({
  useComments: () => ({
    threads: [],
    comments: [],
    loading: false,
    reload: () => {},
  }),
}));

vi.mock("@/store", () => {
  const state: Record<string, unknown> = {
    toggleCommentsPane: vi.fn(),
    zoomByFiletype: {} as Record<string, number>,
    bumpZoom: () => {},
    setZoom: () => {},
  };
  const useStore = (selector: (s: typeof state) => unknown) => selector(state);
  (useStore as unknown as { getState: () => typeof state }).getState = () => state;
  (useStore as unknown as { setState: (partial: Record<string, unknown>) => void }).setState = (partial: Record<string, unknown>) => {
    Object.assign(state, partial);
  };
  return { useStore };
});

import { ImageViewer } from "../ImageViewer";
import { readBinaryFile } from "@/lib/tauri-commands";
import { useStore } from "@/store";

beforeEach(() => {
  cleanup();
  vi.mocked(readBinaryFile).mockResolvedValue("iVBORw0KGgoAAAANSUhEUg==");
  useStore.setState({ zoomByFiletype: { ".png": 1.0, ".image": 1.0 } });
});

describe("ImageViewer (existing behaviour)", () => {
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
    await waitFor(() => {
      expect(screen.getByRole("img")).toBeInTheDocument();
    });
  });

  it("shows loading state initially", async () => {
    vi.mocked(readBinaryFile).mockReturnValue(new Promise(() => {}));
    render(<ImageViewer path="/photos/test.png" />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    cleanup();
  });

  it("shows error for failed load", async () => {
    vi.mocked(readBinaryFile).mockRejectedValue(new Error("file_too_large"));
    render(<ImageViewer path="/photos/huge.png" />);
    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument();
    });
  });
});

describe("ImageViewer (R1)pointer capture, no window listeners", () => {
  beforeEach(() => {
    useStore.setState({ zoomByFiletype: { ".png": 2.0, ".image": 2.0 } });
  });

  it("does NOT register window mouse/pointer move/up listeners on drag start", async () => {
    const winAdd = vi.spyOn(window, "addEventListener");
    const { container } = render(<ImageViewer path="/photos/test.png" />);
    await waitFor(() => expect(screen.getByRole("img")).toBeInTheDocument());
    const canvas = container.querySelector(".image-viewer-canvas") as HTMLDivElement;
    canvas.setPointerCapture = vi.fn();
    canvas.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(canvas, { clientX: 50, clientY: 50, pointerId: 1, button: 0 });

    const dragListeners = winAdd.mock.calls.filter(
      ([type]) => type === "mousemove" || type === "mouseup" || type === "pointermove" || type === "pointerup",
    );
    expect(dragListeners).toHaveLength(0);
    winAdd.mockRestore();
  });

  it("calls setPointerCapture on pointerdown when zoomed > 1", async () => {
    const { container } = render(<ImageViewer path="/photos/test.png" />);
    await waitFor(() => expect(screen.getByRole("img")).toBeInTheDocument());
    const canvas = container.querySelector(".image-viewer-canvas") as HTMLDivElement;
    const captureSpy = vi.fn();
    canvas.setPointerCapture = captureSpy;
    canvas.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(canvas, { clientX: 50, clientY: 50, pointerId: 7, button: 0 });

    expect(captureSpy).toHaveBeenCalledWith(7);
  });

  it("does not throw if unmounted mid-drag (no dangling window listeners)", async () => {
    const { container, unmount } = render(<ImageViewer path="/photos/test.png" />);
    await waitFor(() => expect(screen.getByRole("img")).toBeInTheDocument());
    const canvas = container.querySelector(".image-viewer-canvas") as HTMLDivElement;
    canvas.setPointerCapture = vi.fn();
    canvas.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(canvas, { clientX: 0, clientY: 0, pointerId: 3, button: 0 });
    expect(() => unmount()).not.toThrow();
    expect(() => window.dispatchEvent(new MouseEvent("mousemove", { clientX: 100, clientY: 100 }))).not.toThrow();
  });
});
