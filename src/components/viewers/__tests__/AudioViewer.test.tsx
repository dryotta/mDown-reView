import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { AudioViewer, getAudioMime } from "../AudioViewer";

vi.mock("@/lib/tauri-commands", () => ({
  convertAssetUrl: vi.fn((p: string) => `asset://localhost/${encodeURIComponent(p)}`),
}));

import { convertAssetUrl } from "@/lib/tauri-commands";

describe("AudioViewer", () => {
  beforeEach(() => {
    vi.mocked(convertAssetUrl).mockClear();
    vi.mocked(convertAssetUrl).mockImplementation(
      (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
    );
  });

  it("renders <audio> element with controls and asset:// src", () => {
    const { container } = render(<AudioViewer path="/music/song.mp3" />);
    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio!.hasAttribute("controls")).toBe(true);
    const src = audio!.getAttribute("src") ?? "";
    expect(src.length).toBeGreaterThan(0);
    expect(src).toContain("asset://");
    expect(convertAssetUrl).toHaveBeenCalledWith("/music/song.mp3");
  });

  it("uses preload='metadata' so the browser doesn't fetch full audio up front", () => {
    const { container } = render(<AudioViewer path="/music/song.mp3" />);
    const audio = container.querySelector("audio")!;
    expect(audio.getAttribute("preload")).toBe("metadata");
  });

  // L4 — filename + MIME no longer rendered inside AudioViewer; they are
  // surfaced by the FileActionsBar (mime hint) and the active tab (filename).
  it("does not render its own filename/MIME header (L4)", () => {
    const { container } = render(<AudioViewer path="/music/song.mp3" />);
    expect(container.querySelector(".audio-viewer-header")).toBeNull();
  });
});

describe("getAudioMime (L2)", () => {
  it("returns the canonical MIME for known extensions", () => {
    expect(getAudioMime("/m/song.mp3")).toBe("audio/mpeg");
    expect(getAudioMime("/m/song.wav")).toBe("audio/wav");
  });

  it("falls back to audio/* for unknown extensions", () => {
    expect(getAudioMime("/m/song.xyz")).toBe("audio/*");
  });
});
