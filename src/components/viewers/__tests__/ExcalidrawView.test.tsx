import { render, screen, waitFor, act } from "@testing-library/react";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MockedFunction } from "vitest";

// Iter-22 — auto-load the project-wide IPC mock from
// `src/__mocks__/@tauri-apps/api/core.ts` so tests can override
// individual command stubs via `invokeMock.mockImplementationOnce`.
vi.mock("@tauri-apps/api/core");

import { invoke } from "@tauri-apps/api/core";
const invokeMock = invoke as MockedFunction<typeof invoke>;

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

import { ExcalidrawView, __TEST_ONLY_clearLineAnchoredDismissals } from "../ExcalidrawView";
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
  // Iter-22 — clear cross-test pollution of the per-file warning
  // dismiss-set (module-scope).
  __TEST_ONLY_clearLineAnchoredDismissals();
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

  it("First-entry banner renders in editor mode and dismisses on click", async () => {
    // Storage seen-flags persist across tests; clear so this test starts
    // from "fresh install" state regardless of prior tests.
    window.localStorage.removeItem("mdownreview:excalidraw-first-entry-seen");
    window.localStorage.removeItem(
      "mdownreview:excalidraw-autosave-banner-seen",
    );
    window.localStorage.removeItem(
      "mdownreview:excalidraw-first-save-warning-seen",
    );
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/auto-f.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    expect(
      screen.getByTestId("excalidraw-first-entry-banner"),
    ).toBeInTheDocument();

    await act(async () => {
      screen.getByTestId("excalidraw-first-entry-banner-dismiss").click();
    });
    expect(
      screen.queryByTestId("excalidraw-first-entry-banner"),
    ).not.toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: /Reload/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Keep my edits/i }),
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
      screen.getByRole("button", { name: /Reload/i }).click();
    });

    expect(
      useStore.getState().externalChangePendingByTab["/ws/auto-h.excalidraw"],
    ).toBeUndefined();
    expect(fileChangedSpy).toHaveBeenCalled();
    window.removeEventListener("mdownreview:file-changed", fileChangedSpy);
  });

  // P0-2 regression — pre-iter-21 the Reload click synchronously
  // bumped a local reloadKey, which (a) for canonical files
  // re-fired useExcalidrawScene's effect with the OLD `content`
  // and (b) keyed `<Excalidraw key={reloadKey}>` directly. The
  // result was Excalidraw remounting WITH STALE INITIALDATA
  // before the async re-read committed; the next user edit
  // autosaved the stale draft over the external version.
  it("Reload on a canonical .excalidraw does NOT remount Excalidraw before new content commits (P0-2)", async () => {
    useStore.setState({
      externalChangePendingByTab: { "/ws/p02-canonical.excalidraw": true },
    });
    const oldContent = JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "test",
      elements: [{ id: "old-element" }],
      appState: {},
      files: {},
    });
    const newContent = JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "test",
      elements: [{ id: "external-update" }],
      appState: {},
      files: {},
    });
    const { rerender } = render(
      <ExcalidrawView
        content={oldContent}
        filePath="/ws/p02-canonical.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    const initialStub = await screen.findByTestId("excalidraw-stub");
    expect(screen.getByTestId("excalidraw-conflict-banner")).toBeInTheDocument();

    // Click Reload — synchronous click. The pre-iter-21 design
    // would remount Excalidraw HERE, with the still-OLD content,
    // because the local reloadKey bump re-fired useExcalidrawScene
    // synchronously. Post-fix: for canonical files the Reload
    // click does NOT bump a local key; the remount is gated on
    // the async content prop change committing through
    // useFileContent.
    await act(async () => {
      screen.getByRole("button", { name: /Reload/i }).click();
    });
    // Same DOM node — no premature remount with stale content.
    const afterClickStub = screen.getByTestId("excalidraw-stub");
    expect(afterClickStub).toBe(initialStub);

    // Now simulate the async re-read committing new content.
    await act(async () => {
      rerender(
        <ExcalidrawView
          content={newContent}
          filePath="/ws/p02-canonical.excalidraw"
          mode="editor"
          needsExtract={false}
        />,
      );
    });
    // Excalidraw must now remount with the FRESH initialData
    // (loadVersion bumped because useExcalidrawScene re-parsed
    // the new content via the content-dep change).
    await waitFor(() => {
      const remountedStub = screen.getByTestId("excalidraw-stub");
      expect(remountedStub).not.toBe(initialStub);
    });
  });

  // P0-2 regression for binary variants — the local reloadKey is
  // still required because `content` is sentinel-empty and never
  // changes; bumping it is the only way to re-fire extractScene.
  // We verify that the binary path DOES remount (eventually) on
  // Reload + that loadVersion is the gate.
  it("Reload on a binary .excalidraw.png triggers extractScene + remounts via loadVersion (P0-2)", async () => {
    useStore.setState({
      externalChangePendingByTab: { "/ws/p02-binary.excalidraw.png": true },
    });
    extractSceneMock
      .mockResolvedValueOnce({
        elements: [{ id: "first" }],
        appState: {},
        files: {},
      })
      .mockResolvedValueOnce({
        elements: [{ id: "after-reload" }],
        appState: {},
        files: {},
      });
    render(
      <ExcalidrawView
        content=""
        filePath="/ws/p02-binary.excalidraw.png"
        mode="editor"
        needsExtract={true}
      />,
    );
    const initialStub = await screen.findByTestId("excalidraw-stub");
    expect(extractSceneMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      screen.getByRole("button", { name: /Reload/i }).click();
    });
    // extractScene re-runs because reloadKey is bumped on Reload
    // for binary variants (content is sentinel-empty).
    await waitFor(() => {
      expect(extractSceneMock).toHaveBeenCalledTimes(2);
    });
    // After the second extractScene resolves + setScene +
    // setLoadVersion bump, Excalidraw remounts.
    await waitFor(() => {
      const remountedStub = screen.getByTestId("excalidraw-stub");
      expect(remountedStub).not.toBe(initialStub);
    });
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
      screen.getByRole("button", { name: /Reload/i }).click();
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

  // ── B1+B2+B3 regression tests (#352 ship-readiness review) ─────────────
  //
  // Three confirmed P1 bugs caught by the 9-expert ship-readiness review
  // of PR #353. Each test pins the fix so a future contributor cannot
  // silently regress (review findings: bug-expert P1#1, P1#2, P2#3).

  it("[B1] Cmd+S 'Saved' pill does NOT flash when auto-save is paused", async () => {
    // Bug-expert P1#1: pre-fix the Cmd+S handler unconditionally called
    // triggerSavedPill() after flush(). performSave has six bail-out
    // branches; in the most damaging one (3-strike pause) the user
    // would press Ctrl+S, see "Saved", and believe data was on disk
    // when nothing was written. Damages the Reliable pillar.
    saveSceneMock.mockRejectedValue({ kind: "io", message: "ENOSPC" });
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/b1-cmds-pause.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    const onChange = captureOnChange();

    // Drive 3 failed saves to force autoSavePaused=true.
    vi.useFakeTimers();
    try {
      await act(async () => {
        onChange([{ id: "baseline" }], {}, {});
      });
      for (let i = 1; i <= 3; i++) {
        await act(async () => {
          onChange([{ id: `e${i}`, type: "rectangle", x: i }], {}, {});
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2001);
        });
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        });
      }
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => {
      const banner = screen.getByTestId("excalidraw-save-error-banner");
      expect(banner.textContent).toMatch(/paused/i);
    });

    saveSceneMock.mockClear();

    // Press Cmd+S. The pill must NOT appear (paused → no write fired).
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("mdownreview:excalidraw-flush-save", {
          detail: { path: "/ws/b1-cmds-pause.excalidraw" },
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // No new save was attempted (paused short-circuits before IPC).
    expect(saveSceneMock).not.toHaveBeenCalled();
    // No pill — saved-pill testid is absent.
    expect(screen.queryByTestId("excalidraw-saved-pill")).not.toBeInTheDocument();
  });

  it("[B1] Cmd+S 'Saved' pill DOES flash on a successful user-initiated save", async () => {
    saveSceneMock.mockResolvedValue(undefined);
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/b1-cmds-success.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    const onChange = captureOnChange();

    // Bootstrap + edit (so a write would fire).
    await act(async () => {
      onChange([{ id: "baseline" }], {}, {});
    });
    await act(async () => {
      onChange([{ id: "edit-1", type: "rectangle" }], {}, {});
    });

    // Cmd+S user-initiated flush.
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("mdownreview:excalidraw-flush-save", {
          detail: { path: "/ws/b1-cmds-success.excalidraw" },
        }),
      );
    });
    await waitFor(() => {
      expect(saveSceneMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId("excalidraw-saved-pill")).toBeInTheDocument();
    });
  });

  it("[B1] Cmd+S 'Saved' pill does NOT flash when there is no diff vs baseline", async () => {
    // Pre-fix: the pill flashed on every Cmd+S regardless. After fix:
    // pill only flashes when a real write fired. No-diff short-circuit
    // returns before saveExcalidrawFile is invoked.
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/b1-cmds-nodiff.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    const onChange = captureOnChange();

    // Bootstrap baseline only — no subsequent edit, so live === baseline.
    await act(async () => {
      onChange([{ id: "baseline" }], {}, {});
    });
    saveSceneMock.mockClear();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("mdownreview:excalidraw-flush-save", {
          detail: { path: "/ws/b1-cmds-nodiff.excalidraw" },
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // No save fired (no diff).
    expect(saveSceneMock).not.toHaveBeenCalled();
    // No pill.
    expect(screen.queryByTestId("excalidraw-saved-pill")).not.toBeInTheDocument();
  });

  it("[B2] Reload during in-flight save voids the racing save's post-success bookkeeping", async () => {
    // Bug-expert P1#2: pre-fix the in-flight save's .then continuation
    // unconditionally updated lastSavedHashRef + recordSave +
    // setExcalidrawDirty(false), then armed the watcher self-write
    // suppression. After Reload, the user's pre-Reload draft was
    // already on disk via the racing save AND the watcher echo was
    // suppressed, silently overwriting the external version.
    //
    // After the fix: resetBaseline() flips voidInFlightSaveRef. The
    // .then sees the flag and skips bookkeeping. The user's draft was
    // already written (cannot be unwritten) but the post-save state
    // does not pretend that draft is canonical.
    let resolveSave: (() => void) | null = null;
    const savePromise = new Promise<void>((r) => {
      resolveSave = r;
    });
    saveSceneMock.mockReturnValueOnce(savePromise);

    const recordSaveSpy = vi.spyOn(useStore.getState(), "recordSave");

    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/b2-reload-race.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    const onChange = captureOnChange();

    // Bootstrap baseline + edit; debounce out → save IPC begins.
    vi.useFakeTimers();
    try {
      await act(async () => {
        onChange([{ id: "baseline" }], {}, {});
      });
      await act(async () => {
        onChange([{ id: "user-draft", type: "rectangle", x: 99 }], {}, {});
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2001);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(saveSceneMock).toHaveBeenCalledTimes(1);

    // External change arrives mid-IPC → conflict banner appears.
    await act(async () => {
      useStore
        .getState()
        .setExternalChangePending("/ws/b2-reload-race.excalidraw", true);
    });
    await screen.findByTestId("excalidraw-conflict-banner");

    // User clicks Reload while the save is still in flight.
    await act(async () => {
      screen.getByRole("button", { name: /Reload/i }).click();
    });

    // Now the in-flight save resolves AFTER Reload.
    await act(async () => {
      resolveSave?.();
      await savePromise;
      await Promise.resolve();
      await Promise.resolve();
    });

    // recordSave MUST NOT have been called for the voided save —
    // otherwise the watcher would suppress the external version's
    // file-changed event for the next 1500 ms and the user's draft
    // becomes "canonical" on disk under our suppression token.
    expect(recordSaveSpy).not.toHaveBeenCalled();
  });

  it("[B3] Keep editing flushes immediately so the user's intent persists at click time", async () => {
    // Bug-expert P2#3: pre-fix onKeepEditing only cleared
    // externalChangePending. With no further onChange, no save fired.
    // On power loss / OOM, the divergent in-memory version was lost.
    //
    // After the fix: onKeepEditing calls flush() so the user's
    // "overwrite the version on disk" intent is honored at click time.
    saveSceneMock.mockResolvedValue(undefined);
    useStore.setState({
      externalChangePendingByTab: { "/ws/b3-keep-editing.excalidraw": true },
    });
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/b3-keep-editing.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    const onChange = captureOnChange();

    // Bootstrap baseline. Then bypass the conflict gate to record an
    // edit (so flush has something to write).
    await act(async () => {
      onChange([{ id: "baseline" }], {}, {});
    });
    await act(async () => {
      useStore.setState({
        externalChangePendingByTab: { "/ws/b3-keep-editing.excalidraw": false },
      });
    });
    await act(async () => {
      onChange(
        [{ id: "draft", type: "rectangle", x: 1, y: 2 }],
        {},
        {},
      );
    });
    await act(async () => {
      useStore.setState({
        externalChangePendingByTab: { "/ws/b3-keep-editing.excalidraw": true },
      });
    });

    saveSceneMock.mockClear();
    const banner = await screen.findByTestId("excalidraw-conflict-banner");
    const keepEditingBtn = banner.querySelector("button:nth-of-type(2)");
    expect(keepEditingBtn).toBeTruthy();

    await act(async () => {
      (keepEditingBtn as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Save MUST have fired immediately, not deferred to next onChange.
    expect(saveSceneMock).toHaveBeenCalledTimes(1);
    // Pending cleared.
    expect(
      useStore.getState().externalChangePendingByTab[
        "/ws/b3-keep-editing.excalidraw"
      ],
    ).toBeFalsy();
  });
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

  // P0-3 regression — bug-expert + product-expert.
  // Pre-iter-21 the SaveErrorBanner rendered identical
  // [Resume] [Dismiss] buttons regardless of recoverable-vs-paused
  // state. Clicking Dismiss while paused removed the banner without
  // resuming autosave, leaving the user with NO autosave + NO
  // visible signal. Edits then lived in RAM until close-flush
  // (best-effort over CloseRequested only). Post-fix, Dismiss is
  // hidden when paused — the only way out of pause is Resume.
  it("[P0-3] save-error banner has NO Dismiss button while paused (only Resume)", async () => {
    saveSceneMock.mockRejectedValue(new Error("disk full"));
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/p03-pause-no-dismiss.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    const onChange = captureOnChange();

    vi.useFakeTimers();
    try {
      // Bootstrap baseline.
      await act(async () => {
        onChange([{ id: "rect-baseline" }], {}, {});
      });
      // 3 consecutive failures to enter the paused state.
      for (let i = 1; i <= 3; i++) {
        await act(async () => {
          onChange([{ id: `rect-${i}` }], {}, {});
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2100);
        });
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
      }
    } finally {
      vi.useRealTimers();
    }

    // Banner shows the paused copy.
    await waitFor(() => {
      const banner = screen.getByTestId("excalidraw-save-error-banner");
      expect(banner.textContent).toMatch(/paused/i);
    });
    // Resume button present.
    expect(
      screen.getByTestId("excalidraw-save-error-retry").textContent,
    ).toMatch(/Resume/i);
    // CRITICAL: Dismiss button is HIDDEN while paused. Pre-iter-21
    // it rendered identically and clicking it would silently
    // remove the only signal that autosave was disabled.
    expect(
      screen.queryByTestId("excalidraw-save-error-dismiss"),
    ).not.toBeInTheDocument();
  });

  it("[P0-3] save-error banner DOES show Dismiss in the recoverable (not paused) state", async () => {
    // First failure only — banner shows "Couldn't save your changes:"
    // with [Retry] [Dismiss]. Dismiss is fine here because autosave
    // is still active; the next onChange re-arms the debounce.
    saveSceneMock.mockRejectedValueOnce(new Error("transient"));
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/p03-recoverable-dismiss.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    const onChange = captureOnChange();

    vi.useFakeTimers();
    try {
      await act(async () => {
        onChange([{ id: "baseline" }], {}, {});
      });
      await act(async () => {
        onChange([{ id: "edit-1" }], {}, {});
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    } finally {
      vi.useRealTimers();
    }

    // Banner shows the recoverable copy (NOT paused).
    await waitFor(() => {
      const banner = screen.getByTestId("excalidraw-save-error-banner");
      expect(banner.textContent).toMatch(/Couldn't save/i);
      expect(banner.textContent).not.toMatch(/paused/i);
    });
    // Retry + Dismiss BOTH present.
    expect(
      screen.getByTestId("excalidraw-save-error-retry").textContent,
    ).toMatch(/Retry/i);
    expect(
      screen.getByTestId("excalidraw-save-error-dismiss"),
    ).toBeInTheDocument();
  });

  // P0-4 regression — pre-iter-21 there was no persistent save-state
  // indicator. With autosave-only + Save button hidden + transient
  // SavedPill gated to Cmd+S, the user could not tell if their last
  // edit had landed on disk after a 2 s pause. Post-fix, an
  // always-visible status pill at the canvas top-right shows
  // saved / unsaved / saving / failed.
  it("[P0-4] save-status indicator renders 'Saved' on mount in editor mode", async () => {
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/p04-status-saved.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    const indicator = await screen.findByTestId("excalidraw-save-status");
    expect(indicator.getAttribute("data-status")).toBe("saved");
    expect(indicator.textContent).toMatch(/Saved/i);
  });

  it("[P0-4] save-status indicator flips to 'Unsaved' on edit, then 'Saving…' during the save IPC", async () => {
    let resolveSave: () => void = () => {};
    saveSceneMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/p04-status-edit.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    const onChange = captureOnChange();

    vi.useFakeTimers();
    try {
      // Bootstrap baseline.
      await act(async () => {
        onChange([{ id: "rect-baseline" }], {}, {});
      });
      // First real edit — dirty=true.
      await act(async () => {
        onChange([{ id: "rect-1" }], {}, {});
      });
      // Status should be 'unsaved' (debounce pending; no save in flight yet).
      // Use sync getByTestId — fake timers prevent findByTestId polling.
      let indicator = screen.getByTestId("excalidraw-save-status");
      expect(indicator.getAttribute("data-status")).toBe("unsaved");

      // Advance into the save IPC start.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      indicator = screen.getByTestId("excalidraw-save-status");
      // Status flipped to 'saving' because the IPC is mid-flight
      // (the mock's promise hasn't resolved yet).
      expect(indicator.getAttribute("data-status")).toBe("saving");
    } finally {
      vi.useRealTimers();
    }

    // Resolve the save and let the .finally bookkeeping commit.
    await act(async () => {
      resolveSave();
      await Promise.resolve();
      await Promise.resolve();
    });
    // Status returns to 'saved'.
    await waitFor(() => {
      const indicator = screen.getByTestId("excalidraw-save-status");
      expect(indicator.getAttribute("data-status")).toBe("saved");
    });
  });

  it("[P0-4] save-status indicator flips to 'failed' when the IPC rejects", async () => {
    saveSceneMock.mockRejectedValue(new Error("disk full"));
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/p04-status-failed.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    const onChange = captureOnChange();

    vi.useFakeTimers();
    try {
      await act(async () => {
        onChange([{ id: "baseline" }], {}, {});
      });
      await act(async () => {
        onChange([{ id: "edit-1" }], {}, {});
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    } finally {
      vi.useRealTimers();
    }
    // Real timers restored — sync assertion or waitFor both fine.
    await waitFor(() => {
      const indicator = screen.getByTestId("excalidraw-save-status");
      expect(indicator.getAttribute("data-status")).toBe("failed");
    });
  });

  it("[P0-4] save-status indicator is HIDDEN in visual mode (read-only)", async () => {
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/p04-status-visual.excalidraw"
        mode="visual"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    expect(
      screen.queryByTestId("excalidraw-save-status"),
    ).not.toBeInTheDocument();
  });

  // Iter-22 (#352 bug-expert iter-21 P1-3) — save-status indicator
  // shows a dedicated 'paused' state when 3-strike failure-pause is
  // active. Pre-iter-22 the indicator showed 'Unsaved' while paused
  // (the formula `saveError && !autoSavePaused` excluded the paused
  // state from 'failed'); 'Unsaved' is a forward-looking promise the
  // autosave loop cannot keep until the user clicks Resume — actively
  // misleading the exact user about to lose data via the close-flush
  // bypass bug (P0-1). Locks the post-fix invariant: paused ≠ unsaved.
  it("[iter-22] save-status indicator flips to 'paused' after 3 consecutive save failures", async () => {
    saveSceneMock.mockRejectedValue(new Error("disk full"));
    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath="/ws/p13-status-paused.excalidraw"
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    const onChange = captureOnChange();

    vi.useFakeTimers();
    try {
      // Bootstrap baseline.
      await act(async () => {
        onChange([{ id: "baseline" }], {}, {});
      });
      // 3 distinct edits; each debounce window resolves to a rejected
      // save. After the third failure the autosave hook flips
      // autoSavePaused = true.
      for (let i = 1; i <= 3; i++) {
        await act(async () => {
          onChange([{ id: `edit-${i}` }], {}, {});
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2100);
        });
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
      }
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => {
      const indicator = screen.getByTestId("excalidraw-save-status");
      expect(indicator.getAttribute("data-status")).toBe("paused");
      expect(indicator.textContent).toMatch(/paused/i);
      // Inverse assertion: must NOT show "unsaved" — that was the
      // exact pre-iter-22 lie.
      expect(indicator.textContent).not.toMatch(/^Unsaved$/i);
    });
  });

  // Iter-22 (#352 product-expert iter-21 P0 — MRSF re-anchor "once
  // per profile" gap) — when the user enters Editor mode for an
  // `.excalidraw[lib]` whose MRSF sidecar carries unresolved
  // line-anchored comments, a per-file warning banner surfaces
  // BEFORE the first stroke. The FirstEntryBanner is once-per-
  // profile and does NOT name the file or the count; this banner
  // closes that affordance gap.
  it("[iter-22] line-anchored-comments banner shows when get_file_badges reports lineAnchored > 0", async () => {
    // Override get_file_badges to report 3 line-anchored comments
    // (count=5, file_level=2 → line-anchored = 3).
    const PATH = "/ws/iter22-mrsf-warn.excalidraw";
    invokeMock.mockImplementationOnce(async (cmd, args) => {
      if (cmd !== "get_file_badges") return undefined as never;
      const paths = (args as { filePaths: string[] }).filePaths;
      if (paths.includes(PATH)) {
        return {
          [PATH]: { count: 5, max_severity: "info", file_level_count: 2 },
        } as never;
      }
      return {} as never;
    });

    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath={PATH}
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");

    // Banner appears with the count.
    const banner = await screen.findByTestId("excalidraw-line-anchored-banner");
    expect(banner.getAttribute("data-count")).toBe("3");
    expect(banner.textContent).toMatch(/3 review comments? pinned/i);
    expect(banner.textContent).toMatch(/may move to the whole file/i);

    // Dismissal is per-file per-session: clicking "Got it, keep
    // editing" hides the banner.
    const dismiss = screen.getByTestId(
      "excalidraw-line-anchored-banner-dismiss",
    );
    act(() => {
      dismiss.click();
    });
    await waitFor(() => {
      expect(
        screen.queryByTestId("excalidraw-line-anchored-banner"),
      ).not.toBeInTheDocument();
    });
  });

  it("[iter-22] line-anchored-comments banner does NOT show when only file-level comments exist", async () => {
    // Override get_file_badges so the path has comments but ALL are
    // file-level (count = file_level_count → lineAnchored = 0). The
    // FirstEntryBanner already covers the once-per-profile MRSF
    // disclosure; we don't want to nag on every Editor entry when no
    // line-anchored comments are actually at risk.
    const PATH = "/ws/iter22-no-line-anchored.excalidraw";
    invokeMock.mockImplementationOnce(async (cmd, args) => {
      if (cmd !== "get_file_badges") return undefined as never;
      const paths = (args as { filePaths: string[] }).filePaths;
      if (paths.includes(PATH)) {
        return {
          [PATH]: { count: 2, max_severity: "info", file_level_count: 2 },
        } as never;
      }
      return {} as never;
    });

    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath={PATH}
        mode="editor"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    // Allow the badge IPC promise to resolve.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      screen.queryByTestId("excalidraw-line-anchored-banner"),
    ).not.toBeInTheDocument();
  });

  it("[iter-22] line-anchored-comments banner is HIDDEN in visual mode", async () => {
    const PATH = "/ws/iter22-visual-no-banner.excalidraw";
    invokeMock.mockImplementationOnce(async (cmd) => {
      if (cmd !== "get_file_badges") return undefined as never;
      return {
        [PATH]: { count: 5, max_severity: "info", file_level_count: 0 },
      } as never;
    });

    render(
      <ExcalidrawView
        content={VALID_JSON}
        filePath={PATH}
        mode="visual"
        needsExtract={false}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    expect(
      screen.queryByTestId("excalidraw-line-anchored-banner"),
    ).not.toBeInTheDocument();
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

