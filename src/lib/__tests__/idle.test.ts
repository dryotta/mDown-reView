import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the logger before importing idle.ts so the polyfill banner doesn't fire on real logger.
vi.mock("@/logger", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

describe("idle scheduler", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Restore native APIs if a test deleted them.
    vi.unstubAllGlobals();
  });

  describe("native path (window.requestIdleCallback present)", () => {
    it("delegates requestIdle to the native API and returns its handle", async () => {
      const nativeRic = vi.fn((cb: IdleRequestCallback) => {
        cb({ didTimeout: false, timeRemaining: () => 50 });
        return 1234 as unknown as number;
      });
      const nativeCancel = vi.fn();
      vi.stubGlobal("requestIdleCallback", nativeRic);
      vi.stubGlobal("cancelIdleCallback", nativeCancel);

      const { requestIdle, cancelIdle } = await import("@/lib/idle");
      const cb = vi.fn();
      const handle = requestIdle(cb, { timeout: 100 });

      expect(nativeRic).toHaveBeenCalledOnce();
      expect(nativeRic).toHaveBeenCalledWith(expect.any(Function), { timeout: 100 });
      expect(handle as unknown as number).toBe(1234);
      expect(cb).toHaveBeenCalledOnce();

      cancelIdle(handle);
      expect(nativeCancel).toHaveBeenCalledWith(1234);
    });
  });

  describe("polyfill path (window.requestIdleCallback absent)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // Ensure the native API is undefined for these tests.
      vi.stubGlobal("requestIdleCallback", undefined);
      vi.stubGlobal("cancelIdleCallback", undefined);
    });

    it("falls back to setTimeout and runs callback with a synthetic IdleDeadline", async () => {
      const { requestIdle } = await import("@/lib/idle");
      const cb = vi.fn();
      requestIdle(cb);

      // setTimeout(cb, 1) — advance fake timers.
      vi.advanceTimersByTime(2);
      expect(cb).toHaveBeenCalledOnce();
      const deadline = cb.mock.calls[0][0];
      expect(deadline.didTimeout).toBe(false);
      expect(typeof deadline.timeRemaining).toBe("function");
      expect(deadline.timeRemaining()).toBeGreaterThan(0);
    });

    it("cancelIdle clears the pending setTimeout", async () => {
      const { requestIdle, cancelIdle } = await import("@/lib/idle");
      const cb = vi.fn();
      const handle = requestIdle(cb);
      cancelIdle(handle);

      vi.advanceTimersByTime(10);
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe("defaultScheduler DI surface", () => {
    it("exposes requestIdle and cancelIdle methods", async () => {
      const { defaultScheduler } = await import("@/lib/idle");
      expect(typeof defaultScheduler.requestIdle).toBe("function");
      expect(typeof defaultScheduler.cancelIdle).toBe("function");
    });
  });
});
