import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Per docs/best-practices-common/tauri/v2-patterns.md rule
 * `multiwin-cross-window-state-whitelist`: every `localStorage.{setItem,
 * removeItem, clear}` call site is a cross-window broadcast (the
 * browser's `storage` event fires in OTHER same-origin windows on every
 * write, which is how `useCrossWindowPrefsSync` propagates prefs).
 *
 * Direct writes from arbitrary call sites would multiply the broadcast
 * surface, defeat the equality guard in `useCrossWindowPrefsSync`, and
 * create per-window persistence drift. Production code MUST funnel
 * through one of the two allowlisted chokepoints:
 *
 *   1. `src/store/index.ts` — Zustand `persist` adapter (writes are
 *      driven by the `partialize` selector + `version`/`migrate`
 *      contract; the cross-window listener consumes them).
 *   2. `src/lib/comment-drafts.ts` — per-anchor draft slot with an
 *      explicit memory-map fallback. Drafts are window-local
 *      transient state that must persist across an accidental tab
 *      close; they are not partialize'd into the Zustand store
 *      because the store would re-broadcast them to every other
 *      window which would scramble unrelated composers.
 *
 * Test files (`__tests__/`, `__mocks__/`, `*.test.ts`, `test-setup.ts`)
 * are exempt — tests routinely call `localStorage.clear()` between
 * cases.
 *
 * Self-tests at the bottom guard the matcher itself so a future edit
 * that breaks the regex cannot silently let the gate pass empty.
 */

const SRC_ROOT = join(__dirname, "..");

/** Files allowed to call `localStorage.{setItem,removeItem,clear}` directly. */
const ALLOWED = new Set<string>([
  // Zustand persist middleware drives setItem/removeItem indirectly
  // via `createJSONStorage(localStorage)`. The literal call doesn't
  // appear in this file today (the middleware owns it), but if a
  // future migration lands an explicit fallback path here, this is
  // the chokepoint that's allowed to host it.
  join("store", "index.ts"),
  // Per-anchor draft slot. See file-level rationale above.
  join("lib", "comment-drafts.ts"),
  // Cross-window prefs listener. Listens to the `storage` event; does
  // NOT write today, but if a future edit adds a defensive write to
  // dispatch a cross-tab heartbeat the chokepoint stays here.
  join("hooks", "useCrossWindowPrefsSync.ts"),
  // Issue #352 — first-save MRSF warning seen-flag (one-shot
  // onboarding toast). Single typed module behind which all write
  // traffic flows; readers call `hasSeenFirstSave()` directly
  // (read-only is unrestricted by this gate).
  join("lib", "excalidraw", "first-save-warning.ts"),
  // Issue #352 / iter-11 — auto-save info banner seen-flag (one-shot
  // dismissal). Same pattern as first-save-warning.ts.
  join("lib", "excalidraw", "autosave-banner.ts"),
]);

const FORBIDDEN_WRITE = /localStorage\.(setItem|removeItem|clear)\s*\(/;

export function hasForbiddenLocalStorageWrite(content: string): boolean {
  return FORBIDDEN_WRITE.test(content);
}

export function* walk(dir: string): IterableIterator<string> {
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

export function isTestFile(rel: string): boolean {
  // Vitest test files and __tests__ / __mocks__ directories.
  return (
    /\.test\.(ts|tsx)$/.test(rel) ||
    rel.includes(`${sep}__tests__${sep}`) ||
    rel.includes(`${sep}__mocks__${sep}`) ||
    /(^|[\\/])test-setup\.ts$/.test(rel)
  );
}

describe("localStorage write chokepoint architecture", () => {
  it("no production file outside the chokepoint allowlist writes to localStorage directly", () => {
    const offenders: string[] = [];

    for (const file of walk(SRC_ROOT)) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const rel = relative(SRC_ROOT, file);
      if (isTestFile(rel)) continue;
      if (ALLOWED.has(rel)) continue;

      const content = readFileSync(file, "utf8");
      if (!hasForbiddenLocalStorageWrite(content)) continue;

      // Surface every offending line with its 1-based line number so the
      // C-section implementer can paste path:line into an editor.
      const lines = content.split(/\r?\n/);
      lines.forEach((line, i) => {
        if (FORBIDDEN_WRITE.test(line)) {
          offenders.push(`${rel}:${i + 1} — ${line.trim()}`);
        }
      });
    }

    expect(
      offenders,
      `These files write to localStorage directly. Route through the Zustand persist ` +
        `adapter (src/store/index.ts) or src/lib/comment-drafts.ts. ` +
        `See docs/best-practices-common/tauri/v2-patterns.md rule ` +
        `multiwin-cross-window-state-whitelist:\n  ${offenders.join("\n  ")}`
    ).toEqual([]);
  });

  // ── Matcher self-tests ──────────────────────────────────────────────
  // Guard the matcher so a future edit cannot silently let the gate pass
  // empty.

  describe("hasForbiddenLocalStorageWrite (matcher self-test)", () => {
    it("flags localStorage.setItem with parens", () => {
      expect(hasForbiddenLocalStorageWrite(`localStorage.setItem("k", "v");`)).toBe(true);
    });

    it("flags localStorage.removeItem with parens", () => {
      expect(hasForbiddenLocalStorageWrite(`localStorage.removeItem("k");`)).toBe(true);
    });

    it("flags localStorage.clear with parens", () => {
      expect(hasForbiddenLocalStorageWrite(`localStorage.clear();`)).toBe(true);
    });

    it("flags whitespace between method name and paren", () => {
      // `localStorage.setItem ("k", "v")` — uncommon but legal JS.
      expect(hasForbiddenLocalStorageWrite(`localStorage.setItem ("k", "v");`)).toBe(true);
    });

    it("does NOT flag localStorage.getItem (read-only is fine)", () => {
      expect(hasForbiddenLocalStorageWrite(`const v = localStorage.getItem("k");`)).toBe(false);
    });

    it("does NOT flag a comment without parens (paren-less mention is fine)", () => {
      // The matcher requires `(` after the method name, so a comment
      // that merely names `localStorage.setItem` without invoking it
      // is not a violation. This intentionally keeps the rule narrow:
      // we are forbidding CALLS, not mentions. (Comments that invoke
      // the method via parens — `// localStorage.setItem("k", "v")` —
      // would still match, which is acceptable because such commented
      // invocations are usually leftover dead code.)
      expect(hasForbiddenLocalStorageWrite(`// see localStorage.setItem in store`)).toBe(false);
    });

    it("does NOT flag sessionStorage writes (out of scope for this rule)", () => {
      expect(hasForbiddenLocalStorageWrite(`sessionStorage.setItem("k", "v");`)).toBe(false);
    });

    it("does NOT flag a substring match on a non-method name", () => {
      // `localStorageKey.setItem(...)` is not `localStorage.setItem`.
      expect(hasForbiddenLocalStorageWrite(`localStorageKey.setItem("k", "v");`)).toBe(false);
    });
  });
});
