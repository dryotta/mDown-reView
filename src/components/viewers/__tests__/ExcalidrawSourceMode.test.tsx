/**
 * Tests for `<ExcalidrawSourceMode/>` (issue #352 / AC2) — Source-mode
 * wrapper for `.excalidraw.png` / `.excalidraw.svg` variants. Pulls the
 * embedded scene via `extractScene` and renders pretty-printed JSON
 * through `SourceView`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const extractSceneMock = vi.fn();
vi.mock("@/lib/excalidraw/extractScene", () => ({
  extractScene: (...args: unknown[]) => extractSceneMock(...args),
}));

vi.mock("@/logger", () => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

// Stub SourceView so we can assert what content + syntax-path it received.
vi.mock("../SourceView", () => ({
  SourceView: ({ content, path }: { content: string; path: string }) => (
    <div data-testid="source-view-stub" data-path={path}>
      {content}
    </div>
  ),
}));

import { ExcalidrawSourceMode } from "../ExcalidrawSourceMode";

beforeEach(() => {
  extractSceneMock.mockReset();
});

describe("ExcalidrawSourceMode (#352 / AC2)", () => {
  it("extracts the scene and renders pretty-printed JSON via SourceView", async () => {
    extractSceneMock.mockResolvedValue({
      elements: [{ id: "rect1", type: "rectangle" }],
      appState: { theme: "light" },
      files: {},
    });
    render(
      <ExcalidrawSourceMode
        filePath="/ws/diagram.excalidraw.png"
        fileSize={1024}
        wordWrap={false}
        zoom={1}
        syntaxPath="/ws/diagram.excalidraw.png.json"
      />,
    );
    const stub = await screen.findByTestId("source-view-stub");
    // Pretty-printed (multi-line, indent 2).
    expect(stub.textContent).toContain('"type": "excalidraw"');
    expect(stub.textContent).toContain('"elements"');
    expect(stub.textContent).toContain('"rect1"');
    expect(stub.textContent).toContain("  "); // indented
    // syntaxPath was passed so the highlighter picks JSON.
    expect(stub.getAttribute("data-path")).toBe("/ws/diagram.excalidraw.png.json");
    expect(extractSceneMock).toHaveBeenCalledWith("/ws/diagram.excalidraw.png");
  });

  it("renders an inline error when extractScene rejects", async () => {
    extractSceneMock.mockRejectedValue(new Error("no scene chunk"));
    render(
      <ExcalidrawSourceMode
        filePath="/ws/bad.excalidraw.svg"
        fileSize={undefined}
        wordWrap={false}
        zoom={1}
        syntaxPath="/ws/bad.excalidraw.svg.json"
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/no scene chunk/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("source-view-stub")).not.toBeInTheDocument();
  });

  it("re-extracts when filePath changes (key isolation)", async () => {
    extractSceneMock.mockResolvedValue({
      elements: [],
      appState: {},
      files: {},
    });
    const { rerender } = render(
      <ExcalidrawSourceMode
        filePath="/ws/a.excalidraw.png"
        fileSize={undefined}
        wordWrap={false}
        zoom={1}
        syntaxPath="/ws/a.excalidraw.png.json"
      />,
    );
    await screen.findByTestId("source-view-stub");
    expect(extractSceneMock).toHaveBeenCalledTimes(1);
    extractSceneMock.mockClear();
    rerender(
      <ExcalidrawSourceMode
        filePath="/ws/b.excalidraw.svg"
        fileSize={undefined}
        wordWrap={false}
        zoom={1}
        syntaxPath="/ws/b.excalidraw.svg.json"
      />,
    );
    await waitFor(() => {
      expect(extractSceneMock).toHaveBeenCalledWith("/ws/b.excalidraw.svg");
    });
  });
});
