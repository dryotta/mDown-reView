import { describe, it, expect, vi } from "vitest";
import {
  renderIssueBody, fileIssue, type IssueInput,
  renderGroupedIssueBody, fileGroupedIssue, topSeverity,
  listOpenExploreUxIssues, indexOpenIssuesByGroup,
  type GroupedFinding, type GroupedIssueInput,
} from "./issues";

const INPUT: IssueInput = {
  heuristic_id: "MDR-IPC-RAW-JSON-ERROR",
  heuristic_file: ".claude/skills/test-exploratory-e2e/heuristics/mdownreview-specific.md",
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
    const gh = vi.fn(async () => "https://github.com/x/y/issues/142\n");
    const r = await fileIssue(INPUT, { dryRun: false, gh });
    expect(gh).toHaveBeenCalled();
    const args = gh.mock.calls[0][0] as string[];
    expect(args[0]).toBe("issue");
    expect(args[1]).toBe("create");
    expect(args).toContain("--label");
    expect(args).toContain("explore-ux");
    expect(args).toContain("severity-p1");
    expect(args).not.toContain("--json");
    expect(r).toMatchObject({ status: "filed", issue: 142 });
  });
});

const GROUP_FINDINGS: GroupedFinding[] = [
  { heuristic_id: "MDR-TABSTRIP-SCROLLBAR", severity: "P2", anchor: ".tab-bar",
    detail: "Native scrollbar inside tab strip at 480px.", screenshot: "s/step-6.png",
    step: 6, reproductions: 1, firstSeen: "2026-04-26T07:09:31Z" },
  { heuristic_id: "MDR-TOOLBAR-TEXT-CLIP", severity: "P2", anchor: ".viewer-toolbar button",
    detail: "Toolbar button label clipped mid-word at 800px.", screenshot: "s/step-5.png",
    step: 5, reproductions: 1, firstSeen: "2026-04-26T07:08:05Z" },
  { heuristic_id: "MDR-VIEWER-SQUEEZED-OUT", severity: "P1", anchor: "main viewer pane",
    detail: "Center viewer column reduced to zero width at 480px.", screenshot: "s/step-6.png",
    step: 6, reproductions: 1, firstSeen: "2026-04-26T07:09:16Z" },
];

describe("topSeverity", () => {
  it("returns the most severe (P1 wins over P2/P3)", () => {
    expect(topSeverity(GROUP_FINDINGS)).toBe("P1");
    expect(topSeverity([GROUP_FINDINGS[0], GROUP_FINDINGS[1]])).toBe("P2");
  });
});

describe("renderGroupedIssueBody", () => {
  it("includes a numbered section per finding with anchor + screenshot", () => {
    const body = renderGroupedIssueBody({
      group: "responsive-layout", runId: "2026-04-26-test", findings: GROUP_FINDINGS,
    });
    expect(body).toContain("3 related finding(s)");
    expect(body).toContain("Severity mix: P1, P2");
    expect(body).toContain("### 1. `MDR-TABSTRIP-SCROLLBAR`");
    expect(body).toContain("### 3. `MDR-VIEWER-SQUEEZED-OUT`");
    expect(body).toContain("`.tab-bar`");
    expect(body).toContain("![step-6](s/step-6.png)");
    expect(body).toContain("`responsive-layout`");
  });
});

