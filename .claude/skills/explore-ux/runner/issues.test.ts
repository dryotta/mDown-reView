import { describe, it, expect, vi } from "vitest";
import { renderIssueBody, fileIssue, type IssueInput } from "./issues";

const INPUT: IssueInput = {
  heuristic_id: "MDR-IPC-RAW-JSON-ERROR",
  heuristic_file: ".claude/skills/explore-ux/heuristics/mdownreview-specific.md",
  severity: "P1",
  reproSteps: ["Open folder", "Click file", "Observe banner"],
  screenshot: "screenshots/step-17.png",
  consoleSnippet: 'Failed to invoke read_text_file: {"kind":"io","message":"Permission denied"}',
  a11ySnippet: "banner has accessible name '...'",
  domAnchor: "div.error-banner",
  suggestion: "Add formatFsError() (cf. src/store/index.ts:399-411).",
  runId: "2026-04-25-22-30",
  step: 17,
  reproductions: 3,
  firstSeen: "2026-04-20",
};

describe("renderIssueBody", () => {
  it("includes heuristic id, severity, repro steps, anchor", () => {
    const md = renderIssueBody(INPUT);
    expect(md).toContain("MDR-IPC-RAW-JSON-ERROR");
    expect(md).toContain("**P1**");
    expect(md).toContain("1. Open folder");
    expect(md).toContain("`div.error-banner`");
    expect(md).toContain("explore-ux run id: `2026-04-25-22-30`");
  });
});

describe("fileIssue", () => {
  it("dry-run does NOT call gh", async () => {
    const gh = vi.fn();
    const r = await fileIssue(INPUT, { dryRun: true, gh });
    expect(gh).not.toHaveBeenCalled();
    expect(r).toMatchObject({ status: "dry-run" });
  });

  it("file mode invokes gh issue create with labels and body file", async () => {
    const gh = vi.fn(async (args: string[]) => {
      return JSON.stringify({ number: 142, html_url: "https://github.com/x/y/issues/142" });
    });
    const r = await fileIssue(INPUT, { dryRun: false, gh });
    expect(gh).toHaveBeenCalled();
    const args = gh.mock.calls[0][0] as string[];
    expect(args[0]).toBe("issue");
    expect(args[1]).toBe("create");
    expect(args).toContain("--label");
    expect(args).toContain("explore-ux");
    expect(args).toContain("severity-p1");
    expect(r).toMatchObject({ status: "filed", issue: 142 });
  });
});
