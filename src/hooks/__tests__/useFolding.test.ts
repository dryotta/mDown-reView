import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { computeFoldRegions } from "@/lib/tauri-commands";
import { useFolding } from "../useFolding";

vi.mock("@/lib/tauri-commands", () => ({
  computeFoldRegions: vi.fn(async (content: string) => {
    // Minimal in-test brace folder so the hook returns realistic data without
    // touching the real IPC. Mirrors the Rust implementation just enough.
    const lines = content.split("\n");
    const regions: { startLine: number; endLine: number }[] = [];
    const stack: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === "{") stack.push(i + 1);
        else if (ch === "}" && stack.length) {
          const start = stack.pop()!;
          const end = i + 1;
          if (end - start >= 2) regions.push({ startLine: start, endLine: end });
        }
      }
    }
    return regions;
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useFolding", () => {
  const braceLines = [
    "function foo() {",
    "  const x = 1;",
    "  const y = 2;",
    "}",
  ];

  it("computes foldStartMap from lines with braces", async () => {
    const { result } = renderHook(() => useFolding(braceLines, "/test.ts"));
    await waitFor(() => {
      expect(result.current.foldStartMap.size).toBeGreaterThan(0);
    });
    const region = result.current.foldStartMap.get(1);
    expect(region).toBeDefined();
    expect(region!.startLine).toBe(1);
    expect(region!.endLine).toBe(4);
  });

  it("starts with no collapsed lines", async () => {
    const { result } = renderHook(() => useFolding(braceLines, "/test.ts"));
    await act(async () => {});
    expect(result.current.collapsedLines.size).toBe(0);
  });

  it("toggleFold collapses and expands a line", async () => {
    const { result } = renderHook(() => useFolding(braceLines, "/test.ts"));
    await waitFor(() => {
      expect(result.current.foldStartMap.size).toBeGreaterThan(0);
    });

    act(() => result.current.toggleFold(1));
    expect(result.current.collapsedLines.has(1)).toBe(true);

    act(() => result.current.toggleFold(1));
    expect(result.current.collapsedLines.has(1)).toBe(false);
  });

  it("resets collapsed lines when filePath changes", async () => {
    const { result, rerender } = renderHook(
      ({ lines, path }) => useFolding(lines, path),
      { initialProps: { lines: braceLines, path: "/a.ts" } }
    );
    await waitFor(() => {
      expect(result.current.foldStartMap.size).toBeGreaterThan(0);
    });

    act(() => result.current.toggleFold(1));
    expect(result.current.collapsedLines.has(1)).toBe(true);

    rerender({ lines: braceLines, path: "/b.ts" });
    await waitFor(() => {
      expect(result.current.collapsedLines.size).toBe(0);
    });
  });

  it("returns empty foldStartMap for flat lines", async () => {
    const flatLines = ["a", "b", "c"];
    const { result } = renderHook(() => useFolding(flatLines, "/test.txt"));
    await act(async () => {});
    expect(result.current.foldStartMap.size).toBe(0);
  });

  it("derives the language hint from the file extension", async () => {
    renderHook(() => useFolding(["x: 1", "y: 2"], "/foo.yaml"));
    await waitFor(() => {
      expect(computeFoldRegions).toHaveBeenCalled();
    });
    expect(computeFoldRegions).toHaveBeenCalledWith("x: 1\ny: 2", "yaml");
  });
});
