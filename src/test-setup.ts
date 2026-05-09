import "@testing-library/jest-dom";
import { vi, beforeEach, afterEach, expect } from "vitest";
import { __IPC_MOCK_LISTENERS_RESET } from "./__mocks__/@tauri-apps/api/__bus";

// Issue #359 — apply the manual mock for `@tauri-apps/api/core` globally.
//
// Vitest's bare `vi.mock("@tauri-apps/api/core")` form (used per
// `docs/test-strategy.md` IPC-mock chokepoint, enforced by
// `src/__tests__/ipc-mock-hygiene.test.ts`) does NOT auto-load the
// manual mock at `src/__mocks__/@tauri-apps/api/core.ts` — Vitest
// looks for `__mocks__/` adjacent to the mocked path, not inside
// `src/`. Pre-#359 this didn't matter because no production code
// path called `invoke(...)` for a return-shape that any unit test
// actually read; the auto-mock's undefined returns were silently
// swallowed by `void` calls or paths the test didn't exercise.
//
// As of #359 `tabsSlice.openFile` `await commands.registerWindowFile(...)`
// and reads `.classification.tier` from the result — every unit test
// that touches `openFile` now needs the manual mock's default arms
// (which return the right shape). Applying `vi.mock` here in a setup
// file hoists the registration to every test file, so `vi.mock(
// "@tauri-apps/api/core")` (or even no mock at all) resolves to the
// manual mock module without per-file factory boilerplate.
vi.mock("@tauri-apps/api/core", async () =>
  await import("./__mocks__/@tauri-apps/api/core")
);

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
// render any virtual items in tests. The shim is a no-op observer; tests
// that need to react to size changes drive the virtualiser via
// `installVirtualizerViewportShim` (below). Production runs in a real
// browser where ResizeObserver is native.
if (typeof globalThis.ResizeObserver === "undefined") {
  class TestResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
}

// Opt-in viewport-dimension shim. **Imported only by tests that exercise
// `@tanstack/react-virtual`** — e.g. `src/components/viewers/__tests__/
// SourceView.test.tsx`. Setting these shims globally would silently mask
// "not yet laid out / hidden" branches in unrelated component tests
// (test-expert review on PR #354, iter 2). Call once at the top of the
// describe block; it is idempotent and reverts on `vi.restoreAllMocks()`
// because it returns a teardown handle.
//
// Why it exists: jsdom returns 0 for `offsetHeight` / `clientHeight` /
// `getBoundingClientRect`. `@tanstack/react-virtual`'s default
// `measureElement` reads `el.offsetHeight` and its scroll-element
// observer reads `offsetHeight`/`offsetWidth` of the scroll container
// (see `node_modules/@tanstack/virtual-core/dist/esm/index.js:144,
// 2-5`). With 0 dimensions `outerSize === 0` short-circuits the range
// computation and the virtualiser never mounts any rows — so the
// component tests can't observe their assertions.
export function installVirtualizerViewportShim(viewportPx = 800): () => void {
  const elProto = Element.prototype as unknown as Record<string, unknown>;
  const htmlProto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const prevElHeight = Object.getOwnPropertyDescriptor(elProto, "clientHeight");
  const prevElWidth = Object.getOwnPropertyDescriptor(elProto, "clientWidth");
  const prevHtmlOffsetHeight = Object.getOwnPropertyDescriptor(
    htmlProto,
    "offsetHeight",
  );
  const prevHtmlOffsetWidth = Object.getOwnPropertyDescriptor(
    htmlProto,
    "offsetWidth",
  );
  Object.defineProperty(htmlProto, "offsetHeight", {
    configurable: true,
    get() {
      return viewportPx;
    },
  });
  Object.defineProperty(htmlProto, "offsetWidth", {
    configurable: true,
    get() {
      return viewportPx;
    },
  });
  Object.defineProperty(elProto, "clientHeight", {
    configurable: true,
    get() {
      return viewportPx;
    },
  });
  Object.defineProperty(elProto, "clientWidth", {
    configurable: true,
    get() {
      return viewportPx;
    },
  });
  return () => {
    if (prevElHeight) Object.defineProperty(elProto, "clientHeight", prevElHeight);
    else delete elProto.clientHeight;
    if (prevElWidth) Object.defineProperty(elProto, "clientWidth", prevElWidth);
    else delete elProto.clientWidth;
    if (prevHtmlOffsetHeight)
      Object.defineProperty(htmlProto, "offsetHeight", prevHtmlOffsetHeight);
    else delete htmlProto.offsetHeight;
    if (prevHtmlOffsetWidth)
      Object.defineProperty(htmlProto, "offsetWidth", prevHtmlOffsetWidth);
    else delete htmlProto.offsetWidth;
  };
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
