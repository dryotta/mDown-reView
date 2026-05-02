import { render, screen, waitFor, act } from "@testing-library/react";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────
// Stub @excalidraw/excalidraw's heavy default export with a tiny component
// that mirrors the props we care about asserting (viewModeEnabled, theme).
vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: vi.fn((props: Record<string, unknown>) => (
    <div
      data-testid="excalidraw-stub"
      data-view-mode-enabled={String(props.viewModeEnabled)}
      data-theme={String(props.theme)}
      data-lang={String(props.langCode)}
    />
  )),
  loadFromBlob: vi.fn(async () => ({ elements: [], appState: {}, files: {} })),
}));

// CSS import is a no-op under jsdom — Vite resolves the export, but we
// avoid pulling the real stylesheet into the test bundle.
vi.mock("@excalidraw/excalidraw/index.css", () => ({}));

vi.mock("@/hooks/useTheme", () => ({ useTheme: () => "light" }));

const extractSceneMock = vi.fn();
vi.mock("@/lib/excalidraw/extractScene", () => ({
  extractScene: (...args: unknown[]) => extractSceneMock(...args),
}));

import { ExcalidrawView } from "../ExcalidrawView";

const VALID_JSON = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "test",
  elements: [{ id: "a", type: "rectangle" }],
  appState: { viewBackgroundColor: "#fff" },
  files: {},
});

beforeEach(() => {
  vi.clearAllMocks();
  extractSceneMock.mockReset();
});

describe("ExcalidrawView", () => {
  it("sets window.EXCALIDRAW_ASSET_PATH at module scope (AC9)", () => {
    expect(window.EXCALIDRAW_ASSET_PATH).toBe("/excalidraw-assets/");
  });

  it("renders Visual mode with viewModeEnabled=true", async () => {
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/a.excalidraw"
        mode="visual"
        needsExtract={false}
      />,
    );

    const stub = await screen.findByTestId("excalidraw-stub");
    expect(stub.getAttribute("data-view-mode-enabled")).toBe("true");
    const shell = screen.getByTestId("excalidraw-shell");
    expect(shell.getAttribute("data-mode")).toBe("visual");
    expect(shell.getAttribute("data-path")).toBe("/ws/a.excalidraw");
  });

  it("renders Editor mode with viewModeEnabled=false", async () => {
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/a.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );

    const stub = await screen.findByTestId("excalidraw-stub");
    expect(stub.getAttribute("data-view-mode-enabled")).toBe("false");
    const shell = screen.getByTestId("excalidraw-shell");
    expect(shell.getAttribute("data-mode")).toBe("editor");
  });

  it("loads scene via extractScene for PNG variant when needsExtract is true", async () => {
    extractSceneMock.mockResolvedValue({
      elements: [{ id: "x" }],
      appState: { foo: 1 },
      files: {},
    });

    render(
      <ExcalidrawView
        content=""
        filePath="/ws/a.excalidraw.png"
        mode="visual"
        needsExtract
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("excalidraw-stub")).toBeInTheDocument();
    });
    expect(extractSceneMock).toHaveBeenCalledWith("/ws/a.excalidraw.png");
  });

  it("renders inline error message when JSON parse fails (no console.error escape)", async () => {
    render(
      <ExcalidrawView
        content="{not json"
        filePath="/ws/bad.excalidraw"
        mode="visual"
        needsExtract={false}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Failed to load Excalidraw scene/i),
      ).toBeInTheDocument();
    });
    // Stub must not render in the error path.
    expect(screen.queryByTestId("excalidraw-stub")).not.toBeInTheDocument();
  });

  it("renders error message when extractScene rejects", async () => {
    extractSceneMock.mockRejectedValue(new Error("no scene chunk"));

    render(
      <ExcalidrawView
        content=""
        filePath="/ws/bad.excalidraw.png"
        mode="visual"
        needsExtract
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/no scene chunk/i)).toBeInTheDocument();
    });
  });

  it("does not console.error during a StrictMode double-mount", async () => {
    const errSpy = vi.spyOn(console, "error");

    await act(async () => {
      render(
        <React.StrictMode>
          <ExcalidrawView
            content={VALID_JSON}
            filePath="/ws/a.excalidraw"
            mode="visual"
            needsExtract={false}
          />
        </React.StrictMode>,
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("excalidraw-stub")).toBeInTheDocument();
    });

    expect(errSpy).not.toHaveBeenCalled();
  });
});
