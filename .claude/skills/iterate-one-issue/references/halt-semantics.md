## Halt semantics

**Halt (loop ends, Phase 2 runs):**
- Step 2 `blocked`
- Step 1 abort after auto-resolution (rebase conflict)
- Cap = 30 iterations
- Step 2 `achieved` → Done-Achieved (no release-gate dispatch — `merge-pr-loop` owns that lifecycle)

**Halt (loop ends, Phase 2 skipped):**
- Phase R (`--resume-pr`) success → `Done-ForwardFixed`
- Phase R (`--resume-pr`) failure (no failed run, missing branch, no-op fix, attempt cap) → `Done-Blocked`

**`DEGRADED` (continue):**
- Validate/CI/experts fails to converge after 5 forward-fix waves (Step 6d — single merged loop)
- `IS_BUG` and bug-expert RCA inconclusive (Step 3a)

**`SKIPPED` (continue):**
- `risk=high` plan rejected by `architect-expert` (Step 4)
- Every implementer reports no-op (Step 5)

**Pre-loop halt:**
- No arg passed (use `iterate-loop` for backlog drain)
- Dirty tree at setup
- Pre-existing target branch (issue/goal mode only — `--resume-pr` deliberately reuses an existing branch)
- Genuine spec ambiguity in issue mode (posts comment + `needs-grooming` label, exits cleanly so `iterate-loop` can move on)
- `--resume-pr` referenced PR is not OPEN, or lacks the `iterate-pr` label

**No chaining inside this skill.** Done-Achieved / Done-Blocked / Done-TimedOut / Done-ForwardFixed all print `ITERATE_OUTCOME: …` then exit. The caller (`iterate-loop` for the backlog drain, `merge-pr-loop` for forward-fix passes) decides what runs next.

**No longer halts:**
- Issue has no `<!-- mdownreview-spec -->` comment (0c derives)
- Genuine spec ambiguity in goal mode (captured in PR description, run continues)

---
