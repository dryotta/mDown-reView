// Iter 8 Group A — verifies that images are commentable surfaces.
// Toggle comment mode → click on the image → save dispatches addComment with
// `kind:"image_rect"` carrying x_pct/y_pct. The pin marker persists across
// reload at the same percentages.

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

// 400×400 black PNG (raw zeros, deflate-compressed). Same fixture used by
// zoom-image-pan.spec.ts so the canvas+image sizing is predictable.
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAZAAAAGQCAAAAACl1GkQAAAAsklEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeDRyrgABKT7rhwAAAABJRU5ErkJggg==";

interface AddCommentArgs {
  filePath: string;
  text: string;
  anchor: { kind?: string; x_pct?: number; y_pct?: number; w_pct?: number; h_pct?: number } | null;
}

async function setupImageMocks(page: Page) {
  await page.addInitScript(({ dir, b64 }: { dir: string; b64: string }) => {
    (window as Record<string, unknown>).__ADD_COMMENT_CALLS__ = [];
    const STORAGE_KEY = "__e2e_image_comments__";
    const restored = (() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw) as Record<string, unknown>;
      } catch { /* ignore */ }
      return null;
    })();
    (window as Record<string, unknown>).__COMMENTS__ = restored ?? {
      mrsf_version: "1.1",
      document: "pic.png",
      comments: [] as Record<string, unknown>[],
    };
    function persist() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify((window as Record<string, unknown>).__COMMENTS__)); } catch { /* ignore */ }
    }

    function toThreads(): unknown[] {
      const raw = (window as Record<string, unknown>).__COMMENTS__ as { comments: Record<string, unknown>[] } | null;
      if (!raw) return [];
      const all = raw.comments;
      const roots = all.filter((c) => !c.reply_to);
      return roots.map((root) => ({
        root: { ...root, matchedLineNumber: 0, isOrphaned: false },
        replies: all
          .filter((c) => c.reply_to === root.id)
          .map((r) => ({ ...r, matchedLineNumber: 0, isOrphaned: false })),
      }));
    }

    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir") return [{ name: "pic.png", path: `${dir}/pic.png`, is_dir: false }];
      if (cmd === "read_binary_file") return b64;
      if (cmd === "stat_file") return { size_bytes: 800 };
      if (cmd === "load_review_comments") return (window as Record<string, unknown>).__COMMENTS__;
      if (cmd === "save_review_comments") return null;
      if (cmd === "get_file_comments") return { threads: toThreads(), sidecar_mtime_ms: null };
      if (cmd === "add_comment") {
        ((window as Record<string, unknown>).__ADD_COMMENT_CALLS__ as unknown[]).push(args);
        const sidecar = (window as Record<string, unknown>).__COMMENTS__ as { comments: Record<string, unknown>[] };
        const anchor = args.anchor as
          | { kind?: string; x_pct?: number; y_pct?: number; w_pct?: number; h_pct?: number }
          | null;
        sidecar.comments.push({
          id: "c-" + (sidecar.comments.length + 1),
          author: "Tester",
          timestamp: new Date().toISOString(),
          text: args.text,
          resolved: false,
          line: 0,
          anchor_kind: anchor?.kind ?? "line",
          ...(anchor?.kind === "image_rect"
            ? {
                image_rect: {
                  x_pct: anchor.x_pct,
                  y_pct: anchor.y_pct,
                  ...(anchor.w_pct !== undefined ? { w_pct: anchor.w_pct } : {}),
                  ...(anchor.h_pct !== undefined ? { h_pct: anchor.h_pct } : {}),
                },
              }
            : {}),
        });
        persist();
        // IPC mock auto-emits 'comments-changed' centrally; see fixtures/error-tracking.ts.
        return null;
      }
      if (cmd === "update_comment") return null;
      if (cmd === "check_path_exists") return "file";
      if (cmd === "get_log_path") return "/mock/log.log";
      if (cmd === "compute_anchor_hash") return "deadbeef";
      if (cmd === "get_file_badges") return {};
      return null;
    };
  }, { dir: FIXTURES_DIR, b64: TINY_PNG_B64 });
}

async function readAddCommentCalls(page: Page): Promise<AddCommentArgs[]> {
  return await page.evaluate(
    () => (window as Record<string, unknown>).__ADD_COMMENT_CALLS__ as AddCommentArgs[],
  );
}

test.describe("Iter 8 Group A — comment-on-image", () => {
  test("toggle comment mode → click → save persists pin at same x_pct/y_pct after reload", async ({ page }) => {
    await setupImageMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("pic.png").click();

    const img = page.locator(".image-viewer img");
    await expect(img).toBeVisible();

    // Enter comment mode.
    await page.getByRole("button", { name: /comment mode/i }).click();

    // Click roughly in the middle of the displayed image. The mocked PNG is
    // 400×400 natural, so clicking at the image's bbox centre yields
    // x_pct ≈ 0.5, y_pct ≈ 0.5 regardless of the canvas size.
    const ib = await img.boundingBox();
    expect(ib).not.toBeNull();
    const cx = ib!.x + ib!.width * 0.5;
    const cy = ib!.y + ib!.height * 0.5;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.up();

    const composer = page.locator(".image-viewer-composer");
    await expect(composer).toBeVisible();
    await composer.locator("textarea").fill("centre of the image");
    await composer.getByRole("button", { name: /^save$/i }).click();

    await expect.poll(() => readAddCommentCalls(page).then((c) => c.length)).toBeGreaterThanOrEqual(1);
    const calls = await readAddCommentCalls(page);
    const last = calls[calls.length - 1];
    expect(last.text).toBe("centre of the image");
    expect(last.anchor?.kind).toBe("image_rect");
    // Coordinates are 0..1 fractions (matches Rust image_rect resolver contract).
    expect(last.anchor?.x_pct).toBeGreaterThan(0.4);
    expect(last.anchor?.x_pct).toBeLessThan(0.6);
    expect(last.anchor?.y_pct).toBeGreaterThan(0.4);
    expect(last.anchor?.y_pct).toBeLessThan(0.6);
    // Single-point pin — no rect dimensions.
    expect(last.anchor?.w_pct).toBeUndefined();
    expect(last.anchor?.h_pct).toBeUndefined();

    const savedXPct = last.anchor!.x_pct!;
    const savedYPct = last.anchor!.y_pct!;

    // Marker now visible.
    await expect(page.locator(".image-viewer-marker.is-pin")).toBeVisible();

    // Reload — pin re-renders at the same x_pct/y_pct (same fraction of the
    // displayed image). Reading the image bbox post-reload and the marker's
    // centre lets us re-derive the pct and compare.
    await page.reload();
    await page.locator(".folder-tree").getByText("pic.png").click();
    const img2 = page.locator(".image-viewer img");
    await expect(img2).toBeVisible();
    const marker = page.locator(".image-viewer-marker.is-pin");
    await expect(marker).toBeVisible();

    const ib2 = await img2.boundingBox();
    const mb = await marker.boundingBox();
    expect(ib2).not.toBeNull();
    expect(mb).not.toBeNull();
    const markerCenterX = mb!.x + mb!.width / 2;
    const markerCenterY = mb!.y + mb!.height / 2;
    const reloadedXPct = (markerCenterX - ib2!.x) / ib2!.width;
    const reloadedYPct = (markerCenterY - ib2!.y) / ib2!.height;
    expect(Math.abs(reloadedXPct - savedXPct)).toBeLessThan(0.01);
    expect(Math.abs(reloadedYPct - savedYPct)).toBeLessThan(0.01);
  });
});
