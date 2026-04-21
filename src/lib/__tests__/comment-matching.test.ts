import { describe, it, expect } from "vitest";
import { matchComments } from "@/lib/comment-matching";
import type { MrsfComment } from "@/lib/tauri-commands";

function makeComment(overrides: Partial<MrsfComment>): MrsfComment {
  return {
    id: "c1", author: "Test (t)", timestamp: "2026-01-01T00:00:00Z",
    text: "test", resolved: false, ...overrides,
  };
}

describe("matchComments (MRSF 4-step)", () => {
  const lines = ["line one", "target text here", "line three", "line four", "line five"];

  it("Step 1: exact selected_text match at original line", () => {
    const c = makeComment({ line: 2, selected_text: "target text here" });
    const [matched] = matchComments([c], lines);
    expect(matched.isOrphaned).toBe(false);
    expect(matched.matchedLineNumber).toBe(2);
  });

  it("Step 1: selected_text found at different line → relocate", () => {
    const c = makeComment({ line: 5, selected_text: "target text here" });
    const [matched] = matchComments([c], lines);
    expect(matched.isOrphaned).toBe(false);
    expect(matched.matchedLineNumber).toBe(2);
  });

  it("Step 2: no selected_text, line still exists → fallback", () => {
    const c = makeComment({ line: 3 });
    const [matched] = matchComments([c], lines);
    expect(matched.isOrphaned).toBe(false);
    expect(matched.matchedLineNumber).toBe(3);
  });

  it("Step 2: line beyond document → orphan", () => {
    const c = makeComment({ line: 100 });
    const [matched] = matchComments([c], lines);
    expect(matched.isOrphaned).toBe(true);
  });

  it("Step 3: fuzzy match — slightly changed text", () => {
    const c = makeComment({ line: 2, selected_text: "target text Here" }); // case diff
    const [matched] = matchComments([c], lines);
    expect(matched.isOrphaned).toBe(false);
    expect(matched.matchedLineNumber).toBe(2);
  });

  it("Step 4: text completely gone → orphan", () => {
    const c = makeComment({ line: 2, selected_text: "totally nonexistent text" });
    const [matched] = matchComments([c], lines);
    expect(matched.isOrphaned).toBe(true);
  });

  it("no line, no selected_text → orphan", () => {
    const c = makeComment({});
    const [matched] = matchComments([c], lines);
    expect(matched.isOrphaned).toBe(true);
  });

  it("empty file → all orphaned", () => {
    const c = makeComment({ line: 1, selected_text: "anything" });
    const [matched] = matchComments([c], []);
    expect(matched.isOrphaned).toBe(true);
  });

  it("multiple comments mixed matching", () => {
    const c1 = makeComment({ id: "c1", line: 1, selected_text: "line one" });
    const c2 = makeComment({ id: "c2", line: 2, selected_text: "nonexistent" });
    const c3 = makeComment({ id: "c3", line: 3 });
    const results = matchComments([c1, c2, c3], lines);
    expect(results[0].isOrphaned).toBe(false);
    expect(results[0].matchedLineNumber).toBe(1);
    expect(results[1].isOrphaned).toBe(true);
    expect(results[2].isOrphaned).toBe(false);
    expect(results[2].matchedLineNumber).toBe(3);
  });

  it("fuzzy prefers closer to original line", () => {
    const dupLines = ["foo bar baz", "something else", "foo bar baz"];
    const c = makeComment({ line: 3, selected_text: "foo bar BAZ" }); // case diff
    const [matched] = matchComments([c], dupLines);
    expect(matched.matchedLineNumber).toBe(3);
  });

  it("selected_text substring match works", () => {
    const c = makeComment({ line: 5, selected_text: "target text" });
    const [matched] = matchComments([c], lines);
    expect(matched.isOrphaned).toBe(false);
    expect(matched.matchedLineNumber).toBe(2);
  });
});
