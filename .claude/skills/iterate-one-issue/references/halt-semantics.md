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
- No arg passed (use `iterate-loop` for backlog drain)
- Dirty tree at setup
- Pre-existing target branch
- Genuine spec ambiguity in issue mode (posts comment + `needs-grooming` label, exits cleanly so `iterate-loop` can move on)

**No chaining inside this skill.** Done-Achieved / Done-Blocked / Done-TimedOut all print `ITERATE_OUTCOME: …` then exit. The companion `iterate-loop` decides whether to invoke another `iterate-one-issue` for the next eligible issue.

**No longer halts:**
- Issue has no `<!-- mdownreview-spec -->` comment (0c derives)
- Genuine spec ambiguity in goal mode (captured in PR description, run continues)

---