describe("fileGroupedIssue", () => {
  const INPUT: GroupedIssueInput = {
    group: "responsive-layout", runId: "2026-04-26-test", findings: GROUP_FINDINGS,
  };

  it("dry-run returns a humanised title without calling gh", async () => {
    const gh = vi.fn();
    const r = await fileGroupedIssue(INPUT, { dryRun: true, gh });
    expect(gh).not.toHaveBeenCalled();
    expect(r.status).toBe("dry-run");
    expect(r.title).toContain("Responsive Layout");
    expect(r.title).toContain("3 finding(s)");
    expect(r.severity).toBe("P1");
  });

  it("file mode emits one gh call with severity label of the worst finding", async () => {
    const gh = vi.fn(async () => "https://github.com/x/y/issues/200\n");
    const r = await fileGroupedIssue(INPUT, { dryRun: false, gh });
    expect(gh).toHaveBeenCalledTimes(1);
    const args = gh.mock.calls[0][0] as string[];
    expect(args).toContain("severity-p1");
    expect(args).toContain("explore-ux");
    expect(args).toContain("bug");
    expect(args).not.toContain("--json");
    expect(r).toMatchObject({ status: "filed", issue: 200, severity: "P1" });
  });

  it("truncates heuristic list in title when more than 3", async () => {
    const many: GroupedFinding[] = [
      ...GROUP_FINDINGS,
      { ...GROUP_FINDINGS[0], heuristic_id: "MDR-A" },
      { ...GROUP_FINDINGS[0], heuristic_id: "MDR-B" },
    ];
    const r = await fileGroupedIssue(
      { ...INPUT, findings: many }, { dryRun: true });
    expect(r.title).toMatch(/\(\+\d+ more\)/);
  });

  it("rendered body includes the explore-ux:group marker", () => {
    const body = renderGroupedIssueBody(INPUT);
    expect(body).toMatch(/<!--\s*explore-ux:group=responsive-layout\s*-->/);
  });

  it("when existingIssue is set, comments instead of creating", async () => {
    const gh = vi.fn(async () => "");
    const r = await fileGroupedIssue(INPUT, { dryRun: false, gh, existingIssue: 199 });
    expect(gh).toHaveBeenCalledTimes(1);
    const args = gh.mock.calls[0][0] as string[];
    expect(args.slice(0, 3)).toEqual(["issue", "comment", "199"]);
    expect(args).toContain("--body");
    const body = args[args.indexOf("--body") + 1];
    expect(body).toContain("Reproduced in run");
    expect(body).toMatch(/MDR-(TABSTRIP-SCROLLBAR|VIEWER-SQUEEZED-OUT)/);
    expect(r).toMatchObject({ status: "reproduced", issue: 199, severity: "P1" });
  });

  it("dry-run with existingIssue reports reproduced status", async () => {
    const gh = vi.fn();
    const r = await fileGroupedIssue(INPUT, { dryRun: true, gh, existingIssue: 199 });
    expect(gh).not.toHaveBeenCalled();
    expect(r.status).toBe("reproduced");
    expect(r.issue).toBe(199);
  });
});

describe("listOpenExploreUxIssues", () => {
  it("matches the explore-ux:group=<g> marker in the body", async () => {
    const gh = vi.fn(async () => JSON.stringify([
      { number: 128, title: "[explore-ux] Responsive Layout — 7 finding(s) (X, Y)",
        body: "<!-- explore-ux:group=responsive-layout -->\n\n## Summary\n..." },
      { number: 200, title: "[explore-ux] Errors — 1 finding(s) (Z)",
        body: "<!-- explore-ux:group=errors -->\n## Summary\n" },
    ]));
    const refs = await listOpenExploreUxIssues(gh);
    expect(refs).toEqual([
      { number: 128, group: "responsive-layout", title: expect.stringContaining("Responsive Layout") },
      { number: 200, group: "errors", title: expect.stringContaining("Errors") },
    ]);
  });

  it("falls back to humanised title prefix for legacy issues without marker", async () => {
    const gh = vi.fn(async () => JSON.stringify([
      { number: 127, title: "[explore-ux] Visual Polish — 2 finding(s) (A, B)", body: "no marker here" },
    ]));
    const refs = await listOpenExploreUxIssues(gh);
    expect(refs).toEqual([
      { number: 127, group: "visual-polish", title: expect.stringContaining("Visual Polish") },
    ]);
  });

  it("returns [] when gh output is not JSON", async () => {
    const gh = vi.fn(async () => "garbage");
    expect(await listOpenExploreUxIssues(gh)).toEqual([]);
  });
});

describe("indexOpenIssuesByGroup", () => {
  it("picks the lowest issue number when multiple share a group", () => {
    const map = indexOpenIssuesByGroup([
      { number: 200, group: "errors", title: "" },
      { number: 50,  group: "errors", title: "" },
      { number: 99,  group: "modal-ux", title: "" },
    ]);
    expect(map.get("errors")).toBe(50);
    expect(map.get("modal-ux")).toBe(99);
    expect(map.size).toBe(2);
  });
});
