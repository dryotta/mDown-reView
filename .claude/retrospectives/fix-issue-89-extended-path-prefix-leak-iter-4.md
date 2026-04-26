# Issue #89  retrospective (iter 4 final)

**Mode:** bug-mode iterate
**Final commit:** 07c3763
**Total iters:** 4

## What worked
- bug-expert RCA produced clear ACs in iter 1.
- Empirical falsification: iter 2 implementer's hypothesis (8.3 not resolved by dunce) was wrong; tests confirmed dunce DOES resolve 8.3. This shifted focus to the real boundary mismatch.
- Iter 3 fixed the renderer-side path-form mismatch (scan_review_files canonical vs stored tab paths).
- Iter 4 caught the regression cleanly: missing IPC mock default  null cascade  TypeError. Defensive null-guard + mock default fixed all 50+ regressed browser specs.

## What hurt
- Iter 2 added a Rust regression test for a bug that was actually in the renderer comparison. Test passed without fixing the user-visible failure.
- Iter 3 implementer didn't update the Playwright browser fixture mock for the new IPC, even though they updated the Vitest mock. Two parallel mock layers, one was missed.

## Phase-2 candidate
- 'When introducing a new IPC command, the implementer must update BOTH \src/__mocks__/@tauri-apps/api/core.ts\ (Vitest) AND \2e/browser/fixtures/error-tracking.ts\ (Playwright)'. Two-layer mock skew bit us in iter 4.
- Add a contract test that imports the IPC command list and asserts both mocks have a default for every command.
