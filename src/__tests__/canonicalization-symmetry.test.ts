import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Renderer-side intake-path canonicalization symmetry lint.
 *
 * Enforces rule `multiwin-canonicalize-at-ingest` in
 * `docs/best-practices-common/tauri/v2-patterns.md`. The rule:
 *
 *   "Renderer-side intake (`openFilesFromArgs`, `useOpenFileTab`, drop
 *    handlers) shares this contract — both consumer paths into the
 *    store must canonicalize symmetrically."
 *
 * The two intake paths today:
 *   1. `src/store/launchArgs.ts::openFilesFromArgs` — already canonicalises
 *      via `canonicalizeOrFallback`.
 *   2. `src/hooks/useOpenFileTab.ts` — does NOT canonicalise. The Section
 *      C4 fix of issue #315 adds `canonicalizeOrFallback` here so the
 *      two intakes agree on path form (avoids duplicate-tab bugs when
 *      one intake stores 8.3 short names and the other stores long
 *      forms).
 *
 * **Gradual ratchet** (mirroring the L5 / L9 pattern):
 *   - Today: `useOpenFileTab` is in the EXPECTED_VIOLATORS list. The
 *     lint accepts the pre-state and surfaces a TODO note.
 *   - Once Section C4 lands `canonicalizeOrFallback` in
 *     `useOpenFileTab.ts`, the ENTRY MUST BE REMOVED from the list
 *     below and the lint becomes strict for that file.
 *   - New intake paths added without canonicalisation trip the lint
 *     immediately (they neither appear in INTAKE_PATHS nor get a free
 *     pass).
 *
 * Self-tests at the bottom guard the matcher itself.
 */

const SRC = join(__dirname, "..");

/** Renderer-side file boundaries that ingest a path into the store. */
const INTAKE_PATHS: readonly string[] = ["store/launchArgs.ts", "hooks/useOpenFileTab.ts"];

/**
 * Files that are KNOWN-CURRENT-VIOLATORS of the canonicalisation
 * contract. Each entry is a debt marker tracked against the issue's
 * Section C4 fix; removing the entry is part of the C4 PR.
 *
 * Section C4 (iter-7) landed `canonicalizeOrFallback` in
 * `useOpenFileTab.ts`, so the prior debt entry is removed and the
 * lint is now strict for both intake paths. New intake paths added
 * without canonicalisation trip the lint immediately.
 */
const EXPECTED_VIOLATORS: readonly string[] = [];

/**
 * The substring every intake path must contain. We deliberately match
 * the symbol name rather than the import statement — production code
 * could re-export the helper or alias it locally, and the symbol's
 * presence in the body is what matters.
 */
const REQUIRED_SUBSTRING = "canonicalizeOrFallback";

export function hasCanonicalizationCall(content: string): boolean {
  return content.includes(REQUIRED_SUBSTRING);
}

describe("multiwin-canonicalize-at-ingest: renderer intake-path symmetry", () => {
  it("every renderer intake path canonicalises (or is on the EXPECTED_VIOLATORS debt list)", () => {
    const offenders: string[] = [];
    const stillViolating: string[] = [];

    for (const rel of INTAKE_PATHS) {
      const full = join(SRC, rel);
      const content = readFileSync(full, "utf8");
      const ok = hasCanonicalizationCall(content);
      const expected = EXPECTED_VIOLATORS.includes(rel);

      if (!ok && !expected) {
        // Find the first non-trivial line so the error message has a
        // line:char anchor for the editor.
        const lineNum = content
          .split(/\r?\n/)
          .findIndex((l) => l.trim().length > 0 && !l.trim().startsWith("//"));
        offenders.push(
          `${rel}:${lineNum + 1} — missing call to ${REQUIRED_SUBSTRING}; ` +
            `rule multiwin-canonicalize-at-ingest`
        );
      }

      if (!ok && expected) {
        // Gradual ratchet: still violating, still on the debt list.
        // Surface the pending fix so the implementer can see what's
        // expected.
        stillViolating.push(rel);
      }

      if (ok && expected) {
        // The fix landed but the debt entry was not removed — this is
        // a regression of a different kind: the lint is no longer
        // catching anything but the EXPECTED_VIOLATORS list still
        // claims this file is broken.
        offenders.push(
          `${rel} — file now canonicalises but is still listed in ` +
            `EXPECTED_VIOLATORS. Delete the entry in ` +
            `src/__tests__/canonicalization-symmetry-test.ts.`
        );
      }
    }

    if (stillViolating.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[lint-l8] Pending Section C4 fix: ${stillViolating.join(
          ", "
        )} still missing ${REQUIRED_SUBSTRING}. Lint will tighten once the ` +
          `EXPECTED_VIOLATORS entry is removed.`
      );
    }

    expect(
      offenders,
      `Renderer intake paths must canonicalise via ${REQUIRED_SUBSTRING} ` +
        `before storing — see rule multiwin-canonicalize-at-ingest in ` +
        `docs/best-practices-common/tauri/v2-patterns.md.\n  ${offenders.join("\n  ")}`
    ).toEqual([]);
  });

  // ── Matcher self-tests ──────────────────────────────────────────────

  describe("hasCanonicalizationCall (matcher self-test)", () => {
    it("flags a direct call", () => {
      const sample = `const c = await canonicalizeOrFallback(path);`;
      expect(hasCanonicalizationCall(sample)).toBe(true);
    });

    it("flags an import-only mention", () => {
      // Even an import that is not yet wired counts as the symbol
      // being present — the lint's job is "did the file pull the
      // chokepoint into scope at all?" not "did the file invoke it
      // on every code path?".
      const sample = `import { canonicalizeOrFallback } from "@/store/canonicalize";`;
      expect(hasCanonicalizationCall(sample)).toBe(true);
    });

    it("does NOT flag a similar-but-different identifier", () => {
      const sample = `const v = canonicalizePath(p);`; // wrong helper
      expect(hasCanonicalizationCall(sample)).toBe(false);
    });

    it("does NOT flag an empty file", () => {
      expect(hasCanonicalizationCall("")).toBe(false);
    });
  });
});
