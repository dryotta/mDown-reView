import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommentContextMenu } from "../CommentContextMenu";

describe("CommentContextMenu", () => {
  function setup(overrides: Partial<Parameters<typeof CommentContextMenu>[0]> = {}) {
    const onAction = vi.fn();
    const onClose = vi.fn();
    const utils = render(
      <CommentContextMenu
        open={true}
        x={10}
        y={20}
        hasSelection={true}
        onAction={onAction}
        onClose={onClose}
        {...overrides}
      />,
    );
    return { ...utils, onAction, onClose };
  }

  it("renders all three menu items", () => {
    setup();
    expect(screen.getByRole("menuitem", { name: /Comment on selection/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Copy link to line/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Mark line as discussed/i })).toBeTruthy();
  });

  it("renders nothing when open=false", () => {
    const { container } = setup({ open: false });
    expect(container.firstChild).toBeNull();
  });

  it("disables 'Comment on selection' when hasSelection=false", () => {
    setup({ hasSelection: false });
    const btn = screen.getByRole("menuitem", { name: /Comment on selection/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("clicking an item fires onAction and onClose", () => {
    const { onAction, onClose } = setup();
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy link to line/i }));
    expect(onAction).toHaveBeenCalledWith("copy-link");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clicking a disabled item does NOT fire onAction", () => {
    const { onAction } = setup({ hasSelection: false });
    fireEvent.click(screen.getByRole("menuitem", { name: /Comment on selection/i }));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("Enter on focused item activates it", () => {
    const { onAction, onClose } = setup();
    const btn = screen.getByRole("menuitem", { name: /Mark line as discussed/i });
    btn.focus();
    fireEvent.keyDown(btn, { key: "Enter" });
    expect(onAction).toHaveBeenCalledWith("discussed");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Escape on focused item closes", () => {
    const { onClose, onAction } = setup();
    const btn = screen.getByRole("menuitem", { name: /Copy link to line/i });
    btn.focus();
    fireEvent.keyDown(btn, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("ArrowDown moves focus to next enabled item", () => {
    setup();
    const first = screen.getByRole("menuitem", { name: /Comment on selection/i });
    const second = screen.getByRole("menuitem", { name: /Copy link to line/i });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);
  });

  it("auto-focuses first enabled item on open", () => {
    setup();
    expect((document.activeElement as HTMLElement).textContent).toMatch(/Comment on selection/);
  });

  it("when first item is disabled, auto-focus skips to next", () => {
    setup({ hasSelection: false });
    expect((document.activeElement as HTMLElement).textContent).toMatch(/Copy link to line/);
  });

  it("hasLine=false disables 'Mark line as discussed' and renames Copy link → file", () => {
    const { onAction } = setup({ hasLine: false });
    const discussed = screen.getByRole("menuitem", {
      name: /Mark line as discussed/i,
    }) as HTMLButtonElement;
    expect(discussed.disabled).toBe(true);
    // Copy-link relabels to "Copy link to file" and stays enabled.
    const copyLink = screen.getByRole("menuitem", { name: /Copy link to file/i }) as HTMLButtonElement;
    expect(copyLink.disabled).toBe(false);
    // The line-form label is gone.
    expect(screen.queryByRole("menuitem", { name: /Copy link to line/i })).toBeNull();
    // Clicking discussed is still a no-op.
    fireEvent.click(discussed);
    expect(onAction).not.toHaveBeenCalledWith("discussed");
  });
});
