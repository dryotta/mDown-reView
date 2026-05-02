import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import {
  useSourceHighlighting,
  escapeHtml,
  loadLanguageWithRetry,
  splitShikiHtmlByLine,
  sampleHash,
} from "../useSourceHighlighting";

vi.mock("@/lib/shiki", () => ({
  getSharedHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: vi.fn().mockImplementation((code: string) => {
      const lines = code.split("\n");
      const lineSpans = lines
        .map(() => '<span class="line">highlighted</span>')
        .join("\n");
      return `<pre class="shiki"><code>${lineSpans}</code></pre>`;
    }),
    getLoadedLanguages: vi.fn().mockReturnValue([]),
    loadLanguage: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe("useSourceHighlighting", () => {
  it("seeds plain text immediately, then upgrades to Shiki highlighting", async () => {
    const { result } = renderHook(() =>
      useSourceHighlighting("line1\nline2\nline3", "/test.ts")
    );

    await waitFor(() => {
      expect(result.current.highlightedLines).toHaveLength(3);
    });
    await waitFor(() => {
      expect(result.current.highlightedLines[0]).toContain("highlighted");
    });
  });

  it("produces one highlighted line per source line", async () => {
    const { result } = renderHook(() =>
      useSourceHighlighting("a\nb", "/test.ts")
    );

    await waitFor(() => {
      expect(result.current.highlightedLines).toHaveLength(2);
    });
    await waitFor(() => {
      expect(result.current.highlightedLines[0]).toContain("highlighted");
      expect(result.current.highlightedLines[1]).toContain("highlighted");
    });
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

    let callCount = 0;
    mockedGet.mockImplementation(() => {
      callCount++;
      const thisCall = callCount;
      if (thisCall === 1) {
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                codeToHtml: vi
                  .fn()
                  .mockReturnValue(
                    '<pre class="shiki"><code><span class="line">STALE_A_TS</span></code></pre>'
                  ),
                getLoadedLanguages: vi.fn().mockReturnValue(["typescript"]),
                loadLanguage: vi.fn().mockResolvedValue(undefined),
              } as unknown as Awaited<
                ReturnType<typeof import("@/lib/shiki").getSharedHighlighter>
              >),
            150
          )
        );
      }
      return Promise.resolve({
        codeToHtml: vi
          .fn()
          .mockReturnValue(
            '<pre class="shiki"><code><span class="line">FRESH_B_PY</span></code></pre>'
          ),
        getLoadedLanguages: vi.fn().mockReturnValue(["python"]),
        loadLanguage: vi.fn().mockResolvedValue(undefined),
      } as unknown as Awaited<
        ReturnType<typeof import("@/lib/shiki").getSharedHighlighter>
      >);
    });

    const { result, rerender } = renderHook(
      ({ content, path }: { content: string; path: string }) =>
        useSourceHighlighting(content, path),
      { initialProps: { content: "const x = 1;", path: "a.ts" } }
    );

    rerender({ content: "print('hello')", path: "b.py" });

    await waitFor(
      () => {
        expect(result.current.highlightedLines[0]).toContain("FRESH_B_PY");
      },
      { timeout: 500 }
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });

    expect(result.current.highlightedLines[0]).toContain("FRESH_B_PY");
    expect(result.current.highlightedLines[0]).not.toContain("STALE_A_TS");
  });

  it("preserves all tokens in multi-token lines (regression: broken regex truncation)", async () => {
    const { getSharedHighlighter } = await import("@/lib/shiki");

    const multiTokenHtml =
      '<pre class="shiki github-light" style="background-color:#fff"><code>' +
      '<span class="line"><span style="color:#CF222E">const</span><span style="color:#953800"> x</span><span style="color:#CF222E"> =</span><span style="color:#0550AE"> 1</span><span style="color:#24292F">;</span></span>\n' +
      '<span class="line"><span style="color:#CF222E">let</span><span style="color:#953800"> y</span><span style="color:#CF222E"> =</span><span style="color:#0550AE"> 2</span><span style="color:#24292F">;</span></span>' +
      "</code></pre>";

    const mockHl = {
      getLoadedLanguages: () => ["typescript"],
      loadLanguage: vi.fn(),
      codeToHtml: () => multiTokenHtml,
    };
    vi.mocked(getSharedHighlighter).mockResolvedValue(
      mockHl as unknown as Awaited<ReturnType<typeof getSharedHighlighter>>
    );

    const { result } = renderHook(() =>
      useSourceHighlighting("const x = 1;\nlet y = 2;", "test.ts")
    );

    await waitFor(() => {
      const line1 = result.current.highlightedLines[0] ?? "";
      expect(line1).toContain('<span style="color:#CF222E">const</span>');
    });

    const line1 = result.current.highlightedLines[0];
    expect(line1).toContain("const");
    expect(line1).toContain(" x");
    expect(line1).toContain(" =");
    expect(line1).toContain(" 1");
    expect(line1).toContain(";");
    expect((line1.match(/<span /g) ?? []).length).toBeGreaterThanOrEqual(4);

    const line2 = result.current.highlightedLines[1];
    expect(line2).toContain("let");
    expect(line2).toContain(" y");
    expect(line2).toContain(" =");
    expect(line2).toContain(" 2");
  });

  it("first paint shows plain text (escaped) before Shiki upgrade lands", async () => {
    const { getSharedHighlighter } = await import("@/lib/shiki");

    // Block Shiki indefinitely so we can observe the plain-text seed.
    const blockedPromise = new Promise<never>(() => {});
    vi.mocked(getSharedHighlighter).mockReturnValue(
      blockedPromise as unknown as ReturnType<typeof getSharedHighlighter>
    );

    const { result } = renderHook(() =>
      useSourceHighlighting("a < b\n& c", "/test.ts")
    );

    await waitFor(() => {
      expect(result.current.highlightedLines).toHaveLength(2);
    });

    expect(result.current.highlightedLines[0]).toBe("a &lt; b");
    expect(result.current.highlightedLines[1]).toBe("&amp; c");
  });

  // Regression for the rubber-duck critique on PR #354 iter-2: the original
  // fingerprint = `${path}::${theme}::${lineCount}` mis-validated the
  // overlay when the same path is reloaded with same-length but different
  // content (watcher reload of an in-place edit). Verifies the hash-bearing
  // fingerprint discards the stale overlay.
  it("invalidates stale Shiki output when same-path same-line-count content changes", async () => {
    const { getSharedHighlighter } = await import("@/lib/shiki");

    let html = '<pre class="shiki"><code><span class="line">FIRST</span></code></pre>';
    const codeToHtml = vi.fn(() => html);
    vi.mocked(getSharedHighlighter).mockResolvedValue({
      codeToHtml,
      getLoadedLanguages: () => ["typescript"],
      loadLanguage: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof getSharedHighlighter>>);

    const { result, rerender } = renderHook(
      ({ content, path }: { content: string; path: string }) =>
        useSourceHighlighting(content, path),
      { initialProps: { content: "AAA", path: "/test.ts" } }
    );

    await waitFor(() => {
      expect(result.current.highlightedLines[0]).toContain("FIRST");
    });

    // Same path, same length, completely different content.
    html = '<pre class="shiki"><code><span class="line">SECOND</span></code></pre>';
    rerender({ content: "ZZZ", path: "/test.ts" });

    await waitFor(() => {
      // The renderer should NOT show "FIRST" against "ZZZ" content.
      // Plain-text fallback ("ZZZ") is acceptable; the new "SECOND"
      // overlay is acceptable; stale "FIRST" is the bug we're catching.
      const html0 = result.current.highlightedLines[0];
      expect(html0).not.toContain("FIRST");
    });
  });
});

