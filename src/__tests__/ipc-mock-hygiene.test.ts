// IPC-mock hygiene meta-test.
//
// All Vitest tests share a single canonical mock for `@tauri-apps/api/core`
// at `src/__mocks__/@tauri-apps/api/core.ts`. Test files opt into it with
// the BARE form: `vi.mock("@tauri-apps/api/core")`. Inline factory variants
// (`vi.mock("@tauri-apps/api/core", () => ({...}))`) defeat the purpose of
// the shared mock — they drift from production types and duplicate setup.
//
// This test mirrors the spirit of `event-chokepoint.test.ts`: enforce the
// IPC-mock chokepoint architecturally so it can't silently regress.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC_ROOT = join(__dirname, "..");

// Match the FACTORY form only — the trailing comma after the module string
// is what distinguishes `vi.mock("...", factory)` from the bare `vi.mock("...")`.
// The bare form is the desired pattern (it pulls in `src/__mocks__/`).
const FACTORY_VI_MOCK = /vi\.mock\(\s*["']@tauri-apps\/api\/core["']\s*,/;

export function hasFactoryCoreMock(content: string): boolean {
  return FACTORY_VI_MOCK.test(content);
}

function* walk(dir: string): IterableIterator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

function isTestFile(rel: string): boolean {
  return (
    /\.test\.(ts|tsx)$/.test(rel) ||
    rel.includes(`${sep}__tests__${sep}`)
  );
}

function isInsideMocks(rel: string): boolean {
  return rel.includes(`${sep}__mocks__${sep}`) || rel.startsWith(`__mocks__${sep}`);
}

describe("IPC mock hygiene (chokepoint architecture)", () => {
  it("no test file outside src/__mocks__/ uses an inline factory for @tauri-apps/api/core", () => {
    const offenders: string[] = [];
    // The meta-test itself contains literal example strings used in its
    // negative self-tests below; exclude it from the architectural scan.
    const SELF = relative(SRC_ROOT, __filename);

    for (const file of walk(SRC_ROOT)) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const rel = relative(SRC_ROOT, file);
      if (!isTestFile(rel)) continue;
      if (isInsideMocks(rel)) continue;
      if (rel === SELF) continue;

      const content = readFileSync(file, "utf8");
      if (hasFactoryCoreMock(content)) {
        offenders.push(rel);
      }
    }

    expect(
      offenders,
      `These tests use an inline factory for @tauri-apps/api/core. ` +
        `Use the bare form 'vi.mock("@tauri-apps/api/core")' so the ` +
        `shared mock at src/__mocks__/@tauri-apps/api/core.ts is applied. ` +
        `For per-test command behavior, use ` +
        `vi.mocked(invoke).mockImplementation((cmd, args) => ...) instead:\n  ` +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  // Negative self-test: prove the matcher would catch a violation if introduced.
  describe("hasFactoryCoreMock (matcher self-test)", () => {
    it("flags double-quoted factory call", () => {
      expect(
        hasFactoryCoreMock(`vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));`),
      ).toBe(true);
    });

    it("flags single-quoted factory call", () => {
      expect(
        hasFactoryCoreMock(`vi.mock('@tauri-apps/api/core', () => ({}));`),
      ).toBe(true);
    });

    it("flags multi-line factory call", () => {
      expect(
        hasFactoryCoreMock(`vi.mock(\n  "@tauri-apps/api/core",\n  () => ({})\n);`),
      ).toBe(true);
    });

    it("does NOT flag the bare auto-mock form", () => {
      expect(hasFactoryCoreMock(`vi.mock("@tauri-apps/api/core");`)).toBe(false);
    });

    it("does NOT flag mocks for other tauri modules", () => {
      expect(
        hasFactoryCoreMock(`vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));`),
      ).toBe(false);
    });
  });
});
