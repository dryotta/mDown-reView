import { writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { EvidenceBundle } from "./explore";
import type { MergeResult } from "./dedupe";

export function writeEvidenceLine(runDir: string, b: EvidenceBundle): void {
  mkdirSync(runDir, { recursive: true });
  appendFileSync(join(runDir, "evidence.jsonl"), JSON.stringify({
    step: b.step,
    ts: b.ts,
    flow: b.flow,
    action: b.action,
    screen_id: b.screenId,
    screenshot: b.screenshot,
    dom_snapshot_sha: b.domSnapshotSha,
    console_diff: b.snapshot.console,
    ipc_errors: b.snapshot.ipc_errors,
    rule_hits: b.rule_hits,
  }) + "\n");
}

export interface ReportInput {
  runId: string;
  runDir: string;
  startedAt: string;
  finishedAt: string;
  visionEnabled: boolean;
  dryRun: boolean;
  bundles: EvidenceBundle[];
  merges: { bundle: EvidenceBundle; hit: { id: string; detail: string; anchor: string }; merge: MergeResult }[];
}

export function writeReport(input: ReportInput): string {
  const newCount = input.merges.filter((m) => m.merge.status === "NEW").length;
  const reproCount = input.merges.filter((m) => m.merge.status === "REPRODUCED").length;
  // Group reproductions by (heuristic, screen, anchor)
  type Key = string;
  const reproByKey = new Map<Key, { hit: { id: string; detail: string; anchor: string }; screen: string; n: number }>();
  for (const m of input.merges.filter((x) => x.merge.status === "REPRODUCED")) {
    const k = `${m.hit.id}|${m.bundle.screenId}|${m.hit.anchor}`;
    const cur = reproByKey.get(k);
    if (cur) cur.n += 1;
    else reproByKey.set(k, { hit: m.hit, screen: m.bundle.screenId, n: 1 });
  }
  // Severity helper
  const sev = (id: string): "P1"|"P2"|"P3" =>
    id.startsWith("MDR-") || id.startsWith("WCAG-") ? "P1"
    : id.startsWith("NIELSEN-") ? "P2" : "P3";
  // Most-frequent rule_hits across the run, regardless of new/reproduced
  const hitCounts = new Map<string, number>();
  for (const b of input.bundles) {
    for (const h of b.rule_hits) {
      const k = `${h.id}|${h.anchor}`;
      hitCounts.set(k, (hitCounts.get(k) ?? 0) + 1);
    }
  }
  const topHits = [...hitCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([k, n]) => { const [id, ...rest] = k.split("|"); return { id, anchor: rest.join("|"), n }; });

  const md = [
    `# test-exploratory-e2e run ${input.runId}`,
    ``,
    `- Started:  ${input.startedAt}`,
    `- Finished: ${input.finishedAt}`,
    `- Steps:    ${input.bundles.length}`,
    `- Vision:   ${input.visionEnabled ? "on" : "off"}`,
    `- Mode:     ${input.dryRun ? "DRY-RUN" : "FILE"}`,
    `- Findings: ${newCount} new, ${reproCount} reproduced (${reproByKey.size} distinct)`,
    ``,
    `## New findings`,
    ``,
    `| Heuristic | Severity | Screen | Anchor | Detail | Screenshot |`,
    `|---|---|---|---|---|---|`,
    ...input.merges
      .filter((m) => m.merge.status === "NEW")
      .map((m) => `| ${m.hit.id} | ${sev(m.hit.id)} | \`${m.bundle.screenId}\` | \`${m.hit.anchor}\` | ${m.hit.detail.replace(/\|/g, "\\|")} | ${m.bundle.screenshot || "—"} |`),
    ``,
    `## Reproduced findings (grouped)`,
    ``,
    `| Heuristic | Screen | Anchor | Count |`,
    `|---|---|---|---|`,
    ...[...reproByKey.values()]
      .sort((a, b) => b.n - a.n)
      .map((r) => `| ${r.hit.id} | \`${r.screen}\` | \`${r.hit.anchor}\` | ${r.n} |`),
    ``,
    `## Top rule hits across run`,
    ``,
    `| Heuristic | Anchor | Hits |`,
    `|---|---|---|`,
    ...topHits.map((t) => `| ${t.id} | \`${t.anchor}\` | ${t.n} |`),
    ``,
  ].join("\n");
  const path = join(input.runDir, "report.md");
  writeFileSync(path, md);
  return path;
}
