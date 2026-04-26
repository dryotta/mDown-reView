## Halt semantics

**Halt (loop ends, Phase 2 runs):**
- Step 2 `blocked`
- Step 1 abort after auto-resolution
- Cap = 30
- Step 9 fail after 5 forward-fix
- Step 9 finds pre-existing release-mirror branch

**`DEGRADED` (continue):**
- Validate/CI fails after 5 forward-fix (Step 6)
- Expert review still blocks after one fix round (Step 7)
- `IS_BUG` and bug-expert RCA inconclusive (Step 3a)

**`SKIPPED` (continue):**
- `risk=high` plan rejected by `architect-expert` (Step 4)
- Every implementer reports no-op (Step 5)

**Pre-loop halt:**
- Dirty tree at setup
- Pre-existing target branch
- `MODE=drain-once` and 0c finds no eligible open issues
- `MODE=continuous` and the 24-hour monitor budget exhausts with zero eligible issues

**Continuous-mode chaining (no halt):**
- Done-Achieved, Done-Blocked, and Done-TimedOut all return to **0b** for the next eligible issue when `OUTER_MODE` was `continuous` or `drain-once` (until 0c finds none — see Pre-loop halt above).

**No longer halts:**
- Issue has no `<!-- mdownreview-spec -->` comment (0d derives)
- 0c finds no `groomed` (falls back to oldest non-blocked, non-grooming open issue)
- Genuine spec ambiguity (0e posts a comment + `needs-grooming` label and moves on instead of asking)

---
