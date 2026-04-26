import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Page } from "@playwright/test";
import type { Snapshot } from "./analyze";

declare global {
  interface Window {
    __exploreUxConsole?: { level: string; text: string }[];
    __exploreUxIpcErrors?: { command: string; error: string }[];
  }
}

/**
 * Inject console + IPC drains BEFORE navigation.
 * Required because mdownreview's IPC errors don't all surface to console
 * (cf. src/store/index.ts:399-411 — only formatOnboardingError handles 'kind').
 */
export async function attachDrains(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__exploreUxConsole = [];
    window.__exploreUxIpcErrors = [];
    for (const level of ["log", "warn", "error"] as const) {
      const orig = console[level].bind(console);
      console[level] = (...args: unknown[]) => {
        window.__exploreUxConsole!.push({
          level,
          text: args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" "),
        });
        orig(...(args as []));
      };
    }
    const tauri = (window as unknown as {
      __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
    }).__TAURI_INTERNALS__;
    if (tauri) {
      const origInvoke = tauri.invoke;
      tauri.invoke = async (cmd: string, args?: unknown) => {
        try {
          return await origInvoke(cmd, args);
        } catch (err) {
          window.__exploreUxIpcErrors!.push({
            command: cmd,
            error: typeof err === "string" ? err : JSON.stringify(err),
          });
          throw err;
        }
      };
    }
  });
}

export interface CaptureBundle {
  step: number;
  ts: string;
  screenshot: string;
  domSnapshotSha: string;
  snapshot: Snapshot;
  screenId: string;
}

export async function capture(
  page: Page,
  step: number,
  runDir: string,
): Promise<CaptureBundle> {
  const ts = new Date().toISOString();
  const screenshotRel = `screenshots/step-${step}.png`;
  const screenshotAbs = join(runDir, screenshotRel);
  mkdirSync(dirname(screenshotAbs), { recursive: true });
  await page.screenshot({ path: screenshotAbs, fullPage: false });

  const html = await page.content();
  const domSnapshotSha = createHash("sha1").update(html).digest("hex");

  const drained = await page.evaluate(() => {
    const c = window.__exploreUxConsole ?? [];
    const i = window.__exploreUxIpcErrors ?? [];
    window.__exploreUxConsole = [];
    window.__exploreUxIpcErrors = [];
    return { c, i };
  });

  // Sample computed styles for every visible text-bearing element.
  const computed_styles = await page.evaluate(() => {
    const out: { anchor: string; color: string; background: string; fontSize: number; fontWeight: number }[] = [];
    const seen = new Set<Element>();
    document.querySelectorAll("*").forEach((el) => {
      if (seen.has(el)) return;
      const text = el.textContent?.trim() ?? "";
      if (!text || el.children.length > 0) return;
      const cs = getComputedStyle(el);
      out.push({
        anchor: `${el.tagName.toLowerCase()}${el.className ? "." + (el.className as string).split(/\s+/)[0] : ""}`,
        color: cs.color,
        background: cs.backgroundColor === "rgba(0, 0, 0, 0)" ? "rgb(255,255,255)" : cs.backgroundColor,
        fontSize: parseFloat(cs.fontSize),
        fontWeight: parseInt(cs.fontWeight, 10) || 400,
      });
      seen.add(el);
    });
    return out;
  });

  // Accessibility snapshot via Playwright's a11y API.
  const a11y = await page.accessibility.snapshot();
  const a11y_nodes: { role: string; name: string }[] = [];
  const walk = (n: { role?: string; name?: string; children?: unknown[] } | null) => {
    if (!n) return;
    if (n.role) a11y_nodes.push({ role: n.role, name: n.name ?? "" });
    (n.children as { role?: string; name?: string; children?: unknown[] }[] | undefined)?.forEach(walk);
  };
  walk(a11y as never);

  // screen_id: route + landmark fingerprint
  const url = page.url();
  const landmarkSig = a11y_nodes
    .filter((n) => /banner|main|navigation|complementary|contentinfo|dialog/.test(n.role))
    .map((n) => `${n.role}:${n.name}`)
    .sort()
    .join("|");
  const screenId = `${url}:${createHash("sha1").update(landmarkSig).digest("hex").slice(0, 8)}`;

  return {
    step,
    ts,
    screenshot: screenshotRel,
    domSnapshotSha,
    screenId,
    snapshot: {
      html,
      console: drained.c as Snapshot["console"],
      ipc_errors: drained.i,
      a11y_nodes,
      computed_styles,
    },
  };
}
