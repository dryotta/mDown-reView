import { test as base, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

interface ErrorTrackingOptions {
  consoleErrorAllowlist: string[];
}

interface ErrorTrackingFixtures {
  consoleErrorAllowlist: string[];
}

const test = base.extend<ErrorTrackingFixtures & ErrorTrackingOptions>({
  consoleErrorAllowlist: [[], { option: true }],

  page: async ({ page, consoleErrorAllowlist }, use) => {
    const pageErrors: Error[] = [];
    const consoleErrors: string[] = [];

    // Provide __TAURI_INTERNALS__ before page scripts run so that
    // @tauri-apps/api's invoke() and listen() work in the Vite dev server.
    // Tests set window.__TAURI_IPC_MOCK__ to handle specific commands.
    await page.addInitScript(() => {
      const callbacks: Record<number, { callback: (...args: unknown[]) => void; once: boolean }> =
        {};
      let nextId = 1;
      (window as Record<string, unknown>).__TAURI_INTERNALS__ = {
        transformCallback(callback: (...args: unknown[]) => void, once: boolean): number {
          const id = nextId++;
          callbacks[id] = { callback, once };
          return id;
        },
        unregisterCallback(id: number): void {
          delete callbacks[id];
        },
        async invoke(cmd: string, args?: unknown): Promise<unknown> {
          if (cmd === "plugin:event|listen" || cmd === "plugin:event|unlisten") {
            return nextId++;
          }
          const mock = (window as Record<string, unknown>).__TAURI_IPC_MOCK__ as
            | ((cmd: string, args: unknown) => Promise<unknown>)
            | undefined;
          if (typeof mock === "function") {
            return mock(cmd, args ?? {});
          }
          return null;
        },
      };
      // Mock the event plugin internals used by @tauri-apps/api's unlisten() cleanup.
      (window as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        registerListener: () => {},
        unregisterListener: () => {},
      };
    });

    page.on("pageerror", (error) => {
      pageErrors.push(error);
    });

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        const allowed = consoleErrorAllowlist.some((pattern) => text.includes(pattern));
        if (!allowed) {
          consoleErrors.push(text);
        }
      }
    });

    await use(page);

    if (pageErrors.length > 0) {
      throw new Error(
        `Test failed: uncaught page errors:\n${pageErrors.map((e) => e.message).join("\n")}`
      );
    }
    if (consoleErrors.length > 0) {
      throw new Error(
        `Test failed: unexpected console errors:\n${consoleErrors.join("\n")}`
      );
    }
  },
});

export { test, expect };
export type { Page };
