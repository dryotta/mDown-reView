import type { Page } from "@playwright/test";
import { runRules, type RuleHit } from "./analyze";
import { capture, type CaptureBundle } from "./capture";
import type { Flow, FlowStep } from "./flow-schema";

export interface EvidenceBundle extends CaptureBundle {
  flow: string;
  action: FlowStep;
  rule_hits: RuleHit[];
}

export interface ExploreOptions {
  steps: number;          // hard cap
  runDir: string;         // where capture writes screenshots
}

async function executeStep(page: Page, step: FlowStep): Promise<void> {
  switch (step.kind) {
    case "click":  await page.click(step.selector!); break;
    case "type":   await page.fill(step.selector!, step.text ?? ""); break;
    case "press":  await page.keyboard.press(step.key!); break;
    case "hover":  await page.hover(step.selector!); break;
    case "goto":   await page.goto(step.url!); break;
    case "wait":   await page.waitForTimeout(step.ms ?? 100); break;
    case "resize": await page.setViewportSize({
                     width: step.width ?? 1280,
                     height: step.height ?? 800,
                   }); break;
  }
}

/**
 * Iterate up to opts.steps actions across all flows (priority-ordered).
 * Pure driver: takes a Page (real or mocked) and a flow list.
 */
export async function explore(
  page: Page,
  flows: Flow[],
  opts: ExploreOptions,
): Promise<EvidenceBundle[]> {
  const queue = [...flows].sort((a, b) => a.priority - b.priority);
  const bundles: EvidenceBundle[] = [];
  let stepCount = 0;
  for (const flow of queue) {
    for (const step of flow.steps) {
      if (stepCount >= opts.steps) return bundles;
      stepCount += 1;
      try {
        await executeStep(page, step);
      } catch (e) {
        bundles.push({
          step: stepCount,
          ts: new Date().toISOString(),
          flow: flow.id,
          action: step,
          screenshot: "",
          domSnapshotSha: "",
          screenId: "(error)",
          snapshot: {
            html: "",
            console: [{ level: "error", text: `step failed: ${(e as Error).message}` }],
            ipc_errors: [],
            a11y_nodes: [],
            computed_styles: [],
          },
          rule_hits: [{
            id: "MDR-CONSOLE-ERROR",
            detail: `flow ${flow.id} step ${step.kind} failed`,
            anchor: step.selector ?? "(action)",
          }],
        });
        continue;
      }
      const cap = await capture(page, stepCount, opts.runDir);
      const rule_hits = runRules(cap.snapshot);
      bundles.push({ ...cap, flow: flow.id, action: step, rule_hits });
    }
  }
  return bundles;
}


// ---------------------------------------------------------------------------
// CLI entry: `tsx .claude/skills/explore-ux/runner/explore.ts [args]`
// ---------------------------------------------------------------------------

