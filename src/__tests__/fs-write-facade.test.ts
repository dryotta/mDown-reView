/**
 * Issue #352 iter 1 — façade-consumer smoke for the workspace-write IPC.
 *
 * The bindings layer (`src/lib/bindings.ts`) auto-generates wrappers
 * around `write_workspace_text` / `write_workspace_binary`. The façade
 * (`src/lib/tauri-commands.ts`) re-exports them as `writeWorkspaceText`
 * / `writeWorkspaceBinary`, unwrapping `Result<null, string>` to
 * `Promise<void>`. The static parity scan at
 * `src/__tests__/ipc-mock-parity.test.ts` only checks that EXPLICIT
 * arms in either mock layer are mirrored in the other — it does NOT
 * exercise the façade. This test consumes the façade end-to-end so
 * a hypothetical deletion of `writeWorkspaceText` from
 * `tauri-commands.ts` will fail at compile/runtime, not silently slide.
 *
 * Caller wiring lands in iter 2/3 (`ExcalidrawView` + `useExcalidrawSession`);
 * this iter-1 smoke locks the contract until then.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { writeWorkspaceText, writeWorkspaceBinary } from "@/lib/tauri-commands";

vi.mock("@tauri-apps/api/core");

// The Vitest setup auto-mocks `@tauri-apps/api/core` via
// `src/__mocks__/@tauri-apps/api/core.ts` (where `invoke` is a `vi.fn`);
// both `write_workspace_text` and `write_workspace_binary` arms return
// `undefined`, which the auto-generated bindings interpret as
// `{ status: "ok", data: null }` per tauri-specta's wire shape.

describe("fs_write façade — iter 1 (issue #352)", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
  });

  it("writeWorkspaceText round-trips via the IPC mock with `path` + `text` args", async () => {
    await expect(
      writeWorkspaceText("/ws/scene.excalidraw", '{"v":1}'),
    ).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("write_workspace_text", {
      path: "/ws/scene.excalidraw",
      text: '{"v":1}',
    });
  });

  it("writeWorkspaceBinary round-trips via the IPC mock with `path` + `base64` args", async () => {
    await expect(
      writeWorkspaceBinary("/ws/scene.excalidraw.png", "AAAA"),
    ).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("write_workspace_binary", {
      path: "/ws/scene.excalidraw.png",
      base64: "AAAA",
    });
  });
});
