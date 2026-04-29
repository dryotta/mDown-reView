import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveBootstrapTheme, STORAGE_KEY, type BootstrapDeps } from "@/lib/theme-bootstrap";

const deps = (raw: string | null | (() => never), prefersDark: boolean): BootstrapDeps => ({
  readPersisted: typeof raw === "function" ? raw : () => raw,
  prefersDark: () => prefersDark,
});

describe("resolveBootstrapTheme", () => {
  it('returns stored "light" verbatim regardless of OS preference', () => {
    const persisted = JSON.stringify({ state: { theme: "light" } });
    expect(resolveBootstrapTheme(deps(persisted, true))).toBe("light");
  });

  it('returns stored "dark" verbatim regardless of OS preference', () => {
    const persisted = JSON.stringify({ state: { theme: "dark" } });
    expect(resolveBootstrapTheme(deps(persisted, false))).toBe("dark");
  });

  it('resolves stored "system" via prefers-color-scheme (dark)', () => {
    const persisted = JSON.stringify({ state: { theme: "system" } });
    expect(resolveBootstrapTheme(deps(persisted, true))).toBe("dark");
  });

  it('resolves stored "system" via prefers-color-scheme (light)', () => {
    const persisted = JSON.stringify({ state: { theme: "system" } });
    expect(resolveBootstrapTheme(deps(persisted, false))).toBe("light");
  });

  it("resolves an unknown theme value via OS preference", () => {
    const persisted = JSON.stringify({ state: { theme: "neon" } });
    expect(resolveBootstrapTheme(deps(persisted, true))).toBe("dark");
    expect(resolveBootstrapTheme(deps(persisted, false))).toBe("light");
  });

  it("falls back to OS preference when the persisted key is missing", () => {
    expect(resolveBootstrapTheme(deps(null, true))).toBe("dark");
    expect(resolveBootstrapTheme(deps(null, false))).toBe("light");
  });

  it("falls back to OS preference when state.theme is absent", () => {
    const persisted = JSON.stringify({ state: {} });
    expect(resolveBootstrapTheme(deps(persisted, true))).toBe("dark");
    expect(resolveBootstrapTheme(deps(persisted, false))).toBe("light");
  });

  it("propagates JSON parse errors to the caller (which catches and falls back)", () => {
    // The inline FOUC <script> wraps the whole resolve in try/catch and
    // returns "dark" on any throw. This test pins that contract by
    // asserting the throw, not the (impossible) "should not throw" path.
    expect(() => resolveBootstrapTheme(deps("not-json", false))).toThrow(SyntaxError);
  });

  it("propagates localStorage getter throws to the caller", () => {
    expect(() =>
      resolveBootstrapTheme(
        deps(() => {
          throw new Error("denied");
        }, false)
      )
    ).toThrow("denied");
  });
});

describe("FOUC <script> drift guard", () => {
  it("index.html still references the same persist key", () => {
    // If the inline FOUC script's storage-key string drifts from
    // STORAGE_KEY (e.g. on a Zustand persist rename), the bootstrap
    // silently breaks. This guard catches that the moment it ships.
    const indexHtml = readFileSync(join(__dirname, "..", "..", "..", "index.html"), "utf8");
    expect(indexHtml).toContain(`localStorage.getItem("${STORAGE_KEY}")`);
  });
});
