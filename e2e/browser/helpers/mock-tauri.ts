import type { Page } from "@playwright/test";

interface MockConfig {
  [command: string]: (args: Record<string, unknown>) => unknown;
}

const defaultMocks: MockConfig = {
  get_launch_args: () => ({ files: [], folders: [] }),
  read_dir: () => [],
  read_text_file: () => ({ content: "", size_bytes: 0, line_count: 0 }),
  get_log_path: () => "/mock/path/mdownreview.log",
  save_review_comments: () => null,
  load_review_comments: () => null,
};

let overrideMocks: MockConfig = {};

export function configureMock(command: string, handler: (args: Record<string, unknown>) => unknown) {
  overrideMocks[command] = handler;
}

export async function setupTauriMocks(page: Page) {
  overrideMocks = {};
  await page.addInitScript(() => {
    // Install a global IPC interceptor that the app's invoke() will call
    (window as unknown as Record<string, unknown>).__TAURI_MOCK_HANDLERS__ = {};
  });
}

export async function teardownTauriMocks(_page: Page) {
  overrideMocks = {};
}

export async function injectMocks(page: Page) {
  const mocks = { ...defaultMocks, ...overrideMocks };
  await page.addInitScript((handlers: Record<string, string>) => {
    // Override window.__TAURI_INTERNALS__ to intercept invoke calls
    const originalInternals = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      get() {
        return {
          ...originalInternals,
          invoke: async (cmd: string, args?: unknown) => {
            const handler = (handlers as Record<string, string>)[cmd];
            if (handler) {
              return JSON.parse(handler)(args ?? {});
            }
            throw new Error(`No mock for command: ${cmd}`);
          },
        };
      },
      configurable: true,
    });
  }, Object.fromEntries(
    Object.entries(mocks).map(([cmd, fn]) => [cmd, fn.toString()])
  ));
}
