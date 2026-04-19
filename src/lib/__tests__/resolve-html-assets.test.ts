import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveLocalAssets } from "@/lib/resolve-html-assets";

vi.mock("@/lib/tauri-commands", () => ({
  readBinaryFile: vi.fn(),
  readTextFile: vi.fn(),
}));

import { readBinaryFile, readTextFile } from "@/lib/tauri-commands";

describe("resolveLocalAssets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readBinaryFile).mockResolvedValue("AAAA");
    vi.mocked(readTextFile).mockResolvedValue("body { color: red; }");
  });

  it("replaces relative img src with data URL", async () => {
    const html = '<img src="photo.png">';
    const result = await resolveLocalAssets(html, "/docs/page.html");
    expect(result).toContain("data:image/png;base64,AAAA");
    expect(result).not.toContain("photo.png");
  });

  it("resolves paths relative to HTML file directory", async () => {
    const html = '<img src="./images/cat.jpg">';
    await resolveLocalAssets(html, "/docs/page.html");
    expect(readBinaryFile).toHaveBeenCalledWith("/docs/images/cat.jpg");
  });

  it("leaves http URLs untouched", async () => {
    const html = '<img src="https://example.com/img.png">';
    const result = await resolveLocalAssets(html, "/docs/page.html");
    expect(result).toBe(html);
    expect(readBinaryFile).not.toHaveBeenCalled();
  });

  it("leaves data URLs untouched", async () => {
    const html = '<img src="data:image/png;base64,AAAA">';
    const result = await resolveLocalAssets(html, "/docs/page.html");
    expect(result).toBe(html);
  });

  it("handles multiple images", async () => {
    const html = '<img src="a.png"><img src="b.jpg">';
    const result = await resolveLocalAssets(html, "/docs/page.html");
    expect(result).toContain("data:image/png;base64,AAAA");
    expect(result).toContain("data:image/jpeg;base64,AAAA");
  });

  it("handles failed loads gracefully", async () => {
    vi.mocked(readBinaryFile).mockRejectedValue(new Error("not found"));
    const html = '<img src="missing.png">';
    const result = await resolveLocalAssets(html, "/docs/page.html");
    expect(result).toContain("missing.png");
  });

  it("inlines local stylesheet link as style tag", async () => {
    const html = '<link rel="stylesheet" href="styles.css">';
    const result = await resolveLocalAssets(html, "/docs/page.html");
    expect(result).toContain("<style>body { color: red; }</style>");
    expect(result).not.toContain("styles.css");
    expect(readTextFile).toHaveBeenCalledWith("/docs/styles.css");
  });

  it("inlines stylesheet with href before rel", async () => {
    const html = '<link href="theme.css" rel="stylesheet">';
    const result = await resolveLocalAssets(html, "/docs/page.html");
    expect(result).toContain("<style>body { color: red; }</style>");
  });

  it("leaves remote stylesheet untouched", async () => {
    const html = '<link rel="stylesheet" href="https://cdn.example.com/style.css">';
    const result = await resolveLocalAssets(html, "/docs/page.html");
    expect(result).toBe(html);
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it("handles both images and stylesheets together", async () => {
    const html = '<link rel="stylesheet" href="style.css"><img src="photo.png">';
    const result = await resolveLocalAssets(html, "/docs/page.html");
    expect(result).toContain("<style>body { color: red; }</style>");
    expect(result).toContain("data:image/png;base64,AAAA");
  });
});
