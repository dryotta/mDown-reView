import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { PdfViewer } from "../PdfViewer";

vi.mock("@tauri-apps/api/core");
vi.mock("@/lib/tauri-commands", () => ({
  convertAssetUrl: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
}));

describe("PdfViewer (#65 F3)", () => {
  it("mounts an iframe pointing at the converted asset URL", () => {
    render(<PdfViewer path="/docs/spec.pdf" />);
    const iframe = document.querySelector("iframe.pdf-viewer") as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("src")).toBe(
      `asset://localhost/${encodeURIComponent("/docs/spec.pdf")}`,
    );
  });

  it("does NOT apply a sandbox attribute (Chromium PDF renderer requires scripts)", () => {
    render(<PdfViewer path="/docs/spec.pdf" />);
    const iframe = document.querySelector("iframe.pdf-viewer") as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();
    // Chromium's built-in PDF viewer is a JS-based renderer that requires
    // script execution + same-origin access. `sandbox=""` blocks both,
    // preventing PDFs from rendering. Since PDFs are binary files loaded
    // via the local asset:// protocol (not user-authored HTML/JS), removing
    // sandbox is safe — the CSP still constrains the frame.
    expect(iframe!.hasAttribute("sandbox")).toBe(false);
  });

  it("renders fallback UI when the iframe error event fires", () => {
    render(<PdfViewer path="/docs/missing.pdf" />);
    const iframe = document.querySelector("iframe.pdf-viewer") as HTMLIFrameElement;
    act(() => {
      iframe.dispatchEvent(new Event("error"));
    });
    expect(screen.getByText(/PDF failed to load/i)).toBeInTheDocument();
    expect(screen.getByText("missing.pdf")).toBeInTheDocument();
    expect(document.querySelector("iframe.pdf-viewer")).toBeNull();
  });

  it("derives the filename from a Windows-style path", () => {
    render(<PdfViewer path="C:\\Users\\me\\report.pdf" />);
    const iframe = document.querySelector("iframe.pdf-viewer") as HTMLIFrameElement;
    act(() => {
      iframe.dispatchEvent(new Event("error"));
    });
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
  });
});
