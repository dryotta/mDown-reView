import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useSourceHighlighting, escapeHtml } from "../useSourceHighlighting";

// Helper: build a fake `codeToTokens` return shape from raw lines, optionally
// emitting multi-token lines. Each token is `{ content, color, fontStyle }`.
function makeTokens(lines: string[][], color = "#abc123") {
  return {
    tokens: lines.map((tokensInLine) =>
      tokensInLine.map((content) => ({ content, color, fontStyle: 0 })),
    ),
    fg: "#000",
    bg: "#fff",
    themeName: "github-light",
    rootStyle: undefined,
    grammarState: undefined,
  };
}

vi.mock("@/lib/shiki", () => ({
  getSharedHighlighter: vi.fn().mockResolvedValue({
    codeToTokens: vi.fn().mockImplementation((code: string) => {
      const lines = code.split("\n");
      // Single token per line by default — the simple shape for shape tests.
      return makeTokens(lines.map((l) => [l || ""]));
    }),
    getLoadedLanguages: vi.fn().mockReturnValue(["typescript", "python"]),
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
    expect(result.current.highlightedLines[0]).toContain("line1");
    expect(result.current.highlightedLines[0]).toContain("color:");
  });

  it("produces one highlighted line per source line", async () => {
    const { result } = renderHook(() =>
      useSourceHighlighting("a\nb", "/test.ts")
    );

    await waitFor(() => {
      expect(result.current.highlightedLines).toHaveLength(2);
    });
    expect(result.current.highlightedLines[0]).toContain("a");
    expect(result.current.highlightedLines[1]).toContain("b");
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

  // Issue #94 regression — Bug RCA §5: a multi-token line MUST preserve
  // every token in the rendered HTML. The previous regex-based extractor
  // (`/<span class="line">(.*?)<\/span>/gs`) terminated at the first inner
  // `</span>` and dropped trailing tokens silently. The replacement uses
  // Shiki's structured `codeToTokens` output, so all tokens survive.
  it("preserves every token on a multi-token line (regression for #94)", async () => {
    const { getSharedHighlighter } = await import("@/lib/shiki");
    const mockedGet = vi.mocked(getSharedHighlighter);
    mockedGet.mockResolvedValueOnce({
      codeToTokens: vi
        .fn()
        .mockReturnValue(
          makeTokens([
            // const x = 1; broken into five tokens
            ["const", " ", "x", " = ", "1;"],
          ]),
        ),
      getLoadedLanguages: vi.fn().mockReturnValue(["typescript"]),
      loadLanguage: vi.fn().mockResolvedValue(undefined),
    } as unknown as Awaited<ReturnType<typeof import("@/lib/shiki").getSharedHighlighter>>);

    const { result } = renderHook(() =>
      useSourceHighlighting("const x = 1;", "/test.ts")
    );

    await waitFor(() => {
      expect(result.current.highlightedLines).toHaveLength(1);
    });

    const line = result.current.highlightedLines[0];
    // Each token becomes one `<span style="color:…">…</span>` — count
    // the styled spans. Old regex would have dropped tokens 2–5.
    const spanCount = (line.match(/<span style="color:/g) || []).length;
    expect(spanCount).toBe(5);
    expect(line).toContain("const");
    expect(line).toContain("x");
    expect(line).toContain("1;");
  });

  // Issue #94 — `text` lang (unknown extension) must still render content.
  it("falls back to escaped plain text for unmapped file types", async () => {
    const { result } = renderHook(() =>
      useSourceHighlighting("plain <text> & more\nline2", "/foo.unknownext")
    );

    await waitFor(() => {
      expect(result.current.highlightedLines).toHaveLength(2);
    });
    // HTML-escaped content, no Shiki spans (lang === "text" short-circuits).
    expect(result.current.highlightedLines[0]).toBe("plain &lt;text&gt; &amp; more");
    expect(result.current.highlightedLines[1]).toBe("line2");
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
                codeToTokens: vi
                  .fn()
                  .mockReturnValue(makeTokens([["STALE_A_TS"]])),
                getLoadedLanguages: vi.fn().mockReturnValue(["typescript"]),
                loadLanguage: vi.fn().mockResolvedValue(undefined),
              } as unknown as Awaited<ReturnType<typeof import("@/lib/shiki").getSharedHighlighter>>),
            150
          )
        );
      }
      // Second call: fast highlighter — resolves immediately
      return Promise.resolve({
        codeToTokens: vi
          .fn()
          .mockReturnValue(makeTokens([["FRESH_B_PY"]])),
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
