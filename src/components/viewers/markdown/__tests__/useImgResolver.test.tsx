import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, render } from "@testing-library/react";
import { useImgResolver } from "../useImgResolver";

const convertAssetUrlMock = vi.fn((p: string) => `asset://${p}`);

vi.mock("@/lib/tauri-commands", () => ({
  convertAssetUrl: (p: string) => convertAssetUrlMock(p),
}));

beforeEach(() => {
  convertAssetUrlMock.mockClear();
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
    const rendered = container.querySelector("img");
    expect(rendered?.getAttribute("src")).toBe("asset:///docs/./foo.png");
  });

  it("does not call convertAssetUrl for http(s)/data URLs", () => {
    const { result } = renderHook(() => useImgResolver("/docs/notes.md"));
    const Img = result.current.img;
    render(<Img src="https://example.com/x.png" alt="" />);
    render(<Img src="data:image/png;base64,AAA" alt="" />);
    expect(convertAssetUrlMock).not.toHaveBeenCalled();
  });

  it("passes absolute paths through to convertAssetUrl unchanged", () => {
    const { result } = renderHook(() => useImgResolver("/docs/notes.md"));
    const Img = result.current.img;
    render(<Img src="/abs/path.png" alt="" />);
    expect(convertAssetUrlMock).toHaveBeenCalledWith("/abs/path.png");
  });

  it("passes Windows drive-letter absolute paths through unchanged", () => {
    const winPath = "C:\\images\\foo.png";
    const { result } = renderHook(() => useImgResolver("C:/docs/notes.md"));
    const Img = result.current.img;
    render(<Img src={winPath} alt="" />);
    expect(convertAssetUrlMock).toHaveBeenCalledWith(winPath);
  });

  it("passes Windows backslash-rooted absolute paths through unchanged", () => {
    const winPath = "\\foo.png";
    const { result } = renderHook(() => useImgResolver("/docs/notes.md"));
    const Img = result.current.img;
    render(<Img src={winPath} alt="" />);
    expect(convertAssetUrlMock).toHaveBeenCalledWith(winPath);
  });

  it("returns src unchanged when filePath is null", () => {
    const { result } = renderHook(() => useImgResolver(null));
    const Img = result.current.img;
    const { container } = render(<Img src="./foo.png" alt="" />);
    expect(convertAssetUrlMock).not.toHaveBeenCalled();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("./foo.png");
  });
});
