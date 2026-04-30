import { render, fireEvent } from "@testing-library/react";
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
});
