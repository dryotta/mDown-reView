// AI-driven explore-ux REPL.
//
// One Node process. Long-lived. Owns the Playwright browser + page.
// Reads NDJSON commands from stdin, writes NDJSON responses to stdout.
// Stderr is reserved for human-readable diagnostics so it doesn't
// interleave with the protocol channel.
//
// The agent (you) drives the loop: screenshot+observe → reason → act → repeat.
//
// All long-running setup (CDP attach, drains) happens before the first read,
// so by the time the agent sees the "ready" line on stdout the REPL is hot.

import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { attachDrains, capture } from "./capture";
import { runRules } from "./analyze";
import { loadStore, mergeFinding, saveStore, type Finding } from "./dedupe";
import {
  parseCommand, ok, err, type Command, type Response,
  type Interactive, type Landmark, type Observation, type StopResult,
} from "./tools";

interface Session {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  runId: string;
  runDir: string;
  storePath: string;
  step: number;
  findingsCount: { new: number; reproduced: number };
}

async function setup(): Promise<Session> {
  const { spawnAppWithCdp } = await import("../../../../e2e/native/global-setup");
  const { chromium } = await import("@playwright/test");

  process.stderr.write("[repl] spawning app + attaching CDP...\n");
  await spawnAppWithCdp();
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const context = browser.contexts()[0] ?? await browser.newContext();
  const page = context.pages()[0] ?? await context.newPage();
  await attachDrains(page);

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = join(".claude/explore-ux/runs", runId);
  mkdirSync(join(runDir, "screenshots"), { recursive: true });

  const storePath = ".claude/explore-ux/known-findings.json";

  return {
    browser, context, page, runId, runDir, storePath,
    step: 0,
    findingsCount: { new: 0, reproduced: 0 },
  };
}

// Build a unique CSS selector for an element. Prefers id → data-testid →
// stable class chain → nth-of-type fallback. Stays inside the page eval.
function makeSelectorFn(): string {
  return `(el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    const tid = el.getAttribute('data-testid');
    if (tid) return el.tagName.toLowerCase() + "[data-testid='" + tid + "']";
    const aria = el.getAttribute('aria-label');
    if (aria && aria.length < 60) return el.tagName.toLowerCase() + "[aria-label='" + aria.replace(/'/g, "\\\\'") + "']";
    const cls = el.classList && el.classList.length > 0 ? '.' + el.classList[0] : '';
    let sel = el.tagName.toLowerCase() + cls;
    // Disambiguate with nth-of-type if not unique
    if (cls && document.querySelectorAll(sel).length > 1) {
      let idx = 1;
      let sib = el.previousElementSibling;
      while (sib) { if (sib.tagName === el.tagName) idx++; sib = sib.previousElementSibling; }
      sel += ':nth-of-type(' + idx + ')';
    }
    return sel;
  }`;
}

