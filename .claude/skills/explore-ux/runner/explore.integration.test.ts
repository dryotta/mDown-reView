import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { explore } from "./explore";
import type { Flow } from "./flow-schema";

function fakePage(scenario: { onClick?: () => void } = {}) {
  return {
    click: vi.fn(async () => scenario.onClick?.()),
    fill: vi.fn(async () => {}),
    keyboard: { press: vi.fn(async () => {}) },
    hover: vi.fn(async () => {}),
    goto: vi.fn(async () => {}),
    waitForTimeout: vi.fn(async () => {}),
    setViewportSize: vi.fn(async () => {}),
    screenshot: vi.fn(async () => {}),
    content: vi.fn(async () => "<html><body>ok</body></html>"),
    evaluate: vi.fn(async (fn: unknown) => {
      const src = typeof fn === "function" ? fn.toString() : String(fn);
      if (src.includes("__exploreUxConsole")) return { c: [], i: [] };
      return [];
    }),
    accessibility: { snapshot: vi.fn(async () => ({ role: "main", name: "", children: [] })) },
    url: () => "tauri://localhost/",
  } as unknown as import("@playwright/test").Page;
}

const FLOW: Flow = {
  id: "demo",
  name: "demo",
  priority: 1,
  steps: [
    { kind: "click", selector: "button.x" },
    { kind: "press", key: "Escape" },
  ],
};

describe("explore loop", () => {
  it("runs every step in flow order and emits one bundle per step", async () => {
    const page = fakePage();
    const dir = mkdtempSync(join(tmpdir(), "ux-int-"));
    const bundles = await explore(page, [FLOW], { steps: 10, runDir: dir });
    expect(bundles).toHaveLength(2);
    expect(bundles[0].flow).toBe("demo");
    expect(bundles[0].action.kind).toBe("click");
  });

  it("respects the steps cap", async () => {
    const page = fakePage();
    const dir = mkdtempSync(join(tmpdir(), "ux-int-"));
    const bundles = await explore(page, [FLOW], { steps: 1, runDir: dir });
    expect(bundles).toHaveLength(1);
  });

  it("records failure as evidence but continues", async () => {
    const page = fakePage({ onClick: () => { throw new Error("boom"); } });
    const dir = mkdtempSync(join(tmpdir(), "ux-int-"));
    const bundles = await explore(page, [FLOW], { steps: 10, runDir: dir });
    expect(bundles).toHaveLength(2);
    expect(bundles[0].rule_hits.map((h) => h.id)).toContain("MDR-CONSOLE-ERROR");
  });
});
