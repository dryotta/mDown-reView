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
  // Iter-18: keep ONE shared updateScene spy across all <Excalidraw>
  // re-renders so tests can assert call counts even when the
  // component re-renders (which happens on every zoom state change).
  const sharedUpdateSceneSpy = vi.fn((_data: unknown) => {});
  (
    globalThis as unknown as {
      __EXCALIDRAW_TEST_LAST_API__?: { updateScene: ReturnType<typeof vi.fn> };
    }
  ).__EXCALIDRAW_TEST_LAST_API__ = { updateScene: sharedUpdateSceneSpy };
  return {
    Excalidraw: vi.fn((props: Record<string, unknown>) => {
      const ui = props.UIOptions as
        | { canvasActions?: Record<string, unknown> }
        | undefined;
      const canvasActions = (ui?.canvasActions ?? {}) as Record<string, unknown>;
      // Mirror real Excalidraw's contract: `excalidrawAPI` callback
      // fires ONCE per mount inside an internal effect (post-commit),
      // not on every render. Using `useEffect` with empty deps so
      // tests reflect the same mount-only cardinality real users see
      // (bug-expert iter-18 LOW finding).
      const apiCallback = props.excalidrawAPI as
        | ((api: { updateScene: (data: unknown) => void }) => void)
        | undefined;
      React.useEffect(() => {
        apiCallback?.({ updateScene: sharedUpdateSceneSpy });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return (
        <div
          data-testid="excalidraw-stub"
          data-view-mode-enabled={String(props.viewModeEnabled)}
          data-theme={String(props.theme)}
          data-lang={String(props.langCode)}
          data-has-onchange={typeof props.onChange === "function" ? "true" : "false"}
          data-uioptions-loadscene={String(canvasActions.loadScene)}
          data-uioptions-saveasimage={String(canvasActions.saveAsImage)}
          data-uioptions-savetoactivefile={String(canvasActions.saveToActiveFile)}
          data-uioptions-export={String(canvasActions.export)}
          data-uioptions-toggletheme={String(canvasActions.toggleTheme)}
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

  it("AC4 — built-in Excalidraw Open / Save / Export / loadScene actions are hidden via UIOptions", async () => {
    // Issue #352 AC4 + iter-12 test-expert blocker T1. The four
    // canvasActions toggles MUST all be `false` so the Excalidraw
    // built-in chrome doesn't expose its own Save/Export/Load picker
    // UI — the workspace-write IPC is the sole save chokepoint and
    // the user-visible save action is autosave + Cmd+S.
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/a.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    const stub = await screen.findByTestId("excalidraw-stub");
    expect(stub.getAttribute("data-uioptions-loadscene")).toBe("false");
    expect(stub.getAttribute("data-uioptions-saveasimage")).toBe("false");
    expect(stub.getAttribute("data-uioptions-savetoactivefile")).toBe("false");
    expect(stub.getAttribute("data-uioptions-export")).toBe("false");
    expect(stub.getAttribute("data-uioptions-toggletheme")).toBe("false");
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
      // Bootstrap baseline (iter-11) — first onChange captures the
      // post-mount stable hash, doesn't schedule a save.
      await act(async () => {
        onChange([{ id: "rect-baseline" }], {}, {});
      });
      // Fire 5 onChanges over 1.5s — all within one debounce window.
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          onChange([{ id: `rect-${i}` }], {}, {});
        });
        // T7 (intra-burst oracle): the debounce-RESET semantic means
        // no save fires while the user is bursting. Asserting
        // `not.toHaveBeenCalled` after EACH onChange + 300ms advance
        // pins down the reset behaviour — a bug that fired one save
        // per onChange would be caught here, not just by the final
        // count.
        expect(saveSceneMock).not.toHaveBeenCalled();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(300);
        });
        expect(saveSceneMock).not.toHaveBeenCalled();
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

  // T4 — dynamic externalChangePending race. The flag flips false→true
  // DURING the 2s debounce window (e.g. a watcher event arrives mid-edit).
  // When the timer fires, runAutoSave reads the LATEST value via the ref
  // and bails. Without the iter-11 ref-mirror, the timer would have
  // captured `externalChangePending=false` from the closure and saved
  // anyway, clobbering the external change.
  it("Auto-save bailing on mid-debounce externalChangePending flip", async () => {
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/auto-race.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    const onChange = captureOnChange();

    vi.useFakeTimers();
    try {
      // Bootstrap + real edit — schedules the 2s debounce.
      await act(async () => {
        onChange([{ id: "rect-baseline" }], {}, {});
      });
      await act(async () => {
        onChange([{ id: "rect-1" }], {}, {});
      });
      // Mid-debounce, watcher fires → externalChangePending flips true.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      await act(async () => {
        useStore.setState({
          externalChangePendingByTab: { "/ws/auto-race.excalidraw": true },
        });
      });
      // Finish the debounce. Timer fires, but performSave reads the
      // LATEST flag via the ref and returns without saving.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(saveSceneMock).not.toHaveBeenCalled();
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
    // Iter-12: workspace-write IPC now returns a typed
    // `WorkspaceWriteError`. The mock rejects with the typed shape so
    // `friendlySaveError` exercises the `kind` discriminator path.
    saveSceneMock.mockRejectedValueOnce({
      kind: "payload-too-large",
      observed_bytes: 12345678,
    });
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

  // T5 — Reload button cancels any pending auto-save timer. Without
  // this, a save scheduled before Reload would fire AFTER the reload
  // and clobber the freshly-loaded scene (rubber-duck #15).
  it("Reload button cancels the pending auto-save timer (no clobber after reload)", async () => {
    useStore.setState({
      externalChangePendingByTab: { "/ws/auto-i.excalidraw": true },
    });
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/auto-i.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    const onChange = captureOnChange();

    vi.useFakeTimers();
    try {
      // Bootstrap + edit, externalChangePending=true so save is paused
      // even if timer fires; queue the timer anyway so we can verify
      // it's cancelled.
      await act(async () => {
        onChange([{ id: "rect-baseline" }], {}, {});
      });
      // Briefly clear pending so onChange schedules a timer, then put
      // it back so the timer would clobber the external change if it
      // fired post-Reload.
      await act(async () => {
        useStore.setState({
          externalChangePendingByTab: { "/ws/auto-i.excalidraw": false },
        });
      });
      await act(async () => {
        onChange([{ id: "rect-1" }], {}, {});
      });
      // Advance partway through the 2s debounce.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      // Restore pending so the conflict banner is up.
      await act(async () => {
        useStore.setState({
          externalChangePendingByTab: { "/ws/auto-i.excalidraw": true },
        });
      });
    } finally {
      vi.useRealTimers();
    }
    // Click Reload — should cancel the pending timer.
    await act(async () => {
      screen.getByRole("button", { name: "Reload" }).click();
    });
    // Now advance past the full debounce; if Reload cancelled the
    // timer, no save fires.
    vi.useFakeTimers();
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
    } finally {
      vi.useRealTimers();
    }
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(saveSceneMock).not.toHaveBeenCalled();
  });

  // Iter-14 regression: bug-expert HIGH + react-tauri-expert HIGH.
  // After 3 consecutive failures the hook calls
  // setAutoSavePaused(true). Pre-iter-14 `performSave` read
  // `autoSavePaused` directly from the React-state closure: when the
  // user clicked Retry, the click handler ran in a render where
  // `autoSavePaused === true`, so the freshly-called
  // `performSave(false)` hit the pause check and bailed. No IPC fired.
  // Banner cleared (state did update) but the dirty edit sat unsaved.
  // The fix mirrors `autoSavePaused` into a ref that
  // `retryAfterFailure` clears synchronously before invoking
  // `performSave`, so the pause check passes.
  it("Retry after autosave-paused (3 consecutive failures) DOES fire a save (iter-14)", async () => {
    saveSceneMock.mockRejectedValue({
      kind: "io",
      message: "ENOSPC",
    });
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/iter14-pause.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    const onChange = captureOnChange();

    // Drive 3 separate edits, each through its own debounce → 3
    // failed save attempts → autoSavePaused = true.
    vi.useFakeTimers();
    try {
      // Bootstrap baseline (no save).
      await act(async () => {
        onChange([{ id: "rect-baseline" }], {}, {});
      });
      for (let i = 1; i <= 3; i++) {
        await act(async () => {
          onChange(
            [{ id: `rect-${i}`, type: "rectangle", x: i, y: i }],
            {},
            {},
          );
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2001);
        });
        // Drain the rejection chain back to user-state.
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        });
      }
    } finally {
      vi.useRealTimers();
    }

    expect(saveSceneMock).toHaveBeenCalledTimes(3);
    // Banner should now read "Auto-save paused…" with a Resume button.
    await waitFor(() => {
      const banner = screen.getByTestId("excalidraw-save-error-banner");
      expect(banner).toBeInTheDocument();
      expect(banner.textContent).toMatch(/paused/i);
    });
    expect(
      screen.getByTestId("excalidraw-save-error-retry").textContent,
    ).toMatch(/Resume/i);

    // The headline iter-14 fix: clicking Resume immediately fires a
    // save IPC. (Pre-iter-14 this click was a no-op.)
    saveSceneMock.mockResolvedValueOnce(undefined);
    await act(async () => {
      screen.getByTestId("excalidraw-save-error-retry").click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(saveSceneMock).toHaveBeenCalledTimes(4);
  });

  // Iter-14 regression: bug-expert MEDIUM. notifyChange used to
  // unconditionally `setExcalidrawDirty(true)` on every onChange,
  // including viewport pan / tool-select that produce no
  // persistent-content drift. During the 2 s debounce window, an
  // external write would raise the conflict banner even though the
  // live scene matched disk byte-for-byte. The fix hash-compares
  // BEFORE latching dirty=true and clears any stale flag when the
  // hash matches the baseline.
  it("onChange whose stable hash matches baseline does NOT mark tab dirty (iter-14)", async () => {
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/iter14-pan.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    const onChange = captureOnChange();

    // First onChange establishes the baseline.
    await act(async () => {
      onChange([{ id: "stable-rect", type: "rectangle" }], {}, {});
    });
    // No edit yet — dirty must be false (or unset).
    expect(
      useStore.getState().excalidrawDirtyByTab["/ws/iter14-pan.excalidraw"],
    ).toBeFalsy();

    // Same elements re-fired (mimics viewport pan / tool select —
    // Excalidraw onChange fires but persistent content unchanged).
    await act(async () => {
      onChange([{ id: "stable-rect", type: "rectangle" }], {}, {});
    });
    // Dirty must STILL be false. Without the iter-14 fix this would
    // be true and an external write within the next 2 s would raise
    // a spurious conflict banner.
    expect(
      useStore.getState().excalidrawDirtyByTab["/ws/iter14-pan.excalidraw"],
    ).toBeFalsy();
    // No save fires either (no debounce was scheduled).
    expect(saveSceneMock).not.toHaveBeenCalled();
  });
});

// Iter-18 — toolbar zoom must drive Excalidraw's internal zoom.
//
// Pre-iter-18 the viewer-toolbar zoom buttons updated a Zustand store
// (`zoomByFiletype[".excalidraw"]`) but the value was never plumbed
// into the Excalidraw canvas. Users saw the toolbar +/- buttons as
// no-ops while the canvas had its own (now hidden) +/- widget. The
// fix: ExcalidrawView subscribes to the zoom value and pushes it
// into the canvas via `excalidrawAPI.updateScene({ appState: { zoom:
// { value }}})` whenever the value changes (and on initial mount).
describe("ExcalidrawView — toolbar zoom wiring (#352 iter-18)", () => {
  function lastApi(): { updateScene: ReturnType<typeof vi.fn> } | undefined {
    return (globalThis as unknown as {
      __EXCALIDRAW_TEST_LAST_API__?: { updateScene: ReturnType<typeof vi.fn> };
    }).__EXCALIDRAW_TEST_LAST_API__;
  }

  it("pushes zoomByFiletype changes into the canvas via excalidrawAPI.updateScene", async () => {
    // Reset zoom to the default so the test is hermetic.
    useStore.setState({ zoomByFiletype: { ".excalidraw": 1.0 } });
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/iter18-zoom.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    const api = lastApi();
    expect(api).toBeDefined();
    // Initial-mount push: Excalidraw is at 1.0, the toolbar is at 1.0
    // — the wiring should still call updateScene at least once with
    // the canonical zoom payload so a remount lands on the right
    // value. (Allow zero or one initial calls; the assertion below
    // is on the post-bump count.)
    const initialCallCount = api!.updateScene.mock.calls.length;

    // Bump zoom in — store now has 1.1 (default step).
    await act(async () => {
      useStore.getState().bumpZoom(".excalidraw", "in");
    });
    // The effect should have pushed the new zoom into the canvas.
    await waitFor(() => {
      expect(api!.updateScene.mock.calls.length).toBeGreaterThan(initialCallCount);
    });
    const lastCall = api!.updateScene.mock.calls[
      api!.updateScene.mock.calls.length - 1
    ][0] as { appState?: { zoom?: { value?: number } } };
    expect(lastCall?.appState?.zoom?.value).toBeGreaterThan(1.0);

    // Bump zoom out — value decreases.
    const beforeOut = useStore.getState().zoomByFiletype[".excalidraw"] ?? 1.0;
    await act(async () => {
      useStore.getState().bumpZoom(".excalidraw", "out");
    });
    await waitFor(() => {
      const calls = api!.updateScene.mock.calls;
      const last = calls[calls.length - 1][0] as { appState?: { zoom?: { value?: number } } };
      expect(last?.appState?.zoom?.value).toBeLessThan(beforeOut);
    });

    // Reset returns to 1.0.
    await act(async () => {
      useStore.getState().bumpZoom(".excalidraw", "reset");
    });
    await waitFor(() => {
      const calls = api!.updateScene.mock.calls;
      const last = calls[calls.length - 1][0] as { appState?: { zoom?: { value?: number } } };
      expect(last?.appState?.zoom?.value).toBe(1.0);
    });
  });

  it("Visual-mode ExcalidrawView ALSO honours toolbar zoom (no save side effect)", async () => {
    useStore.setState({ zoomByFiletype: { ".excalidraw": 1.0 } });
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/iter18-zoom-visual.excalidraw"
        mode="visual"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    const api = lastApi();
    expect(api).toBeDefined();
    const before = api!.updateScene.mock.calls.length;
    await act(async () => {
      useStore.getState().bumpZoom(".excalidraw", "in");
    });
    await waitFor(() => {
      expect(api!.updateScene.mock.calls.length).toBeGreaterThan(before);
    });
    // Saving must not have been triggered by zoom alone.
    expect(saveSceneMock).not.toHaveBeenCalled();
  });
});
