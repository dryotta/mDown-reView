import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";
const DIAGRAM_MD = `${FIXTURES_DIR}/diagram.md`;
const FLOW_MMD = `${FIXTURES_DIR}/flow.mmd`;

const DIAGRAM_BODY = "# Mermaid embed test\n\n```mermaid\ngraph TD\n  A-->B\n```\n";
const FLOW_BODY = "graph TD\n  X-->Y\n";

async function setupMocks(page: Page): Promise<void> {
  await page.addInitScript(
    ({
      dir,
      diagramPath,
      flowPath,
      diagramBody,
      flowBody,
    }: {
      dir: string;
      diagramPath: string;
      flowPath: string;
      diagramBody: string;
      flowBody: string;
    }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__TAURI_IPC_MOCK__ = async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "get_launch_args") return { files: [], folders: [dir] };
        if (cmd === "read_dir") {
          return [
            { name: "diagram.md", path: diagramPath, is_dir: false },
            { name: "flow.mmd", path: flowPath, is_dir: false },
          ];
        }
        if (cmd === "read_text_file") {
          const path = (args?.path as string | undefined) ?? "";
          if (path === flowPath) return flowBody;
          return diagramBody;
        }
        if (cmd === "load_review_comments") return null;
        if (cmd === "save_review_comments") return null;
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
        return null;
      };
    },
    {
      dir: FIXTURES_DIR,
      diagramPath: DIAGRAM_MD,
      flowPath: FLOW_MMD,
      diagramBody: DIAGRAM_BODY,
      flowBody: FLOW_BODY,
    },
  );
}

async function openEmbeddedPopout(page: Page): Promise<void> {
  await setupMocks(page);
  await page.goto("/");
  await page.locator(".folder-tree").getByText("diagram.md").click();
  await expect(page.locator(".markdown-body")).toBeVisible();
  await expect(page.locator(".markdown-body .mermaid-embedded svg")).toBeVisible({
    timeout: 15_000,
  });
  await page.locator(".markdown-body .mermaid-embedded").first().hover();
  const popoutBtn = page.locator(".mermaid-embedded__popout-btn").first();
  await expect(popoutBtn).toBeVisible();
  await popoutBtn.click();
  await expect(page.locator(".mermaid-popout-overlay")).toBeVisible();
  await expect(page.locator(".mermaid-popout-overlay svg")).toBeVisible({ timeout: 15_000 });
}

test.describe("mermaid popout (issue #276)", () => {
  test("opens the popout from an embedded mermaid block", async ({ page }) => {
    await openEmbeddedPopout(page);
    await expect(
      page.locator('[role="dialog"][aria-label="Mermaid diagram preview"]'),
    ).toBeVisible();
  });

  test("Esc closes the popout", async ({ page }) => {
    await openEmbeddedPopout(page);
    await page.keyboard.press("Escape");
    await expect(page.locator(".mermaid-popout-overlay")).not.toBeVisible();
  });

  test("X button closes the popout", async ({ page }) => {
    await openEmbeddedPopout(page);
    await page.locator(".mermaid-popout-close").click();
    await expect(page.locator(".mermaid-popout-overlay")).not.toBeVisible();
  });

  test("opening another file closes the popout", async ({ page }) => {
    await openEmbeddedPopout(page);
    await page.locator(".folder-tree").getByText("flow.mmd").click();
    await expect(page.locator(".mermaid-popout-overlay")).not.toBeVisible();
  });

  test("clicking the Comments toolbar button closes the popout", async ({ page }) => {
    await openEmbeddedPopout(page);
    await page
      .locator('.toolbar-btn[title*="Comments" i], .toolbar-btn[aria-label*="Comments" i]')
      .first()
      .click();
    await expect(page.locator(".mermaid-popout-overlay")).not.toBeVisible();
  });

  test("renders the dedicated viewer for .mmd files with the floating Pop-out button", async ({
    page,
  }) => {
    await setupMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("flow.mmd").click();
    await expect(page.locator(".mermaid-canvas svg")).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator(".mermaid-canvas-actions button", { hasText: "Fit" }),
    ).toBeVisible();
    await expect(page.locator('button[aria-label="Pop out"]')).toBeVisible();
  });
});
