import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useSourceHighlighting, escapeHtml } from "../useSourceHighlighting";

vi.mock("@/lib/shiki", () => ({
  getSharedHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: vi.fn().mockImplementation((code: string) => {
      const lines = code.split("\n");
      const lineSpans = lines.map(() => '<span class="line">highlighted</span>').join("\n");
      return `<pre class="shiki"><code>${lineSpans}</code></pre>`;
    }),
    getLoadedLanguages: vi.fn().mockReturnValue([]),
    loadLanguage: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe("useSourceHighlighting", () => {
  it("returns highlighted lines for given content", async () => {
    const { result } = renderHook(() =>
      useSourceHighlighting("line1\nline2\nline3", "/test.ts")
    );

    await waitFor(() => {
      expect(result.current.highlightedLines).toHaveLength(3);
    });
    expect(result.current.highlightedLines[0]).toContain("highlighted");
  });

  it("produces one highlighted line per source line", async () => {
    const { result } = renderHook(() =>
      useSourceHighlighting("a\nb", "/test.ts")
    );

    await waitFor(() => {
      expect(result.current.highlightedLines).toHaveLength(2);
    });
    expect(result.current.highlightedLines[0]).toContain("highlighted");
    expect(result.current.highlightedLines[1]).toContain("highlighted");
  });

  it("updates highlighted lines when content changes", async () => {
    const { result, rerender } = renderHook(
      ({ content, path }) => useSourceHighlighting(content, path),
      { initialProps: { content: "a", path: "/test.ts" } }
    );

    await waitFor(() => {
      expect(result.current.highlightedLines).toHaveLength(1);
    });

    rerender({ content: "a\nb\nc", path: "/test.ts" });

    await waitFor(() => {
      expect(result.current.highlightedLines).toHaveLength(3);
    });
  });

  it("updates highlighted lines when path changes", async () => {
    const { result, rerender } = renderHook(
      ({ content, path }) => useSourceHighlighting(content, path),
      { initialProps: { content: "code", path: "/test.ts" } }
    );

    await waitFor(() => {
      expect(result.current.highlightedLines).toHaveLength(1);
    });

    rerender({ content: "code", path: "/test.py" });

    await waitFor(() => {
      expect(result.current.highlightedLines).toHaveLength(1);
    });
  });

  it("does not apply stale highlight results after rapid path changes", async () => {
    const { getSharedHighlighter } = await import("@/lib/shiki");
    const mockedGet = vi.mocked(getSharedHighlighter);

    // Track call order: first call (a.ts) resolves slowly, second (b.py) resolves fast
    let callCount = 0;
    mockedGet.mockImplementation(() => {
      callCount++;
      const thisCall = callCount;
      if (thisCall === 1) {
        // First call: slow highlighter — resolves after 150ms
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                codeToHtml: vi.fn().mockReturnValue('<pre class="shiki"><code><span class="line">STALE_A_TS</span></code></pre>'),
                getLoadedLanguages: vi.fn().mockReturnValue(["typescript"]),
                loadLanguage: vi.fn().mockResolvedValue(undefined),
              } as unknown as Awaited<ReturnType<typeof import("@/lib/shiki").getSharedHighlighter>>),
            150
          )
        );
      }
      // Second call: fast highlighter — resolves immediately
      return Promise.resolve({
        codeToHtml: vi.fn().mockReturnValue('<pre class="shiki"><code><span class="line">FRESH_B_PY</span></code></pre>'),
        getLoadedLanguages: vi.fn().mockReturnValue(["python"]),
        loadLanguage: vi.fn().mockResolvedValue(undefined),
      } as unknown as Awaited<ReturnType<typeof import("@/lib/shiki").getSharedHighlighter>>);
    });

    const { result, rerender } = renderHook(
      ({ content, path }: { content: string; path: string }) =>
        useSourceHighlighting(content, path),
      { initialProps: { content: "const x = 1;", path: "a.ts" } }
    );

    // Rapidly switch to a different file before the first resolves
    rerender({ content: "print('hello')", path: "b.py" });

    // Wait for fast (b.py) result to appear
    await waitFor(
      () => {
        expect(result.current.highlightedLines.length).toBeGreaterThan(0);
      },
      { timeout: 500 }
    );

    // Now wait for the slow (a.ts) promise to also resolve — it fires at 150ms
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });

    // Result should STILL be for b.py (FRESH), not overwritten by stale a.ts
    expect(result.current.highlightedLines[0]).toContain("FRESH_B_PY");
    expect(result.current.highlightedLines[0]).not.toContain("STALE_A_TS");
  });
});

describe("escapeHtml", () => {
  it("escapes ampersands", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes angle brackets", () => {
    expect(escapeHtml("<div>")).toBe("&lt;div&gt;");
  });

  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("handles multiple special chars", () => {
    expect(escapeHtml("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
  });
});
