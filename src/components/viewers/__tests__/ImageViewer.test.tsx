import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, act } from "@testing-library/react";

const { addCommentMock, setFocusedThreadMock, useCommentsMock } = vi.hoisted(() => {
  type UseCommentsReturn = { threads: unknown[]; comments: unknown[]; loading: boolean; reload: () => void };
  return {
    addCommentMock: vi.fn<(filePath: string, text: string, anchor?: unknown) => Promise<void>>(async () => {}),
    setFocusedThreadMock: vi.fn(),
    useCommentsMock: vi.fn<(path: string | null) => UseCommentsReturn>(() => ({
      threads: [],
      comments: [],
      loading: false,
      reload: () => {},
    })),
  };
});

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");
vi.mock("@/lib/tauri-commands", () => ({
  readBinaryFile: vi.fn().mockResolvedValue("iVBORw0KGgoAAAANSUhEUg=="),
}));

vi.mock("@/lib/vm/use-comments", () => ({
  useComments: (path: string | null) => useCommentsMock(path),
}));

vi.mock("@/lib/vm/use-comment-actions", () => ({
  useCommentActions: () => ({ addComment: addCommentMock }),
}));

import { ImageViewer } from "../ImageViewer";
import { readBinaryFile } from "@/lib/tauri-commands";
import { useStore } from "@/store";

// JSDOM has no real layout. Stub bounding rects + natural dims so coord math
// against the displayed <img> is deterministic.
function setupImageGeometry(container: HTMLElement, img: HTMLImageElement) {
  // 200×200 image element at canvas-origin (0,0).
  Object.defineProperty(img, "naturalWidth", { value: 200, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: 200, configurable: true });
  Object.defineProperty(img, "clientWidth", { value: 200, configurable: true });
  Object.defineProperty(img, "clientHeight", { value: 200, configurable: true });
  img.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 200, width: 200, height: 200, toJSON: () => ({}) } as DOMRect);
  const canvas = container.querySelector(".image-viewer-canvas") as HTMLDivElement;
  canvas.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 400, width: 400, height: 400, toJSON: () => ({}) } as DOMRect);
  // Stub pointer-capture APIs JSDOM lacks.
  canvas.setPointerCapture = vi.fn();
  canvas.releasePointerCapture = vi.fn();
  // Trigger onLoad to populate dimensions state.
  fireEvent.load(img);
}

