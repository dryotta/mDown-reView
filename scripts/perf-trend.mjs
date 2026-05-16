#!/usr/bin/env node
// Generate a perf-bench trend report across recent ci.yml runs on `main`.
//
// Data flow:
//   1. `gh run list --workflow ci.yml --branch main --status success`
//   2. For each run, `gh run download <id> --name bench-output` (if present —
//      skip-on-skip runs and pre-bench-job runs have no artifact).
//   3. Parse criterion `--output-format bencher` output:
//        test <bench_id> ... bench:   N,NNN ns/iter (+/- M,MMM)
//   4. Cross-reference each run with the commit SHA, timestamp, and PR title.
//   5. Render a markdown report covering all benches present in any run inside
//      the window, with the budget (parsed from .github/workflows/ci.yml) and
//      a delta-vs-median column for regression spotting.
//
// Output: markdown to stdout, OR to $GITHUB_STEP_SUMMARY if `--summary` is
// passed (lets a future CI step reuse the same renderer without rewriting).
//
// Usage:
//   node scripts/perf-trend.mjs [--days N] [--runs M] [--workflow ci.yml]
//                               [--branch main] [--summary]
//
// Defaults: --days 14 --runs 30 (artifacts retain 14 days, more runs is
// harmless — they just get filtered by the days window).

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const args = parseArgs(process.argv.slice(2));
const DAYS = args.days ?? 14;
const RUNS = args.runs ?? 30;
const WORKFLOW = args.workflow ?? "ci.yml";
const BRANCH = args.branch ?? "main";
const SUMMARY = args.summary ?? false;
const ARTIFACT_NAME = "bench-output";
const ARTIFACT_FILE = "bench-output.txt";
const WORKSPACE = process.cwd();

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--summary") { out.summary = true; continue; }
    if (a === "--days") { out.days = Number(argv[++i]); continue; }
    if (a === "--runs") { out.runs = Number(argv[++i]); continue; }
    if (a === "--workflow") { out.workflow = argv[++i]; continue; }
    if (a === "--branch") { out.branch = argv[++i]; continue; }
    if (a === "--help" || a === "-h") {
      process.stdout.write(
        "Usage: node scripts/perf-trend.mjs [--days N] [--runs M] " +
        "[--workflow ci.yml] [--branch main] [--summary]\n",
      );
      process.exit(0);
    }
    throw new Error(`Unknown arg: ${a}`);
  }
  return out;
}

function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  if (res.error) throw res.error;
  return res;
}

