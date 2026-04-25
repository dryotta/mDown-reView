import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, render, waitFor, cleanup } from "@testing-library/react";
import { useImgResolver, hasRemoteImageReferences } from "../useImgResolver";

const convertAssetUrlMock = vi.fn((p: string) => `asset://${p}`);
const fetchRemoteAssetMock = vi.fn();

vi.mock("@/lib/tauri-commands", () => ({
  convertAssetUrl: (p: string) => convertAssetUrlMock(p),
  fetchRemoteAsset: (url: string) => fetchRemoteAssetMock(url),
}));

vi.mock("@/logger", () => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

// Mutable allowance map driven per-test via setAllowance().
let allowance: Record<string, boolean> = {};
const setAllowance = (path: string, allowed: boolean) => {
  allowance = { ...allowance, [path]: allowed };
};

vi.mock("@/store", () => ({
  useStore: <T,>(selector: (s: { allowedRemoteImageDocs: Record<string, boolean> }) => T): T =>
    selector({ allowedRemoteImageDocs: allowance }),
}));

beforeEach(() => {
  convertAssetUrlMock.mockClear();
  fetchRemoteAssetMock.mockReset();
  allowance = {};
});

describe("useImgResolver", () => {
  it("returns the same img reference across renders for the same filePath", () => {
    const { result, rerender } = renderHook(({ p }) => useImgResolver(p), {
      initialProps: { p: "/docs/notes.md" },
    });
    const first = result.current.img;
    rerender({ p: "/docs/notes.md" });
    expect(result.current.img).toBe(first);
  });

  it("returns a new img reference when filePath changes", () => {
    const { result, rerender } = renderHook(({ p }) => useImgResolver(p), {
      initialProps: { p: "/docs/notes.md" },
    });
    const first = result.current.img;
    rerender({ p: "/other/place.md" });
    expect(result.current.img).not.toBe(first);
  });

  it("resolves a relative img src against the file's directory via convertAssetUrl", () => {
    const { result } = renderHook(() => useImgResolver("/docs/notes.md"));
    const Img = result.current.img;
    const { container } = render(<Img src="./foo.png" alt="f" />);
    expect(convertAssetUrlMock).toHaveBeenCalledWith("/docs/./foo.png");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("asset:///docs/./foo.png");
  });

  it("passes data: URLs through unchanged", () => {
    const { result } = renderHook(() => useImgResolver("/docs/notes.md"));
    const Img = result.current.img;
    const { container } = render(<Img src="data:image/png;base64,AAA" alt="" />);
    expect(convertAssetUrlMock).not.toHaveBeenCalled();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,AAA",
    );
  });

  it("https image is BLOCKED with placeholder when allowance is off", () => {
    const { result } = renderHook(() => useImgResolver("/docs/notes.md"));
    const Img = result.current.img;
    const { container } = render(<Img src="https://example.com/x.png" alt="" />);
    expect(container.querySelector("[data-remote-image-placeholder]")).toBeInTheDocument();
    expect(container.querySelector("[data-remote-image-placeholder]")?.getAttribute("data-reason"))
      .toBe("blocked");
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(fetchRemoteAssetMock).not.toHaveBeenCalled();
  });

  it("http:// is ALWAYS blocked (insecure scheme) regardless of allowance", () => {
    setAllowance("/docs/notes.md", true);
    const { result } = renderHook(() => useImgResolver("/docs/notes.md"));
    const Img = result.current.img;
    const { container } = render(<Img src="http://example.com/x.png" alt="" />);
    const ph = container.querySelector("[data-remote-image-placeholder]");
    expect(ph).toBeInTheDocument();
    expect(ph?.getAttribute("data-reason")).toBe("insecure");
    expect(fetchRemoteAssetMock).not.toHaveBeenCalled();
  });

  it("https image fetches blob URL and revokes it on unmount when allowance is on", async () => {
    setAllowance("/docs/notes.md", true);
    fetchRemoteAssetMock.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    });
    const createSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake-1");
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    const { result } = renderHook(() => useImgResolver("/docs/notes.md"));
    const Img = result.current.img;
    const { container, unmount } = render(<Img src="https://example.com/x.png" alt="" />);

    await waitFor(() => {
      expect(fetchRemoteAssetMock).toHaveBeenCalledWith("https://example.com/x.png");
      expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:fake-1");
    });

    unmount();
    expect(revokeSpy).toHaveBeenCalledWith("blob:fake-1");
    createSpy.mockRestore();
    revokeSpy.mockRestore();
    cleanup();
  });

  it("returns src unchanged when filePath is null and src is local-looking", () => {
    const { result } = renderHook(() => useImgResolver(null));
    const Img = result.current.img;
    const { container } = render(<Img src="./foo.png" alt="" />);
    expect(convertAssetUrlMock).not.toHaveBeenCalled();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("./foo.png");
  });
});

describe("hasRemoteImageReferences", () => {
  it("detects a markdown image with an https URL", () => {
    expect(hasRemoteImageReferences("![x](https://example.com/i.png)")).toBe(true);
  });
  it("detects a markdown image with an http URL", () => {
    expect(hasRemoteImageReferences("![x](http://example.com/i.png)")).toBe(true);
  });
  it("detects a raw <img> tag with an https src", () => {
    expect(hasRemoteImageReferences('<img src="https://example.com/x.png" />')).toBe(true);
  });
  it("detects a raw <img> tag with unquoted https src", () => {
    expect(hasRemoteImageReferences("<img src=https://example.com/x.png>")).toBe(true);
  });
  it("returns false when only local images are referenced", () => {
    expect(hasRemoteImageReferences("![x](./i.png) and ![y](/abs/i.png)")).toBe(false);
  });
  it("returns false for empty body", () => {
    expect(hasRemoteImageReferences("")).toBe(false);
  });
  it("ignores remote-image refs inside fenced code blocks", () => {
    const body = "```md\n![x](https://example.com/i.png)\n```\n";
    expect(hasRemoteImageReferences(body)).toBe(false);
  });
  it("ignores remote-image refs inside inline code", () => {
    const body = "Use `![x](https://example.com/i.png)` to embed.";
    expect(hasRemoteImageReferences(body)).toBe(false);
  });
});
