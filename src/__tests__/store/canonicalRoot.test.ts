import { describe, it, expect, beforeEach, vi } from "vitest";
import type { MockedFunction } from "vitest";
import { useStore, openFilesFromArgs } from "@/store";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core");

const initialState = useStore.getState();
const invokeMock = invoke as MockedFunction<typeof invoke>;

beforeEach(() => {
  useStore.setState(initialState, true);
  invokeMock.mockReset();
});

describe("setRoot canonicalisation (#89 iter 3)", () => {
  it("stores the canonical long-form path returned by the IPC", async () => {
    const shortName = "C:\\Users\\RUNNER~1\\Temp\\X";
    const longName = "C:\\Users\\runneradmin\\Temp\\X";
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === "canonicalize_path") {
        expect((args as { path?: string })?.path).toBe(shortName);
        return longName;
      }
      return undefined;
    });

    await useStore.getState().setRoot(shortName);

    expect(useStore.getState().root).toBe(longName);
  });

  it("does NOT invoke canonicalize_path when root is null", async () => {
    invokeMock.mockResolvedValue(undefined);

    await useStore.getState().setRoot(null);

    expect(useStore.getState().root).toBeNull();
    const calls = invokeMock.mock.calls.filter((c) => c[0] === "canonicalize_path");
    expect(calls).toHaveLength(0);
  });

  it("falls back to the original path when canonicalize_path rejects", async () => {
    const original = "C:\\Users\\RUNNER~1\\Temp\\Y";
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "canonicalize_path") {
        throw new Error("ENOENT");
      }
      return undefined;
    });

    await useStore.getState().setRoot(original);

    expect(useStore.getState().root).toBe(original);
  });
});

describe("openFilesFromArgs canonicalisation (#89 iter 3)", () => {
  it("canonicalises folder + file paths before storing", async () => {
    const folderShort = "C:\\Users\\RUNNER~1\\Temp\\Z";
    const folderLong = "C:\\Users\\runneradmin\\Temp\\Z";
    const fileShort = "C:\\Users\\RUNNER~1\\Temp\\Z\\todelete.md";
    const fileLong = "C:\\Users\\runneradmin\\Temp\\Z\\todelete.md";
    const map: Record<string, string> = {
      [folderShort]: folderLong,
      [fileShort]: fileLong,
    };
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === "canonicalize_path") {
        const p = (args as { path?: string })?.path ?? "";
        return map[p] ?? p;
      }
      if (cmd === "register_window_file") {
        // Issue #359 — tabs.ts openFile awaits this. Honour the same
        // canonical map so the new tab lands on the long-form path
        // (matches the production flow where Rust canonicalises
        // before returning).
        const p = (args as { path?: string })?.path ?? "";
        const canonical = map[p] ?? p;
        return {
          canonical,
          classification: { tier: "inside", canonical },
        };
      }
      return undefined;
    });

    await openFilesFromArgs([fileShort], [folderShort], useStore.getState());

    expect(useStore.getState().root).toBe(folderLong);
    expect(useStore.getState().tabs.map((t) => t.path)).toEqual([fileLong]);
  });
});
