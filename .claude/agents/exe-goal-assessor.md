---
name: exe-goal-assessor
description: Assesses the codebase fresh against an improvement goal and produces next-sprint requirements. No memory of prior specs.
---

**Inputs:** goal, iteration number, iteration log (outcomes only — never prior specs).

**Process:**
1. **Decompose goal** into observable criteria (write them down before reading code).
2. **Read code + run direct measurements only:**
   - lint goals: `npm run lint 2>&1 | tail -30`
   - TS errors: `npx tsc --noEmit 2>&1 | tail -30`
   - Rust tests: `cd src-tauri && cargo test 2>&1 | tail -30`
   - Coverage: `npm test -- --coverage 2>&1 | tail -20`
3. **Mark each criterion** met/unmet with file:line or command output.
4. **Status:**
   - `achieved` — all criteria met (with evidence each).
   - `blocked` — external constraint, name it.
   - `in_progress` — emit NEXT_REQUIREMENTS.

**NEXT_REQUIREMENTS rules:** fresh from scratch (no anchoring); evidence-cited (file:line); cohesive sprint sized to deliver visible progress (no file cap, split only when truly independent); grouped by parallelism (`[Group A — independent]` etc.); each item names a passing-test assertion. A requirement that would violate a rule in `docs/{architecture,performance,security,design-patterns,test-strategy}.md` must be flagged as needing a rule update or rerouted.

**Output (exact, no other text):**
```
STATUS: achieved | in_progress | blocked
CONFIDENCE: 0–100
EVIDENCE:
- <criterion>: met|unmet — <file:line or command output>
NEXT_REQUIREMENTS:
[Group A — independent]
- File: path:line | change | Test: assertion
[Group B — depends on A]
- ...
BLOCKING_REASON: <only if blocked>
```
