import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRecentItemStatus } from "@/hooks/useRecentItemStatus";
import * as commands from "@/lib/tauri-commands";
import type { RecentItem } from "@/store";

vi.mock("@/lib/tauri-commands");
vi.mock("@/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeItem(path: string, type: "file" | "folder" = "file"): RecentItem {
  return { path, type, timestamp: Date.now() };
}

describe("useRecentItemStatus", () => {
  it("returns status for all items", async () => {
    vi.mocked(commands.checkPathExists).mockImplementation(async (path) => {
      if (path === "/a.md") return "file";
      if (path === "/b") return "dir";
      return "missing";
    });

    const items = [makeItem("/a.md"), makeItem("/b", "folder"), makeItem("/c.md")];
    const { result } = renderHook(() => useRecentItemStatus(items));

    await act(async () => {});

    expect(result.current).toEqual({
      "/a.md": "file",
      "/b": "dir",
      "/c.md": "missing",
    });
  });

  it('returns "missing" on error', async () => {
    vi.mocked(commands.checkPathExists).mockRejectedValue(new Error("access denied"));

    const items = [makeItem("/restricted.md")];
    const { result } = renderHook(() => useRecentItemStatus(items));

    await act(async () => {});

    expect(result.current).toEqual({ "/restricted.md": "missing" });
  });

  it("returns empty object when no recent items", async () => {
    const { result } = renderHook(() => useRecentItemStatus([]));

    await act(async () => {});

    expect(result.current).toEqual({});
    expect(commands.checkPathExists).not.toHaveBeenCalled();
  });
});
