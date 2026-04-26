import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

export interface IssueInput {
  heuristic_id: string;
  heuristic_file: string;
  severity: "P1" | "P2" | "P3";
  reproSteps: string[];
  screenshot: string;
  consoleSnippet?: string;
  a11ySnippet?: string;
  domAnchor: string;
  suggestion: string;
  runId: string;
  step: number;
  reproductions: number;
  firstSeen: string;
}

export function renderIssueBody(i: IssueInput): string {
  const lines = [
    `## Heuristic`,
    `**${i.heuristic_id}** — see \`${i.heuristic_file}\``,
    ``,
    `## Severity`,
    `**${i.severity}**`,
    ``,
    `## Reproduction`,
    ...i.reproSteps.map((s, idx) => `${idx + 1}. ${s}`),
    ``,
    `## Evidence`,
    `![step-${i.step}](${i.screenshot})`,
    ``,
    `**DOM anchor:** \`${i.domAnchor}\``,
  ];
  if (i.consoleSnippet) lines.push(`**Console:** \`${i.consoleSnippet}\``);
  if (i.a11ySnippet)    lines.push(`**A11y:** ${i.a11ySnippet}`);
  lines.push(
    ``,
    `## Suggested direction`,
    i.suggestion,
    ``,
    `## Run`,
    `explore-ux run id: \`${i.runId}\`, step ${i.step}`,
    `Reproduced ${i.reproductions}× since ${i.firstSeen}.`,
  );
  return lines.join("\n");
}

export type GhExec = (args: string[]) => Promise<string>;

export const realGh: GhExec = (args) =>
  new Promise((resolve, reject) => {
    const p = spawn("gh", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.once("exit", (code) => code === 0 ? resolve(out) : reject(new Error(err || `gh exit ${code}`)));
  });

export async function fileIssue(
  i: IssueInput,
  opts: { dryRun: boolean; gh?: GhExec },
): Promise<{ status: "dry-run" | "filed"; issue?: number; url?: string }> {
  if (opts.dryRun) return { status: "dry-run" };
  const gh = opts.gh ?? realGh;
  const body = renderIssueBody(i);
  const tmp = mkdtempSync(join(tmpdir(), "ux-issue-"));
  const bodyPath = join(tmp, "body.md");
  writeFileSync(bodyPath, body);
  const labels = ["explore-ux", "needs-grooming", `severity-${i.severity.toLowerCase()}`];
  const isUx = i.heuristic_id.startsWith("NIELSEN-") || i.heuristic_id.startsWith("AP-")
    || i.heuristic_id.startsWith("WCAG-");
  labels.push(isUx ? "ux" : "bug");
  const args = [
    "issue", "create",
    "--title", `[explore-ux] ${i.heuristic_id}: ${i.reproSteps[i.reproSteps.length - 1] ?? "issue"}`,
    "--body-file", bodyPath,
    ...labels.flatMap((l) => ["--label", l]),
    "--json", "number,html_url",
  ];
  const out = await gh(args);
  try {
    const parsed = JSON.parse(out);
    return { status: "filed", issue: parsed.number, url: parsed.html_url };
  } catch {
    const m = /\/issues\/(\d+)/.exec(out);
    return { status: "filed", issue: m ? +m[1] : undefined, url: out.trim() };
  }
}
