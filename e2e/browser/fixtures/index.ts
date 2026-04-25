import type { Page } from "@playwright/test";

export { test, expect } from "./error-tracking";

export interface LaunchArgs {
  files: string[];
  folders: string[];
}

/**
 * Push values into the in-page `get_launch_args` queue. Each subsequent
 * frontend call to `get_launch_args` shifts one entry off the queue.
 *
 * The queue is wired up in `error-tracking.ts` via `__TAURI_QUEUE_LAUNCH_ARGS__`
 * which `addInitScript` installs before page scripts run.
 */
export async function queueLaunchArgs(page: Page, values: LaunchArgs[]): Promise<void> {
  await page.evaluate((vals) => {
    const fn = (window as unknown as {
      __TAURI_QUEUE_LAUNCH_ARGS__?: (v: LaunchArgs[]) => void;
    }).__TAURI_QUEUE_LAUNCH_ARGS__;
    if (typeof fn !== "function") {
      throw new Error("__TAURI_QUEUE_LAUNCH_ARGS__ not installed — fixture init script missing");
    }
    fn(vals);
  }, values);
}

/**
 * Dispatch a Tauri event into the in-page event bus (mock). Wraps the
 * `__DISPATCH_TAURI_EVENT__` helper installed by the fixture.
 */
export async function dispatchTauriEvent(
  page: Page,
  event: string,
  payload: unknown = undefined,
): Promise<void> {
  await page.evaluate(
    ({ event: e, payload: p }) => {
      const fn = (window as unknown as {
        __DISPATCH_TAURI_EVENT__?: (e: string, p: unknown) => void;
      }).__DISPATCH_TAURI_EVENT__;
      if (typeof fn !== "function") {
        throw new Error("__DISPATCH_TAURI_EVENT__ not installed — fixture init script missing");
      }
      fn(e, p);
    },
    { event, payload },
  );
}
