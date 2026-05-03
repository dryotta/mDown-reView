/**
 * Issue #352 / iter-13 — persistent Excalidraw mount host: smoke +
 * cleanup tests.
 *
 * The host's job is twofold:
 *   1. Render a slot per registered path. The slot mounts a single
 *      `<ExcalidrawView>` whose `viewModeEnabled` toggles dynamically
 *      between Visual and Editor.
 *   2. Show only the slot for the active path AND only when active
 *      view-mode is `visual` or `editor` — Source mode hides the
 *      slot, even though it stays mounted (display:none).
 *
 * These tests assert the rendering decisions; the underlying
 * `<ExcalidrawView>` is mocked to keep the suite fast and prevent
 * the heavy `@excalidraw/excalidraw` chunk from loading in jsdom.
 */

import { render, screen, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Stub the lazy ExcalidrawView with a deterministic placeholder so the
// host renders synchronously in jsdom and the tests can introspect the
// mounted props.
vi.mock("../ExcalidrawView", () => ({
  ExcalidrawView: vi.fn(
    (props: { filePath: string; mode: string; content: string; needsExtract: boolean }) => (
      <div
        data-testid={`excalidraw-stub-${props.filePath}`}
        data-mode={props.mode}
        data-content-len={String(props.content.length)}
        data-needs-extract={String(props.needsExtract)}
      />
    ),
  ),
}));

// Stub useFileContent so the slot renders without firing real IPC
// reads. Returns a "ready" snapshot with deterministic content.
vi.mock("@/hooks/useFileContent", () => ({
  useFileContent: vi.fn((path: string) => ({
    status: "ready" as const,
    content: `{"type":"excalidraw","elements":[],"path":"${path}"}`,
  })),
}));

import { useStore } from "@/store";

import { PersistentExcalidrawHost } from "../excalidraw/PersistentExcalidrawHost";

beforeEach(() => {
  useStore.setState({
    tabs: [],
    activeTabPath: null,
    viewModeByTab: {},
    fileMetaByPath: {},
    excalidrawDirtyByTab: {},
    externalChangePendingByTab: {},
    excalidrawEditorMounts: [],
    lastSaveByPath: {},
  });
});

describe("PersistentExcalidrawHost", () => {
  it("renders nothing when no paths are registered", () => {
    render(<PersistentExcalidrawHost />);
    expect(screen.queryByTestId("excalidraw-host")).toBeNull();
  });

  it("renders one slot per registered path", () => {
    useStore.setState({
      excalidrawEditorMounts: ["/ws/a.excalidraw", "/ws/b.excalidraw"],
      activeTabPath: "/ws/a.excalidraw",
      viewModeByTab: { "/ws/a.excalidraw": "editor" },
    });
    render(<PersistentExcalidrawHost />);
    expect(screen.getByTestId("excalidraw-host")).toBeInTheDocument();
    expect(
      screen.getByTestId("excalidraw-host-slot-/ws/a.excalidraw"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("excalidraw-host-slot-/ws/b.excalidraw"),
    ).toBeInTheDocument();
  });

  it("only the active path's slot is data-active=true", () => {
    useStore.setState({
      excalidrawEditorMounts: ["/ws/a.excalidraw", "/ws/b.excalidraw"],
      activeTabPath: "/ws/a.excalidraw",
      viewModeByTab: {
        "/ws/a.excalidraw": "editor",
        "/ws/b.excalidraw": "editor",
      },
    });
    render(<PersistentExcalidrawHost />);
    expect(
      screen.getByTestId("excalidraw-host-slot-/ws/a.excalidraw").getAttribute("data-active"),
    ).toBe("true");
    expect(
      screen.getByTestId("excalidraw-host-slot-/ws/b.excalidraw").getAttribute("data-active"),
    ).toBe("false");
  });

  it("active slot in Source mode is data-active=false (SourceView covers it)", () => {
    useStore.setState({
      excalidrawEditorMounts: ["/ws/a.excalidraw"],
      activeTabPath: "/ws/a.excalidraw",
      viewModeByTab: { "/ws/a.excalidraw": "source" },
    });
    render(<PersistentExcalidrawHost />);
    expect(
      screen.getByTestId("excalidraw-host-slot-/ws/a.excalidraw").getAttribute("data-active"),
    ).toBe("false");
  });

  it("propagates `editor` view mode to the active slot's ExcalidrawView", () => {
    useStore.setState({
      excalidrawEditorMounts: ["/ws/a.excalidraw"],
      activeTabPath: "/ws/a.excalidraw",
      viewModeByTab: { "/ws/a.excalidraw": "editor" },
    });
    render(<PersistentExcalidrawHost />);
    const stub = screen.getByTestId("excalidraw-stub-/ws/a.excalidraw");
    expect(stub.getAttribute("data-mode")).toBe("editor");
  });

  it("propagates `visual` view mode when active mode is visual", () => {
    useStore.setState({
      excalidrawEditorMounts: ["/ws/a.excalidraw"],
      activeTabPath: "/ws/a.excalidraw",
      viewModeByTab: { "/ws/a.excalidraw": "visual" },
    });
    render(<PersistentExcalidrawHost />);
    const stub = screen.getByTestId("excalidraw-stub-/ws/a.excalidraw");
    expect(stub.getAttribute("data-mode")).toBe("visual");
  });

  it("inactive slots default to `visual` mode (re-show ready)", () => {
    useStore.setState({
      excalidrawEditorMounts: ["/ws/a.excalidraw", "/ws/b.excalidraw"],
      activeTabPath: "/ws/a.excalidraw",
      viewModeByTab: {
        "/ws/a.excalidraw": "editor",
        "/ws/b.excalidraw": "editor",
      },
    });
    render(<PersistentExcalidrawHost />);
    // The inactive slot's stub should show mode "visual" defensively
    // (it's hidden anyway; the prop only matters at re-show time).
    const inactiveStub = screen.getByTestId("excalidraw-stub-/ws/b.excalidraw");
    expect(inactiveStub.getAttribute("data-mode")).toBe("visual");
  });

  it("flags PNG variants with needsExtract=true", () => {
    useStore.setState({
      excalidrawEditorMounts: ["/ws/scene.excalidraw.png"],
      activeTabPath: "/ws/scene.excalidraw.png",
      viewModeByTab: { "/ws/scene.excalidraw.png": "editor" },
    });
    render(<PersistentExcalidrawHost />);
    const stub = screen.getByTestId("excalidraw-stub-/ws/scene.excalidraw.png");
    expect(stub.getAttribute("data-needs-extract")).toBe("true");
  });

  it("flags canonical .excalidraw with needsExtract=false", () => {
    useStore.setState({
      excalidrawEditorMounts: ["/ws/scene.excalidraw"],
      activeTabPath: "/ws/scene.excalidraw",
      viewModeByTab: { "/ws/scene.excalidraw": "editor" },
    });
    render(<PersistentExcalidrawHost />);
    const stub = screen.getByTestId("excalidraw-stub-/ws/scene.excalidraw");
    expect(stub.getAttribute("data-needs-extract")).toBe("false");
  });

  it("removing a path from the registry unmounts its slot (cleanup)", () => {
    const { rerender } = render(<PersistentExcalidrawHost />);
    act(() => {
      useStore.setState({
        excalidrawEditorMounts: ["/ws/a.excalidraw"],
        activeTabPath: "/ws/a.excalidraw",
        viewModeByTab: { "/ws/a.excalidraw": "editor" },
      });
    });
    rerender(<PersistentExcalidrawHost />);
    expect(
      screen.getByTestId("excalidraw-host-slot-/ws/a.excalidraw"),
    ).toBeInTheDocument();

    // Simulate closeTab: drop from registry.
    act(() => {
      useStore.setState({ excalidrawEditorMounts: [] });
    });
    rerender(<PersistentExcalidrawHost />);
    expect(
      screen.queryByTestId("excalidraw-host-slot-/ws/a.excalidraw"),
    ).toBeNull();
    // Whole host should be gone too — no mounts, no host wrapper.
    expect(screen.queryByTestId("excalidraw-host")).toBeNull();
  });
});
