import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { searchInDocument } from "@/lib/tauri-commands";
import { useSearch } from "../useSearch";

vi.mock("@/lib/tauri-commands", () => ({
  searchInDocument: vi.fn(async (content: string, query: string) => {
    if (!query) return [];
    const results: Array<{ lineIndex: number; startCol: number; endCol: number }> = [];
    const lines = content.split("\n");
    const lowerQuery = query.toLowerCase();
    for (let i = 0; i < lines.length; i++) {
      const lowerLine = lines[i].toLowerCase();
      let pos = 0;
      while (pos <= lowerLine.length - lowerQuery.length) {
        const idx = lowerLine.indexOf(lowerQuery, pos);
        if (idx === -1) break;
        results.push({ lineIndex: i, startCol: idx, endCol: idx + query.length });
        pos = idx + 1;
      }
    }
    return results;
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useSearch", () => {
  it("returns empty matches for empty query", async () => {
    const { result } = renderHook(() => useSearch("hello world"));
    await act(async () => {});
    expect(result.current.matches).toEqual([]);
    expect(result.current.currentIndex).toBe(-1);
  });

  it("finds all matches case-insensitively", async () => {
    const { result } = renderHook(() => useSearch("foo bar Foo BAR foo"));
    act(() => result.current.setQuery("foo"));
    await waitFor(() => {
      expect(result.current.matches).toHaveLength(3);
    });
    expect(result.current.matches[0]).toEqual({ lineIndex: 0, startCol: 0, endCol: 3 });
    expect(result.current.matches[1]).toEqual({ lineIndex: 0, startCol: 8, endCol: 11 });
    expect(result.current.matches[2]).toEqual({ lineIndex: 0, startCol: 16, endCol: 19 });
    expect(result.current.currentIndex).toBe(0);
  });

  it("finds matches across multiple lines", async () => {
    const { result } = renderHook(() => useSearch("line1 x\nline2 x\nline3"));
    act(() => result.current.setQuery("x"));
    await waitFor(() => {
      expect(result.current.matches).toHaveLength(2);
    });
    expect(result.current.matches[0].lineIndex).toBe(0);
    expect(result.current.matches[1].lineIndex).toBe(1);
  });

  it("navigates forward with next()", async () => {
    const { result } = renderHook(() => useSearch("a a a"));
    act(() => result.current.setQuery("a"));
    await waitFor(() => {
      expect(result.current.matches).toHaveLength(3);
    });
    expect(result.current.currentIndex).toBe(0);
    act(() => result.current.next());
    expect(result.current.currentIndex).toBe(1);
    act(() => result.current.next());
    expect(result.current.currentIndex).toBe(2);
    act(() => result.current.next());
    expect(result.current.currentIndex).toBe(0); // wraps
  });

  it("navigates backward with prev()", async () => {
    const { result } = renderHook(() => useSearch("a a a"));
    act(() => result.current.setQuery("a"));
    await waitFor(() => {
      expect(result.current.matches).toHaveLength(3);
    });
    act(() => result.current.prev());
    expect(result.current.currentIndex).toBe(2); // wraps back
  });

  it("resets currentIndex when query changes", async () => {
    const { result } = renderHook(() => useSearch("foo bar"));
    act(() => result.current.setQuery("foo"));
    await waitFor(() => {
      expect(result.current.matches).toHaveLength(1);
    });
    act(() => result.current.next());
    act(() => result.current.setQuery("bar"));
    await waitFor(() => {
      expect(result.current.matches).toHaveLength(1);
    });
    expect(result.current.currentIndex).toBe(0);
  });

  it("exposes isPending as a boolean", async () => {
    const { result } = renderHook(() => useSearch("hello world"));
    await act(async () => {});
    expect(typeof result.current.isPending).toBe("boolean");
    expect(result.current.isPending).toBe(false);
  });

  it("updates query immediately while deferring matches via transition", async () => {
    const { result } = renderHook(() => useSearch("hello world"));
    act(() => result.current.setQuery("hello"));
    expect(result.current.query).toBe("hello");
    await waitFor(() => {
      expect(result.current.matches).toHaveLength(1);
    });
    expect(result.current.isPending).toBe(false);
  });

  it("clears matches and resets isPending when query is cleared", async () => {
    const { result } = renderHook(() => useSearch("abc def abc"));
    act(() => result.current.setQuery("abc"));
    await waitFor(() => {
      expect(result.current.matches).toHaveLength(2);
    });
    act(() => result.current.setQuery(""));
    await waitFor(() => {
      expect(result.current.matches).toEqual([]);
    });
    expect(result.current.currentIndex).toBe(-1);
    expect(result.current.isPending).toBe(false);
  });

  it("calls searchInDocument IPC with content and query", async () => {
    const { result } = renderHook(() => useSearch("test content"));
    act(() => result.current.setQuery("test"));
    await waitFor(() => {
      expect(result.current.matches).toHaveLength(1);
    });
    expect(searchInDocument).toHaveBeenCalledWith("test content", "test");
  });
});
