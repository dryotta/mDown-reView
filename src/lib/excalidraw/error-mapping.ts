/**
 * Issue #352 / iter-12 — friendly Rust→user error mapping for the
 * workspace-write IPC.
 *
 * The Rust `write_workspace_text` / `write_workspace_binary` commands
 * return a typed `WorkspaceWriteError` enum (discriminated by `kind`)
 * via tauri-specta. The renderer branches on the discriminator instead
 * of substring-matching prose — a future tweak to the error layout
 * cannot silently degrade UX (rule `architecture-rust-first` in
 * `docs/architecture.md`).
 *
 * `String` fallback covers two minor cases:
 *   1. Hot-path errors thrown outside the IPC layer (e.g. JS thrown
 *      from `serializeAsJSON`) — no `kind` discriminator available.
 *   2. Bindings-drift safety: if `bindings.ts` and Rust go out of sync
 *      mid-rebase the renderer keeps degrading-not-crashing.
 */

import type { WorkspaceWriteError } from "@/lib/bindings";

/**
 * Type-narrow predicate for a typed workspace-write error.
 */
export function isWorkspaceWriteError(
  err: unknown,
): err is WorkspaceWriteError {
  return (
    typeof err === "object" &&
    err !== null &&
    "kind" in err &&
    typeof (err as { kind: unknown }).kind === "string"
  );
}

/**
 * Map a workspace-write error (typed enum or fallback Error / string)
 * to user-facing copy.
 */
export function friendlySaveError(err: unknown): string {
  if (isWorkspaceWriteError(err)) {
    switch (err.kind) {
      case "outside-workspace":
        return "This file is outside your workspace and is read-only. Open its containing folder to save.";
      case "ext-not-allowed":
        return "This file type can't be saved by mdownreview.";
      case "filename-invalid":
        if (err.reason.includes("NTFS ADS")) {
          return "Filename contains a forbidden character (`:`) — rename and retry.";
        }
        return `Invalid filename: ${err.reason}`;
      case "payload-too-large": {
        const mb = Math.round(err.observed_bytes / (1024 * 1024));
        return `Drawing too large to save (${mb} MB > 10 MB limit). Try removing embedded images or splitting the drawing.`;
      }
      case "invalid-base-64":
        return "Failed to encode the drawing for save (corrupted scene). Reload the file and try again.";
      case "io":
        return err.message;
    }
  }
  // Fallback: stringified error / Error / unknown.
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

