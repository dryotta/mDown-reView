# Retrospective — feature/issue-112-comments-changed-event iter 2

## Outcome
Iter 2 simplified iter 1's overshoot. Net **-230 LOC**. All 9 expert findings addressed via deletion (not addition). All validations green: lint, tsc, vitest 1407/1407, cargo 61+7 emit, playwright 130/130. CI green on push.

## What changed (vs iter 1)
1. Reverted `Emitter::emit` → `emit_to(self, "main", …)` in `commands/comments/mod.rs` per `docs/design-patterns.md` rule 4. Trait seam stays (it intercepts above the Tauri channel; `MockEmitter` doesn't care about the channel).
2. Deleted `resolve_comment` + `move_anchor` Rust commands and TS wrappers — frontend uses `update_comment` patches at `use-comment-actions.ts:162-205`. ~110 lines dead.
3. Deleted `e2e/browser/comment-emit-contract.spec.ts` — circular oracle (asserted the IPC mock fired, not the Rust contract). AC6 covered transitively by 5 modified `comment-on-*.spec.ts`.
4. Extracted `COMMENT_MUTATION_COMMANDS` to `src/lib/comment-mutation-commands.ts` — single source of truth (was duplicated 4×).

## What iter 1 got wrong (causing iter 2 work)
- Implementer added 2 dedicated commands "for completeness" without checking caller-side. Frontend already routes through `update_comment` patches.
- Implementer chose `Emitter::emit` over `emit_to("main", ...)` to satisfy `tauri::test::mock_app()` — but the same PR introduced a `CommentsEmitter` trait seam that makes the test-mock concern moot. Two solutions to one problem.
- Implementer wrote a "regression test" (`comment-emit-contract.spec.ts`) whose entire signal came from the test fixture's own auto-emit, not the production code path. Bypassing the bare-specifier import in iter-1 forward-fix didn't fix the underlying tautology.

## Phase 2 candidates

**P2-CANDIDATE-1 (HIGH, prompt/skill):** `exe-task-implementer` should be required, before introducing new IPC commands, to grep the frontend for an existing call site and document why the new command is needed (or report that it's a duplicate). Would have caught the dead `resolve_comment`/`move_anchor` plumbing pre-commit.

**P2-CANDIDATE-2 (MEDIUM, skill):** When a regression test's "production path" is a test fixture (mock or e2e auto-emit), the test is circular. Iterate Step 6b should add a manual review item: *"For each new test, name the production code path that fails when reverted."* Would have caught the circular contract spec.

**P2-CANDIDATE-3 (LOW, docs):** When choosing an IPC channel (emit vs emit_to), require explicit citation of `docs/design-patterns.md` rule 4 in the PR commit message. Today: silent drift caught only by expert review.

## Cost
- Iter 1: ~5h (RCA + 17-file change + e2e forward-fix + 1 CI re-poll + 1 panel)
- Iter 2: ~1h (single subagent dispatch + validations + 1 CI re-poll)

## Learning
The `--scope tighten Step 6b/7 to diff content` improvement (#122 from #105 retro) won't help here — iter-1 needed the full 8-expert panel to surface the lean and arch findings. But P2-CANDIDATE-1 (force caller-side grep) would have prevented iter 2 entirely.
