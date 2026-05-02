import { render, screen, waitFor, act } from "@testing-library/react";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────
// Stub `@excalidraw/excalidraw`'s heavy default export with a tiny
// component that mirrors the props we care about asserting
// (viewModeEnabled, theme). The stub also exposes `onChange` so
// tests drive scene mutations: each click on the stub increments a
// counter and fires onChange with a UNIQUE element id, so the
// content-hash comparison (iter-7) sees actual content drift.
vi.mock("@excalidraw/excalidraw", () => {
  let editCounter = 0;
  return {
    Excalidraw: vi.fn((props: Record<string, unknown>) => {
      return (
        <div
          data-testid="excalidraw-stub"
          data-view-mode-enabled={String(props.viewModeEnabled)}
          data-theme={String(props.theme)}
          data-lang={String(props.langCode)}
          data-has-onchange={typeof props.onChange === "function" ? "true" : "false"}
          onClick={() => {
            const onChange = props.onChange as
              | ((els: unknown, app: unknown, files: unknown) => void)
              | undefined;
            editCounter += 1;
            onChange?.(
              [{ id: `edit-${editCounter}`, version: editCounter }],
              { theme: "light" },
              {},
            );
          }}
        />
      );
    }),
    loadFromBlob: vi.fn(async () => ({ elements: [], appState: {}, files: {} })),
    // Iter-7: deterministic stub hashes that reflect element identity.
    hashElementsVersion: vi.fn((els: unknown[]) =>
      els.length === 0
        ? "empty"
        : els.map((e) => (e as { id?: string }).id ?? "x").join(","),
    ),
    getLibraryItemsHash: vi.fn((items: unknown[]) =>
      items.length === 0
        ? "empty-lib"
        : items.map((it) => JSON.stringify(it)).join("|"),
    ),
  };
});

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
import * as ExcalidrawModule from "@excalidraw/excalidraw";

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