async function observe(page: Page): Promise<Observation> {
  const url = page.url();
  const title = await page.title();
  const cdpVp = page.viewportSize();
  const viewport = cdpVp && cdpVp.width > 0
    ? cdpVp
    : await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));

  const drained = await page.evaluate(() => {
    const c = window.__exploreUxConsole ?? [];
    const i = window.__exploreUxIpcErrors ?? [];
    window.__exploreUxConsole = [];
    window.__exploreUxIpcErrors = [];
    return { c, i };
  });

  const interactives = await page.evaluate((selectorFnSrc: string) => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const sel = new Function("return " + selectorFnSrc)() as (el: Element) => string;
    const tagToRole: Record<string, string> = {
      button: "button", a: "link", input: "textbox", textarea: "textbox",
      select: "combobox", nav: "navigation", header: "banner", main: "main",
      footer: "contentinfo", aside: "complementary", dialog: "dialog",
    };
    const out: Interactive[] = [];
    const seenSel = new Set<string>();
    const nodes = document.querySelectorAll(
      "button, a, input, textarea, select, [role='button'], [role='link'], [role='tab'], [role='menuitem'], [tabindex]:not([tabindex='-1'])"
    );
    nodes.forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") return;
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute("role") ?? tagToRole[tag] ?? tag;
      const name = el.getAttribute("aria-label")
        ?? el.getAttribute("title")
        ?? (el as HTMLElement).innerText?.trim().slice(0, 80)
        ?? "";
      const text = ((el as HTMLElement).innerText ?? el.textContent ?? "").trim().slice(0, 80);
      const classes: string[] = [];
      for (let k = 0; k < Math.min(2, el.classList.length); k++) classes.push(el.classList[k]);
      let selector: string;
      try { selector = sel(el); } catch { selector = tag; }
      if (seenSel.has(selector)) return;
      seenSel.add(selector);
      out.push({
        selector, tag, role, name, text, classes,
        bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        visible: true,
        enabled: !(el as HTMLInputElement).disabled,
      });
    });
    return out;
  }, makeSelectorFn());

  const landmarks = await page.evaluate(() => {
    const tagToRole: Record<string, string> = {
      nav: "navigation", header: "banner", main: "main",
      footer: "contentinfo", aside: "complementary", dialog: "dialog",
    };
    const out: Landmark[] = [];
    document.querySelectorAll(
      "[role='banner'], [role='navigation'], [role='main'], [role='contentinfo'], [role='complementary'], [role='dialog'], header, nav, main, footer, aside, dialog"
    ).forEach((el) => {
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute("role") ?? tagToRole[tag] ?? tag;
      const label = el.getAttribute("aria-label")
        ?? el.querySelector("h1,h2,h3")?.textContent?.trim().slice(0, 60)
        ?? undefined;
      const id = el.id;
      const cls = el.classList && el.classList.length > 0 ? "." + el.classList[0] : "";
      out.push({
        role,
        selector: id ? `#${id}` : `${tag}${cls}`,
        label,
      });
    });
    return out;
  });

  // Reuse capture() for screenId fingerprint logic by piggybacking lightly.
  // Cheap recompute here so we don't have to write a screenshot just to observe.
  const screenId = await page.evaluate(() => {
    const tagToRole: Record<string, string> = {
      nav: "navigation", header: "banner", main: "main",
      footer: "contentinfo", aside: "complementary", dialog: "dialog",
    };
    const parts: string[] = [];
    document.querySelectorAll("[role], header, nav, main, footer, aside, dialog, h1, h2").forEach((el) => {
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute("role") ?? tagToRole[tag] ?? tag;
      if (!/^(banner|main|navigation|complementary|contentinfo|dialog|h1|h2|tab)$/.test(role)) return;
      const name = el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? "";
      parts.push(`${role}:${name}`);
    });
    parts.sort();
    let h = 5381;
    const s = parts.join("|");
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16).padStart(8, "0");
  });

  return {
    url, title,
    screenId: `${url}:${screenId}`,
    viewport,
    interactives,
    landmarks,
    consoleErrors: drained.c
      .filter((c) => c.level === "error" || c.level === "warn")
      .map((c) => ({ ts: new Date().toISOString(), text: c.text })),
    ipcErrors: drained.i.map((i) => ({
      ts: new Date().toISOString(), cmd: i.command, error: i.error,
    })),
  };
}

async function takeScreenshot(s: Session): Promise<{ png: string }> {
  s.step += 1;
  const rel = `screenshots/step-${s.step}.png`;
  const abs = join(s.runDir, rel);
  await s.page.screenshot({ path: abs, fullPage: false });
  return { png: abs.replace(/\\/g, "/") };
}

