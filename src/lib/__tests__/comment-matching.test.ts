import { describe, it, expect } from "vitest";
import { matchComments, type MatchedComment } from "@/lib/comment-matching";
import { computeLineHash, captureContext } from "@/lib/comment-anchors";
import type { ReviewComment } from "@/lib/tauri-commands";

function makeLineComment(lineNumber: number, lineText: string, lines: string[]): ReviewComment {
  const idx = lineNumber - 1;
  const ctx = captureContext(lines, idx);
  return {
    id: `c${lineNumber}`,
    anchorType: "line",
    lineNumber,
    lineHash: computeLineHash(lineText),
    contextBefore: ctx.contextBefore,
    contextAfter: ctx.contextAfter,
    text: `comment on line ${lineNumber}`,
    createdAt: new Date().toISOString(),
    resolved: false,
  };
}

function makeSelectionComment(
  lineNumber: number,
  lineText: string,
  selectedText: string,
  lines: string[]
): ReviewComment {
  const idx = lineNumber - 1;
  const ctx = captureContext(lines, idx);
  return {
    id: `sel${lineNumber}`,
    anchorType: "selection",
    lineNumber,
    lineHash: computeLineHash(lineText),
    contextBefore: ctx.contextBefore,
    contextAfter: ctx.contextAfter,
    selectedText,
    selectionStartOffset: lineText.indexOf(selectedText),
    selectionEndLine: lineNumber,
    selectionEndOffset: lineText.indexOf(selectedText) + selectedText.length,
    text: `selection comment on line ${lineNumber}`,
    createdAt: new Date().toISOString(),
    resolved: false,
  };
}

describe("matchComments", () => {
  it("1. exact match — lineHash matches at lineNumber", () => {
    const lines = ["alpha", "beta", "gamma"];
    const comment = makeLineComment(2, "beta", lines);
    const result = matchComments([comment], lines);
    expect(result[0].matchedLineNumber).toBe(2);
    expect(result[0].isOrphaned).toBeFalsy();
  });

  it("2. nearby hash match — line moved ±5 lines", () => {
    const original = ["alpha", "beta", "gamma", "delta"];
    const comment = makeLineComment(2, "beta", original);
    const modified = ["alpha", "new1", "new2", "new3", "beta", "gamma"];
    const result = matchComments([comment], modified);
    expect(result[0].matchedLineNumber).toBe(5);
    expect(result[0].isOrphaned).toBeFalsy();
  });

  it("3. context-based match — commented line rewritten, context intact", () => {
    const original = ["alpha", "beta", "gamma", "delta", "epsilon"];
    const comment = makeLineComment(3, "gamma", original);
    const modified = ["alpha", "beta", "CHANGED", "delta", "epsilon"];
    const result = matchComments([comment], modified);
    expect(result[0].matchedLineNumber).toBe(3);
    expect(result[0].isOrphaned).toBeFalsy();
  });

  it("4. global hash fallback — line moved >30 lines", () => {
    const lines: string[] = [];
    for (let i = 0; i < 60; i++) lines.push(`line${i}`);
    const comment = makeLineComment(5, "line4", lines);
    const modified = lines.filter((_, i) => i !== 4);
    modified.splice(54, 0, "line4");
    const result = matchComments([comment], modified);
    expect(result[0].matchedLineNumber).toBe(55);
    expect(result[0].isOrphaned).toBeFalsy();
  });

  it("5. selected text fallback — selection comment, hash gone, text found", () => {
    const original = ["const x = fetchData(url);", "doSomething();"];
    const comment = makeSelectionComment(1, original[0], "fetchData(url)", original);
    const modified = ["const y = 42;", "const result = fetchData(url);"];
    const result = matchComments([comment], modified);
    expect(result[0].matchedLineNumber).toBe(2);
    expect(result[0].isOrphaned).toBeFalsy();
  });

  it("6. duplicate lines — comment stays on correct one", () => {
    const lines = ["alpha", "dup", "beta", "dup", "gamma"];
    const comment = makeLineComment(2, "dup", lines);
    const result = matchComments([comment], lines);
    expect(result[0].matchedLineNumber).toBe(2);
  });

  it("7. orphaned gracefully — line and context deleted", () => {
    const original = ["alpha", "beta", "gamma", "delta"];
    const comment = makeLineComment(2, "beta", original);
    const modified = ["completely", "different", "content"];
    const result = matchComments([comment], modified);
    expect(result[0].isOrphaned).toBe(true);
    expect(result[0].matchedLineNumber).toBeLessThanOrEqual(modified.length);
  });

  it("8. file truncated — lineNumber beyond EOF", () => {
    const original = ["a", "b", "c", "d", "e"];
    const comment = makeLineComment(5, "e", original);
    const modified = ["a", "b"];
    const result = matchComments([comment], modified);
    expect(result[0].matchedLineNumber).toBeLessThanOrEqual(2);
    expect(result[0].isOrphaned).toBe(true);
  });

  it("9. file empty — all comments orphaned at line 1", () => {
    const original = ["a", "b", "c"];
    const comment = makeLineComment(2, "b", original);
    const result = matchComments([comment], []);
    expect(result[0].isOrphaned).toBe(true);
    expect(result[0].matchedLineNumber).toBe(1);
  });

  it("10. multiple comments, mixed matching", () => {
    const original = ["a", "b", "c", "d"];
    const c1 = makeLineComment(1, "a", original);
    const c2 = makeLineComment(2, "b", original);
    const c3 = makeLineComment(4, "d", original);
    const modified = ["a", "X", "Y", "c", "d"];
    const result = matchComments([c1, c2, c3], modified);
    expect(result[0].matchedLineNumber).toBe(1); // exact
    expect(result[0].isOrphaned).toBeFalsy();
    expect(result[2].matchedLineNumber).toBe(5); // moved
    expect(result[2].isOrphaned).toBeFalsy();
  });

  it("11. re-anchor updates lineNumber on returned comment", () => {
    const original = ["a", "b", "c"];
    const comment = makeLineComment(2, "b", original);
    const modified = ["new", "a", "b", "c"];
    const result = matchComments([comment], modified);
    expect(result[0].lineNumber).toBe(3); // updated from 2 to 3
  });

  it("12. context match disambiguates identical lines", () => {
    const lines = ["before1", "dup", "after1", "before2", "dup", "after2"];
    const comment = makeLineComment(5, "dup", lines);
    const result = matchComments([comment], lines);
    expect(result[0].matchedLineNumber).toBe(5);
  });

  it("13. selection degradation — selectedText not found", () => {
    const original = ["const x = fetchData(url);"];
    const comment = makeSelectionComment(1, original[0], "fetchData(url)", original);
    const modified = ["completely rewritten line"];
    const result = matchComments([comment], modified);
    expect(result[0].isOrphaned).toBe(true);
  });

  it("legacy block comment — displayed at fallbackLine as orphaned", () => {
    const blockComment: ReviewComment = {
      id: "legacy1",
      anchorType: "block",
      blockHash: "abcd1234",
      headingContext: null,
      fallbackLine: 3,
      text: "old block comment",
      createdAt: new Date().toISOString(),
      resolved: false,
    };
    const lines = ["a", "b", "c", "d"];
    const result = matchComments([blockComment], lines);
    expect(result[0].matchedLineNumber).toBe(3);
    expect(result[0].isOrphaned).toBe(true);
  });
});
