import "@testing-library/jest-dom";
import { vi, beforeEach, afterEach, expect } from "vitest";
import { __IPC_MOCK_LISTENERS_RESET } from "./__mocks__/@tauri-apps/api/__bus";

// jsdom does not implement HTMLDialogElement.showModal/close (the spec
// requires top-layer / inert support that jsdom omits). Polyfill the
// minimum surface so components that depend on the native <dialog>
// (e.g. SettingsDialog) render under jsdom. Production runs in a real
// browser/Tauri WebView where the native API is available.
if (typeof HTMLDialogElement !== "undefined") {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal: () => void;
    show: () => void;
    close: (returnValue?: string) => void;
  };
  if (typeof proto.showModal !== "function") {
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.show !== "function") {
    proto.show = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
}

// jsdom does not ship ResizeObserver — @tanstack/react-virtual (used by
// `SourceView` after iter 2 of #252) relies on it to watch the scroll
// element for size changes. Without the shim the virtualiser refuses to
// render any virtual items in tests. Production runs in a real browser
// where ResizeObserver is native; the shim is test-only.
if (typeof globalThis.ResizeObserver === "undefined") {
  class TestResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
}

// jsdom returns 0 for offsetHeight / offsetWidth / getBoundingClientRect
// dimensions. @tanstack/react-virtual uses `element.offsetHeight` to compute
// the scroll-element's outer size, and short-circuits to an empty range
// when `outerSize === 0`. Without dimensions the virtualiser renders zero
// virtual items even with a non-empty count. Synthesise an 800-px viewport
// globally so virtualised component tests (SourceView and any future
// virtualised viewers) get a sensible row window. Production runs in a
// real browser where layout measurement is real; the override is test-only.
// jsdom defines these accessors on `HTMLElement.prototype`.
if (typeof HTMLElement !== "undefined") {
  const TEST_VIEWPORT_PX = 800;
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return TEST_VIEWPORT_PX;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return TEST_VIEWPORT_PX;
    },
  });
}
if (typeof Element !== "undefined") {
  const TEST_VIEWPORT_PX = 800;
  Object.defineProperty(Element.prototype, "clientHeight", {
    configurable: true,
    get() {
      return TEST_VIEWPORT_PX;
    },
  });
  Object.defineProperty(Element.prototype, "clientWidth", {
    configurable: true,
    get() {
      return TEST_VIEWPORT_PX;
    },
  });
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error");
  consoleWarnSpy = vi.spyOn(console, "warn");
});

afterEach(() => {
  expect(consoleErrorSpy, "Unexpected console.error call").not.toHaveBeenCalled();
  expect(consoleWarnSpy, "Unexpected console.warn call").not.toHaveBeenCalled();
  vi.restoreAllMocks();
  // Drop every `listen("comments-changed", …)` subscription so a leaked
  // handler from one test can't fire under another's invoke.
  __IPC_MOCK_LISTENERS_RESET();
});
