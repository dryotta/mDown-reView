import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MermaidControls } from "../mermaid/MermaidControls";

const noop = () => {};

describe("MermaidControls", () => {
  describe("mode=inline", () => {
    it("renders Fit + Pop-out and wires their handlers", async () => {
      const user = userEvent.setup();
      const onFit = vi.fn();
      const onPopout = vi.fn();
      render(
        <MermaidControls
          mode="inline"
          zoom={1}
          onZoomIn={noop}
          onZoomOut={noop}
          onReset={noop}
          onFit={onFit}
          onPopout={onPopout}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Fit to window" }));
      expect(onFit).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole("button", { name: "Pop out" }));
      expect(onPopout).toHaveBeenCalledTimes(1);
    });

    it("omits the pop-out button when onPopout is undefined", () => {
      render(
        <MermaidControls
          mode="inline"
          zoom={1}
          onZoomIn={noop}
          onZoomOut={noop}
          onReset={noop}
          onFit={noop}
        />,
      );

      expect(screen.getByRole("button", { name: "Fit to window" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Pop out" })).not.toBeInTheDocument();
    });
  });

  describe("mode=popout", () => {
    it("renders − / zoom-display / + / Fit / X and wires their handlers", async () => {
      const user = userEvent.setup();
      const onZoomIn = vi.fn();
      const onZoomOut = vi.fn();
      const onReset = vi.fn();
      const onFit = vi.fn();
      const onClose = vi.fn();
      render(
        <MermaidControls
          mode="popout"
          zoom={1}
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          onReset={onReset}
          onFit={onFit}
          onClose={onClose}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Zoom out" }));
      expect(onZoomOut).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole("button", { name: "Zoom in" }));
      expect(onZoomIn).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole("button", { name: "Fit to window" }));
      expect(onFit).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole("button", { name: "Close popout" }));
      expect(onClose).toHaveBeenCalledTimes(1);

      // Reset zoom is a role="button" span
      await user.click(screen.getByRole("button", { name: "Reset zoom" }));
      expect(onReset).toHaveBeenCalledTimes(1);
    });

    it.each([
      [1, "100%"],
      [1.21, "121%"],
      [2.5, "250%"],
    ])("renders zoom %s as %s", (zoom, expected) => {
      render(
        <MermaidControls
          mode="popout"
          zoom={zoom}
          onZoomIn={noop}
          onZoomOut={noop}
          onReset={noop}
          onFit={noop}
          onClose={noop}
        />,
      );
      expect(screen.getByRole("button", { name: "Reset zoom" })).toHaveTextContent(expected);
    });

    it("invokes onReset on Enter key activation of the zoom display", async () => {
      const user = userEvent.setup();
      const onReset = vi.fn();
      render(
        <MermaidControls
          mode="popout"
          zoom={1}
          onZoomIn={noop}
          onZoomOut={noop}
          onReset={onReset}
          onFit={noop}
          onClose={noop}
        />,
      );

      const display = screen.getByRole("button", { name: "Reset zoom" });
      display.focus();
      await user.keyboard("{Enter}");
      expect(onReset).toHaveBeenCalledTimes(1);
    });
  });

  it("every <button> uses type=\"button\" (no implicit form submit)", () => {
    const { container } = render(
      <MermaidControls
        mode="popout"
        zoom={1}
        onZoomIn={noop}
        onZoomOut={noop}
        onReset={noop}
        onFit={noop}
        onClose={noop}
      />,
    );
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((b) => expect(b.getAttribute("type")).toBe("button"));

    const inline = render(
      <MermaidControls
        mode="inline"
        zoom={1}
        onZoomIn={noop}
        onZoomOut={noop}
        onReset={noop}
        onFit={noop}
        onPopout={noop}
      />,
    );
    const inlineButtons = inline.container.querySelectorAll("button");
    expect(inlineButtons.length).toBeGreaterThan(0);
    inlineButtons.forEach((b) => expect(b.getAttribute("type")).toBe("button"));
  });
});
