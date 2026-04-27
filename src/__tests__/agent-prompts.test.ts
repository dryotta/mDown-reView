import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Issue #119 — contract test for agent prompts that must enforce a
 * pre-flight rule-citation gate. Without the gate, implementer agents
 * keep rediscovering canonical rules (logger chokepoint, perf caps,
 * security bounds) at expert-review time, costing one fix commit per
 * iteration. See the retros referenced in the issue body.
 *
 * This test is a content contract — if the gate gets accidentally
 * deleted or watered down, this fails loudly.
 */

const AGENT_PATH = resolve(__dirname, "../../.claude/agents/exe-task-implementer.md");
const PROMPT = readFileSync(AGENT_PATH, "utf8");

describe("exe-task-implementer agent prompt", () => {
  it("declares an explicit MANDATORY pre-flight gate before writing code", () => {
    expect(PROMPT).toMatch(/Pre-flight\s*\(MANDATORY before writing any code\)/);
  });

  it("requires per-file enumeration of canonical rules", () => {
    expect(PROMPT.toLowerCase()).toContain("for every file you will create or modify");
    expect(PROMPT.toLowerCase()).toContain("enumerate which canonical rules apply before writing");
  });

  it("names the canonical rule docs implementers must consult", () => {
    expect(PROMPT).toContain("docs/architecture.md");
    expect(PROMPT).toContain("docs/performance.md");
    expect(PROMPT).toContain("docs/security.md");
  });

  it("cites the historical regressions that motivated the gate (logger + unbounded loops)", () => {
    expect(PROMPT.toLowerCase()).toContain("logger chokepoint");
    expect(PROMPT.toLowerCase()).toMatch(/unbounded\s+(promise\.all|input)/);
  });

  it("requires the implementer's Output to include a Pre-flight rule citations table", () => {
    expect(PROMPT).toMatch(/\*\*Pre-flight rule citations:\*\*/);
    expect(PROMPT).toMatch(/\| File \| Rules consulted \| Conformance \|/);
  });

  it("instructs the implementer to STOP rather than silently violate a blocking rule", () => {
    expect(PROMPT.toLowerCase()).toContain("stop and report the conflict");
    expect(PROMPT.toLowerCase()).toMatch(/do not silently violate/);
  });
});
