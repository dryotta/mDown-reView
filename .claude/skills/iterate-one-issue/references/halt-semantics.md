## Halt semantics

**Halt (loop ends, Phase 2 runs):**
- Step 2 `blocked`
- Step 1 abort after auto-resolution
- Cap = 30
- Step 9c (release-gate forward-fix) fails 5×
- Step 9a-dispatch fails (workflow_dispatch returned error / could not capture run ID)

**Halt (loop ends, Phase 2 deferred to resume):**
- Step 9a-dispatch returns `Done-Achieved-RG-Pending` in pipeline mode (loop will run Phase 2 after 9b–d-resume reaches Done-Achieved or Done-Blocked).

**`DEGRADED` (continue):**
- Validate/CI/experts fails to converge after 5 forward-fix waves (Step 6d — single merged loop)
- `IS_BUG` and bug-expert RCA inconclusive (Step 3a)

**`SKIPPED` (continue):**
- `risk=high` plan rejected by `architect-expert` (Step 4)
- Every implementer reports no-op (Step 5)

**Pre-loop halt:**
- No arg passed (use `iterate-loop` for backlog drain)
- Dirty tree at setup
- Pre-existing target branch
- Genuine spec ambiguity in issue mode (posts comment + `needs-grooming` label, exits cleanly so `iterate-loop` can move on)

**No chaining inside this skill.** Done-Achieved / Done-Achieved-RG-Pending / Done-Blocked / Done-TimedOut all print `ITERATE_OUTCOME: …` then exit. The companion `iterate-loop` decides whether to invoke another `iterate-one-issue` for the next eligible issue, and (in pipeline mode) decides when to call back into 9b–d-resume for any pending release gate.

**No longer halts:**
- Issue has no `<!-- mdownreview-spec -->` comment (0c derives)
- Genuine spec ambiguity in goal mode (captured in PR description, run continues)
- Step 9 release-gate dispatch on a `DIFF_CLASS != code` diff (Step 9 skipped, Done-Achieved direct)

---
