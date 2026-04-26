import "@testing-library/jest-dom";
import { vi, beforeEach, afterEach, expect } from "vitest";

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
});
