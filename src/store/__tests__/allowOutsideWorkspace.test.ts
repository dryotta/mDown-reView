/**
 * Issue #338 / Group B-foundation — `allowOutsideWorkspace` slice contract.
 *
 * Locks down:
 *   1. State mutations (allow / disallow) update the Set.
 *   2. The persistence allowlist excludes `allowOutsideWorkspace` so trust
 *      decisions cannot silently survive an app restart (security-expert
 *      finding for #338, mirrors `allowedRemoteImageDocs`).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useStore } from "@/store";
import { invoke } from "@tauri-apps/api/core";

beforeEach(() => {
  useStore.setState({ allowOutsideWorkspace: new Set<string>() } as never);
});

describe("allowOutsideWorkspace slice", () => {
  it("allowOutsideForTab adds the tabPath", () => {
    useStore.getState().allowOutsideForTab("/ws/a.md");
    expect(useStore.getState().allowOutsideWorkspace.has("/ws/a.md")).toBe(true);
  });

  it("disallowOutsideForTab removes the tabPath", () => {
    useStore.getState().allowOutsideForTab("/ws/a.md");
    useStore.getState().disallowOutsideForTab("/ws/a.md");
    expect(useStore.getState().allowOutsideWorkspace.has("/ws/a.md")).toBe(false);
  });

  it("per-tab independence: allow on /a does not leak into /b", () => {
    useStore.getState().allowOutsideForTab("/ws/a.md");
    expect(useStore.getState().allowOutsideWorkspace.has("/ws/b.md")).toBe(false);
  });

  it("re-allow is idempotent (no spurious state churn)", () => {
    useStore.getState().allowOutsideForTab("/ws/a.md");
    const before = useStore.getState().allowOutsideWorkspace;
    useStore.getState().allowOutsideForTab("/ws/a.md");
    const after = useStore.getState().allowOutsideWorkspace;
    expect(after).toBe(before);
  });
});

describe("allowOutsideWorkspace persistence allowlist", () => {
  // Mirror the strategy used in `viewerPrefs.test.ts`: the persistence
  // allowlist lives inline in `src/store/index.ts`, so we string-match
  // the partialize body. This keeps drift visible without coupling to
  // Zustand persist internals.
  const storeIndex = readFileSync(resolve(process.cwd(), "src/store/index.ts"), "utf8");
  const partializeBody =
    storeIndex.match(/partialize:\s*\(state\)\s*=>\s*\(\{([\s\S]*?)\}\)/)?.[1] ?? "";

  it("excludes allowOutsideWorkspace (session-only trust — must not survive restart)", () => {
    expect(partializeBody.length).toBeGreaterThan(0);
    expect(partializeBody).not.toMatch(/allowOutsideWorkspace/);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Issue #359 / AC3 — extendScopeForTab atomic IPC + flag-flip contract.
// ────────────────────────────────────────────────────────────────────────
describe("extendScopeForTab (issue #359 / AC3)", () => {
  const invokeMock = vi.mocked(invoke);

  beforeEach(() => {
    useStore.setState({ allowOutsideWorkspace: new Set<string>() } as never);
  });
  afterEach(() => {
    invokeMock.mockClear();
  });

  it("awaits IPC before flipping the allow flag", async () => {
    let resolveExtend: () => void = () => {};
    invokeMock.mockImplementationOnce(
      (cmd) =>
        new Promise<undefined>((res) => {
          if (cmd !== "extend_window_scope_files") {
            res(undefined);
            return;
          }
          resolveExtend = () => res(undefined);
        }),
    );
    const p = useStore.getState().extendScopeForTab("/ws/a.md");
    // Flag must NOT flip while IPC is in flight.
    expect(useStore.getState().allowOutsideWorkspace.has("/ws/a.md")).toBe(false);
    resolveExtend();
    await p;
    // After IPC resolves, the flag is set.
    expect(useStore.getState().allowOutsideWorkspace.has("/ws/a.md")).toBe(true);
  });

  it("on IPC reject does NOT flip the flag and rethrows", async () => {
    invokeMock.mockImplementationOnce(async (cmd) => {
      if (cmd === "extend_window_scope_files") throw "system path blocked";
      return undefined;
    });
    await expect(
      useStore.getState().extendScopeForTab("/sys/x.md"),
    ).rejects.toBeDefined();
    // Flag must remain unset so the banner stays visible.
    expect(useStore.getState().allowOutsideWorkspace.has("/sys/x.md")).toBe(false);
  });
});
