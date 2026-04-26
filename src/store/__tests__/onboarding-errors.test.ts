import { describe, it, expect } from "vitest";
import { formatOnboardingError } from "@/store/index";
import type { CliShimError } from "@/lib/tauri-commands";

/**
 * B9 — `formatOnboardingError` must exhaustively handle every tagged-enum
 * variant emitted by the onboarding IPC layer, and must not fall back to
 * `JSON.stringify` for unknown shapes (which would leak raw blobs into
 * the UI). Each `kind` × error-type pair gets one assertion.
 *
 * Today only `CliShimError` is a tagged enum. `set_default_handler` and
 * `(un)register_folder_context` reject with plain strings (`Result<(), String>`).
 * If those grow tagged enums later, add the matching describe block here.
 */
describe("formatOnboardingError", () => {
  describe("CliShimError (tagged enum)", () => {
    it("permission_denied → human-readable suggestion with path/target", () => {
      const err: CliShimError = {
        kind: "permission_denied",
        path: "/usr/local/bin/mdownreview-cli",
        target: "/Applications/mdownreview.app/Contents/MacOS/mdownreview-cli",
      };
      const msg = formatOnboardingError(err);
      expect(msg).toContain("Permission denied");
      expect(msg).toContain("/usr/local/bin/mdownreview-cli");
      expect(msg).toContain("/Applications/mdownreview.app/Contents/MacOS/mdownreview-cli");
    });

    it("io → returns the embedded message verbatim", () => {
      const err: CliShimError = { kind: "io", message: "disk full" };
      expect(formatOnboardingError(err)).toBe("disk full");
    });
  });

  describe("DefaultHandlerError (plain Result<(), String>)", () => {
    it("string rejection passes through unchanged", () => {
      expect(formatOnboardingError("LSSetDefaultRoleHandler failed: -10810")).toBe(
        "LSSetDefaultRoleHandler failed: -10810",
      );
    });
  });

  describe("FolderContextError (plain Result<(), String>)", () => {
    it("string rejection passes through unchanged", () => {
      expect(formatOnboardingError("registry write denied")).toBe(
        "registry write denied",
      );
    });
  });

  describe("non-tagged shapes", () => {
    it("Error instance → uses .message", () => {
      expect(formatOnboardingError(new Error("boom"))).toBe("boom");
    });

    it("unknown object shape → stable sentinel, NOT JSON.stringify", () => {
      // Per repo memory: tagged-enum payloads must be exhausted in the
      // switch above; any unknown object shape is a contract bug and must
      // surface a stable, non-leaking string.
      const out = formatOnboardingError({ random: "shape", nested: { x: 1 } });
      expect(out).toBe("Unexpected error");
      expect(out).not.toContain("{");
    });
  });
});
