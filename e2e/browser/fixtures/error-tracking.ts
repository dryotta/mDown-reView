import { test as base, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { COMMENT_MUTATION_COMMANDS } from "../../../src/lib/comment-mutation-commands";

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
    await page.addInitScript((commentMutations: readonly string[]) => {
      const callbacks: Record<number, { callback: (...args: unknown[]) => void; once: boolean }> =
        {};
      const eventListeners: Record<string, number[]> = {};
      let nextId = 1;
      // Queue of LaunchArgs values returned by successive `get_launch_args`
      // calls. Empty queue ⇒ default empty LaunchArgs. Tests push entries via
      // window.__TAURI_QUEUE_LAUNCH_ARGS__.
      const launchArgsQueue: { files: string[]; folders: string[] }[] = [];
      (window as Record<string, unknown>).__TAURI_QUEUE_LAUNCH_ARGS__ = (
        values: { files: string[]; folders: string[] }[]
      ) => {
        launchArgsQueue.push(...values);
      };
      (window as Record<string, unknown>).__TAURI_INTERNALS__ = {
        convertFileSrc(filePath: string, protocol: string = "asset"): string {
          // Mirrors the @tauri-apps/api implementation but doesn't depend on
          // the OS detection used in production builds. Audio/Video viewers
          // call this synchronously during render so it MUST exist on the
          // mock or the component throws.
          return `https://${protocol}.localhost/${encodeURIComponent(filePath)}`;
        },
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
            // Return the handler id as the eventId so unlisten can remove it.
            return handler;
          }
          if (cmd === "plugin:event|unlisten") {
            const { event, eventId } = args as { event: string; eventId: number };
            if (eventListeners[event]) {
              eventListeners[event] = eventListeners[event].filter((h) => h !== eventId);
            }
            delete callbacks[eventId];
            return undefined;
          }
          // Draining queue takes precedence so tests can drive multi-instance
          // scenarios without writing a custom mock per test.
          if (cmd === "get_launch_args" && launchArgsQueue.length > 0) {
            return launchArgsQueue.shift();
          }
          const mock = (window as Record<string, unknown>).__TAURI_IPC_MOCK__ as
            | ((cmd: string, args: unknown) => Promise<unknown>)
            | undefined;
          if (typeof mock === "function") {
            const result = await mock(cmd, args ?? {});
            // Auto-emit `comments-changed` after every successful sidecar
            // mutation invoke. Mirrors the Rust contract (Emitter::emit_to
            // after save) so specs don't need to dispatch the event by
            // hand — preventing skew between renderer subscribers and
            // the production wire format. The list is passed in from
            // `lib/comment-mutation-commands.ts` (single source of truth).
            if (commentMutations.indexOf(cmd) !== -1) {
              const a = (args ?? {}) as Record<string, unknown>;
              const filePath =
                (typeof a.filePath === "string" && a.filePath) ||
                (typeof a.file_path === "string" && a.file_path) ||
                "";
              if (filePath) {
                const handlers = eventListeners["comments-changed"] || [];
                for (const id of handlers) {
                  const cb = callbacks[id];
                  if (cb) {
                    cb.callback({
                      event: "comments-changed",
                      payload: { file_path: filePath },
                      id,
                    });
                  }
                }
              }
            }
            // read_text_file changed shape from `string` to `{ content, size_bytes, line_count }`.
            // Tests authored before that change still return a plain string — wrap it transparently
            // so the existing specs keep working without per-file edits.
            if (cmd === "read_text_file" && typeof result === "string") {
              return {
                content: result,
                size_bytes: new TextEncoder().encode(result).length,
                line_count: result.length === 0
                  ? 0
                  : result.split("\n").length - (result.endsWith("\n") ? 1 : 0),
              };
            }
            // If the test mock returned null, apply safe defaults for
            // infrastructure commands that were added after the test was written.
            if (result === null) {
              if (cmd === "get_file_comments") return [];
              if (cmd === "scan_review_files") return [];
              if (cmd === "update_watched_files") return undefined;
              if (cmd === "update_tree_watched_dirs") return undefined;
              if (cmd === "check_update") return null;
              if (cmd === "install_update") return null;
              if (cmd === "search_in_document") return [];
              if (cmd === "compute_fold_regions") return [];
              if (cmd === "parse_kql") return [];
              if (cmd === "strip_json_comments") return (args as { text?: string })?.text ?? "";
              if (cmd === "read_text_file") return { content: "", size_bytes: 0, line_count: 0 };
              // Onboarding (iter 2 + iter 3) — keep welcome auto-show OFF by default.
              if (
                cmd === "cli_shim_status" ||
                cmd === "default_handler_status" ||
                cmd === "folder_context_status"
              )
                return "missing";
              if (cmd === "onboarding_state")
                return { schema_version: 1, last_seen_sections: [] };
              if (cmd === "get_launch_args") return { files: [], folders: [] };
              if (
                cmd === "install_cli_shim" ||
                cmd === "remove_cli_shim" ||
                cmd === "set_default_handler" ||
                cmd === "register_folder_context" ||
                cmd === "unregister_folder_context"
              )
                return undefined;
              // Identity default for canonicalize_path so test mocks that
              // don't override it still return a usable string. Tests that
              // exercise canonicalisation override via __TAURI_IPC_MOCK__.
              if (cmd === "canonicalize_path") {
                const a = (args ?? {}) as Record<string, unknown>;
                return typeof a.path === "string" ? a.path : "";
              }
            }
            return result;
          }
          // Default fallback when no test-specific mock is set
          if (cmd === "get_file_comments") return [];
          if (cmd === "scan_review_files") return [];
          if (cmd === "update_watched_files") return undefined;
          if (cmd === "update_tree_watched_dirs") return undefined;
          if (cmd === "check_update") return null;
          if (cmd === "install_update") return null;
          if (cmd === "search_in_document") return [];
          if (cmd === "compute_fold_regions") return [];
          if (cmd === "parse_kql") return [];
          if (cmd === "strip_json_comments") return (args as { text?: string })?.text ?? "";
          if (cmd === "read_text_file") return { content: "", size_bytes: 0, line_count: 0 };
          if (
            cmd === "cli_shim_status" ||
            cmd === "default_handler_status" ||
            cmd === "folder_context_status"
          )
            return "missing";
          if (cmd === "onboarding_state")
            return { schema_version: 1, last_seen_sections: [] };
          if (cmd === "get_launch_args") return { files: [], folders: [] };
          if (
            cmd === "install_cli_shim" ||
            cmd === "remove_cli_shim" ||
            cmd === "set_default_handler" ||
            cmd === "register_folder_context" ||
            cmd === "unregister_folder_context"
          )
            return undefined;
          if (cmd === "canonicalize_path") {
            const a = (args ?? {}) as Record<string, unknown>;
            return typeof a.path === "string" ? a.path : "";
          }
          // ── Two-layer mock parity (issue #135) ─────────────────────────
          // Mirroring the Vitest mock defaults so unit-tests and browser
          // e2e tests observe the same baseline shape. Locked in by
          // src/__tests__/ipc-mock-parity.test.ts.
          if (cmd === "fetch_remote_asset") {
            // Default: empty 1×1 png-like blob in prefix-encoded shape.
            const ct = new TextEncoder().encode("image/png");
            const buf = new ArrayBuffer(4 + ct.byteLength);
            const view = new DataView(buf);
            view.setUint32(0, ct.byteLength, false);
            new Uint8Array(buf, 4).set(ct);
            return buf;
          }
          if (cmd === "get_file_badges") return {};
          if (cmd === "tokenize_words") return [];
          if (cmd === "export_review_summary") return "";
          if (cmd === "update_comment") return undefined;
          if (cmd === "set_author") return "";
          if (cmd === "get_author") return "Test User";
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
    }, [...COMMENT_MUTATION_COMMANDS]);

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
