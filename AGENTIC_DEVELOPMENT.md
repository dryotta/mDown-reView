# Agentic Development Process

`mdownreview` is built by AI agents driven from short scenario prompts. This doc maps the moving parts and gives copy-pasteable prompts for the **three workflows** that cover ~all day-to-day work.

For the **rules** every agent must follow, read [`AGENTS.md`](AGENTS.md). This doc is the **process** layer.

---

## TL;DR

- Issues are the only durable backlog.
- **`/iterate-loop`** drains the backlog continuously; **`/iterate-one-issue`** does one issue or one freeform goal.
- **`/test-exploratory-loop`** dogfoods the live app and files new bugs as issues; the iterate loop then fixes them.
- Every autonomous run writes a retrospective and, if it found a process gap, files a `iterate-improvement` issue — closing the loop.

---

## Three flows

### Flow 1 — New feature (human-driven)

```
You file an issue   →   /groom-issues #N   →   /iterate-one-issue N
                                                   │
                                       branch + tests + PR + retro
```

Manual: file the issue. Then groom it (Phase A is interactive, asks the questions needed to make it executable, applies acceptance criteria, adds `groomed`). Then dispatch one iterate run against it. The skill plans → writes failing tests → implements → runs `/run-build-test` → opens the PR → writes a retrospective.

**Prompts:**
```
brainstorm with me improvements to the comments panel and file a gh issue after
```
```
/groom-issues #142
```
```
/iterate-one-issue 142
```
or for several at once, run them through the loop:
```
/iterate-loop
```
(The loop will pick up `groomed` issues first.)

### Flow 2 — Self-improvement via dogfood (fully autonomous)

```
/test-exploratory-loop      ──files──►   GitHub issues (explore-ux, bug)
   (terminal B)                              │
                                             ▼
/iterate-loop               ──fixes──►   PRs + retros + iterate-improvement issues
   (terminal A)                              │
                                             └──── next /iterate-loop round picks them up
```

Two terminals (preferably two git worktrees — see `superpowers:using-git-worktrees`). Both loops re-sync to `origin/main` between rounds, so you can merge PRs at your own pace.

**Prompts:**

Terminal A (fix loop):
```
/iterate-loop
```

Terminal B (explore loop, Windows-only):
```
/test-exploratory-loop --iterations 100
```

This is the intended steady-state for the project.

### Flow 3 — Self-improvement towards a goal (fully autonomous)

When you have a freeform goal that doesn't decompose into known issues, hand it to `iterate-one-issue` directly. The `exe-goal-assessor` agent decides when "done" is true.

**Prompts:**
```
/iterate-one-issue add a CSV export action to the comments panel
```
```
/iterate-one-issue compress agent + skill prompts into a minimal, lossless representation; remove boilerplate, repeated phrasing, and verbose disclaimers
```
```
/iterate-one-issue make the cold-start time on Windows under 800 ms
```

The skill assesses, plans, implements, runs gates, opens PR, retros. No issue required.

---

## Skills (the verbs)

Skills live in `.claude/skills/<name>/SKILL.md`. You invoke skills.

### Autonomous loops (never prompt)

| Skill | Use when |
|---|---|
| **`iterate-loop`** | Drain the backlog continuously; pair with `test-exploratory-loop` |
| **`iterate-one-issue`** | One issue, one freeform goal, or `--once` style runs |
| **`test-exploratory-loop`** | Continuous dogfood, files new bugs (Windows only) |
| **`test-exploratory-e2e`** | One round of dogfood (Windows only) |

### Issue + release plumbing

| Skill | Use when |
|---|---|
| **`groom-issues`** | A raw issue or `needs-grooming` backlog needs to become executable (Phase A interactive · Phase B autonomous) |
| **`validate-ci`** | Open a `release/*` mirror PR so CI + Release Gate run on the current branch |
| **`publish-release`** | Bump version, update changelog, tag, push (triggers release workflow) |

### Local verification

| Skill | Use when |
|---|---|
| **`run-build-test`** | Before a PR / after a rebase — runs lint → build → fmt → clippy → cargo tests → vitest → Playwright (browser + native on Windows). Stops on first failure. |

### Authoring

| Skill | Use when |
|---|---|
| **`optimize-prompt`** | Author or edit a SKILL.md / agent / instruction block — returns a tightened rewrite with token delta |

---

## Agents (the expert reviewers)