async function execute(cmd: Command, s: Session): Promise<Response> {
  try {
    switch (cmd.act) {
      case "screenshot": return ok(await takeScreenshot(s));
      case "observe":    return ok(await observe(s.page));
      case "click":      await s.page.click(cmd.selector, { timeout: 3000 }); return ok({ ok: true });
      case "press":      await s.page.keyboard.press(cmd.key); return ok({ ok: true });
      case "type":       await s.page.fill(cmd.selector, cmd.text, { timeout: 3000 }); return ok({ ok: true });
      case "hover":      await s.page.hover(cmd.selector, { timeout: 3000 }); return ok({ ok: true });
      case "resize":     await s.page.setViewportSize({ width: cmd.width, height: cmd.height }); return ok({ ok: true });
      case "emit": {
        const event = cmd.event;
        await s.page.evaluate(async (ev) => {
          const w = window as unknown as {
            __TAURI__?: { event?: { emit: (e: string, p?: unknown) => Promise<void> } };
            __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
          };
          if (w.__TAURI__?.event?.emit) await w.__TAURI__.event.emit(ev);
          else if (w.__TAURI_INTERNALS__?.invoke) await w.__TAURI_INTERNALS__.invoke("plugin:event|emit", { event: ev, payload: null });
          else throw new Error(`Tauri event API unavailable; cannot emit '${ev}'`);
        }, event);
        return ok({ ok: true });
      }
      case "cli": {
        const { spawn } = await import("node:child_process");
        const { existsSync } = await import("node:fs");
        const exe = ["src-tauri/target/debug/mdownreview.exe", "src-tauri/target/release/mdownreview.exe"]
          .find((p) => existsSync(p));
        if (!exe) throw new Error("mdownreview.exe not found");
        const child = spawn(exe, cmd.args, { detached: true, stdio: "ignore" });
        child.unref();
        await s.page.waitForTimeout(500);
        return ok({ ok: true });
      }
      case "rules": {
        // Run a full capture once so analyze.ts has every input it needs.
        const cap = await capture(s.page, s.step, s.runDir);
        return ok({ hits: runRules(cap.snapshot) });
      }
      case "record": {
        const finding: Finding = {
          heuristic_id: cmd.heuristic,
          screen_id: (await observe(s.page)).screenId,
          anchor: cmd.anchor,
          severity: cmd.severity,
          detail: cmd.detail,
          screenshot: cmd.screenshot,
        };
        const store = loadStore(s.storePath);
        const result = mergeFinding(store, finding, new Date().toISOString());
        saveStore(s.storePath, store);
        appendFileSync(join(s.runDir, "findings.jsonl"), JSON.stringify({
          ts: new Date().toISOString(),
          step: s.step,
          ...finding,
          status: result.status,
          key: result.key,
        }) + "\n");
        if (result.status === "NEW") s.findingsCount.new += 1;
        else s.findingsCount.reproduced += 1;
        return ok({ status: result.status, key: result.key });
      }
      case "stop": {
        const reportPath = join(s.runDir, "report.md");
        writeReport(s, reportPath);
        await s.browser.close().catch(() => {});
        const result: StopResult = {
          findings: s.findingsCount.new + s.findingsCount.reproduced,
          newCount: s.findingsCount.new,
          reproducedCount: s.findingsCount.reproduced,
          runDir: s.runDir,
          reportPath,
        };
        return ok(result);
      }
    }
  } catch (e) {
    return err(e);
  }
}

function writeReport(s: Session, path: string): void {
  const findingsPath = join(s.runDir, "findings.jsonl");
  let lines: string[] = [];
  try {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    lines = readFileSync(findingsPath, "utf8").split("\n").filter(Boolean);
  } catch { /* no findings */ }
  const recs = lines.map((l) => JSON.parse(l) as {
    ts: string; step: number; heuristic_id: string; severity: string;
    anchor: string; detail: string; screenshot: string; status: string;
  });
  const md = [
    `# explore-ux v2 run ${s.runId}`,
    ``,
    `- Steps:    ${s.step}`,
    `- Findings: ${s.findingsCount.new} new, ${s.findingsCount.reproduced} reproduced`,
    ``,
    `## Findings`,
    ``,
    `| # | Status | Sev | Heuristic | Anchor | Detail | Screenshot |`,
    `|---|---|---|---|---|---|---|`,
    ...recs.map((r, i) =>
      `| ${i + 1} | ${r.status} | ${r.severity} | ${r.heuristic_id} | \`${r.anchor}\` | ${r.detail.replace(/\|/g, "\\|").slice(0, 200)} | ${r.screenshot} |`),
    ``,
  ].join("\n");
  writeFileSync(path, md);
}

async function main(): Promise<void> {
  if (process.platform !== "win32") {
    process.stderr.write("[repl] Windows-only in v1.\n");
    process.exit(2);
  }
  const session = await setup();
  process.stderr.write(`[repl] ready (runDir=${session.runDir})\n`);
  process.stdout.write(JSON.stringify({ ready: true, runDir: session.runDir }) + "\n");

  const rl = createInterface({ input: process.stdin, terminal: false });
  const responsesPath = join(session.runDir, "responses.jsonl");
  const requestsPath = join(session.runDir, "requests.jsonl");
  const writeResponse = (resp: Response): void => {
    const line = JSON.stringify(resp) + "\n";
    process.stdout.write(line);
    try { appendFileSync(responsesPath, line); } catch { /* best-effort */ }
  };
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { appendFileSync(requestsPath, trimmed + "\n"); } catch { /* best-effort */ }
    let response: Response;
    try {
      const cmd = parseCommand(trimmed);
      response = await execute(cmd, session);
      writeResponse(response);
      if (cmd.act === "stop") break;
    } catch (e) {
      response = err(e);
      writeResponse(response);
    }
  }
  process.exit(0);
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}

export { execute, observe, takeScreenshot, setup };
