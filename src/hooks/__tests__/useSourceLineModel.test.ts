import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSourceLineModel, type SourceLineModelInput } from "../useSourceLineModel";
import type { CommentThread, FoldRegion } from "@/lib/tauri-commands";

function makeInput(overrides: Partial<SourceLineModelInput> = {}): SourceLineModelInput {
  const lines = overrides.lines ?? ["alpha", "beta", "gamma"];
  return {
    lines,
    threadsByLine: new Map(),
    foldStartMap: new Map(),
    collapsedLines: new Set(),
    query: "",
    matchesByLine: new Map(),
    highlightedLines: [],
    expandedLine: null,
    commentingLine: null,
    ...overrides,
  };
}

describe("useSourceLineModel", () => {
  it("no folds → identity passthrough (one entry per line, escaped fallback html)", () => {
    const lines = ["a < b", "c & d", "e > f"];
    const { result } = renderHook(() => useSourceLineModel(makeInput({ lines })));
    expect(result.current).toHaveLength(3);
    expect(result.current.map((m) => m.idx)).toEqual([0, 1, 2]);
    expect(result.current.map((m) => m.lineNum)).toEqual([1, 2, 3]);
    expect(result.current[0].contentHtml).toBe("a &lt; b");
    expect(result.current[1].contentHtml).toBe("c &amp; d");
    expect(result.current[2].contentHtml).toBe("e &gt; f");
  });

  it("collapsed region → inner indices skipped, fold endpoint rendered as next item", () => {
    const lines = ["fn () {", "  body1", "  body2", "  body3", "}"];
    const foldRegion: FoldRegion = { startLine: 1, endLine: 5 };
    const { result } = renderHook(() =>
      useSourceLineModel(
        makeInput({
          lines,
          foldStartMap: new Map([[1, foldRegion]]),
          collapsedLines: new Set([1]),
        }),
      ),
    );
    // Should produce: line 1 (the fold start, marked collapsed), then jump to line 5.
    expect(result.current.map((m) => m.lineNum)).toEqual([1, 5]);
    expect(result.current[0].isCollapsed).toBe(true);
    expect(result.current[0].foldRegion).toEqual(foldRegion);
    expect(result.current[1].isCollapsed).toBe(false);
  });

  it("query + matches → highlighted html selected for matched lines", () => {
    const lines = ["foo bar baz", "no match here"];
    const { result } = renderHook(() =>
      useSourceLineModel(
        makeInput({
          lines,
          query: "bar",
          matchesByLine: new Map([[0, [{ startCol: 4, endCol: 7, isCurrent: true }]]]),
        }),
      ),
    );
    expect(result.current[0].contentHtml).toBe(
      'foo <mark class="search-match-current">bar</mark> baz',
    );
    // Unmatched line falls back to escaped text.
    expect(result.current[1].contentHtml).toBe("no match here");
  });

  it("no highlight + non-current match → uses search-match (not -current) class", () => {
    const lines = ["xx zz xx"];
    const { result } = renderHook(() =>
      useSourceLineModel(
        makeInput({
          lines,
          query: "xx",
          matchesByLine: new Map([
            [
              0,
              [
                { startCol: 0, endCol: 2, isCurrent: false },
                { startCol: 6, endCol: 8, isCurrent: false },
              ],
            ],
          ]),
        }),
      ),
    );
    expect(result.current[0].contentHtml).toBe(
      '<mark class="search-match">xx</mark> zz <mark class="search-match">xx</mark>',
    );
  });

  it("highlightedLines present (and no query) → extracts inner code from <pre><code>…</code></pre>", () => {
    const lines = ["const x = 1;"];
    const highlightedLines = ['<pre class="shiki"><code><span class="line">SHIKI</span></code></pre>'];
    const { result } = renderHook(() =>
      useSourceLineModel(makeInput({ lines, highlightedLines })),
    );
    expect(result.current[0].contentHtml).toBe('<span class="line">SHIKI</span>');
  });

  it("lineThreads correctly attached to corresponding line; missing lookups get a stable empty array", () => {
    const lines = ["one", "two", "three"];
    const thread = { root: { line: 2 } } as unknown as CommentThread;
    const threadsByLine = new Map<number, CommentThread[]>([[2, [thread]]]);
    const { result, rerender } = renderHook(
      (props: SourceLineModelInput) => useSourceLineModel(props),
      { initialProps: makeInput({ lines, threadsByLine }) },
    );
    expect(result.current[0].lineThreads).toEqual([]);
    expect(result.current[1].lineThreads).toEqual([thread]);
    expect(result.current[2].lineThreads).toEqual([]);

    // Stable empty-array sentinel: identity preserved across renders so that
    // React.memo on SourceLine does not see a fresh `[]` per render.
    const emptyRefBefore = result.current[0].lineThreads;
    rerender(makeInput({ lines, threadsByLine }));
    expect(result.current[0].lineThreads).toBe(emptyRefBefore);
  });

  it("query active + line has no match + Shiki highlights present → still renders Shiki HTML, not escaped text", () => {
    // Critical perf-correctness invariant: while typing in search, lines
    // without a match must keep their syntax colors (extracted from Shiki),
    // not collapse to plain escaped text.
    const lines = ["const a = 1;", "const b = 2;"];
    const highlightedLines = [
      '<pre class="shiki"><code><span class="line">SHIKI_A</span></code></pre>',
      '<pre class="shiki"><code><span class="line">SHIKI_B</span></code></pre>',
    ];
    const { result } = renderHook(() =>
      useSourceLineModel(
        makeInput({
          lines,
          highlightedLines,
          query: "a",
          // Only line 0 matches; line 1 has no matches but should still be highlighted.
          matchesByLine: new Map([[0, [{ startCol: 6, endCol: 7, isCurrent: true }]]]),
        }),
      ),
    );
    expect(result.current[0].contentHtml).toContain('<mark class="search-match-current">');
    expect(result.current[1].contentHtml).toBe('<span class="line">SHIKI_B</span>');
  });

  it("expandedLine / commentingLine flags map to the right entry", () => {
    const lines = ["a", "b", "c"];
    const { result } = renderHook(() =>
      useSourceLineModel(makeInput({ lines, expandedLine: 2, commentingLine: 3 })),
    );
    expect(result.current[0].isExpanded).toBe(false);
    expect(result.current[0].isCommenting).toBe(false);
    expect(result.current[1].isExpanded).toBe(true);
    expect(result.current[1].isCommenting).toBe(false);
    expect(result.current[2].isExpanded).toBe(false);
    expect(result.current[2].isCommenting).toBe(true);
  });
});
