/**
 * Cross-browser requestIdleCallback shim.
 *
 * **Why mandatory:** WKWebView (the macOS Tauri v2 webview engine) does NOT
 * implement requestIdleCallback. Safari has never shipped it. Without this
 * polyfill, idle-chunked Shiki highlighting (used in
 * src/hooks/useSourceHighlighting.ts starting iter 2 of PR for #252) would
 * crash on macOS at runtime.
 *
 * **Honest semantics:** the polyfill schedules via setTimeout(cb, 1) and
 * provides a synthetic IdleDeadline whose timeRemaining() returns a constant
 * 16 ms. That value is an advisory cushion, not a hard cap — once expensive
 * work like codeToHtml is dispatched on a chunk, it runs to completion
 * regardless of timeRemaining(). The contract is "one chunk per idle slot",
 * not "fit work into timeRemaining()".
 */

import { debug } from "@/logger";

/** Tightened mirror of the spec IdleDeadline (only the surface we expose to consumers). */
export interface IdleDeadlineLike {
  didTimeout: boolean;
  timeRemaining(): number;
}

export type IdleHandle = number;

const hasNative = typeof globalThis.requestIdleCallback === "function";

if (!hasNative) {
  void debug("[idle] requestIdleCallback unavailable — polyfilling via setTimeout");
}

export const requestIdle: (
  callback: (deadline: IdleDeadlineLike) => void,
  options?: { timeout?: number },
) => IdleHandle = hasNative
  ? (cb, options) =>
      globalThis.requestIdleCallback(cb as IdleRequestCallback, options) as unknown as IdleHandle
  : (cb) =>
      setTimeout(
        () => cb({ didTimeout: false, timeRemaining: () => 16 }),
        1,
      ) as unknown as IdleHandle;

export const cancelIdle: (handle: IdleHandle) => void = hasNative
  ? (h) => globalThis.cancelIdleCallback(h as unknown as number)
  : (h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>);
