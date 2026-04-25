import { describe, it, expect, beforeEach, vi } from "vitest";
import { useRef } from "react";
import { render, fireEvent, act } from "@testing-library/react";
import { ReadingWidthHandle } from "../ReadingWidthHandle";
import { useStore } from "@/store";

// Test harness: a parent .reading-width container with a known starting
// width (rect mocked below) plus the handle wired to its ref.
function Harness({ initialPx }: { initialPx: number }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      data-testid="container"
      className="reading-width"
      style={{ ["--reading-width" as string]: `${initialPx}px` }}
    >
      <ReadingWidthHandle containerRef={ref} />
    </div>
  );
}

function getHandle(container: HTMLElement) {
  const handle = container.querySelector(".reading-width-handle");
  if (!handle) throw new Error("handle not found");
  return handle as HTMLElement;
}

function mockRectWidth(el: HTMLElement, width: number) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    width,
    height: 100,
    top: 0,
    left: 0,
    right: width,
    bottom: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

// jsdom doesn't implement Pointer Capture; stub to no-ops.
beforeEach(() => {
  vi.restoreAllMocks();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
  // Reset store width to default before each test
  useStore.setState({ readingWidth: 720 });
});

describe("ReadingWidthHandle", () => {
  it("writes --reading-width to the container element on pointermove (no store update)", () => {
    const setSpy = vi.spyOn(useStore.getState(), "setReadingWidth");
    const { getByTestId, container } = render(<Harness initialPx={720} />);
    const containerEl = getByTestId("container");
    mockRectWidth(containerEl, 720);
    const handle = getHandle(container);

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 1000 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 1050 });

    // 720 + (1050 - 1000) * 2 = 820
    expect(containerEl.style.getPropertyValue("--reading-width")).toBe("820px");
    // Crucially: no store mutation mid-drag
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("commits the latest width to the store on pointerup", () => {
    const setSpy = vi.spyOn(useStore.getState(), "setReadingWidth");
    const { getByTestId, container } = render(<Harness initialPx={720} />);
    const containerEl = getByTestId("container");
    mockRectWidth(containerEl, 720);
    const handle = getHandle(container);

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 60 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 60 });

    // 720 + 60*2 = 840
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith(840);
  });

  it("clamps at the upper bound (1600px)", () => {
    const { getByTestId, container } = render(<Harness initialPx={720} />);
    const containerEl = getByTestId("container");
    mockRectWidth(containerEl, 720);
    const handle = getHandle(container);

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0 });
    // huge drag right → would compute 720 + 5000*2 = 10720 → clamped to 1600
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 5000 });
    expect(containerEl.style.getPropertyValue("--reading-width")).toBe("1600px");

    act(() => {
      fireEvent.pointerUp(handle, { pointerId: 1, clientX: 5000 });
    });
    expect(useStore.getState().readingWidth).toBe(1600);
  });

  it("clamps at the lower bound (400px)", () => {
    const { getByTestId, container } = render(<Harness initialPx={720} />);
    const containerEl = getByTestId("container");
    mockRectWidth(containerEl, 720);
    const handle = getHandle(container);

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0 });
    // huge drag left → 720 + (-5000)*2 = -9280 → clamped to 400
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: -5000 });
    expect(containerEl.style.getPropertyValue("--reading-width")).toBe("400px");

    act(() => {
      fireEvent.pointerUp(handle, { pointerId: 1, clientX: -5000 });
    });
    expect(useStore.getState().readingWidth).toBe(400);
  });

  it("ignores pointermove without a prior pointerdown", () => {
    const { getByTestId, container } = render(<Harness initialPx={720} />);
    const containerEl = getByTestId("container");
    mockRectWidth(containerEl, 720);
    const handle = getHandle(container);

    const setSpy = vi.spyOn(useStore.getState(), "setReadingWidth");
    setSpy.mockClear();

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 50 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 50 });

    expect(containerEl.style.getPropertyValue("--reading-width")).toBe("720px");
    expect(setSpy).not.toHaveBeenCalled();
  });
});
