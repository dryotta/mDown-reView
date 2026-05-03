/**
 * Tests for the Excalidraw close-flush registry. Module-scope
 * singleton on a critical close-handshake path that previously had
 * zero direct tests (test-expert HIGH finding).
 *
 * Covers:
 *   - register → flush is invoked by the drain helper
 *   - same-path re-register replaces the flush callback
 *   - the unregister returned by `registerExcalidrawFlush` only deletes
 *     when WE are still the current owner (defensive on remount race)
 *   - empty registry resolves immediately
 *   - a single flush rejection does NOT reject the outer drain promise
 *     (best-effort contract; failures swallowed so a single editor
 *     can't block the close handshake)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  flushAllPendingExcalidrawSaves,
  registerExcalidrawFlush,
  __TEST_ONLY_clearRegistry,
  __TEST_ONLY_size,
} from "../flush-registry";

describe("flush-registry", () => {
  beforeEach(() => {
    __TEST_ONLY_clearRegistry();
  });

  afterEach(() => {
    __TEST_ONLY_clearRegistry();
  });

  it("flushAllPendingExcalidrawSaves on empty registry resolves immediately", async () => {
    expect(__TEST_ONLY_size()).toBe(0);
    await expect(flushAllPendingExcalidrawSaves()).resolves.toBeUndefined();
  });

  it("invokes every registered flush in parallel", async () => {
    const a = vi.fn(async () => {});
    const b = vi.fn(async () => {});
    registerExcalidrawFlush("/ws/a.excalidraw", a);
    registerExcalidrawFlush("/ws/b.excalidraw", b);
    expect(__TEST_ONLY_size()).toBe(2);

    await flushAllPendingExcalidrawSaves();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("re-register for same path replaces the previous callback", async () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    registerExcalidrawFlush("/ws/x.excalidraw", first);
    registerExcalidrawFlush("/ws/x.excalidraw", second);
    expect(__TEST_ONLY_size()).toBe(1);

    await flushAllPendingExcalidrawSaves();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("unregister only deletes when we are still the current owner", () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    const unregisterFirst = registerExcalidrawFlush("/ws/y.excalidraw", first);
    // A remount registered a new flush before the old cleanup fired.
    registerExcalidrawFlush("/ws/y.excalidraw", second);
    expect(__TEST_ONLY_size()).toBe(1);
    // Old cleanup must not yank the new owner.
    unregisterFirst();
    expect(__TEST_ONLY_size()).toBe(1);
  });

  it("a single flush rejection does NOT reject the outer drain promise (best-effort contract)", async () => {
    const rejecting = vi.fn(async () => {
      throw new Error("save failed");
    });
    const ok = vi.fn(async () => {});
    registerExcalidrawFlush("/ws/bad.excalidraw", rejecting);
    registerExcalidrawFlush("/ws/good.excalidraw", ok);

    // Suppress the console.warn that flushAllPendingExcalidrawSaves
    // emits on a single failure so the test output stays clean.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(flushAllPendingExcalidrawSaves()).resolves.toBeUndefined();

    expect(rejecting).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("unregister returns and removes the entry", () => {
    const fn = vi.fn(async () => {});
    const unregister = registerExcalidrawFlush("/ws/z.excalidraw", fn);
    expect(__TEST_ONLY_size()).toBe(1);
    unregister();
    expect(__TEST_ONLY_size()).toBe(0);
  });
});
