import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

/**
 * Multi-window rules coverage gate (D1, issue #315 iter 6).
 *
 * Enforces that every `multiwin-*` rule declared in
 * `.claude/agents/tauri-coding-expert/knowledge/tauri-v2-patterns.md` has at least one
 * enforcement test file that cites it by ID. The "enforcement" can be a
 * unit lint (`src/__tests__/*.test.ts(x)`), a Rust integration test
 * (`src-tauri/tests/*.rs`), or a Playwright e2e spec
 * (`e2e/{browser,native}/*.spec.ts`). A rule with zero citations is a
 * dangling pattern — the doc declares the rule but the codebase never
 * verifies it.
 *
 * The corpus discovery walks the repo's three test trees once, then for
 * each rule ID asks whether at least one corpus file mentions it. The
 * mention can appear in a top doc-comment, a `describe(...)` label, an
 * assertion message, or a `//!` rustdoc — any plain-text occurrence
 * counts. We do not require the citation to live in a fixed location
 * because the existing tests scatter them across module-level docs,
 * `describe` strings, and `expect(...).toEqual()` failure messages.
 *
 * `RULES_WITHOUT_ENFORCEMENT` lists rules that are intentionally
 * prose-only — pattern guidelines without a single code-level failure
 * mode that a focused test could pin. Each entry MUST carry a brief
 * justification next to it.
 *
 * Self-tests at the bottom guard the parser itself.
 */

const REPO_ROOT = join(__dirname, "..", "..");
const SPEC_PATH = join(REPO_ROOT, ".claude", "agents", "tauri-coding-expert", "knowledge", "tauri-v2-patterns.md");

const TEST_ROOTS = [
  join(REPO_ROOT, "src", "__tests__"),
  join(REPO_ROOT, "src-tauri", "tests"),
  join(REPO_ROOT, "e2e", "browser"),
  join(REPO_ROOT, "e2e", "native"),
];

/**
 * Rules accepted as prose-only — they describe a pattern or guideline
 * whose violation is caught indirectly by other rules' tests, so
 * defining a dedicated lint would be redundant or impossible to pin to
 * a single failure mode. Keep this set tiny.
 */
const RULES_WITHOUT_ENFORCEMENT: ReadonlySet<string> = new Set([
  // `multiwin-emit-filter` is a pattern guideline ("when an event is
  // relevant to a subset, use `emit_filter` instead of a manual loop").
  // Its concrete violations are already tracked as ❌-marked rows in
  // the per-event emit-target table inside `multiwin-window-scoped-events`,
  // and `event-emit-target.test.ts` checks that table for parity. A
  // separate "no manual `for win in app.webview_windows()` loop" lint
  // exists at `forbid_app_webview_windows_iteration_test.rs` which cites
  // `multiwin-lifecycle-registry`; the same loop pattern is what
  // `emit-filter` forbids, so coverage flows through that test.
  "multiwin-emit-filter",
  // `multiwin-window-creation-nonblocking` is a runtime-perf guideline
  // ("don't block the main thread during build()"). Its failure mode is
  // a slow startup measurable only end-to-end; the static lints that
  // would attempt to enforce it (e.g. "no IO calls between build() and
  // emit()") would be brittle string-matching with high false-positive
  // rate. Covered indirectly by `render-count-cold-startup.spec.ts`
  // which guards the cold-startup budget.
  "multiwin-window-creation-nonblocking",
  // `multiwin-per-window-startup-recorder` describes a forward-looking
  // observability requirement (per-window phase recording in
  // `StartupRecorder`). The current `StartupRecorder` is process-global;
  // until per-window keying lands, no test can assert the per-window
  // phase exists. Tracked in docs/observability.md.
  "multiwin-per-window-startup-recorder",
  // `multiwin-rejection-affects-store` is a TypeScript ViewModel pattern
  // ("await IPC + reconcile store on reject"). A static lint would have
  // to model promise control flow; the failure surfaces as a "ghost
  // state" e2e bug, covered by `folder-navigation.spec.ts` reject
  // paths. Tracked here as prose-only until a reliable static check is
  // designed.
  "multiwin-rejection-affects-store",
]);