describe("splitShikiHtmlByLine", () => {
  it("splits well-formed Shiki output into per-line fragments", () => {
    const html =
      '<pre class="shiki"><code>' +
      '<span class="line"><span>a</span></span>\n' +
      '<span class="line"><span>b</span></span>' +
      "</code></pre>";
    const out = splitShikiHtmlByLine(html);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe("<span>a</span>");
    expect(out[1]).toBe("<span>b</span>");
  });

  it("returns an empty array when the blob has no line markers", () => {
    expect(splitShikiHtmlByLine("<pre><code>plain</code></pre>")).toEqual([]);
  });
});

describe("sampleHash", () => {
  it("differs for same-length, same-prefix, different-content strings", () => {
    // Catches the original same-path + same-line-count + different-content
    // bug — the rubber-duck critique on PR #354 iter-2.
    const a = "x".repeat(100) + "alpha" + "x".repeat(100);
    const b = "x".repeat(100) + "OMEGA" + "x".repeat(100); // same length
    expect(a.length).toBe(b.length);
    expect(sampleHash(a)).not.toBe(sampleHash(b));
  });

  it("is stable for identical strings", () => {
    expect(sampleHash("abc")).toBe(sampleHash("abc"));
    expect(sampleHash("")).toBe(sampleHash(""));
  });

  it("differs when length differs", () => {
    expect(sampleHash("abc")).not.toBe(sampleHash("abcd"));
  });

  // Iter 2 of #252 / test-expert review: the original sample-step-only hash
  // collided when a same-length 5 MB file mutated only at indices that the
  // stride skipped. The fix hashes every byte, so any mid-file mutation —
  // even a single-byte flip at an arbitrary position — produces a
  // different hash.
  it("detects single-byte mid-file mutations at arbitrary positions", () => {
    const a = "x".repeat(5000);
    // Pick a position that the previous stride-sampling algorithm skipped
    // (step=5 starting at 256, so 2501 is unsampled). The current
    // every-byte hash MUST detect it.
    const b = a.substring(0, 2501) + "Y" + a.substring(2502);
    expect(a.length).toBe(b.length);
    expect(sampleHash(a)).not.toBe(sampleHash(b));
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

describe("loadLanguageWithRetry", () => {
  it("returns true on first-attempt success", async () => {
    const loadedLangs: string[] = [];
    const hl = {
      loadLanguage: vi.fn().mockImplementation(async (lang: string) => {
        loadedLangs.push(
          typeof lang === "string" ? lang : (lang as { name: string }).name
        );
      }),
      getLoadedLanguages: vi.fn().mockImplementation(() => loadedLangs),
    } as unknown as import("shiki").Highlighter;

    const result = await loadLanguageWithRetry(hl, "typescript");
    expect(result).toBe(true);
    expect(hl.loadLanguage).toHaveBeenCalledTimes(1);
  });

  it("retries and succeeds on second attempt (#206)", async () => {
    let attempt = 0;
    const hl = {
      loadLanguage: vi.fn().mockImplementation(async () => {
        attempt++;
        if (attempt === 1) throw new Error("transient failure");
      }),
      getLoadedLanguages: vi
        .fn()
        .mockImplementation(() => (attempt >= 2 ? ["tsx"] : [])),
    } as unknown as import("shiki").Highlighter;

    const result = await loadLanguageWithRetry(hl, "tsx");
    expect(result).toBe(true);
    expect(hl.loadLanguage).toHaveBeenCalledTimes(2);
  });

  it("returns false after all retries fail", async () => {
    const hl = {
      loadLanguage: vi.fn().mockRejectedValue(new Error("unavailable")),
      getLoadedLanguages: vi.fn().mockReturnValue([]),
    } as unknown as import("shiki").Highlighter;

    const result = await loadLanguageWithRetry(hl, "tsx");
    expect(result).toBe(false);
    expect(hl.loadLanguage).toHaveBeenCalledTimes(2);
  });
});
