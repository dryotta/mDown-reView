/**
 * Cross-browser requestIdleCallback shim with DI-friendly scheduler interface.
 *
 * **Why mandatory:** WKWebView (the macOS Tauri v2 webview engine) does NOT
 * implement requestIdleCallback. Safari has never shipped it. Without this
 * polyfill, idle-chunked Shiki highlighting (used in src/hooks/useSourceHighlighting.ts
 * starting iter 2 of PR for #252) would crash on macOS at runtime.
 *
 * **Honest semantics:** the polyfill schedules via setTimeout(cb, 1) and provides
 * a synthetic IdleDeadline whose timeRemaining() returns a constant 16ms.
 * Consumers MUST treat IDLE_BUDGET_MS (src/lib/viewer-budgets.ts) as an
 * advisory cushion, not a hard cap — once expensive work like codeToHtml is
 * dispatched on a chunk, it runs to completion regardless of timeRemaining().
 * The contract is "one chunk per idle slot", not "fit work into timeRemaining()".
 */

import { debug } from "@/logger";

/** Tightened mirror of the spec IdleDeadline (only the surface we expose to consumers). */
export interface IdleDeadlineLike {
  didTimeout: boolean;
  timeRemaining(): number;
}

export type IdleHandle = number;

/**
 * Scheduler interface for DI in tests. Production code uses `defaultScheduler`,
 * which selects the native requestIdleCallback when available and falls back
 * to a setTimeout-based polyfill otherwise. Tests inject a synchronous fake.
 */
export interface IdleScheduler {
  requestIdle(callback: (deadline: IdleDeadlineLike) => void, options?: { timeout?: number }): IdleHandle;
  cancelIdle(handle: IdleHandle): void;
}

/** True when the host environment exposes window.requestIdleCallback. */
function hasNativeRic(): boolean {
  return typeof globalThis !== "undefined"
    && typeof (globalThis as unknown as { requestIdleCallback?: unknown }).requestIdleCallback === "function";
}

/**
 * Module-load-time polyfill banner. Logs once at import time when the host lacks the
 * native API — surfaces the polyfill activation to maintainers without per-call spam.
 */
let _bannerLogged = false;
function ensureBannerLogged(): void {
  if (_bannerLogged) return;
  _bannerLogged = true;
  if (!hasNativeRic()) {
    void debug("[idle] requestIdleCallback unavailable — polyfilling via setTimeout");
  }
}
ensureBannerLogged();

const FALLBACK_TIME_REMAINING_MS = 16;

const nativeScheduler: IdleScheduler = {
  requestIdle: (cb, options) => {
    return (globalThis as unknown as { requestIdleCallback: typeof requestIdleCallback })
      .requestIdleCallback(cb as IdleRequestCallback, options) as unknown as IdleHandle;
  },
  cancelIdle: (handle) => {
    (globalThis as unknown as { cancelIdleCallback: typeof cancelIdleCallback }).cancelIdleCallback(handle as unknown as number);
  },
};

const fallbackScheduler: IdleScheduler = {
  requestIdle: (cb, _options) => {
    const handle = setTimeout(() => {
      cb({ didTimeout: false, timeRemaining: () => FALLBACK_TIME_REMAINING_MS });
    }, 1);
    return handle as unknown as IdleHandle;
  },
  cancelIdle: (handle) => {
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  },
};

/** Default scheduler — native when available, polyfill otherwise. Selected at module load. */
export const defaultScheduler: IdleScheduler = hasNativeRic() ? nativeScheduler : fallbackScheduler;

/** Convenience function — wraps defaultScheduler.requestIdle. */
export function requestIdle(
  callback: (deadline: IdleDeadlineLike) => void,
  options?: { timeout?: number },
): IdleHandle {
  return defaultScheduler.requestIdle(callback, options);
}

/** Convenience function — wraps defaultScheduler.cancelIdle. */
export function cancelIdle(handle: IdleHandle): void {
  defaultScheduler.cancelIdle(handle);
}
