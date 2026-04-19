import { describe, it, expect } from "vitest";
import { parseKqlPipeline, formatKql } from "@/lib/kql-parser";

describe("parseKqlPipeline", () => {
  it("parses simple pipeline", () => {
    const result = parseKqlPipeline("StormEvents | where State == 'FL' | count");
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ operator: "StormEvents", isSource: true });
    expect(result[1]).toMatchObject({ operator: "where", details: "State == 'FL'" });
    expect(result[2]).toMatchObject({ operator: "count" });
  });

  it("handles multi-line input", () => {
    const input = "Logs\n| where Level == 'Error'\n| summarize count() by Source";
    const result = parseKqlPipeline(input);
    expect(result).toHaveLength(3);
    expect(result[1].operator).toBe("where");
    expect(result[2].operator).toBe("summarize");
  });

  it("handles empty input", () => {
    expect(parseKqlPipeline("")).toEqual([]);
  });

  it("ignores pipes inside string literals", () => {
    const result = parseKqlPipeline(`T | where Name == "a|b" | count`);
    expect(result).toHaveLength(3);
    expect(result[1]).toMatchObject({ operator: "where", details: expect.stringContaining("a|b") });
  });
});

describe("formatKql", () => {
  it("adds line breaks at pipe operators", () => {
    const result = formatKql("T | where x > 1 | count");
    expect(result).toContain("\n| where");
    expect(result).toContain("\n| count");
  });

  it("preserves existing line breaks", () => {
    const input = "T\n| where x > 1\n| count";
    const result = formatKql(input);
    expect(result.split("\n")).toHaveLength(3);
  });
});