// Parse BUDGETS associative array out of .github/workflows/ci.yml. Keeps the
// budget table single-sourced; if the workflow's budgets change, this script
// follows automatically.
function loadBudgets() {
  const yml = fs.readFileSync(
    path.join(WORKSPACE, ".github", "workflows", "ci.yml"),
    "utf8",
  );
  const start = yml.indexOf("declare -A BUDGETS=(");
  if (start < 0) return {};
  const end = yml.indexOf(")", start);
  const block = yml.slice(start, end);
  const out = {};
  for (const line of block.split("\n")) {
    const m = line.match(/\["([^"]+)"\]=(\d+)/);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

function listRuns() {
  // --status success only — we want clean data, no half-finished or failed runs.
  const res = sh("gh", [
    "run", "list",
    "--workflow", WORKFLOW,
    "--branch", BRANCH,
    "--status", "success",
    "--limit", String(RUNS),
    "--json", "databaseId,headSha,createdAt,displayTitle",
  ]);
  if (res.status !== 0) {
    throw new Error(`gh run list failed: ${res.stderr}`);
  }
  const all = JSON.parse(res.stdout);
  const cutoff = Date.now() - DAYS * 24 * 60 * 60 * 1000;
  return all.filter((r) => new Date(r.createdAt).getTime() >= cutoff);
}

function downloadArtifact(runId, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const res = sh("gh", [
    "run", "download", String(runId),
    "--name", ARTIFACT_NAME,
    "--dir", destDir,
  ]);
  if (res.status !== 0) {
    // Missing artifact (skipped run, retention expired, bench job didn't exist
    // yet) is normal — just signal absence to the caller.
    return null;
  }
  const p = path.join(destDir, ARTIFACT_FILE);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
}

// criterion --output-format bencher produces one line per measurement:
//   test <bench_id> ... bench:    N,NNN ns/iter (+/- M,MMM)
const BENCHER_RE = /^test\s+(\S+)\s+\.\.\.\s+bench:\s+([\d,]+)\s+ns\/iter\s+\(\+\/-\s*([\d,]+)\)/;

function parseBencherOutput(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(BENCHER_RE);
    if (!m) continue;
    out[m[1]] = {
      ns: Number(m[2].replace(/,/g, "")),
      dev: Number(m[3].replace(/,/g, "")),
    };
  }
  return out;
}

function fmtNs(ns) {
  if (ns >= 1_000_000) return `${(ns / 1_000_000).toFixed(2)} ms`;
  if (ns >= 1_000) return `${(ns / 1_000).toFixed(2)} µs`;
  return `${ns} ns`;
}

function median(nums) {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function fmtPct(delta) {
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}%`;
}

// Tiny ASCII sparkline: 8 levels, normalised across the bench's own range.
const BLOCKS = "▁▂▃▄▅▆▇█";
function sparkline(values) {
  if (values.length === 0) return "";
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (hi === lo) return BLOCKS[0].repeat(values.length);
  return values
    .map((v) => BLOCKS[Math.min(7, Math.floor(((v - lo) / (hi - lo)) * 7.999))])
    .join("");
}

function render({ runs, byBench, budgets, windowDays }) {
  const lines = [];
  lines.push(`# Perf bench trend — last ${windowDays} days`);
  lines.push("");
  lines.push(
    `**Window:** ${runs.length} successful \`${WORKFLOW}\` runs on ` +
    `\`${BRANCH}\` with bench output. ` +
    `**Profile:** \`release-ci\` (lto=off, codegen-units=16 — expect ` +
    `~1.5–2× slower than production \`release\`).`,
  );
  lines.push("");

  if (runs.length === 0) {
    lines.push("_No bench data in window._ Widen `--days` or check that the " +
      "`bench` job is producing the `bench-output` artifact.");
    return lines.join("\n");
  }

  // ── Missing benches ───────────────────────────────────────────────────
  // A budgeted bench that produced no output in the entire window is a
  // strong signal that a prior bench in `cargo bench`'s execution order
  // panicked and short-circuited the remaining harnesses. The CI summary
  // step is silent about this (it only prints rows for benches it sees
  // in bench-output.txt), so surfacing it here is one of the main
  // reasons this skill exists.
  const seenNames = new Set(Object.keys(byBench));
  const missingBudgeted = Object.keys(budgets)
    .filter((b) => !seenNames.has(b))
    .sort();
  if (missingBudgeted.length > 0) {
    lines.push("## ⚠️ Missing budgeted benches");
    lines.push("");
    lines.push(
      `${missingBudgeted.length} budgeted bench(es) produced **no output** ` +
      `in the last ${windowDays} days. Most common cause: an earlier bench ` +
      `harness panicked (\`cargo bench\` stops on first failure). ` +
      `Inspect a recent \`bench-output\` artifact for the panic.`,
    );
    lines.push("");
    for (const name of missingBudgeted) {
      lines.push(`- \`${name}\` (budget ${fmtNs(budgets[name])})`);
    }
    lines.push("");
  }

  // ── Summary table ─────────────────────────────────────────────────────
  lines.push("## Summary");
  lines.push("");
  lines.push("| Bench | Latest | Budget | Median | Δ vs median | Status | Trend |");
  lines.push("|---|---:|---:|---:|---:|---|---|");

  const benchNames = Object.keys(byBench).sort();
  const regressions = [];
  const improvements = [];

  for (const name of benchNames) {
    const series = byBench[name]; // [{run, ns, dev}, ...] newest first
    if (series.length === 0) continue;
    const latest = series[0];
    const all = series.map((s) => s.ns);
    const med = median(all);
    const budget = budgets[name];
    const deltaPct = med ? ((latest.ns - med) / med) * 100 : 0;

    let status = "—";
    if (budget != null) {
      status = latest.ns <= budget ? "✅" : "⚠️ over budget";
    }
    // Reverse sparkline values so left=old, right=new (matches reading order).
    const reversed = [...all].reverse();
    const spark = sparkline(reversed);
    const budgetLabel = budget != null ? fmtNs(budget) : "—";
    lines.push(
      `| \`${name}\` | ${fmtNs(latest.ns)} | ${budgetLabel} | ${fmtNs(med)} ` +
      `| ${fmtPct(deltaPct)} | ${status} | \`${spark}\` |`,
    );

    if (series.length >= 3 && deltaPct >= 10) {
      regressions.push({ name, deltaPct, latest, med, budget });
    } else if (series.length >= 3 && deltaPct <= -10) {
      improvements.push({ name, deltaPct, latest, med });
    }
  }
  lines.push("");

  // ── Movers ────────────────────────────────────────────────────────────
  regressions.sort((a, b) => b.deltaPct - a.deltaPct);
  improvements.sort((a, b) => a.deltaPct - b.deltaPct);
  if (regressions.length > 0 || improvements.length > 0) {
    lines.push("## Movers (≥10% vs median, ≥3 samples)");
    lines.push("");
  }
  if (regressions.length > 0) {
    lines.push("### Regressions");
    lines.push("");
    for (const r of regressions.slice(0, 5)) {
      const sha = r.latest.run.headSha.slice(0, 8);
      const title = r.latest.run.displayTitle;
      lines.push(
        `- \`${r.name}\`: ${fmtNs(r.latest.ns)} vs median ${fmtNs(r.med)} ` +
        `(**${fmtPct(r.deltaPct)}**) — latest run ${sha} _${title}_`,
      );
    }
    lines.push("");
  }
  if (improvements.length > 0) {
    lines.push("### Improvements");
    lines.push("");
    for (const i of improvements.slice(0, 5)) {
      const sha = i.latest.run.headSha.slice(0, 8);
      const title = i.latest.run.displayTitle;
      lines.push(
        `- \`${i.name}\`: ${fmtNs(i.latest.ns)} vs median ${fmtNs(i.med)} ` +
        `(**${fmtPct(i.deltaPct)}**) — latest run ${sha} _${title}_`,
      );
    }
    lines.push("");
  }

  // ── Per-bench history ─────────────────────────────────────────────────
  lines.push("## Per-bench history");
  lines.push("");
  for (const name of benchNames) {
    const series = byBench[name];
    if (series.length === 0) continue;
    lines.push(`<details><summary><code>${name}</code> (${series.length} samples)</summary>`);
    lines.push("");
    lines.push("| Date | Commit | ns/iter | ± dev | Title |");
    lines.push("|---|---|---:|---:|---|");
    for (const s of series) {
      const date = s.run.createdAt.slice(0, 16).replace("T", " ");
      const sha = s.run.headSha.slice(0, 8);
      const title = s.run.displayTitle.replace(/\|/g, "\\|").slice(0, 80);
      lines.push(
        `| ${date} | \`${sha}\` | ${fmtNs(s.ns)} | ±${fmtNs(s.dev)} | ${title} |`,
      );
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  // ── Footer ────────────────────────────────────────────────────────────
  lines.push("---");
  lines.push(`Generated by \`scripts/perf-trend.mjs\` at ${new Date().toISOString()}.`);
  return lines.join("\n");
}

function main() {
  const budgets = loadBudgets();
  const runs = listRuns();
  process.stderr.write(
    `Found ${runs.length} successful ${WORKFLOW} runs on ${BRANCH} ` +
    `in last ${DAYS} days.\n`,
  );

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "perf-trend-"));
  // Newest-first ordering preserved from `gh run list`.
  const byBench = {}; // name → [{run, ns, dev}, ...]
  let downloaded = 0;
  for (const r of runs) {
    const dest = path.join(tmpRoot, String(r.databaseId));
    const text = downloadArtifact(r.databaseId, dest);
    if (!text) {
      process.stderr.write(`  skip ${r.databaseId} (no artifact)\n`);
      continue;
    }
    downloaded += 1;
    const parsed = parseBencherOutput(text);
    for (const [name, { ns, dev }] of Object.entries(parsed)) {
      if (!byBench[name]) byBench[name] = [];
      byBench[name].push({ run: r, ns, dev });
    }
    process.stderr.write(
      `  ok   ${r.databaseId}  ${r.headSha.slice(0, 8)}  ` +
      `${Object.keys(parsed).length} benches\n`,
    );
  }
  // Best-effort tmp cleanup; we don't care if a worker still holds a handle.
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}

  const usableRuns = runs.filter((r) =>
    Object.values(byBench).some((s) => s.some((x) => x.run.databaseId === r.databaseId)),
  );

  const md = render({
    runs: usableRuns,
    byBench,
    budgets,
    windowDays: DAYS,
  });

  if (SUMMARY && process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
    process.stderr.write(
      `\nWrote ${md.split("\n").length} lines to $GITHUB_STEP_SUMMARY.\n`,
    );
  } else {
    process.stdout.write(md + "\n");
  }
  process.stderr.write(
    `\nDone. ${downloaded}/${runs.length} runs had bench-output artifacts; ` +
    `${Object.keys(byBench).length} distinct benches charted.\n`,
  );
}

main();
