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
    const SKIP = new Set(["SCRIPT","STYLE","TITLE","META","HEAD","LINK","NOSCRIPT","SVG","PATH","CIRCLE","RECT","G","DEFS","USE","SYMBOL"]);
    document.querySelectorAll("body *").forEach((el) => {
      if (seen.has(el)) return;
      if (SKIP.has(el.tagName)) return;
      const text = el.textContent?.trim() ?? "";
      if (!text || el.children.length > 0) return;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") return;
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      // Walk up ancestors to find first opaque background (handles inherited bg)
      let bg = cs.backgroundColor;
      let cur: Element | null = el.parentElement;
      while (cur && (bg === "rgba(0, 0, 0, 0)" || bg === "transparent" || bg.startsWith("rgba(") && bg.endsWith(", 0)"))) {
        bg = getComputedStyle(cur).backgroundColor;
        cur = cur.parentElement;
      }
      if (bg === "rgba(0, 0, 0, 0)" || bg === "transparent") {
        // Fallback to body/html computed background
        bg = getComputedStyle(document.body).backgroundColor;
        if (bg === "rgba(0, 0, 0, 0)" || bg === "transparent") {
          bg = getComputedStyle(document.documentElement).backgroundColor;
        }
        if (bg === "rgba(0, 0, 0, 0)" || bg === "transparent") bg = "rgb(255,255,255)";
      }
      const firstClass = el.classList && el.classList.length > 0 ? el.classList[0] : "";
      out.push({
        anchor: `${el.tagName.toLowerCase()}${firstClass ? "." + firstClass : ""}`,
        color: cs.color,
        background: bg,
        fontSize: parseFloat(cs.fontSize),
        fontWeight: parseInt(cs.fontWeight, 10) || 400,
      });
      seen.add(el);
    });
    return out;
  });

  // Accessibility snapshot via Playwright's a11y API (unavailable on WebView2 CDP).
  const a11y_nodes: { role: string; name: string }[] = [];
  if (page.accessibility) {
    try {
      const a11y = await page.accessibility.snapshot();
      const walk = (n: { role?: string; name?: string; children?: unknown[] } | null) => {
        if (!n) return;
        if (n.role) a11y_nodes.push({ role: n.role, name: n.name ?? "" });
        (n.children as { role?: string; name?: string; children?: unknown[] }[] | undefined)?.forEach(walk);
      };
      walk(a11y as never);
    } catch {
      // a11y unavailable — fall back to ARIA-attribute scrape below
    }
  }
  if (a11y_nodes.length === 0) {
    const aria = await page.evaluate(() => {
      const tagToRole: Record<string, string> = {
        nav: "navigation", header: "banner", main: "main",
        footer: "contentinfo", aside: "complementary", dialog: "dialog",
      };
      const out: { role: string; name: string }[] = [];
      document.querySelectorAll("[role], button, a, h1, h2, h3, nav, main, header, footer, aside, dialog").forEach((el) => {
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute("role") ?? tagToRole[tag] ?? tag;
        const name = el.getAttribute("aria-label") ?? el.getAttribute("title") ?? (el.textContent?.trim().slice(0, 60) ?? "");
        out.push({ role, name });
      });
      return out;
    });
    a11y_nodes.push(...aria);
  }

  // screen_id: route + landmark fingerprint (visible h1/h2 + landmarks + open dialog)
  const url = page.url();
  const landmarks = a11y_nodes
    .filter((n) => /^(banner|main|navigation|complementary|contentinfo|dialog|h1|h2|tab)$/.test(n.role))
    .map((n) => `${n.role}:${n.name.slice(0, 40)}`);
  const visibleHeaders = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll("h1, h2, [role='heading']").forEach((el) => {
      const t = el.textContent?.trim() ?? "";
      if (t) out.push(t.slice(0, 40));
    });
    return out;
  });
  const sig = [...landmarks, ...visibleHeaders.map((h) => `h:${h}`)].sort().join("|");
  const screenId = `${url}:${createHash("sha1").update(sig).digest("hex").slice(0, 8)}`;

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
