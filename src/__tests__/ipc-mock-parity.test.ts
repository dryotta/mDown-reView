import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Issue #135 — two-layer IPC mock parity contract.
 *
 * The codebase has two independent mock layers for Tauri IPC:
 *   1. `src/__mocks__/@tauri-apps/api/core.ts`         — Vitest unit/component layer
 *   2. `e2e/browser/fixtures/error-tracking.ts`         — Playwright browser layer
 *
 * They serve different runtimes (jsdom vs real Vite browser), so both must
 * exist. But they MUST NOT silently disagree: iter 3 of #89 added the
 * `canonicalize_path` command, updated only the Vitest mock, and the
 * Playwright fixture fell through to `return null`. `setRoot(null)`
 * cascaded into a TypeError at `basename(item.path)` and ~50 browser specs
 * failed. (Same class of bug just hit on PR #165 / issue #96 — the
 * `get_file_comments` envelope shape change broke ~119 e2e specs that had
 * inline mocks returning bare arrays.)
 *
 * Contract enforced here: for every IPC command name referenced from
 * `src/lib/tauri-commands.ts` (the chokepoint), if EITHER mock has an
 * explicit `cmd === "<name>"` arm, BOTH mocks must. (Falling through to
 * the catch-all is OK for both; what is NOT OK is one mock returning a
 * tailored shape while the other returns the catch-all.)
 */

const ROOT = resolve(__dirname, "../..");
const TAURI_COMMANDS = readFileSync(resolve(ROOT, "src/lib/tauri-commands.ts"), "utf8");
const VITEST_MOCK = readFileSync(
  resolve(ROOT, "src/__mocks__/@tauri-apps/api/core.ts"),
  "utf8",
);
const PLAYWRIGHT_FIXTURE = readFileSync(
  resolve(ROOT, "e2e/browser/fixtures/error-tracking.ts"),
  "utf8",
);

// Extract every `invoke<...>("<command_name>"...)` literal from the chokepoint.
function extractCommands(src: string): Set<string> {
  const out = new Set<string>();
  // Match `invoke` then anything except `(` (covers nested generics, arrays,
  // unions, type params) up to the call's opening paren and the literal name.
  const re = /\binvoke[^(]*\(\s*["']([a-z_][a-z0-9_]*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  return out;
}

// Extract every `cmd === "<name>"` arm from a mock file.
function extractExplicitArms(src: string): Set<string> {
  const out = new Set<string>();
  const re = /cmd\s*===\s*["']([a-z_][a-z0-9_]*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  return out;
}

const COMMANDS = extractCommands(TAURI_COMMANDS);
const VITEST_ARMS = extractExplicitArms(VITEST_MOCK);
const PLAYWRIGHT_ARMS = extractExplicitArms(PLAYWRIGHT_FIXTURE);

// Plugin pseudo-commands like `plugin:event|listen` are framework-internal,
// not part of tauri-commands.ts. Keep them out of the parity set.
const FRAMEWORK_INTERNAL = new Set<string>(["plugin"]);

describe("two-layer IPC mock parity contract (issue #135)", () => {
  it("extracts a non-empty IPC command set from tauri-commands.ts (sanity)", () => {
    expect(COMMANDS.size).toBeGreaterThan(20);
    // Spot-check well-known commands so a wholesale rename of the chokepoint
    // doesn't make this test silently extract zero commands.
    expect(COMMANDS.has("read_text_file")).toBe(true);
    expect(COMMANDS.has("get_file_comments")).toBe(true);
    expect(COMMANDS.has("canonicalize_path")).toBe(true);
  });

  it("every command explicit in EITHER mock must be explicit in BOTH (no silent skew)", () => {
    const skew: { command: string; vitest: boolean; playwright: boolean }[] = [];
    const union = new Set<string>([...VITEST_ARMS, ...PLAYWRIGHT_ARMS]);
    for (const cmd of union) {
      if (FRAMEWORK_INTERNAL.has(cmd)) continue;
      const inVitest = VITEST_ARMS.has(cmd);
      const inPlaywright = PLAYWRIGHT_ARMS.has(cmd);
      if (!(inVitest && inPlaywright) && COMMANDS.has(cmd)) {
        skew.push({ command: cmd, vitest: inVitest, playwright: inPlaywright });
      }
    }
    if (skew.length > 0) {
      const msg = skew
        .map(
          (s) =>
            `  - ${s.command}: vitest=${s.vitest ? "✓" : "✗"} playwright=${s.playwright ? "✓" : "✗"}`,
        )
        .join("\n");
      throw new Error(
        `Mock parity violation — the following IPC command(s) have an explicit handler in only one mock layer.\n` +
          `Add the missing arm so both layers return the same shape (or remove it from both and rely on the catch-all):\n${msg}`,
      );
    }
  });

  it("explicit-arm names referenced from mocks must exist in tauri-commands.ts (catches typos)", () => {
    const orphans: { command: string; mock: string }[] = [];
    for (const cmd of VITEST_ARMS) {
      if (FRAMEWORK_INTERNAL.has(cmd)) continue;
      if (!COMMANDS.has(cmd)) orphans.push({ command: cmd, mock: "vitest" });
    }
    for (const cmd of PLAYWRIGHT_ARMS) {
      if (FRAMEWORK_INTERNAL.has(cmd)) continue;
      if (!COMMANDS.has(cmd)) orphans.push({ command: cmd, mock: "playwright" });
    }
    if (orphans.length > 0) {
      const msg = orphans.map((o) => `  - ${o.mock}: "${o.command}"`).join("\n");
      throw new Error(
        `Mock-arm references a command name that is not declared in src/lib/tauri-commands.ts.\n` +
          `Likely a typo or a deleted command. Update the mock or restore the wrapper:\n${msg}`,
      );
    }
  });
});
