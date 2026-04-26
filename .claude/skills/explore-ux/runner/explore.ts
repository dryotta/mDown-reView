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
