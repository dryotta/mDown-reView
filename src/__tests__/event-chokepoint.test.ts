import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC_ROOT = join(__dirname, "..");
// Files allowed to import from "@tauri-apps/api/event",
// "@tauri-apps/api/webview", or "@tauri-apps/api/webviewWindow" directly.
const ALLOWED = new Set<string>([
  // The chokepoint itself.
  join("lib", "tauri-events.ts"),
  // tauri-specta-generated bindings (issue #263) — emits unused
  // event-API scaffolding alongside the typed command wrappers. The
  // re-export façade in src/lib/tauri-commands.ts (iter 2) keeps
  // tauri-events as the only event chokepoint that production code
  // imports.
  join("lib", "bindings.ts"),
]);

const FORBIDDEN_IMPORT = /from\s+["']@tauri-apps\/api\/event["']/;
// PR #372 (drag-drop) — also funnel `@tauri-apps/api/webview` (used for
// `getCurrentWebview().onDragDropEvent`) and `@tauri-apps/api/webviewWindow`
// (used for the per-window listener-target binding in `listenEvent`)
// through the same chokepoint. The webview API is a parallel event
// surface; without this guard a future feature would silently sprout a
// second event-import policy.
const FORBIDDEN_WEBVIEW =
  /from\s+["']@tauri-apps\/api\/(webview|webviewWindow)["']/;

export function hasForbiddenEventImport(content: string): boolean {
  return FORBIDDEN_IMPORT.test(content);
}

export function hasForbiddenWebviewImport(content: string): boolean {
  return FORBIDDEN_WEBVIEW.test(content);
}

export function* walk(dir: string): IterableIterator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) {
      // Skip nothing — tests live under src/ but are excluded by filename below.
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

export function isTestFile(rel: string): boolean {
  // Vitest test files and __tests__ / __mocks__ directories.
  return (
    /\.test\.(ts|tsx)$/.test(rel) ||
    rel.includes(`${sep}__tests__${sep}`) ||
    rel.includes(`${sep}__mocks__${sep}`) ||
    /(^|[\\/])test-setup\.ts$/.test(rel)
  );
}

describe("event chokepoint architecture", () => {
  it("no production file outside @/lib/tauri-events imports @tauri-apps/api/event", () => {
    const offenders: string[] = [];

    for (const file of walk(SRC_ROOT)) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const rel = relative(SRC_ROOT, file);
      if (isTestFile(rel)) continue;
      if (ALLOWED.has(rel)) continue;

      const content = readFileSync(file, "utf8");
      if (hasForbiddenEventImport(content)) {
        offenders.push(rel);
      }
    }

    expect(
      offenders,
      `These files import @tauri-apps/api/event directly. ` +
        `Use listenEvent from @/lib/tauri-events instead:\n  ${offenders.join("\n  ")}`
    ).toEqual([]);
  });

  it("no production file outside @/lib/tauri-events imports @tauri-apps/api/webview or webviewWindow", () => {
    // PR #372 — drag-drop introduced `getCurrentWebview().onDragDropEvent`
    // as a parallel event surface. The webview / webviewWindow modules
    // expose listener primitives equivalent to `@tauri-apps/api/event` and
    // therefore must share the same single-chokepoint discipline so the
    // log shape, target-scoping defaults, and unsubscribe contract live
    // in exactly one production file.
    const offenders: string[] = [];

    for (const file of walk(SRC_ROOT)) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const rel = relative(SRC_ROOT, file);
      if (isTestFile(rel)) continue;
      if (ALLOWED.has(rel)) continue;

      const content = readFileSync(file, "utf8");
      if (hasForbiddenWebviewImport(content)) {
        offenders.push(rel);
      }
    }

    expect(
      offenders,
      `These files import @tauri-apps/api/webview or webviewWindow directly. ` +
        `Use listenEvent / listenDragDrop from @/lib/tauri-events instead:\n  ${offenders.join("\n  ")}`
    ).toEqual([]);
  });

  // Negative self-test: ensure the matcher would catch a violation if one
  // were introduced. Guards against the meta-test silently passing because
  // the regex is broken or the walker skips files it shouldn't.
  describe("hasForbiddenEventImport (matcher self-test)", () => {
    it("flags double-quoted import from @tauri-apps/api/event", () => {
      expect(hasForbiddenEventImport(`import { listen } from "@tauri-apps/api/event";`)).toBe(true);
    });

    it("flags single-quoted import from @tauri-apps/api/event", () => {
      expect(hasForbiddenEventImport(`import { listen } from '@tauri-apps/api/event';`)).toBe(true);
    });

    it("does NOT flag imports from @/lib/tauri-events (the chokepoint)", () => {
      expect(hasForbiddenEventImport(`import { listenEvent } from "@/lib/tauri-events";`)).toBe(
        false
      );
    });

    it("does NOT flag unrelated tauri imports", () => {
      expect(hasForbiddenEventImport(`import { invoke } from "@tauri-apps/api/core";`)).toBe(false);
    });

    it("does NOT flag a partial / substring match", () => {
      // No "from" keyword preceding the package name => not an import statement.
      expect(hasForbiddenEventImport(`// see @tauri-apps/api/event for details`)).toBe(false);
    });
  });

  describe("hasForbiddenWebviewImport (matcher self-test)", () => {
    it("flags @tauri-apps/api/webview import", () => {
      expect(
        hasForbiddenWebviewImport(`import { getCurrentWebview } from "@tauri-apps/api/webview";`)
      ).toBe(true);
    });

    it("flags @tauri-apps/api/webviewWindow import", () => {
      expect(
        hasForbiddenWebviewImport(
          `import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";`
        )
      ).toBe(true);
    });

    it("does NOT flag @tauri-apps/api/event (handled by the other matcher)", () => {
      expect(
        hasForbiddenWebviewImport(`import { listen } from "@tauri-apps/api/event";`)
      ).toBe(false);
    });

    it("does NOT flag chokepoint imports", () => {
      expect(
        hasForbiddenWebviewImport(`import { listenDragDrop } from "@/lib/tauri-events";`)
      ).toBe(false);
    });
  });
});