Agents live in `.claude/agents/<name>.md`. They are stateless reviewers dispatched by skills (and sometimes by you). Every reviewer cites a specific rule (`"violates rule 14 in docs/architecture.md"`).

### Code-quality reviewers

| Agent | Reviews |
|---|---|
| `architect-expert` | Layer separation, IPC chokepoints, store design, file-size budgets |
| `bug-expert` | Confirmed defects with reproductions |
| `lean-expert` | Bloat — fewer lines, deps, abstractions |
| `performance-expert` | Render bottlenecks, watcher/IPC cost, Shiki, large files |
| `react-tauri-expert` | React 19 + Tauri v2 idioms |
| `security-expert` | IPC handlers, FS access, markdown XSS |
| `test-expert` | Pyramid placement, oracle quality, mock hygiene |

### Product / docs reviewers

| Agent | Reviews |
|---|---|
| `product-expert` | UX, scope vs Non-Goals, alignment with five pillars |
| `documentation-expert` | Drift between code and docs; doc taxonomy |

### Loop helpers (used by `iterate-one-issue`)

| Agent | Role |
|---|---|
| `exe-task-implementer` | Implements one scoped task |
| `exe-implementation-validator` | Runs the gate sequence; never fixes |
| `exe-goal-assessor` | Decides if a freeform goal's requirements are satisfied |

---

## Common prompts

```
# Backlog drain (default daily driver)
/iterate-loop

# Drain once and exit (CI-style)
/iterate-loop --once

# Single issue
/iterate-one-issue 142

# Several issues sequentially (the loop picks them up automatically; or chain manually)
/iterate-one-issue 36
/iterate-one-issue 40
/iterate-one-issue 41

# Freeform goal (no issue)
/iterate-one-issue add a CSV export action to the comments panel

# Review all bug-tagged issues, ask clarifications via groom, then fix in sequence
review all open issues with the `bug` label, run /groom-issues over them,
then /iterate-loop to fix them. Don't ask questions during iterate —
let the expert panels decide.

# Groom one issue / the whole needs-grooming queue
/groom-issues #87
groom the needs-grooming backlog

# Local verification before a PR
/run-build-test

# CI didn't run on a feature branch
/validate-ci

# Ship a release
/publish-release

# Tighten a prompt
/optimize-prompt
<paste prompt text>

# Direct expert review (escape hatch)
have the security-expert review my staged changes
```

---

## Where state lives

| Location | What |
|---|---|
| GitHub issues | The backlog — only source of truth for "what's next" |
| GitHub PRs | Work in progress + review state |
| `.claude/retrospectives/` | Per-run retros (`<skill>-<run-tag>.md`) — feeds the next `iterate-improvement` |
| `.claude/skills/<skill>/runs/<ts>/` | Skill-local artifacts (digests, screenshots, findings) — not committed |

No separate task tracker. Issues + PRs + retros are the entire system.

---

## Adding a new skill or agent

1. Read [`AGENTS.md`](AGENTS.md) and [`docs/principles.md`](docs/principles.md) — charter rules apply to skills/agents too.
2. Draft `SKILL.md` or `<agent>.md`.
3. Run `/optimize-prompt` over it before saving.
4. Land via `/iterate-one-issue` like any other change.

If the new skill is **fully autonomous**, wire up [`.claude/shared/retrospective.md`](.claude/shared/retrospective.md) so it joins the self-improvement loop.

---

## Anti-patterns

- "Look at this and make it better" — too vague. Use a scenario prompt or file an issue and run `/iterate-one-issue <N>`.
- Editing `main` directly — feature branch + PR is mandatory.
- Calling reviewer agents one-by-one — skills dispatch them in parallel.
- Skipping `/run-build-test` before a PR — CI catches it, but local catch is faster.
- Treating the retrospective as optional — it's how the system improves itself.

---

## Further reading

- [`AGENTS.md`](AGENTS.md) — charter, git workflow, doc taxonomy router
- [`docs/principles.md`](docs/principles.md) — five pillars + three meta-principles
- [`.claude/shared/retrospective.md`](.claude/shared/retrospective.md) — unified retro + self-improve contract
- [`.claude/skills/iterate-loop/SKILL.md`](.claude/skills/iterate-loop/SKILL.md) — outer orchestrator
- [`.claude/skills/iterate-one-issue/SKILL.md`](.claude/skills/iterate-one-issue/SKILL.md) — single-issue / single-goal executor
- [`.claude/skills/run-build-test/SKILL.md`](.claude/skills/run-build-test/SKILL.md) — local CI mirror
