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
      const eventListeners: Record<string, number[]> = {};
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
          if (cmd === "plugin:event|listen") {
            const { event, handler } = args as { event: string; handler: number };
            if (!eventListeners[event]) eventListeners[event] = [];
            eventListeners[event].push(handler);
            return nextId++;
          }
          if (cmd === "plugin:event|unlisten") {
            return nextId++;
          }
          const mock = (window as Record<string, unknown>).__TAURI_IPC_MOCK__ as
            | ((cmd: string, args: unknown) => Promise<unknown>)
            | undefined;
          if (typeof mock === "function") {
            const result = await mock(cmd, args ?? {});
            // If the test mock returned null, apply safe defaults for
            // infrastructure commands that were added after the test was written.
            if (result === null) {
              if (cmd === "get_unresolved_counts") return {};
              if (cmd === "get_file_comments") return [];
              if (cmd === "scan_review_files") return [];
              if (cmd === "update_watched_files") return undefined;
              if (cmd === "check_update") return null;
              if (cmd === "install_update") return null;
              if (cmd === "search_in_document") return [];
            }
            return result;
          }
          // Default fallback when no test-specific mock is set
          if (cmd === "get_unresolved_counts") return {};
          if (cmd === "get_file_comments") return [];
          if (cmd === "scan_review_files") return [];
          if (cmd === "update_watched_files") return undefined;
          if (cmd === "check_update") return null;
          if (cmd === "install_update") return null;
          if (cmd === "search_in_document") return [];
          return null;
        },
      };
      // Helper to dispatch events through the Tauri event system
      (window as Record<string, unknown>).__DISPATCH_TAURI_EVENT__ = (
        event: string,
        payload: unknown
      ) => {
        const handlers = eventListeners[event] || [];
        for (const id of handlers) {
          const entry = callbacks[id];
          if (entry) {
            entry.callback({ event, payload, id: nextId++ });
            if (entry.once) delete callbacks[id];
          }
        }
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
