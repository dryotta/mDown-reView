import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSearch } from "../useSearch";

describe("useSearch", () => {
  it("returns empty matches for empty query", () => {
    const { result } = renderHook(() => useSearch("hello world"));
    expect(result.current.matches).toEqual([]);
    expect(result.current.currentIndex).toBe(-1);
  });

  it("finds all matches case-insensitively", () => {
    const { result } = renderHook(() => useSearch("foo bar Foo BAR foo"));
    act(() => result.current.setQuery("foo"));
    expect(result.current.matches).toHaveLength(3);
    expect(result.current.matches[0]).toEqual({ lineIndex: 0, startCol: 0, endCol: 3 });
    expect(result.current.matches[1]).toEqual({ lineIndex: 0, startCol: 8, endCol: 11 });
    expect(result.current.matches[2]).toEqual({ lineIndex: 0, startCol: 16, endCol: 19 });
    expect(result.current.currentIndex).toBe(0);
  });

  it("finds matches across multiple lines", () => {
    const { result } = renderHook(() => useSearch("line1 x\nline2 x\nline3"));
    act(() => result.current.setQuery("x"));
    expect(result.current.matches).toHaveLength(2);
    expect(result.current.matches[0].lineIndex).toBe(0);
    expect(result.current.matches[1].lineIndex).toBe(1);
  });

  it("navigates forward with next()", () => {
    const { result } = renderHook(() => useSearch("a a a"));
    act(() => result.current.setQuery("a"));
    expect(result.current.currentIndex).toBe(0);
    act(() => result.current.next());
    expect(result.current.currentIndex).toBe(1);
    act(() => result.current.next());
    expect(result.current.currentIndex).toBe(2);
    act(() => result.current.next());
    expect(result.current.currentIndex).toBe(0); // wraps
  });

  it("navigates backward with prev()", () => {
    const { result } = renderHook(() => useSearch("a a a"));
    act(() => result.current.setQuery("a"));
    act(() => result.current.prev());
    expect(result.current.currentIndex).toBe(2); // wraps back
  });

  it("resets currentIndex when query changes", () => {
    const { result } = renderHook(() => useSearch("foo bar"));
    act(() => result.current.setQuery("foo"));
    act(() => result.current.next());
    act(() => result.current.setQuery("bar"));
    expect(result.current.currentIndex).toBe(0);
  });
});
