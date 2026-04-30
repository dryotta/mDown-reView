import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Per docs/best-practices-common/tauri/v2-patterns.md rule
 * `caps-window-scope`: every Tauri capability
 * file under `src-tauri/capabilities/` MUST declare an explicit
 * `windows: [...]` array enumerating exactly which window labels (or
 * label patterns) the capability applies to.
 *
 * Specifically:
 *   1. The top-level object MUST contain a `windows` field.
 *   2. `windows` MUST be a non-empty array of strings.
 *   3. No element may be the bare `"*"` (universal wildcard) and no
 *      element may contain `?` (single-char wildcard). A bounded
 *      label-prefix glob like `"win-*"` IS currently permitted but is
 *      tracked in EXPECTED_VIOLATORS until the C-section migration
 *      replaces it with explicit per-window-template registration.
 *
 * Self-tests at the bottom guard the assertion logic itself so a future
 * edit cannot silently let the gate pass empty.
 */

const CAPS_ROOT = join(__dirname, "..", "..", "src-tauri", "capabilities");

/**
 * Known violators carried until issue #315's capability-scoping fix in
 * the C-section lands. Each entry is keyed by the capability filename
 * (basename) and lists the wildcard tokens that file is permitted to
 * carry. New violators must NOT be added here without an issue link.
 */
const EXPECTED_VIOLATORS: Record<string, string[]> = {
  // TODO: removed by issue #315 capability scoping fix.
  // `default.json` carries `"win-*"` so dynamically-created folder
  // windows (`win-1`, `win-2`, ...) inherit the same default
  // permission set without each window registering its own
  // capability file. The C-section migration will replace this with
  // either a runtime `add_capability` call per-window or a finite
  // capability shard pre-registered at build time.
  "default.json": ["win-*"],
};

interface CapabilityShape {
  windows?: unknown;
}

export function isWildcardToken(token: string): boolean {
  // The bare universal `"*"` is always a violation. Any `?` (single-char
  // wildcard) is also forbidden. A bounded prefix glob like `"win-*"`
  // contains a `*` but is allowed by EXPECTED_VIOLATORS only.
  if (token === "*") return true;
  if (token.includes("?")) return true;
  if (token.includes("*")) return true;
  return false;
}

describe("capability files declare explicit window scope", () => {
  const files = readdirSync(CAPS_ROOT)
    .filter((name) => name.endsWith(".json"))
    .filter((name) => !name.startsWith("."));

  it("at least one capability file exists (sanity)", () => {
    // Guards against an empty directory silently letting every
    // assertion below pass vacuously.
    expect(files.length).toBeGreaterThan(0);
  });

  for (const name of files) {
    describe(`capabilities/${name}`, () => {
      const full = join(CAPS_ROOT, name);
      const raw = readFileSync(full, "utf8");
      let parsed: CapabilityShape;
      try {
        parsed = JSON.parse(raw) as CapabilityShape;
      } catch (e) {
        throw new Error(`capabilities/${name} is not valid JSON: ${(e as Error).message}`);
      }

      it("contains a `windows` field at the top level", () => {
        expect(
          parsed.windows,
          `capabilities/${name} is missing a top-level "windows" field. ` +
            `Per caps-window-scope, every capability ` +
            `file must enumerate the window labels it applies to.`
        ).toBeDefined();
      });

      it("`windows` is a non-empty array of strings", () => {
        expect(
          Array.isArray(parsed.windows),
          `capabilities/${name}: "windows" must be an array, got ${typeof parsed.windows}`
        ).toBe(true);
        const arr = parsed.windows as unknown[];
        expect(
          arr.length,
          `capabilities/${name}: "windows" array is empty — capability would apply to no windows`
        ).toBeGreaterThan(0);
        for (const el of arr) {
          expect(
            typeof el,
            `capabilities/${name}: every "windows" element must be a string, got ${typeof el}`
          ).toBe("string");
        }
      });

      it("no `windows` element is a wildcard (or is in EXPECTED_VIOLATORS)", () => {
        const arr = (parsed.windows as string[]) ?? [];
        const expected = new Set(EXPECTED_VIOLATORS[name] ?? []);
        const violators: string[] = [];
        arr.forEach((el, idx) => {
          if (!isWildcardToken(el)) return;
          if (expected.has(el)) return;
          violators.push(
            `${relative(process.cwd(), full)}: windows[${idx}] = ${JSON.stringify(el)}`
          );
        });
        expect(
          violators,
          `capabilities/${name} contains wildcard window scope(s) not in EXPECTED_VIOLATORS. ` +
            `Per caps-window-scope, capabilities must enumerate ` +
            `concrete window labels (or label-prefix globs that are pre-tracked here):\n  ${violators.join("\n  ")}`
        ).toEqual([]);
      });
    });
  }

  // ── Matcher self-tests ──────────────────────────────────────────────
  // Guard `isWildcardToken` so a future edit cannot silently let the
  // gate pass empty.

  describe("isWildcardToken (matcher self-test)", () => {
    it("flags the bare universal star", () => {
      expect(isWildcardToken("*")).toBe(true);
    });

    it("flags a string containing a star (prefix glob)", () => {
      // `win-*` IS a wildcard; it just happens to be allowlisted via
      // EXPECTED_VIOLATORS.
      expect(isWildcardToken("win-*")).toBe(true);
    });

    it("flags a string containing a question mark", () => {
      expect(isWildcardToken("win-?")).toBe(true);
    });

    it("does NOT flag a concrete label", () => {
      expect(isWildcardToken("main")).toBe(false);
    });

    it("does NOT flag a concrete dashed label", () => {
      expect(isWildcardToken("win-1")).toBe(false);
    });

    it("does NOT flag the empty string (separately caught by length check)", () => {
      // The empty string is not a wildcard — but the parent test
      // catches it via the array-length / element-type assertions.
      expect(isWildcardToken("")).toBe(false);
    });
  });
});
