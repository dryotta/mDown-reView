import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Issue #125 — contract test: exe-task-implementer must run a caller-side
 * grep before adding any new IPC surface (Tauri command or
 * tauri-commands.ts export). PR #123 / iter 1 of #112 shipped two duplicate
 * IPC commands (~110 LOC) because the implementer didn't grep for existing
 * callers in src/lib/vm/use-comment-actions.ts. Iter 2 had to delete it.
 *
 * This test locks in two things:
 * 1. The agent prompt contains the Pre-flight: Caller-Side Verification
 *    section with the required rg invocations and citation requirement.
 * 2. The iterate skill's Step 6b enforces the gate (rejects iters that
 *    add IPC surface without a "pre-flight:" line in the commit message).
 */

const AGENT_PATH = resolve(
  __dirname,
  "../../.claude/agents/exe-task-implementer.md",
);
const SKILL_PATH = resolve(
  __dirname,
  "../../.claude/skills/iterate-one-issue/SKILL.md",
);
const AGENT = readFileSync(AGENT_PATH, "utf8");
const SKILL = readFileSync(SKILL_PATH, "utf8");

describe("exe-task-implementer caller-side pre-flight (issue #125)", () => {
  it("agent prompt declares the MANDATORY caller-side verification gate", () => {
    expect(AGENT).toMatch(
      /Pre-flight:\s*Caller-Side Verification\s*\(MANDATORY before adding any new IPC surface\)/i,
    );
  });

  it("agent prompt cites the motivating regression (PR #123 / iter 1 of #112)", () => {
    // Issue body specifically calls out PR #123 / issue #112 / 110 LOC of duplicate IPC.
    expect(AGENT).toMatch(/#123|#112/);
    expect(AGENT.toLowerCase()).toContain("duplicate");
  });

  it("agent prompt names the required rg invocations", () => {
    expect(AGENT).toMatch(/rg -n[^\n]*src\//);
    expect(AGENT).toMatch(/use-comment-actions\.ts|use-comments\.ts/);
  });

  it("agent prompt requires the (a)/(b) decision when a caller exists", () => {
    expect(AGENT.toLowerCase()).toContain("document why the new surface");
    expect(AGENT.toLowerCase()).toContain("cancel the new surface");
    expect(AGENT.toLowerCase()).toContain("route through the existing one");
  });

  it("agent prompt requires the pre-flight result in the iter commit message", () => {
    expect(AGENT).toMatch(/pre-flight:\s*rg returned|pre-flight:\s*\d+ callers found/i);
    expect(AGENT.toLowerCase()).toContain("must be cited in the iter commit message");
  });

  it("agent Output template includes a 'Pre-flight (caller-side verification)' line", () => {
    expect(AGENT).toMatch(/\*\*Pre-flight\s*\(caller-side verification\):\*\*/i);
  });
});

describe("iterate skill Step 6b enforces caller-side pre-flight (issue #125)", () => {
  it("Step 6b mentions the new-IPC-surface gate and rejects iters missing 'pre-flight:'", () => {
    expect(SKILL).toMatch(/New-IPC-surface gate.*#125/);
    expect(SKILL).toMatch(/`pre-flight:`/);
  });

  it("Step 6b checks for new tauri::command or tauri-commands.ts exports", () => {
    expect(SKILL).toMatch(/#\[tauri::command\]/);
    expect(SKILL).toMatch(/tauri-commands\.ts/);
  });

  it("Step 6b feeds the violation back to 6d as a forward-fix BLOCK (not silent proceed)", () => {
    expect(SKILL.toLowerCase()).toContain("forward-fix block");
    expect(SKILL.toLowerCase()).toContain("do not silently proceed");
  });
});
