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
      // Expose the onChange so tests can drive scene mutations directly.
      data-has-onchange={typeof props.onChange === "function" ? "true" : "false"}
      onClick={() => {
        const onChange = props.onChange as
          | ((els: unknown, app: unknown, files: unknown) => void)
          | undefined;
        onChange?.([{ id: "edit" }], { theme: "light" }, {});
      }}
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

const saveSceneMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/excalidraw/saveScene", () => ({
  saveExcalidrawFile: (...args: unknown[]) => saveSceneMock(...args),
}));

import { ExcalidrawView } from "../ExcalidrawView";
import { useStore } from "@/store";

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
  saveSceneMock.mockReset();
  saveSceneMock.mockResolvedValue(undefined);
  useStore.setState({
    excalidrawDirtyByTab: {},
    externalChangePendingByTab: {},
  });
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

// Issue #352 / AC5 + AC6 + AC7 — save flow, dirty tracking, and
// conflict banner. Drive the stub's exposed onClick (which calls the
// captured `onChange` with a fake edit) to simulate a user mutation.
describe("ExcalidrawView — save / dirty / conflict (#352)", () => {
  it("Editor onChange (after initial mount) marks the tab dirty", async () => {
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/a.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    const stub = await screen.findByTestId("excalidraw-stub");
    // First click → counted as initial mount; second click → user edit.
    await act(async () => {
      stub.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      stub.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useStore.getState().excalidrawDirtyByTab["/ws/a.excalidraw"]).toBe(true);
  });

  it("Visual mode onChange does NOT mark the tab dirty", async () => {
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/a.excalidraw"
        mode="visual"
        needsExtract={false}
      />,
    );
    const stub = await screen.findByTestId("excalidraw-stub");
    await act(async () => {
      stub.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      stub.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useStore.getState().excalidrawDirtyByTab["/ws/a.excalidraw"]).toBeUndefined();
  });

  it("save-request DOM event in Editor mode invokes saveExcalidrawFile and clears dirty", async () => {
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/a.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    const stub = await screen.findByTestId("excalidraw-stub");
    // Drive a user edit so the saver has live data.
    await act(async () => {
      stub.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      stub.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useStore.getState().excalidrawDirtyByTab["/ws/a.excalidraw"]).toBe(true);

    // Dispatch the save-request event for THIS path.
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("mdownreview:excalidraw-save-request", {
          detail: { path: "/ws/a.excalidraw" },
        }),
      );
      // Allow the .then microtask to run.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveSceneMock).toHaveBeenCalledTimes(1);
    expect(saveSceneMock.mock.calls[0][0]).toBe("/ws/a.excalidraw");
    // Dirty cleared on success.
    expect(useStore.getState().excalidrawDirtyByTab["/ws/a.excalidraw"]).toBeUndefined();
  });

  it("save-request event for a DIFFERENT path is ignored", async () => {
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/a.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("mdownreview:excalidraw-save-request", {
          detail: { path: "/ws/somewhere-else.excalidraw" },
        }),
      );
      await Promise.resolve();
    });

    expect(saveSceneMock).not.toHaveBeenCalled();
  });

  it("save-request event in Visual mode is a no-op (saver not called)", async () => {
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/a.excalidraw"
        mode="visual"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("mdownreview:excalidraw-save-request", {
          detail: { path: "/ws/a.excalidraw" },
        }),
      );
      await Promise.resolve();
    });
    expect(saveSceneMock).not.toHaveBeenCalled();
  });

  it("renders the conflict banner when externalChangePending is true (Editor only)", async () => {
    useStore.setState({
      externalChangePendingByTab: { "/ws/a.excalidraw": true },
    });
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/a.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    expect(screen.getByTestId("excalidraw-conflict-banner")).toBeInTheDocument();
    expect(screen.getByText("File changed on disk")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Keep editing — your save will overwrite",
      }),
    ).toBeInTheDocument();
  });

  it("does NOT render the conflict banner in Visual mode", async () => {
    useStore.setState({
      externalChangePendingByTab: { "/ws/a.excalidraw": true },
    });
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/a.excalidraw"
        mode="visual"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    expect(screen.queryByTestId("excalidraw-conflict-banner")).not.toBeInTheDocument();
  });

  it("Reload button clears dirty + pending and dispatches a fresh file-changed event", async () => {
    useStore.setState({
      excalidrawDirtyByTab: { "/ws/a.excalidraw": true },
      externalChangePendingByTab: { "/ws/a.excalidraw": true },
    });
    const fileChangedSpy = vi.fn();
    window.addEventListener("mdownreview:file-changed", fileChangedSpy);

    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/a.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    const reload = screen.getByRole("button", { name: "Reload" });
    await act(async () => {
      reload.click();
    });

    expect(useStore.getState().excalidrawDirtyByTab["/ws/a.excalidraw"]).toBeUndefined();
    expect(
      useStore.getState().externalChangePendingByTab["/ws/a.excalidraw"],
    ).toBeUndefined();
    expect(fileChangedSpy).toHaveBeenCalled();
    const detail = (fileChangedSpy.mock.calls[0][0] as CustomEvent).detail;
    expect(detail).toEqual({ path: "/ws/a.excalidraw", kind: "content" });

    window.removeEventListener("mdownreview:file-changed", fileChangedSpy);
  });

  it("Keep editing button clears pending only; dirty remains true", async () => {
    useStore.setState({
      excalidrawDirtyByTab: { "/ws/a.excalidraw": true },
      externalChangePendingByTab: { "/ws/a.excalidraw": true },
    });

    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/a.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    const keep = screen.getByRole("button", {
      name: "Keep editing — your save will overwrite",
    });
    await act(async () => {
      keep.click();
    });

    expect(useStore.getState().excalidrawDirtyByTab["/ws/a.excalidraw"]).toBe(true);
    expect(
      useStore.getState().externalChangePendingByTab["/ws/a.excalidraw"],
    ).toBeUndefined();
  });

  // Issue #352 / iter-3 product-expert + rubber-duck BLOCK — save
  // failure MUST NOT unmount the canvas. A transient IPC failure
  // (locked file, AV scan, OneDrive sync, disk full, payload > 10 MB)
  // should leave the user's unsaved scene intact, with a non-modal
  // banner above the canvas.
  it("save IPC rejection surfaces a save-error banner, leaves dirty=true, and KEEPS the canvas mounted", async () => {
    saveSceneMock.mockRejectedValueOnce(
      new Error("decoded payload exceeds 10485760-byte cap: 12345678 bytes"),
    );
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/a.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    const stub = await screen.findByTestId("excalidraw-stub");
    await act(async () => {
      stub.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      stub.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useStore.getState().excalidrawDirtyByTab["/ws/a.excalidraw"]).toBe(true);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("mdownreview:excalidraw-save-request", {
          detail: { path: "/ws/a.excalidraw" },
        }),
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("excalidraw-save-error-banner")).toBeInTheDocument();
    });
    // Canvas STILL mounted — the user's scene isn't lost.
    expect(screen.getByTestId("excalidraw-stub")).toBeInTheDocument();
    expect(screen.getByText(/Save failed:/i)).toBeInTheDocument();
    // Dirty stays true so the Save button stays "live" for retry.
    expect(useStore.getState().excalidrawDirtyByTab["/ws/a.excalidraw"]).toBe(true);

    // Dismiss button hides the banner.
    await act(async () => {
      screen.getByRole("button", { name: "Dismiss" }).click();
    });
    await waitFor(() => {
      expect(screen.queryByTestId("excalidraw-save-error-banner")).not.toBeInTheDocument();
    });
  });

  // Issue #352 / iter-3 bug-expert MEDIUM — concurrent save guard. A
  // second save-request fired while the first IPC is in flight must
  // be coalesced (not race the first), preventing stale-bytes
  // overwrites.
  it("coalesces a second save-request while the first is still in flight", async () => {
    let resolveFirst!: () => void;
    const firstPromise = new Promise<void>((r) => {
      resolveFirst = r;
    });
    saveSceneMock
      .mockImplementationOnce(() => firstPromise)
      .mockResolvedValue(undefined);

    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/a.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    const stub = await screen.findByTestId("excalidraw-stub");
    await act(async () => {
      stub.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      stub.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("mdownreview:excalidraw-save-request", {
          detail: { path: "/ws/a.excalidraw" },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("mdownreview:excalidraw-save-request", {
          detail: { path: "/ws/a.excalidraw" },
        }),
      );
    });

    // Only ONE save attempt — second was coalesced.
    expect(saveSceneMock).toHaveBeenCalledTimes(1);

    // Resolve the first; another dispatch should now succeed.
    await act(async () => {
      resolveFirst();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("mdownreview:excalidraw-save-request", {
          detail: { path: "/ws/a.excalidraw" },
        }),
      );
    });
    expect(saveSceneMock).toHaveBeenCalledTimes(2);
  });

  // Issue #352 / iter-5 BLOCKER (product B1 + bug P0 + rubber-duck #1)
  // — the iter-3 unmount cleanup that cleared dirty + pending on every
  // unmount was REMOVED. It caused silent data loss because the live
  // scene state lives only in the mounted Excalidraw component; unmount
  // (tab switch) wipes the warning signal so the user has no idea their
  // unsaved work is gone. iter-5 replaces it with `setActiveTab` and
  // `setViewMode` GUARDS in the tabs slice (`Discard changes?` prompt
  // before the unmount) — this test enforces that the unmount is
  // NON-DESTRUCTIVE: dirty + pending FLAGS persist past unmount so
  // anyone holding a reference to the path can still surface the
  // warning. The guard system in the tabs slice is what gates the
  // user-visible decision; this hook just doesn't fight it.
  it("does NOT clear dirty + pending on unmount (iter-5 BLOCKER fix)", async () => {
    useStore.setState({
      excalidrawDirtyByTab: { "/ws/a.excalidraw": true },
      externalChangePendingByTab: { "/ws/a.excalidraw": true },
    });
    const { unmount } = render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/a.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    unmount();
    // Flags PRESERVED — see file-header rationale.
    expect(useStore.getState().excalidrawDirtyByTab["/ws/a.excalidraw"]).toBe(true);
    expect(
      useStore.getState().externalChangePendingByTab["/ws/a.excalidraw"],
    ).toBe(true);
  });
});
