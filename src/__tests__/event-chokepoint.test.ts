import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC_ROOT = join(__dirname, "..");
// Files allowed to import from "@tauri-apps/api/event" directly.
const ALLOWED = new Set<string>([
  // The chokepoint itself.
  join("lib", "tauri-events.ts"),
]);

const FORBIDDEN_IMPORT = /from\s+["']@tauri-apps\/api\/event["']/;

export function hasForbiddenEventImport(content: string): boolean {
  return FORBIDDEN_IMPORT.test(content);
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
        `Use listenEvent from @/lib/tauri-events instead:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  // Negative self-test: ensure the matcher would catch a violation if one
  // were introduced. Guards against the meta-test silently passing because
  // the regex is broken or the walker skips files it shouldn't.
  describe("hasForbiddenEventImport (matcher self-test)", () => {
    it("flags double-quoted import from @tauri-apps/api/event", () => {
      expect(
        hasForbiddenEventImport(`import { listen } from "@tauri-apps/api/event";`),
      ).toBe(true);
    });

    it("flags single-quoted import from @tauri-apps/api/event", () => {
      expect(
        hasForbiddenEventImport(`import { listen } from '@tauri-apps/api/event';`),
      ).toBe(true);
    });

    it("does NOT flag imports from @/lib/tauri-events (the chokepoint)", () => {
      expect(
        hasForbiddenEventImport(`import { listenEvent } from "@/lib/tauri-events";`),
      ).toBe(false);
    });

    it("does NOT flag unrelated tauri imports", () => {
      expect(
        hasForbiddenEventImport(`import { invoke } from "@tauri-apps/api/core";`),
      ).toBe(false);
    });

    it("does NOT flag a partial / substring match", () => {
      // No "from" keyword preceding the package name => not an import statement.
      expect(
        hasForbiddenEventImport(`// see @tauri-apps/api/event for details`),
      ).toBe(false);
    });
  });
});
