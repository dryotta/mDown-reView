import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Cross-window state whitelist constant lint.
 *
 * Enforces rule `multiwin-cross-window-state-whitelist` in
 * `docs/best-practices-common/tauri/v2-patterns.md`. The rule body
 * prescribes a single exported `CROSS_WINDOW_SYNCED_KEYS` constant in
 * `src/store/index.ts` that BOTH the persist `partialize` selector AND
 * the `useCrossWindowPrefsSync` hook's patch builder consume. Two
 * inline allowlists drift the moment a developer adds a new persisted
 * key without updating both — the constant is the source of truth.
 *
 * **Gradual ratchet** (see issue #315 implementation plan):
 *   - Today: the constant has not yet been introduced (Section C lands
 *     it). The lint accepts the pre-state and emits a TODO note so the
 *     suite is green while the migration is staged.
 *   - Once `export const CROSS_WINDOW_SYNCED_KEYS = […] as const;` lands
 *     in `src/store/index.ts`, the lint tightens automatically: both
 *     the partialize body and the sync hook MUST reference the symbol,
 *     and the constant MUST be `as const`.
 *
 * Self-tests at the bottom guard the matchers themselves.
 */

const SRC = join(__dirname, "..");
const STORE_PATH = join(SRC, "store", "index.ts");
const HOOK_PATH = join(SRC, "hooks", "useCrossWindowPrefsSync.ts");

/** True if `source` exports the `CROSS_WINDOW_SYNCED_KEYS` constant. */
export function hasCrossWindowKeysExport(source: string): boolean {
  return /export\s+const\s+CROSS_WINDOW_SYNCED_KEYS\s*=/.test(source);
}

/**
 * Extract the body of `partialize: (…) => ({ … })` from `source` so the
 * caller can assert what the body references. Returns `null` if no
 * partialize is found.
 *
 * The matcher is intentionally loose: the partialize argument list is
 * `(state)` today but could be destructured tomorrow; the body is `({
 * … })` for now but could be a multi-statement arrow with an explicit
 * `return { … }`. We capture from `partialize:` to the next `}` at the
 * same nesting depth so both shapes are covered.
 */
export function extractPartializeBody(source: string): string | null {
  const idx = source.indexOf("partialize:");
  if (idx === -1) return null;
  // Find the first `{` after `partialize:` that opens the body.
  // For `({ … })` the open is `{` (after `(`); for `=> { return {…}; }`
  // the outer `{` opens the function body. Either way, the first `{`
  // is the start of what we want to scan.
  const openIdx = source.indexOf("{", idx);
  if (openIdx === -1) return null;
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(openIdx, i + 1);
      }
    }
  }
  return null;
}

