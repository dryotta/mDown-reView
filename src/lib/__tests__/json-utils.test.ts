import { describe, it, expect } from "vitest";
import { stripJsonComments } from "../json-utils";

describe("stripJsonComments", () => {
  it("handles empty input", () => {
    expect(stripJsonComments("")).toBe("");
  });

  it("returns valid JSON unchanged", () => {
    const input = '{"key": "value", "num": 42}';
    expect(stripJsonComments(input)).toBe(input);
  });

  it("strips // line comments", () => {
    const input = '{\n  "key": "value" // this is a comment\n}';
    const result = stripJsonComments(input);
    expect(result).toBe('{\n  "key": "value" \n}');
    expect(JSON.parse(result)).toEqual({ key: "value" });
  });

  it("strips /* */ block comments", () => {
    const input = '{\n  /* comment */\n  "key": "value"\n}';
    const result = stripJsonComments(input);
    expect(result).toBe('{\n  \n  "key": "value"\n}');
    expect(JSON.parse(result)).toEqual({ key: "value" });
  });

  it("strips multi-line block comments", () => {
    const input = '{\n  /* multi\n     line\n     comment */\n  "key": 1\n}';
    const result = stripJsonComments(input);
    expect(JSON.parse(result)).toEqual({ key: 1 });
  });

  it("removes trailing commas before }", () => {
    const input = '{"a": 1, "b": 2, }';
    const result = stripJsonComments(input);
    expect(JSON.parse(result)).toEqual({ a: 1, b: 2 });
  });

  it("removes trailing commas before ]", () => {
    const input = '[1, 2, 3, ]';
    const result = stripJsonComments(input);
    expect(JSON.parse(result)).toEqual([1, 2, 3]);
  });

  it("removes trailing commas with whitespace before closing bracket", () => {
    const input = '{\n  "a": 1,\n}';
    const result = stripJsonComments(input);
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it("preserves strings containing //", () => {
    const input = '{"url": "https://example.com"}';
    const result = stripJsonComments(input);
    expect(result).toBe(input);
    expect(JSON.parse(result)).toEqual({ url: "https://example.com" });
  });

  it("preserves strings containing /*", () => {
    const input = '{"pattern": "/* glob */"}';
    const result = stripJsonComments(input);
    expect(result).toBe(input);
    expect(JSON.parse(result)).toEqual({ pattern: "/* glob */" });
  });

  it("preserves escaped quotes in strings", () => {
    const input = '{"escaped": "he said \\"hello\\""}';
    const result = stripJsonComments(input);
    expect(result).toBe(input);
  });

  it("handles combined comments, trailing commas, and strings with comment-like content", () => {
    const input = `{
  "url": "https://example.com", // a URL
  "note": "/* not a comment */",
  /* block comment */
  "trailing": true,
}`;
    const result = stripJsonComments(input);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({
      url: "https://example.com",
      note: "/* not a comment */",
      trailing: true,
    });
  });
});
