import { render, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeEach } from "vitest";

import { FolderPaneShell } from "../FolderPaneShell";

import { resetRenderCounts, getRenderCount } from "@/hooks/dev/useRenderCount";
import { useStore } from "@/store";

describe("FolderPaneShell — RC1/P2.4 drag isolation", () => {
  beforeEach(() => {
    resetRenderCounts();
    useStore.setState({ folderPaneWidth: 240 });
  });

  it("dragging fires setFolderPaneWidth and re-renders the shell, but not its children", () => {
    let childRenders = 0;
    function ChildSpy() {
      childRenders += 1;
      return <div data-testid="child" />;
    }

    const { container } = render(
      <FolderPaneShell hideDragHandle={false}>
        <ChildSpy />
      </FolderPaneShell>
    );

    const initialChildRenders = childRenders;
    const handle = container.querySelector(".drag-handle") as HTMLElement;
    expect(handle).toBeTruthy();

    fireEvent.mouseDown(handle, { clientX: 200 });
    for (let dx = 1; dx <= 10; dx++) {
      fireEvent.mouseMove(window, { clientX: 200 + dx });
    }
    fireEvent.mouseUp(window);

    // Children identity is stable; React bails on child re-renders.
    expect(childRenders).toBe(initialChildRenders);
    // Shell rendered for each store update (10 mouse moves → 10 re-renders + initial).
    expect(getRenderCount("FolderPaneShell")).toBeGreaterThan(initialChildRenders);
    // Final width applied.
    expect(useStore.getState().folderPaneWidth).toBeGreaterThanOrEqual(160);
  });

  it("does not render the drag handle when hideDragHandle is true", () => {
    const { container } = render(
      <FolderPaneShell hideDragHandle>
        <div />
      </FolderPaneShell>
    );
    expect(container.querySelector(".drag-handle")).toBeNull();
    expect(container.querySelector(".folder-pane-hidden")).toBeTruthy();
  });

  it("regression: wrapper sizing rule uses `width` not `max-width` so the pane can grow past content width", () => {
    // Why this assertion is structural, not visual:
    // jsdom does not run a real layout engine, so `getBoundingClientRect`
    // returns 0×0 for everything. We instead assert against the loaded
    // CSS rule itself — the bug was that `.folder-pane-wrapper` had only
    // `max-width: var(--folder-pane-width)` and no `width`, so dragging
    // the handle right could not widen the pane past its content.
    // The visual / pointer-driven layout regression is covered by
    // e2e/browser/folder-pane-resize.spec.ts.
    const cssPath = resolve(__dirname, "../../styles/folder-tree.css");
    const css = readFileSync(cssPath, "utf-8");
    // `width: var(--folder-pane-width …)` MUST exist on
    // `.folder-pane-wrapper` so the wrapper takes the slider value as
    // its actual size, not just an upper cap.
    expect(css).toMatch(
      /\.folder-pane-wrapper\s*\{[^}]*\bwidth:\s*var\(--folder-pane-width/
    );
    // `flex-shrink: 0` MUST be present so the flex parent (.main-area)
    // does not shrink the wrapper back below the slider value when the
    // viewer area is wider than its remaining space.
    expect(css).toMatch(/\.folder-pane-wrapper\s*\{[^}]*\bflex-shrink:\s*0/);
  });

  it("regression: an active drag toggles the `is-dragging` class so the width transition is suppressed", () => {
    const { container } = render(
      <FolderPaneShell hideDragHandle={false}>
        <div />
      </FolderPaneShell>
    );
    const wrapper = container.querySelector(".folder-pane-wrapper") as HTMLElement;
    const handle = container.querySelector(".drag-handle") as HTMLElement;

    expect(wrapper.classList.contains("is-dragging")).toBe(false);

    fireEvent.mouseDown(handle, { clientX: 200 });
    // After mousedown the shell rerendered with isDragging=true.
    expect(wrapper.classList.contains("is-dragging")).toBe(true);

    fireEvent.mouseMove(window, { clientX: 250 });
    expect(wrapper.classList.contains("is-dragging")).toBe(true);

    fireEvent.mouseUp(window);
    expect(wrapper.classList.contains("is-dragging")).toBe(false);
  });
});
