import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Multi-window feature-doc cross-link gate (D3, issue #315 iter 6).
 *
 * Rule: every file under `docs/features/*.md` that mentions multi-window
 * concepts (multiple windows, window lifecycle, per-window state) MUST
 * cite the canonical `multiwin-*` rule set so a reader who lands on the
 * feature page can find the canonical rules without grepping. The rule
 * set is bundled with the `tauri-coding-expert` agent at
 * `.claude/agents/tauri-coding-expert/knowledge/tauri-v2-patterns.md`.
 *
 * "Cite" is satisfied by either:
 *   1. A path link / substring mention of the canonical bundled path, or
 *   2. A bare-text mention of any `multiwin-*` rule-id (e.g.
 *      `multiwin-window-scoped-events`, `multiwin-allowlist-scope`).
 *
 * "Mentions multi-window" is detected by a curated keyword list. We
 * keep the list short and obvious so unrelated mentions of "tab"
 * (e.g. "indent with a tab") don't trigger the cross-link requirement.
 *
 * `EXEMPT_FEATURE_DOCS` lists feature docs whose multi-window mentions
 * are incidental and a citation would be noise. Currently empty.
 *
 * Self-tests at the bottom guard the matchers themselves.
 */

const REPO_ROOT = join(__dirname, "..", "..");
const FEATURES_DIR = join(REPO_ROOT, "docs", "features");

/**
 * Curated keywords that, when present in a feature doc, indicate the
 * doc discusses multi-window behaviour and therefore SHOULD link to
 * the canonical `multiwin-*` rule set.
 *
 * Word-boundary anchored to avoid partial-word matches (`window` would
 * not match `windowless`, but `window-` and `windows` both do via the
 * boundary). Keywords are case-insensitive.
 */
const MULTIWIN_KEYWORDS: ReadonlyArray<RegExp> = [
  /\bmulti-window\b/i,
  /\bmultiple windows\b/i,
  /\bsecondary window\b/i,
  /\bper-window\b/i,
  /\bcross-window\b/i,
  /\bwindow registry\b/i,
  /\bwindow label\b/i,
  /\bemit_to\b/i,
  /\bnew window\b/i,
];

/** Path substring that, if present, satisfies the cross-link requirement. */
const REQUIRED_LINK = ".claude/agents/tauri-coding-expert/knowledge/tauri-v2-patterns.md";

/**
 * Rule-id mention pattern that, if present, also satisfies the requirement.
 * Matches both specific rule-ids (`multiwin-window-scoped-events`) and
 * family globs (`multiwin-*`).
 */
const MULTIWIN_RULE_ID_PATTERN = /\bmultiwin-/;

/**
 * Feature docs intentionally exempt from the cross-link rule. Each
 * entry must be the bare basename and carry a justification comment.
 */
const EXEMPT_FEATURE_DOCS: ReadonlySet<string> = new Set([
  // (none — keep the gate strict; add entries with justification only
  //  if a feature doc legitimately mentions a multiwin keyword without
  //  needing the cross-reference)
]);

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Return the list of `MULTIWIN_KEYWORDS` patterns that match somewhere
 * in `body`. Empty array means the doc does not discuss multi-window.
 */
export function findMultiwinKeywords(body: string): string[] {
  return MULTIWIN_KEYWORDS.filter((re) => re.test(body)).map((re) =>
    re.source.replace(/^\\b|\\b$/g, "")
  );
}

/**
 * True iff `body` contains a citation of the canonical multiwin rule
 * set: either a path link (markdown link or bare substring) to the
 * bundled `tauri-v2-patterns.md`, or a bare-text mention of any
 * `multiwin-*` rule-id.
 */
export function hasMultiwinRuleLink(body: string): boolean {
  return (
    body.includes(REQUIRED_LINK) ||
    body.includes("tauri-coding-expert/knowledge/tauri-v2-patterns.md") ||
    MULTIWIN_RULE_ID_PATTERN.test(body)
  );
}

function listFeatureDocs(): string[] {
  return readdirSync(FEATURES_DIR)
    .filter((name) => name.endsWith(".md"))
    .filter((name) => {
      const full = join(FEATURES_DIR, name);
      try {
        return statSync(full).isFile();
      } catch {
        return false;
      }
    })
    .map((name) => join(FEATURES_DIR, name));
}

// ── Tests ────────────────────────────────────────────────────────────

describe("docs/features cross-links to multiwin rules (D3)", () => {
  const docPaths = listFeatureDocs();

  it("docs/features/ contains a non-trivial set of feature pages", () => {
    expect(docPaths.length).toBeGreaterThanOrEqual(5);
  });

  it("every feature doc that mentions multi-window keywords cites a multiwin-* rule", () => {
    const offenders: { doc: string; matched: string[] }[] = [];
    for (const path of docPaths) {
      const base = path.split(/[\\/]/).pop()!;
      if (EXEMPT_FEATURE_DOCS.has(base)) continue;
      const body = readFileSync(path, "utf8");
      const matched = findMultiwinKeywords(body);
      if (matched.length === 0) continue;
      if (hasMultiwinRuleLink(body)) continue;
      offenders.push({ doc: base, matched });
    }
    const message =
      `These feature docs discuss multi-window concepts but do not ` +
      `cite the canonical multiwin rule set. Either link to ` +
      `\`${REQUIRED_LINK}\` or mention a \`multiwin-*\` rule-id by name ` +
      `in prose, or add the basename to EXEMPT_FEATURE_DOCS with ` +
      `justification:\n  ` +
      offenders.map((o) => `${o.doc} — matched keywords: ${o.matched.join(", ")}`).join("\n  ");
    expect(offenders, message).toEqual([]);
  });

  it("EXEMPT_FEATURE_DOCS entries refer to existing files", () => {
    const existing = new Set(docPaths.map((p) => p.split(/[\\/]/).pop()!));
    const phantom = [...EXEMPT_FEATURE_DOCS].filter((b) => !existing.has(b));
    expect(
      phantom,
      `EXEMPT_FEATURE_DOCS lists files that don't exist in docs/features/:\n  ` +
        phantom.join("\n  ")
    ).toEqual([]);
  });

  // ── Self-tests ─────────────────────────────────────────────────────

  describe("findMultiwinKeywords (self-test)", () => {
    it("returns matched patterns for a body that uses 'multi-window'", () => {
      const body = "This feature is multi-window aware.";
      expect(findMultiwinKeywords(body).length).toBeGreaterThan(0);
    });

    it("matches 'per-window state' and 'cross-window'", () => {
      const body = "Per-window state, cross-window sync.";
      expect(findMultiwinKeywords(body).length).toBeGreaterThanOrEqual(2);
    });

    it("returns [] for prose with no multi-window vocabulary", () => {
      const body =
        "The viewer renders Markdown with footnotes and tables. " +
        "A user pressing Tab cycles to the next focusable input.";
      expect(findMultiwinKeywords(body)).toEqual([]);
    });

    it("is case-insensitive", () => {
      const body = "Multi-Window support is on the roadmap.";
      expect(findMultiwinKeywords(body).length).toBeGreaterThan(0);
    });
  });

  describe("hasMultiwinRuleLink (self-test)", () => {
    it("matches an absolute-style path mention", () => {
      expect(hasMultiwinRuleLink("see .claude/agents/tauri-coding-expert/knowledge/tauri-v2-patterns.md")).toBe(true);
    });

    it("matches a relative-style markdown link", () => {
      const body = "[v2 patterns](../tauri-coding-expert/knowledge/tauri-v2-patterns.md)";
      expect(hasMultiwinRuleLink(body)).toBe(true);
    });

    it("matches a bare multiwin-* rule-id mention", () => {
      expect(hasMultiwinRuleLink("see the `multiwin-window-scoped-events` rule")).toBe(true);
      expect(hasMultiwinRuleLink("`multiwin-allowlist-scope` and `multiwin-per-window-menu` rules")).toBe(true);
      expect(hasMultiwinRuleLink("consult the `multiwin-*` rule family")).toBe(true);
    });

    it("returns false when no link or rule-id is present", () => {
      expect(hasMultiwinRuleLink("Just prose, no link.")).toBe(false);
    });

    it("does not false-match a sibling agent-bundle doc", () => {
      const body = "[react patterns](../react-coding-expert/knowledge/react-composition-patterns.md)";
      expect(hasMultiwinRuleLink(body)).toBe(false);
    });

    it("does not false-match a non-multiwin rule-id", () => {
      expect(hasMultiwinRuleLink("see the `architecture-avoid-boolean-props` rule")).toBe(false);
    });
  });
});
