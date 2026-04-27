# Agentic Development Process

`mdownreview` embraces agentic development. This doc maps the moving parts and gives copy-pasteable prompts for the **three workflows** that cover ~all day-to-day work.

For the **rules** every agent must follow, read [`AGENTS.md`](AGENTS.md). This doc is the **process** layer.

---

## Three flows

### Flow 1 — New feature (human-initiated)

```
You file an issue   →   /groom-issues #N   →   /iterate-one-issue #N
                                                   │
                                       branch + tests + PR + retro
```

File the issue manually or use prompt:

**Prompts:**
```
> brainstorm with me improvements to the comments panel and file a gh issue after
```
```
/groom-issues #142
```
```
/iterate-one-issue #142
```

### Flow 2 — Self-improvement via agentic dogfood (fully autonomous)

```
/test-exploratory-loop      ──files──►   GitHub issues (explore-ux, bug)
   (terminal C)                              │
                                             ▼
/iterate-loop               ──opens──►   PRs labelled `iterate-pr` (ready-for-review)
   (terminal A)                              │
                                             ▼
/merge-pr-loop              ──gates──►   Release Gate → squash-merge to main
   (terminal B)                              │
                                             └──── next /iterate-loop round picks up
                                                   any iterate-improvement issues
```

Each loop runs in its own terminal — its inner agent runs synchronously in the foreground, so progress is always visible. All loops re-sync to `origin/main` between rounds.

**Prompts:**

Terminal A (issue → PR):
```
/iterate-loop
```

PRs land ready-for-review with the `iterate-pr` label. Run terminal B to ship them.

Terminal B (PR → release-gate → merge):
```
/merge-pr-loop
```

`merge-pr-loop` watches `iterate-pr` PRs, dispatches the Release Gate against each branch, drives forward-fixes via `iterate-one-issue --resume-pr <PR>` on failure (max 5 attempts per PR), and squash-merges on green. Choose the loops up-front — there is no shared mid-run state between them.

Terminal C (explore loop, Windows-only, optional):
```
/test-exploratory-loop
```

(Defaults to 50 iterations; pass `--iterations N` to override.)

This is the intended steady-state for the project.

### Flow 3 — Self-iterate towards a human-initiated goal

When you have a freeform goal that doesn't decompose into known issues, hand it to `iterate-one-issue` directly. The `exe-goal-assessor` agent decides when "done" is true.

**Prompts:**
```
/iterate-one-issue make the cold-start time on Windows under 800 ms
```

The skill assesses, plans, implements, runs gates, opens the PR ready-for-review with the `iterate-pr` label, retros. No issue required. The PR is left ready-for-review — `iterate-one-issue` itself never merges and never dispatches the release gate. Run `/merge-pr-loop` (or merge manually) to ship it.

---

## Skills (the verbs)

Skills live in `.claude/skills/<name>/SKILL.md`. You invoke skills.

### Autonomous loops (never prompt)

| Skill | Use when |
|---|---|
| **`iterate-loop`** | Drain the issue backlog continuously; pair with `merge-pr-loop` (and optionally `test-exploratory-loop`). Sequential — inner agent runs in the foreground for full visibility. |
| **`merge-pr-loop`** | Watch ready-for-review `iterate-pr` PRs, run the Release Gate, drive forward-fixes via `iterate-one-issue --resume-pr`, squash-merge on green. |
| **`iterate-one-issue`** | One issue, one freeform goal, or `--resume-pr <PR>` for a release-gate forward-fix pass driven by `merge-pr-loop`. |
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

- "Look at this and make it better" — too vague. Use a scenario prompt or file an issue and run `/iterate-one-issue #N`.
- Editing `main` directly — feature branch + PR is mandatory.
- Calling reviewer agents one-by-one — skills dispatch them in parallel.
- Skipping `/run-build-test` before a PR — CI catches it, but local catch is faster.
- Treating the retrospective as optional — it's how the system improves itself.

---

## Further reading

- [`AGENTS.md`](AGENTS.md) — charter, git workflow, doc taxonomy router
- [`docs/principles.md`](docs/principles.md) — five pillars + three meta-principles
- [`.claude/shared/retrospective.md`](.claude/shared/retrospective.md) — unified retro + self-improve contract
- [`.claude/skills/iterate-loop/SKILL.md`](.claude/skills/iterate-loop/SKILL.md) — outer issue-drain orchestrator
- [`.claude/skills/merge-pr-loop/SKILL.md`](.claude/skills/merge-pr-loop/SKILL.md) — release-gate + merge orchestrator
- [`.claude/skills/iterate-one-issue/SKILL.md`](.claude/skills/iterate-one-issue/SKILL.md) — single-issue / single-goal executor (and `--resume-pr` forward-fix mode)
- [`.claude/skills/run-build-test/SKILL.md`](.claude/skills/run-build-test/SKILL.md) — local CI mirror
