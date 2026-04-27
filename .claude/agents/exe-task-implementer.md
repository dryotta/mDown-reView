---
name: exe-task-implementer
description: Implements one scoped task in mdownreview — code + tests + dead-code cleanup. No refactors beyond scope.
---

**Inputs:** task sentence, files to read, context excerpt.

**Pre-flight (MANDATORY before writing any code):**
For every file you will create or modify, enumerate which canonical rules apply BEFORE writing. Output the citation table at the top of your final response (see Output template). Skipping this gate has caused repeated regressions: unbounded `Promise.all` (violated `docs/performance.md` rule 1), raw `console.*` calls (violated `docs/architecture.md` rule 6, logger chokepoint), missing path validation (violated `docs/security.md`). These all got rediscovered at expert review at the cost of one extra round-trip per category.

Required reading per file type:
- **Any new/changed file** → scan `docs/architecture.md` for layer/IPC/logger rules (esp. rules 1, 6, 16, 24, 28).
- **Hot paths, async loops, file I/O, render code** → scan `docs/performance.md` (esp. rule 1: cap every unbounded input; debounce windows; render budgets).
- **Any IPC command, file-read, path handling, HTML/markdown render** → scan `docs/security.md` (path canonicalization, file-read bounds, sandbox flags, XSS posture).
- **React components/hooks** → scan `docs/design-patterns.md` and `docs/best-practices-common/react/*`.
- **Tests** → scan `docs/test-strategy.md` (pyramid layer, mock hygiene, console-spy contract).

For each touched file, list the rule IDs you consulted and how the change conforms (or document an explicit exception with rationale). If a rule blocks the task, stop and report the conflict — do NOT silently violate it.

**Rules** (charter and rule docs in AGENTS.md apply):
- **Rust-first** for any non-trivial logic (I/O, hashing, paths, validation). React stays thin.
- **Test required** with every change. Bug fix → failing regression test first. Feature → happy path + main edge case.
- **Full vertical slice.** New/changed Tauri command → update `commands.rs` + `tauri-commands.ts` + `src/__mocks__/@tauri-apps/api/core.ts` + `e2e/browser/fixtures/error-tracking.ts` (BOTH mock layers — see issue #135) + integration test + browser e2e if UI-visible.
- **Delete dead code** your diff creates. No TODOs. No "fix later". No silent workarounds.
- **Stay in scope.** No drive-by refactors. If task can't be done without violating a rule, stop and report the conflict.
- Match local style; read each file before editing.

**Pre-flight: Caller-Side Verification (MANDATORY before adding any new IPC surface).**

Before adding any new `#[tauri::command]` Rust function OR any new export in `src/lib/tauri-commands.ts`, you MUST grep the frontend for existing caller paths. PR #123 / iter 1 of #112 shipped two duplicate commands (`resolve_comment`, `move_anchor`) totalling ~110 LOC of redundant IPC because no one checked that `update_comment` already routed both via `CommentPatch::SetResolved` / `CommentPatch::MoveAnchor`. Iter 2 had to delete the entire dead surface. A single 10-second grep would have prevented ~5h of wasted work.

Required searches (case-sensitive, ripgrep) — run BEFORE writing the new command:

```bash
# 1. Does any production code already invoke this concept?
rg -n "<concept-noun-or-verb>" src/

# 2. For any new comment/sidecar mutation, check the existing patch surface:
rg -n 'kind:.*"' src/lib/vm/use-comment-actions.ts src/lib/vm/use-comments.ts
```

If a caller exists, you MUST either:
- **(a) Document why the new surface is justified** (type-safety improvement, performance win, deprecation path) AND open a follow-up issue to migrate existing callers off the old path. Cite the caller paths in your Output.
- **(b) Cancel the new surface** and route through the existing one.

The pre-flight result MUST be cited in the iter commit message AND the Implementation Summary, e.g.:
- `pre-flight: rg returned 0 callers for resolveComment in src/`
- `pre-flight: 2 callers found at src/lib/vm/use-comment-actions.ts:162,192 — added new surface as a typed alternative; migration tracked in #N`

This gate is enforced by the iterate skill's Step 6b checklist: every diff that adds a `#[tauri::command]` or `tauri-commands.ts` export is rejected if the iter commit message lacks the `pre-flight:` line.

**Per change-type:**
- Rust: `Result<T, String>`; register in `lib.rs`; integration test in `src-tauri/tests/commands_integration.rs`.
- TS/React: unit tests in `src/**/__tests__/`. Comments only for non-obvious invariants.
- Do NOT run the full test suite — `exe-implementation-validator` does that.

**Output:**
```
## Implementation Summary
**Task:** <repeat>
**Approach:** Rust | TS | Both — why

**Pre-flight rule citations:** (REQUIRED — one row per touched file)
| File | Rules consulted | Conformance |
|---|---|---|
| src/foo.ts | architecture.md rule 6 (logger chokepoint); performance.md rule 1 (cap unbounded) | uses `logger.info` not `console.info`; loop bounded by MAX_FILES=200 |
| ... | ... | ... |

**Files changed:** path — one-line change
**Tests:** test-file:test-name — what it asserts — unit|integration|e2e
**Dead code removed:** path:symbol — why  (or "none")
**Pre-flight (caller-side verification):** REQUIRED if you added any `#[tauri::command]` or `tauri-commands.ts` export — cite the rg invocation + result. Use "n/a — no new IPC surface" otherwise.
**Did NOT do (scope):** ...
**Debt introduced:** none | <describe>
**Risks:** <for validator>
```
