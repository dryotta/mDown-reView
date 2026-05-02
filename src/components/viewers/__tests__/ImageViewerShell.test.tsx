import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

vi.mock("@/hooks/useFileBadges", () => ({
  useFileBadges: () => ({}),
}));

vi.mock("../ImageViewer", () => ({
  ImageViewer: ({ path, zoom, fit }: { path: string; zoom: number; fit: boolean }) => (
    <div data-testid="image-viewer" data-path={path} data-zoom={zoom} data-fit={String(fit)}>
      ImageViewer
    </div>
  ),
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

import { ImageViewerShell } from "../ImageViewerShell";
import { useStore } from "@/store";

beforeEach(() => {
  useStore.setState({ zoomByFiletype: { ".image": 1.0 } });
});

describe("ImageViewerShell", () => {
  it("renders a ViewerToolbar with zoom controls and FileActionsBar", () => {
    render(<ImageViewerShell path="/photos/test.png" />);
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /zoom in/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /zoom out/i })).toBeInTheDocument();
  });

  it("renders centerSlot when provided", () => {
    const onCof = vi.fn();
    render(
      <ImageViewerShell
        path="/photos/test.png"
        centerSlot={<button onClick={onCof}>Comment on file</button>}
      />,
    );
    const btn = screen.getByRole("button", { name: /comment on file/i });
    fireEvent.click(btn);
    expect(onCof).toHaveBeenCalledOnce();
  });

  it("passes zoom and fit=true to ImageViewer", () => {
    render(<ImageViewerShell path="/photos/test.png" />);
    const viewer = screen.getByTestId("image-viewer");
    expect(viewer.dataset.zoom).toBe("1");
    expect(viewer.dataset.fit).toBe("true");
  });
});