beforeEach(() => {
  cleanup();
  addCommentMock.mockClear();
  setFocusedThreadMock.mockClear();
  useCommentsMock.mockReset();
  useCommentsMock.mockReturnValue({ threads: [], comments: [], loading: false, reload: () => {} });
  vi.mocked(readBinaryFile).mockResolvedValue("iVBORw0KGgoAAAANSUhEUg==");
  // Reset zoom so canPan is false unless a test opts in.
  useStore.setState({ zoomByFiletype: { ".png": 1.0, ".image": 1.0 }, setFocusedThread: setFocusedThreadMock });
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

/**
 * R1 — drag uses pointer-events with `setPointerCapture` instead of
 * window-level mousemove/mouseup listeners.
 */
describe("ImageViewer (R1) — pointer capture, no window listeners", () => {
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

/**
 * Iter 8 Group A — image_rect commentable surface.
 */
describe("ImageViewer (iter 8 A) — image_rect comments", () => {
  it("renders the comment-mode toggle", async () => {
    render(<ImageViewer path="/photos/test.png" />);
    await waitFor(() => expect(screen.getByRole("img")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /comment mode/i })).toBeInTheDocument();
  });

  it("comment mode ON, click on image emits {kind:image_rect,x_pct,y_pct} (no w/h)", async () => {
    const { container } = render(<ImageViewer path="/photos/test.png" />);
    const img = (await screen.findByRole("img")) as HTMLImageElement;
    setupImageGeometry(container, img);

    // Toggle comment mode.
    fireEvent.click(screen.getByRole("button", { name: /comment mode/i }));
    const canvas = container.querySelector(".image-viewer-canvas") as HTMLDivElement;

    // Click at (50, 100) inside the 200×200 image — equals (25%, 50%).
    fireEvent.pointerDown(canvas, { clientX: 50, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerUp(canvas, { clientX: 50, clientY: 100, pointerId: 1, button: 0 });

    const composer = await screen.findByRole("textbox");
    fireEvent.change(composer, { target: { value: "look here" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(addCommentMock).toHaveBeenCalledTimes(1));
    const [filePath, text, anchor] = addCommentMock.mock.calls[0];
    expect(filePath).toBe("/photos/test.png");
    expect(text).toBe("look here");
    expect(anchor).toEqual({ kind: "image_rect", x_pct: 25, y_pct: 50 });
    expect(anchor as Record<string, unknown>).not.toHaveProperty("w_pct");
    expect(anchor as Record<string, unknown>).not.toHaveProperty("h_pct");
  });

  it("comment mode ON, drag emits {kind:image_rect,x_pct,y_pct,w_pct,h_pct}", async () => {
    const { container } = render(<ImageViewer path="/photos/test.png" />);
    const img = (await screen.findByRole("img")) as HTMLImageElement;
    setupImageGeometry(container, img);

    fireEvent.click(screen.getByRole("button", { name: /comment mode/i }));
    const canvas = container.querySelector(".image-viewer-canvas") as HTMLDivElement;

    // Drag from (40, 60) to (120, 160) inside the 200×200 image.
    // Expected: x_pct=20, y_pct=30, w_pct=40, h_pct=50.
    fireEvent.pointerDown(canvas, { clientX: 40, clientY: 60, pointerId: 1, button: 0 });
    fireEvent.pointerMove(canvas, { clientX: 120, clientY: 160, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 120, clientY: 160, pointerId: 1, button: 0 });

    const composer = await screen.findByRole("textbox");
    fireEvent.change(composer, { target: { value: "this region" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(addCommentMock).toHaveBeenCalledTimes(1));
    const anchor = addCommentMock.mock.calls[0][2] as Record<string, number>;
    expect(anchor.kind).toBe("image_rect");
    expect(anchor.x_pct).toBeCloseTo(20, 5);
    expect(anchor.y_pct).toBeCloseTo(30, 5);
    expect(anchor.w_pct).toBeCloseTo(40, 5);
    expect(anchor.h_pct).toBeCloseTo(50, 5);
  });

  it("clicks an existing image_rect marker → setFocusedThread is called", async () => {
    useCommentsMock.mockReturnValue({
      threads: [
        {
          root: {
            id: "thread-1",
            author: "Tester",
            timestamp: "2024-01-01T00:00:00Z",
            text: "first",
            resolved: false,
            line: 0,
            anchor_kind: "image_rect",
            image_rect: { x_pct: 25, y_pct: 50 },
          },
          replies: [],
        },
      ],
      comments: [],
      loading: false,
      reload: () => {},
    });

    const { container } = render(<ImageViewer path="/photos/test.png" />);
    const img = (await screen.findByRole("img")) as HTMLImageElement;
    setupImageGeometry(container, img);

    // Force a re-layout pass so markers compute their positions from the
    // now-stubbed bounding rect.
    act(() => { window.dispatchEvent(new Event("resize")); });

    const marker = await waitFor(() => {
      const m = container.querySelector('[data-thread-id="thread-1"]');
      if (!m) throw new Error("marker not yet rendered");
      return m as HTMLElement;
    });
    fireEvent.click(marker);
    expect(setFocusedThreadMock).toHaveBeenCalledWith("thread-1");
  });

  it("comment mode OFF — clicking does NOT call addComment (pan-mode preserved)", async () => {
    const { container } = render(<ImageViewer path="/photos/test.png" />);
    const img = (await screen.findByRole("img")) as HTMLImageElement;
    setupImageGeometry(container, img);

    // No toggle — comment mode stays off.
    const canvas = container.querySelector(".image-viewer-canvas") as HTMLDivElement;
    fireEvent.pointerDown(canvas, { clientX: 50, clientY: 50, pointerId: 1, button: 0 });
    fireEvent.pointerUp(canvas, { clientX: 50, clientY: 50, pointerId: 1, button: 0 });

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(addCommentMock).not.toHaveBeenCalled();
  });

  it("Esc closes the composer", async () => {
    const { container } = render(<ImageViewer path="/photos/test.png" />);
    const img = (await screen.findByRole("img")) as HTMLImageElement;
    setupImageGeometry(container, img);

    fireEvent.click(screen.getByRole("button", { name: /comment mode/i }));
    const canvas = container.querySelector(".image-viewer-canvas") as HTMLDivElement;
    fireEvent.pointerDown(canvas, { clientX: 50, clientY: 50, pointerId: 1, button: 0 });
    fireEvent.pointerUp(canvas, { clientX: 50, clientY: 50, pointerId: 1, button: 0 });

    const textarea = await screen.findByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  });
});
