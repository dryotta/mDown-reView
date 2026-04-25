import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { VideoViewer, getVideoMime } from "../VideoViewer";

vi.mock("@/lib/tauri-commands", () => ({
  convertAssetUrl: vi.fn((p: string) => `asset://localhost/${encodeURIComponent(p)}`),
}));

import { convertAssetUrl } from "@/lib/tauri-commands";

describe("VideoViewer", () => {
  beforeEach(() => {
    vi.mocked(convertAssetUrl).mockClear();
    vi.mocked(convertAssetUrl).mockImplementation(
      (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
    );
  });

  it("renders <video> element with controls and asset:// src", () => {
    const { container } = render(<VideoViewer path="/movies/clip.mp4" />);
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video!.hasAttribute("controls")).toBe(true);
    const src = video!.getAttribute("src") ?? "";
    expect(src.length).toBeGreaterThan(0);
    expect(src).toContain("asset://");
    expect(convertAssetUrl).toHaveBeenCalledWith("/movies/clip.mp4");
  });

  it("uses preload='metadata'", () => {
    const { container } = render(<VideoViewer path="/movies/clip.mp4" />);
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video.getAttribute("preload")).toBe("metadata");
  });

  // L4 — filename + MIME no longer rendered inside VideoViewer; they are
  // surfaced by the FileActionsBar (mime hint) and the active tab (filename).
  it("does not render its own filename/MIME header (L4)", () => {
    const { container } = render(<VideoViewer path="/movies/clip.mp4" />);
    expect(container.querySelector(".video-viewer-header")).toBeNull();
  });
});

describe("getVideoMime (L2)", () => {
  it("returns the canonical MIME for known extensions", () => {
    expect(getVideoMime("/m/clip.mp4")).toBe("video/mp4");
    expect(getVideoMime("/m/clip.webm")).toBe("video/webm");
  });

  it("falls back to video/* for unknown extensions", () => {
    expect(getVideoMime("/m/clip.xyz")).toBe("video/*");
  });
});