// Issue #352 / iter-10 redesign — auto-save flow.
//
// The Save button + manual Ctrl+S + dirty-tracking close-confirms have
// all been removed. Excalidraw onChange schedules a debounced save
// (default 2000ms) which fires once the user pauses editing. Tests
// that need to drive the debounce use vi.useFakeTimers() locally; the
// rest run on real timers so React Testing Library's findByTestId
// (which uses real-timer polling) doesn't deadlock.
describe("ExcalidrawView — auto-save (#352 iter-10)", () => {
  // Helper: capture the most recently passed onChange from the
  // Excalidraw stub. Walk to the last call's prop set.
  function captureOnChange(): (els: unknown, app: unknown, files: unknown) => void {
    const mod = ExcalidrawModule as unknown as {
      Excalidraw: ReturnType<typeof vi.fn>;
    };
    const calls = mod.Excalidraw.mock.calls;
    const lastCall = calls[calls.length - 1];
    return lastCall?.[0].onChange as (
      els: unknown,
      app: unknown,
      files: unknown,
    ) => void;
  }

  it("Editor mode: onChange + debounce window elapsed -> saveExcalidrawFile fires", async () => {
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/auto-a.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    const onChange = captureOnChange();
    expect(typeof onChange).toBe("function");

    // Switch to fake timers AFTER mount so findByTestId can poll on
    // real timers above. Then advance past the 2s debounce.
    vi.useFakeTimers();
    try {
      await act(async () => {
        // First onChange — bootstraps baseline (iter-11). No save scheduled.
        onChange([{ id: "rect-baseline" }], {}, {});
      });
      await act(async () => {
        // Real edit — different elements → save scheduled.
        onChange([{ id: "rect-1", type: "rectangle", x: 0, y: 0 }], {}, {});
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2001);
      });
    } finally {
      vi.useRealTimers();
    }
    // Microtask drain on real timers so the .then() lands.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveSceneMock).toHaveBeenCalledTimes(1);
    expect(saveSceneMock.mock.calls[0][0]).toBe("/ws/auto-a.excalidraw");
  });

  it("Visual mode: onChange does NOT trigger auto-save", async () => {
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/auto-b.excalidraw"
        mode="visual"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    const onChange = captureOnChange();

    vi.useFakeTimers();
    try {
      await act(async () => {
        onChange([{ id: "rect-1" }], {}, {});
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(saveSceneMock).not.toHaveBeenCalled();
  });

  it("Multiple onChanges within debounce window coalesce into ONE save", async () => {
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/auto-c.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    const onChange = captureOnChange();

    vi.useFakeTimers();
    try {
      // Fire 5 onChanges over 1.5s — all within one debounce window.
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          onChange([{ id: `rect-${i}` }], {}, {});
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(300);
        });
      }
      // Wait out the full debounce.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2001);
      });
    } finally {
      vi.useRealTimers();
    }
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Only ONE save fired — bursty edits coalesce per debounce.
    expect(saveSceneMock).toHaveBeenCalledTimes(1);
    // The save received the LAST set of elements.
    const savePayload = saveSceneMock.mock.calls[0][1] as { elements: unknown };
    expect(savePayload.elements).toEqual([{ id: "rect-4" }]);
  });

  it("Auto-save is paused while externalChangePending is true (don't clobber on-disk changes)", async () => {
    useStore.setState({
      externalChangePendingByTab: { "/ws/auto-d.excalidraw": true },
    });
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/auto-d.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    const onChange = captureOnChange();

    vi.useFakeTimers();
    try {
      await act(async () => {
        // Bootstrap baseline so divergence is detectable. Save still
        // pauses below because externalChangePending=true.
        onChange([{ id: "rect-baseline" }], {}, {});
      });
      await act(async () => {
        onChange([{ id: "rect-1" }], {}, {});
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2001);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(saveSceneMock).not.toHaveBeenCalled();
  });

  it("Save IPC rejection surfaces save-error banner; canvas stays mounted; Retry re-fires save", async () => {
    saveSceneMock.mockRejectedValueOnce(
      new Error("decoded payload exceeds 10485760-byte cap: 12345678 bytes"),
    );
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/auto-e.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    const onChange = captureOnChange();

    vi.useFakeTimers();
    try {
      await act(async () => {
        // Bootstrap baseline (iter-11).
        onChange([{ id: "rect-baseline" }], {}, {});
      });
      await act(async () => {
        // Real edit triggers the failing save.
        onChange([{ id: "rect-1" }], {}, {});
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2001);
      });
    } finally {
      vi.useRealTimers();
    }
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Banner appears, canvas survives, friendly copy.
    await waitFor(() => {
      expect(screen.getByTestId("excalidraw-save-error-banner")).toBeInTheDocument();
    });
    expect(screen.getByTestId("excalidraw-stub")).toBeInTheDocument();
    expect(screen.getByText(/Drawing too large to save/i)).toBeInTheDocument();

    // Retry — clears banner and immediately re-fires the save.
    saveSceneMock.mockResolvedValueOnce(undefined);
    await act(async () => {
      screen.getByTestId("excalidraw-save-error-retry").click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(saveSceneMock).toHaveBeenCalledTimes(2);
  });

  it("Auto-save banner renders in editor mode and dismisses on click", async () => {
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/auto-f.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    expect(screen.getByTestId("excalidraw-autosave-banner")).toBeInTheDocument();

    await act(async () => {
      screen.getByTestId("excalidraw-autosave-banner-dismiss").click();
    });
    expect(screen.queryByTestId("excalidraw-autosave-banner")).not.toBeInTheDocument();
  });

  it("Conflict banner renders in editor mode when externalChangePending is true", async () => {
    useStore.setState({
      externalChangePendingByTab: { "/ws/auto-g.excalidraw": true },
    });
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/auto-g.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    expect(screen.getByTestId("excalidraw-conflict-banner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Keep editing — your changes will overwrite the version on disk" }),
    ).toBeInTheDocument();
  });

  it("Reload button clears pending + dispatches mdownreview:file-changed", async () => {
    useStore.setState({
      externalChangePendingByTab: { "/ws/auto-h.excalidraw": true },
    });
    const fileChangedSpy = vi.fn();
    window.addEventListener("mdownreview:file-changed", fileChangedSpy);
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/auto-h.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    await act(async () => {
      screen.getByRole("button", { name: "Reload" }).click();
    });

    expect(
      useStore.getState().externalChangePendingByTab["/ws/auto-h.excalidraw"],
    ).toBeUndefined();
    expect(fileChangedSpy).toHaveBeenCalled();
    window.removeEventListener("mdownreview:file-changed", fileChangedSpy);
  });
});