// ── Parsing ──────────────────────────────────────────────────────────

/**
 * Extract every `multiwin-*` rule ID from the v2-patterns.md spec.
 *
 * Rule headers look like:
 *   `### \`multiwin-foo-bar\``
 * The regex captures the bare ID (no backticks, no leading hash).
 */
export function extractMultiwinRuleIds(markdown: string): string[] {
  const ids: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^###\s+`(multiwin-[a-z0-9-]+)`\s*$/.exec(line);
    if (m) ids.push(m[1]);
  }
  return ids;
}

/**
 * True if `corpus` text mentions `ruleId` anywhere — a plain substring
 * check, since rule IDs are kebab-case and unlikely to collide with
 * unrelated identifiers. We anchor on the `multiwin-` prefix so e.g.
 * a stray `foo-multiwin-per-window-menu-bar` would still match (which
 * is the correct behavior — the rule is being cited).
 */
export function corpusMentionsRule(corpus: string, ruleId: string): boolean {
  return corpus.includes(ruleId);
}

// ── Corpus discovery ─────────────────────────────────────────────────

function* walk(dir: string): IterableIterator<string> {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const full = join(dir, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      // Skip vendored dirs; tests live directly under TEST_ROOTS.
      if (name === "node_modules" || name === "target" || name === ".git") {
        continue;
      }
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

function isEnforcementFile(path: string): boolean {
  return (
    /\.test\.(ts|tsx)$/.test(path) ||
    /\.spec\.ts$/.test(path) ||
    (/\.rs$/.test(path) && path.includes(`tests${sep}`))
  );
}

interface CorpusEntry {
  path: string;
  body: string;
}

function loadCorpus(): CorpusEntry[] {
  const out: CorpusEntry[] = [];
  for (const root of TEST_ROOTS) {
    for (const f of walk(root)) {
      if (!isEnforcementFile(f)) continue;
      try {
        out.push({ path: f, body: readFileSync(f, "utf8") });
      } catch {
        // unreadable file — skip silently; the missing-coverage check
        // will surface the underlying issue if it matters
      }
    }
  }
  return out;
}

describe("multiwin-* rules coverage (D1)", () => {
  const md = readFileSync(SPEC_PATH, "utf8");
  const ruleIds = extractMultiwinRuleIds(md);
  const corpus = loadCorpus();

  it("v2-patterns.md declares >= 8 multiwin-* rules", () => {
    // Sanity floor: if this drops, the regex broke or the doc was gutted.
    expect(ruleIds.length).toBeGreaterThanOrEqual(8);
  });

  it("test corpus is non-empty", () => {
    // Sanity floor: if this is 0, the walker is broken.
    expect(corpus.length).toBeGreaterThanOrEqual(10);
  });

  it("every multiwin-* rule has at least one enforcing test", () => {
    const uncovered: string[] = [];
    for (const id of ruleIds) {
      if (RULES_WITHOUT_ENFORCEMENT.has(id)) continue;
      const found = corpus.some((c) => corpusMentionsRule(c.body, id));
      if (!found) uncovered.push(id);
    }
    expect(
      uncovered,
      `These multiwin-* rules in .claude/agents/tauri-coding-expert/knowledge/tauri-v2-patterns.md ` +
        `have no enforcing test under src/__tests__/, src-tauri/tests/, or e2e/. ` +
        `Either add a test that cites the rule ID by name (in a top comment, ` +
        `describe label, or assertion message) or, if the rule is genuinely ` +
        `prose-only, add it to RULES_WITHOUT_ENFORCEMENT with a justification:\n  ` +
        uncovered.join("\n  ")
    ).toEqual([]);
  });

  it("every RULES_WITHOUT_ENFORCEMENT entry references a real rule", () => {
    const idSet = new Set(ruleIds);
    const phantom: string[] = [];
    for (const id of RULES_WITHOUT_ENFORCEMENT) {
      if (!idSet.has(id)) phantom.push(id);
    }
    expect(
      phantom,
      `These entries in RULES_WITHOUT_ENFORCEMENT do not match any ` +
        `multiwin-* rule in v2-patterns.md. Either the rule was renamed or ` +
        `deleted; remove the stale entry:\n  ` +
        phantom.join("\n  ")
    ).toEqual([]);
  });

  // ── Self-tests ─────────────────────────────────────────────────────

  describe("extractMultiwinRuleIds (self-test)", () => {
    it("extracts a single rule from a minimal sample", () => {
      const sample = "### `multiwin-per-window-menu`\n\nbody";
      expect(extractMultiwinRuleIds(sample)).toEqual(["multiwin-per-window-menu"]);
    });

    it("extracts multiple rules in document order", () => {
      const sample = [
        "### `multiwin-a`",
        "body",
        "### `multiwin-b`",
        "more",
        "### `multiwin-c`",
      ].join("\n");
      expect(extractMultiwinRuleIds(sample)).toEqual(["multiwin-a", "multiwin-b", "multiwin-c"]);
    });

    it("ignores non-multiwin H3 headers (e.g. ipc-*, windows-*)", () => {
      const sample = [
        "### `ipc-typed-wrappers`",
        "### `windows-config-not-runtime`",
        "### `multiwin-per-window-menu`",
      ].join("\n");
      expect(extractMultiwinRuleIds(sample)).toEqual(["multiwin-per-window-menu"]);
    });

    it("ignores H1/H2/H4 headers and inline mentions of multiwin-*", () => {
      const sample = [
        "# `multiwin-fake-h1`",
        "## `multiwin-fake-h2`",
        "#### `multiwin-fake-h4`",
        "Some prose mentioning `multiwin-inline` in a paragraph.",
        "### `multiwin-real`",
      ].join("\n");
      expect(extractMultiwinRuleIds(sample)).toEqual(["multiwin-real"]);
    });

    it("returns [] for input with no multiwin-* headers", () => {
      expect(extractMultiwinRuleIds("# Title\n\nNo rules here.")).toEqual([]);
    });
  });

  describe("corpusMentionsRule (self-test)", () => {
    it("matches a citation in a top-of-file comment", () => {
      const body = "//! Test for rule `multiwin-foo-bar` (v2-patterns.md)";
      expect(corpusMentionsRule(body, "multiwin-foo-bar")).toBe(true);
    });

    it("matches a citation in an assertion message", () => {
      const body = 'expect(x).toEqual([], "violates multiwin-baz-quux per docs");';
      expect(corpusMentionsRule(body, "multiwin-baz-quux")).toBe(true);
    });

    it("returns false when the rule is not mentioned", () => {
      const body = "// Plain test with no rule citation\nexpect(1).toBe(1);";
      expect(corpusMentionsRule(body, "multiwin-foo")).toBe(false);
    });

    it("does not falsely match a different rule with shared prefix", () => {
      // The substring matcher is conservative — `multiwin-foo` is a strict
      // prefix of `multiwin-foobar`, so a body mentioning only the former
      // would NOT match the latter (the longer ID just isn't there).
      const body = "//! Cites multiwin-foo only";
      expect(corpusMentionsRule(body, "multiwin-foobar")).toBe(false);
      // Conversely, a body mentioning the longer ID *does* contain the
      // shorter one as a substring — this is acceptable because rule IDs
      // are unique within the spec; the same body still satisfies both.
      const body2 = "//! Cites multiwin-foobar";
      expect(corpusMentionsRule(body2, "multiwin-foo")).toBe(true);
    });
  });
});
