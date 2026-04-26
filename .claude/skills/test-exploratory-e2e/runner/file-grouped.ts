// One-shot: file grouped GitHub issues from an existing findings.jsonl.
// Usage:
//   tsx file-grouped.ts <runDir> [--dry-run] [--update <issue#> ...]
//
// `--update <n>` re-renders the body of an existing GitHub issue using
// the current findings + uploaded screenshot URLs (no new issues filed).
// Reuses the same grouping + body rendering as the REPL's file_issues act.

import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  fileGroupedIssue, listOpenExploreUxIssues, indexOpenIssuesByGroup,
  renderGroupedIssueBody, topSeverity,
  type GroupedFinding,
} from "./issues";
import { loadStore, saveStore } from "./dedupe";
import { uploadEvidence, resolveScreenshotUrl } from "./evidence";

interface FindingRecord {
  ts: string; step: number; heuristic_id: string;
  severity: "P1" | "P2" | "P3";
  anchor: string; detail: string; screenshot: string; status: string;
  group?: string; key: string;
}

function inferGroup(heuristicId: string): string {
  if (/TABSTRIP|TOOLBAR|VIEWER-HSCROLL|SQUEEZED|HEADER-CLIPPED|TAB-SCROLL/i.test(heuristicId))
    return "responsive-layout";
  if (heuristicId.startsWith("WCAG-") || /A11Y|FOCUS|CONTRAST/i.test(heuristicId))
    return "accessibility";
  if (heuristicId === "NIELSEN-N4" || /MODAL|DIALOG/i.test(heuristicId))
    return "modal-ux";
  if (heuristicId === "AP-EMOJI-AS-ICON" || /TITLE|EMOJI|ICON/i.test(heuristicId))
    return "visual-polish";
  if (heuristicId === "MDR-CONSOLE-ERROR" || heuristicId === "MDR-IPC-RAW-JSON-ERROR")
    return "errors";
  return "misc";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const updateIdx = args.indexOf("--update");
  const updateMode = updateIdx >= 0;
  const updateIssueNumbers: number[] = updateMode
    ? args.slice(updateIdx + 1).filter((a) => /^\d+$/.test(a)).map(Number)
    : [];
  const runDir = args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a));
  if (!runDir) {
    console.error("Usage: tsx file-grouped.ts <runDir> [--dry-run] [--update <issue#> ...]");
    process.exit(2);
  }
  const findingsPath = join(runDir, "findings.jsonl");
  if (!existsSync(findingsPath)) {
    console.error(`No findings.jsonl at ${findingsPath}`);
    process.exit(2);
  }
  const recs: FindingRecord[] = readFileSync(findingsPath, "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const newRecs = recs.filter((r) => r.status === "NEW");

  const runId = runDir.replace(/.*[\\/]/, "");

  // Upload screenshots first (skipped in dry-run).
  let upload: Awaited<ReturnType<typeof uploadEvidence>> | null = null;
  if (!dryRun) {
    console.log(`Uploading screenshots to evidence branch...`);
    upload = await uploadEvidence(runDir, runId);
    console.log(`  ${upload.count} png(s) → ${upload.baseUrl}/${upload.remoteDir}\n`);
  }

  const buckets = new Map<string, GroupedFinding[]>();
  for (const r of newRecs) {
    const groupKey = r.group ?? inferGroup(r.heuristic_id);
    const arr = buckets.get(groupKey) ?? [];
    arr.push({
      heuristic_id: r.heuristic_id, severity: r.severity, anchor: r.anchor,
      detail: r.detail,
      screenshot: resolveScreenshotUrl(r.screenshot, upload),
      step: r.step, reproductions: 1, firstSeen: r.ts,
    });
    buckets.set(groupKey, arr);
  }

  const SEV_RANK = { P1: 0, P2: 1, P3: 2 } as const;
  const storePath = ".claude/test-exploratory-e2e/known-findings.json";
  const store = loadStore(storePath);

  if (updateMode) {
    console.log(`Updating ${updateIssueNumbers.length} existing issue(s) with re-rendered bodies:\n`);
    const groups = Array.from(buckets.entries());
    if (groups.length !== updateIssueNumbers.length) {
      console.warn(
        `WARNING: ${groups.length} group(s) but ${updateIssueNumbers.length} issue number(s). ` +
        `Pairing in order.`);
    }
    for (let i = 0; i < Math.min(groups.length, updateIssueNumbers.length); i++) {
      const [group, findings] = groups[i];
      findings.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
      const issueNum = updateIssueNumbers[i];
      const body = renderGroupedIssueBody({ group, runId, findings });
      const sev = topSeverity(findings);
      try {
        await ghEditBody(issueNum, body);
        console.log(`  [${sev}] #${issueNum} ← ${group} (${findings.length} finding(s)) — body updated`);
      } catch (e) {
        console.error(`  [FAIL] #${issueNum}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return;
  }

  console.log(`\n${dryRun ? "[DRY-RUN] " : ""}Filing ${buckets.size} grouped issue(s) from ${newRecs.length} NEW finding(s):\n`);

  // Look up open explore-ux issues so we re-use them rather than re-file.
  let openByGroup = new Map<string, number>();
  try {
    const refs = await listOpenExploreUxIssues();
    openByGroup = indexOpenIssuesByGroup(refs);
    if (refs.length > 0) {
      console.log(`  ${refs.length} open explore-ux issue(s); ${openByGroup.size} group(s) already covered.\n`);
    }
  } catch (e) {
    console.warn(`  open-issue lookup failed: ${e instanceof Error ? e.message : e}\n`);
  }

  for (const [group, findings] of buckets) {
    findings.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
    try {
      const r = await fileGroupedIssue(
        { group, runId, findings },
        { dryRun, existingIssue: openByGroup.get(group) },
      );
      console.log(`  [${r.severity}] ${r.title}`);
      console.log(`         status=${r.status}${r.issue ? `, issue=#${r.issue}` : ""}${r.url ? `, url=${r.url}` : ""}`);
      if ((r.status === "filed" || r.status === "reproduced") && r.issue !== undefined) {
        for (const rec of newRecs) {
          const groupKey = rec.group ?? inferGroup(rec.heuristic_id);
          if (groupKey !== group) continue;
          const stored = store.findings[rec.key];
          if (stored && stored.issue === null) stored.issue = r.issue;
        }
      }
    } catch (e) {
      console.error(`  [FAIL] ${group}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!dryRun) {
    saveStore(storePath, store);
    console.log("\nDedupe store updated.");
  }
}

async function ghEditBody(issueNumber: number, body: string): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), "ux-edit-"));
  const bodyPath = join(tmp, "body.md");
  writeFileSync(bodyPath, body);
  await new Promise<void>((resolve, reject) => {
    const p = spawn("gh", ["issue", "edit", String(issueNumber), "--body-file", bodyPath],
      { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(err.trim() || `gh exit ${code}`)));
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