interface CliArgs {
  steps: number;
  vision: boolean;
  file: boolean;
  auto: boolean;
  noConfirm: boolean;
  seed?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const a: CliArgs = { steps: 50, vision: true, file: false, auto: false, noConfirm: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--steps")     a.steps = Math.min(200, parseInt(argv[++i], 10));
    else if (v === "--no-vision")  a.vision = false;
    else if (v === "--file")       a.file = true;
    else if (v === "--auto")       a.auto = true;
    else if (v === "--no-confirm") a.noConfirm = true;
    else if (v === "--seed")       a.seed = argv[++i];
    else if (v.startsWith("--seed=")) a.seed = v.slice(7);
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (process.platform !== "win32") {
    console.error("[explore-ux] Windows-only in v1. See docs/specs/skill-explore-ux.md 3.");
    process.exit(2);
  }
  const net = await import("node:net");
  const portFree = await new Promise<boolean>((resolve) => {
    const srv = net.createServer().once("error", () => resolve(false))
      .once("listening", () => srv.close(() => resolve(true)));
    srv.listen(9222, "127.0.0.1");
  });
  if (!portFree) {
    console.error("[explore-ux] CDP port 9222 is in use. Stop other sessions first.");
    process.exit(2);
  }

  const { spawnAppWithCdp } = await import("../../../../e2e/native/global-setup");
  const { chromium } = await import("@playwright/test");
  const { attachDrains } = await import("./capture");
  const { parseFlowCatalogue } = await import("./flow-schema");
  const { readFileSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { loadStore, mergeFinding, saveStore } = await import("./dedupe");
  const { writeReport, writeEvidenceLine } = await import("./report");
  const { fileIssue } = await import("./issues");

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = join(".claude/explore-ux/runs", runId);
  mkdirSync(join(runDir, "screenshots"), { recursive: true });

  console.log(`[explore-ux] Run ${runId} starting (steps=${args.steps}, vision=${args.vision}, file=${args.file})`);

  const { appProc } = await spawnAppWithCdp();
  let exitCode = 0;
  try {
    const browser = await chromium.connectOverCDP("http://localhost:9222");
    const ctx = browser.contexts()[0] ?? await browser.newContext();
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await attachDrains(page);
    const md = readFileSync(".claude/skills/explore-ux/flows/catalogue.md", "utf8");
    const flows = parseFlowCatalogue(md);
    const ordered = args.seed
      ? [...flows.filter((f) => f.id === args.seed), ...flows.filter((f) => f.id !== args.seed)]
      : flows;

    const startedAt = new Date().toISOString();
    const bundles = await explore(page, ordered, { steps: args.steps, runDir });
    const finishedAt = new Date().toISOString();

    bundles.forEach((b) => writeEvidenceLine(runDir, b));

    const storePath = ".claude/explore-ux/known-findings.json";
    const store = loadStore(storePath);
    const merges: { bundle: typeof bundles[number]; hit: typeof bundles[number]["rule_hits"][number]; merge: ReturnType<typeof mergeFinding> }[] = [];
    for (const b of bundles) {
      for (const hit of b.rule_hits) {
        const severity: "P1"|"P2"|"P3" = hit.id.startsWith("MDR-") || hit.id.startsWith("WCAG-") ? "P1"
          : hit.id.startsWith("NIELSEN-") ? "P2" : "P3";
        const merge = mergeFinding(store, {
          heuristic_id: hit.id, screen_id: b.screenId, anchor: hit.anchor,
          severity, detail: hit.detail, screenshot: b.screenshot,
        }, b.ts);
        merges.push({ bundle: b, hit, merge });
      }
    }

    if (args.file) {
      for (const m of merges.filter((m) => m.merge.status === "NEW")) {
        const heuristicFile = ".claude/skills/explore-ux/heuristics/" +
          (m.hit.id.startsWith("NIELSEN-") ? "nielsen.md"
          : m.hit.id.startsWith("WCAG-") ? "wcag-aa.md"
          : m.hit.id.startsWith("MDR-") ? "mdownreview-specific.md"
          : "anti-patterns.md");
        const severity: "P1"|"P2"|"P3" = m.hit.id.startsWith("MDR-") || m.hit.id.startsWith("WCAG-") ? "P1"
          : m.hit.id.startsWith("NIELSEN-") ? "P2" : "P3";
        const r = await fileIssue({
          heuristic_id: m.hit.id,
          heuristic_file: heuristicFile,
          severity,
          reproSteps: [`Action: ${m.bundle.action.kind} ${m.bundle.action.selector ?? m.bundle.action.key ?? ""}`, "Observe."],
          screenshot: m.bundle.screenshot,
          domAnchor: m.hit.anchor,
          suggestion: "See heuristic doc for direction.",
          runId,
          step: m.bundle.step,
          reproductions: store.findings[m.merge.key].reproductions,
          firstSeen: store.findings[m.merge.key].first_seen,
        }, { dryRun: false });
        if (r.status === "filed" && r.issue) store.findings[m.merge.key].issue = r.issue;
      }
    }

    saveStore(storePath, store);
    const reportPath = writeReport({
      runId, runDir, startedAt, finishedAt,
      visionEnabled: args.vision, dryRun: !args.file,
      bundles, merges,
    });
    console.log(`[explore-ux] Report: ${reportPath}`);
    await browser.close();
  } catch (e) {
    console.error("[explore-ux] Fatal:", e);
    exitCode = 1;
  } finally {
    try { appProc.kill(); } catch { /* already gone */ }
    process.exit(exitCode);
  }
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}
