/**
 * Issue #352 / iter-12 — regression tests for `friendlySaveError`.
 *
 * Locks the typed `WorkspaceWriteError` → user-facing copy contract.
 * If the Rust enum gains a new variant (via tauri-specta regen), the
 * `switch` in `error-mapping.ts` becomes non-exhaustive and TypeScript
 * fails to compile — this suite then locks the user-visible copy.
 */

import { describe, expect, it } from "vitest";

import { friendlySaveError, isWorkspaceWriteError } from "../error-mapping";

describe("friendlySaveError", () => {
  it("maps outside-workspace to read-only / open-folder hint", () => {
    expect(
      friendlySaveError({ kind: "outside-workspace", path: "/tmp/foo.excalidraw" }),
    ).toMatch(/outside your workspace/);
  });

  it("maps ext-not-allowed to a non-developer message", () => {
    expect(
      friendlySaveError({ kind: "ext-not-allowed", filename: "secret.txt" }),
    ).toMatch(/can't be saved/);
  });

  it("maps filename-invalid with NTFS ADS reason to colon hint", () => {
    expect(
      friendlySaveError({ kind: "filename-invalid", reason: "':' is forbidden (NTFS ADS)" }),
    ).toMatch(/forbidden character.*rename/i);
  });

  it("maps generic filename-invalid to the raw reason", () => {
    expect(
      friendlySaveError({ kind: "filename-invalid", reason: "no UTF-8 component" }),
    ).toMatch(/Invalid filename: no UTF-8 component/);
  });

  it("formats payload-too-large as MB", () => {
    expect(
      friendlySaveError({ kind: "payload-too-large", observed_bytes: 12_582_912 }),
    ).toMatch(/12 MB > 10 MB limit/);
  });

  it("maps invalid-base-64 to corruption hint", () => {
    expect(
      friendlySaveError({ kind: "invalid-base-64", detail: "bad char" }),
    ).toMatch(/corrupted scene.*Reload/i);
  });

  it("maps io to the raw message (developer-debuggable)", () => {
    expect(
      friendlySaveError({ kind: "io", message: "ENOSPC" }),
    ).toBe("ENOSPC");
  });

  it("falls through Error → message", () => {
    expect(friendlySaveError(new Error("plain JS error"))).toBe("plain JS error");
  });

  it("falls through string verbatim", () => {
    expect(friendlySaveError("raw string")).toBe("raw string");
  });

  it("stringifies non-typed objects", () => {
    expect(friendlySaveError({ random: "thing" })).toBe("[object Object]");
  });
});

describe("isWorkspaceWriteError", () => {
  it("recognises typed errors with a kind discriminator", () => {
    expect(
      isWorkspaceWriteError({ kind: "outside-workspace", path: "x" }),
    ).toBe(true);
  });

  it("rejects Error instances", () => {
    expect(isWorkspaceWriteError(new Error("x"))).toBe(false);
  });

  it("rejects strings, null, undefined", () => {
    expect(isWorkspaceWriteError("x")).toBe(false);
    expect(isWorkspaceWriteError(null)).toBe(false);
    expect(isWorkspaceWriteError(undefined)).toBe(false);
  });

  it("rejects objects without a string kind", () => {
    expect(isWorkspaceWriteError({})).toBe(false);
    expect(isWorkspaceWriteError({ kind: 123 })).toBe(false);
  });
});
