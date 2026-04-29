import { describe, it, expect, beforeEach, vi } from "vitest";
import type { MockedFunction } from "vitest";

// We test the handler logic that main.tsx installs on window.onerror and
// window.onunhandledrejection without importing main.tsx itself (which has
// ReactDOM.createRoot as a side-effect). We reproduce the exact handler
// bodies and verify they call logger.error with the expected message shape.
//
// vi.mock hoisting makes the @/logger import below receive the stub module
// from src/__mocks__/logger.ts automatically.
vi.mock("@/logger");

import * as logger from "@/logger";

// All exports from the mock are plain vi.fn() — cast them once for clarity.
const mockError = logger.error as MockedFunction<typeof logger.error>;
const mockWarn = logger.warn as MockedFunction<typeof logger.warn>;
const mockInfo = logger.info as MockedFunction<typeof logger.info>;
const mockDebug = logger.debug as MockedFunction<typeof logger.debug>;
const mockTrace = logger.trace as MockedFunction<typeof logger.trace>;

// ── Reproduce the exact handler logic from main.tsx ─────────────────────────

function makeOnerrorHandler(log: typeof logger) {
  return (
    message: string | Event,
    source: string | undefined,
    lineno: number | undefined,
    colno: number | undefined,
    error: Error | undefined
  ) => {
    const stack = error?.stack ?? "";
    void log.error(`Uncaught error: ${message} at ${source}:${lineno}:${colno}\n${stack}`);
  };
}

function makeUnhandledRejectionHandler(log: typeof logger) {
  return (event: PromiseRejectionEvent) => {
    const reason =
      event.reason instanceof Error
        ? (event.reason.stack ?? event.reason.message)
        : String(event.reason);
    void log.error(`Unhandled promise rejection: ${reason}`);
  };
}

// ── Helper ───────────────────────────────────────────────────────────────────

function makePromiseRejectionEvent(reason: unknown): PromiseRejectionEvent {
  return new PromiseRejectionEvent("unhandledrejection", {
    promise: Promise.reject(reason),
    reason,
  });
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("window.onerror handler logic", () => {
  it("calls logger.error with message, source, line, col and stack", () => {
    const handler = makeOnerrorHandler(logger);
    const err = new Error("test error");
    err.stack = "Error: test error\n    at someFile.ts:10:5";

    handler("test error", "someFile.ts", 10, 5, err);

    expect(mockError).toHaveBeenCalledOnce();
    const [msg] = mockError.mock.calls[0];
    expect(msg).toContain("Uncaught error:");
    expect(msg).toContain("test error");
    expect(msg).toContain("someFile.ts");
    expect(msg).toContain("10");
    expect(msg).toContain("5");
    expect(msg).toContain("Error: test error");
  });

  it("uses an empty string for stack when error is undefined", () => {
    const handler = makeOnerrorHandler(logger);
    handler("Script error.", undefined, undefined, undefined, undefined);

    expect(mockError).toHaveBeenCalledOnce();
    const [msg] = mockError.mock.calls[0];
    expect(msg).toContain("Uncaught error:");
    expect(msg).toContain("Script error.");
    // The handler appends \n then an empty stack, so message ends with \n
    expect(msg).toMatch(/\n$/);
  });

  it("uses an empty string for stack when error has no stack property", () => {
    const handler = makeOnerrorHandler(logger);
    const err = new Error("no stack");
    delete (err as Partial<Error>).stack;

    handler("no stack", "file.ts", 1, 1, err);

    const [msg] = mockError.mock.calls[0];
    expect(msg).toContain("Uncaught error: no stack");
  });

  it("formats the full message: Uncaught error: <msg> at <src>:<line>:<col>\\n<stack>", () => {
    const handler = makeOnerrorHandler(logger);
    const err = new Error("boom");
    err.stack = "stack trace here";

    handler("boom", "app.js", 42, 7, err);

    const [msg] = mockError.mock.calls[0];
    expect(msg).toBe("Uncaught error: boom at app.js:42:7\nstack trace here");
  });
});

describe("window.onunhandledrejection handler logic", () => {
  it("calls logger.error with the rejection reason as a string", () => {
    const handler = makeUnhandledRejectionHandler(logger);
    const event = makePromiseRejectionEvent("network timeout");

    handler(event);

    expect(mockError).toHaveBeenCalledOnce();
    const [msg] = mockError.mock.calls[0];
    expect(msg).toContain("Unhandled promise rejection:");
    expect(msg).toContain("network timeout");
  });

  it("uses the error stack when reason is an Error with a stack", () => {
    const handler = makeUnhandledRejectionHandler(logger);
    const err = new Error("async failure");
    err.stack = "Error: async failure\n    at async fn.ts:5:3";
    const event = makePromiseRejectionEvent(err);

    handler(event);

    const [msg] = mockError.mock.calls[0];
    expect(msg).toContain("Unhandled promise rejection:");
    expect(msg).toContain("Error: async failure");
    expect(msg).toContain("async fn.ts:5:3");
  });

  it("falls back to error.message when reason is an Error without a stack", () => {
    const handler = makeUnhandledRejectionHandler(logger);
    const err = new Error("stackless error");
    delete (err as Partial<Error>).stack;
    const event = makePromiseRejectionEvent(err);

    handler(event);

    const [msg] = mockError.mock.calls[0];
    expect(msg).toContain("stackless error");
  });

  it("converts non-Error rejections to string via String()", () => {
    const handler = makeUnhandledRejectionHandler(logger);
    const event = makePromiseRejectionEvent(42);

    handler(event);

    const [msg] = mockError.mock.calls[0];
    expect(msg).toContain("42");
  });

  it("handles null rejection reason", () => {
    const handler = makeUnhandledRejectionHandler(logger);
    const event = makePromiseRejectionEvent(null);

    handler(event);

    const [msg] = mockError.mock.calls[0];
    expect(msg).toContain("null");
  });

  it("formats the message as: Unhandled promise rejection: <reason>", () => {
    const handler = makeUnhandledRejectionHandler(logger);
    const event = makePromiseRejectionEvent("pure string reason");

    handler(event);

    const [msg] = mockError.mock.calls[0];
    expect(msg).toBe("Unhandled promise rejection: pure string reason");
  });
});

describe("handler isolation", () => {
  it("onerror handler does not call warn, info, debug, or trace", () => {
    const handler = makeOnerrorHandler(logger);
    handler("err", "f.ts", 1, 1, undefined);
    expect(mockWarn).not.toHaveBeenCalled();
    expect(mockInfo).not.toHaveBeenCalled();
    expect(mockDebug).not.toHaveBeenCalled();
    expect(mockTrace).not.toHaveBeenCalled();
  });

  it("unhandledrejection handler does not call warn, info, debug, or trace", () => {
    const handler = makeUnhandledRejectionHandler(logger);
    handler(makePromiseRejectionEvent("reason"));
    expect(mockWarn).not.toHaveBeenCalled();
    expect(mockInfo).not.toHaveBeenCalled();
    expect(mockDebug).not.toHaveBeenCalled();
    expect(mockTrace).not.toHaveBeenCalled();
  });
});
