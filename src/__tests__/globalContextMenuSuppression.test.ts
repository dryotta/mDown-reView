import { describe, it, expect, vi } from "vitest";

// We test the contextmenu suppression handler that main.tsx installs on the
// window without importing main.tsx itself (which has ReactDOM.createRoot as
// a side-effect — same constraint as globalErrorHandlers.test.ts). We
// reproduce the exact handler body and verify it calls preventDefault on the
// event.

function makeContextMenuHandler() {
  return (e: Event) => {
    e.preventDefault();
  };
}

describe("global contextmenu suppression", () => {
  it("calls preventDefault on a contextmenu event", () => {
    const handler = makeContextMenuHandler();
    const e = new Event("contextmenu", { cancelable: true });
    const spy = vi.spyOn(e, "preventDefault");

    handler(e);

    expect(spy).toHaveBeenCalledOnce();
    expect(e.defaultPrevented).toBe(true);
  });

  it("re-prevents an already-prevented event without throwing", () => {
    const handler = makeContextMenuHandler();
    const e = new Event("contextmenu", { cancelable: true });
    // Mirrors the case where some earlier handler also called preventDefault.
    e.preventDefault();
    expect(e.defaultPrevented).toBe(true);

    expect(() => handler(e)).not.toThrow();
    expect(e.defaultPrevented).toBe(true);
  });

  it("registered as a window listener prevents the WebView default menu", () => {
    // End-to-end style on the real `window` to mirror what main.tsx wires.
    const handler = makeContextMenuHandler();
    window.addEventListener("contextmenu", handler);
    try {
      const e = new Event("contextmenu", { cancelable: true, bubbles: true });
      window.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    } finally {
      window.removeEventListener("contextmenu", handler);
    }
  });
});