describe("multiwin-cross-window-state-whitelist: CROSS_WINDOW_SYNCED_KEYS constant", () => {
  const storeContent = readFileSync(STORE_PATH, "utf8");
  const hookContent = readFileSync(HOOK_PATH, "utf8");

  it(
    "once Section C exports CROSS_WINDOW_SYNCED_KEYS, both partialize and " +
      "useCrossWindowPrefsSync reference it (otherwise: pass with TODO)",
    () => {
      if (!hasCrossWindowKeysExport(storeContent)) {
        // Gradual ratchet: accept the pre-state. The note prints into
        // Vitest's stdout so the implementer can see the lint is
        // waiting for the migration.
        // eslint-disable-next-line no-console
        console.log(
          "[lint-l5] CROSS_WINDOW_SYNCED_KEYS not yet exported (Section C of #315 will add it). " +
            "Lint will tighten once the constant exists."
        );
        return;
      }

      // Strict mode: the export exists, so all three invariants apply.

      // (a) The constant is declared `as const` so its element type is
      //     a readonly tuple of string literals (the partialize selector
      //     and the sync hook BOTH index by these literal keys).
      expect(
        storeContent,
        "CROSS_WINDOW_SYNCED_KEYS must be declared `as const` so consumers " +
          "see a literal-tuple type, not `string[]`. " +
          `(${STORE_PATH})`
      ).toMatch(/CROSS_WINDOW_SYNCED_KEYS\s*=\s*\[[\s\S]*?\]\s+as\s+const/);

      // (b) The partialize body references the constant. We only assert
      //     the symbol name appears inside the body — the exact shape
      //     (Object.fromEntries vs explicit map) is the caller's choice.
      const body = extractPartializeBody(storeContent);
      expect(body, "partialize: (…) => ({ … }) not found in src/store/index.ts").not.toBeNull();
      expect(
        body!,
        "partialize body must reference CROSS_WINDOW_SYNCED_KEYS so the " +
          "exported constant is the single source of truth (rule " +
          "multiwin-cross-window-state-whitelist).\nBody:\n" +
          body
      ).toContain("CROSS_WINDOW_SYNCED_KEYS");

      // (c) The sync hook references the constant.
      expect(
        hookContent,
        "src/hooks/useCrossWindowPrefsSync.ts must reference " +
          "CROSS_WINDOW_SYNCED_KEYS rather than maintain its own inline " +
          "allowlist (rule multiwin-cross-window-state-whitelist)."
      ).toContain("CROSS_WINDOW_SYNCED_KEYS");
    }
  );

  // ── Matcher self-tests ──────────────────────────────────────────────

  describe("hasCrossWindowKeysExport (matcher self-test)", () => {
    it("flags an `as const` literal export", () => {
      const sample = `export const CROSS_WINDOW_SYNCED_KEYS = ["theme"] as const;`;
      expect(hasCrossWindowKeysExport(sample)).toBe(true);
    });

    it("flags a multi-line declaration", () => {
      const sample = [
        `export const CROSS_WINDOW_SYNCED_KEYS = [`,
        `  "theme",`,
        `  "authorName",`,
        `] as const;`,
      ].join("\n");
      expect(hasCrossWindowKeysExport(sample)).toBe(true);
    });

    it("does NOT flag a comment that mentions the symbol", () => {
      const sample = `// see CROSS_WINDOW_SYNCED_KEYS in store/index.ts`;
      expect(hasCrossWindowKeysExport(sample)).toBe(false);
    });

    it("does NOT flag a non-exported declaration", () => {
      const sample = `const CROSS_WINDOW_SYNCED_KEYS = ["theme"] as const;`;
      // Without `export`, the constant is module-private and the sync
      // hook in a different module cannot consume it. Don't flag the
      // file as compliant.
      expect(hasCrossWindowKeysExport(sample)).toBe(false);
    });

    it("does NOT flag a different exported constant", () => {
      const sample = `export const SOME_OTHER_KEYS = ["theme"] as const;`;
      expect(hasCrossWindowKeysExport(sample)).toBe(false);
    });
  });

  describe("extractPartializeBody (matcher self-test)", () => {
    it("extracts an inline arrow body", () => {
      const sample = [
        `persist(initial, {`,
        `  partialize: (state) => ({`,
        `    theme: state.theme,`,
        `  }),`,
        `})`,
      ].join("\n");
      const body = extractPartializeBody(sample);
      expect(body).not.toBeNull();
      expect(body!).toContain("theme: state.theme");
    });

    it("returns null when no partialize is present", () => {
      expect(extractPartializeBody(`persist(initial, { name: "x" });`)).toBeNull();
    });

    it("balances nested braces correctly", () => {
      const sample = [
        `partialize: (state) => ({`,
        `  prefs: { a: state.a, b: { c: state.c } },`,
        `}),`,
      ].join("\n");
      const body = extractPartializeBody(sample);
      expect(body).not.toBeNull();
      // Body must contain the deepest nested key — proves the brace
      // walker did not stop early at the first `}`.
      expect(body!).toContain("c: state.c");
    });
  });
});
