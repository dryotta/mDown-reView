# Building mdownreview

## Prerequisites

- [Node.js LTS](https://nodejs.org) (v20+)
- [Rust stable](https://rustup.rs) (1.75+)

## Setup

```bash
git clone https://github.com/dryotta/mdownreview.git
cd mdownreview
npm install
npm run stage:cli      # builds + stages mdownreview-cli for Tauri externalBin (one-time per checkout)
```

> The `stage:cli` step is required because `tauri.conf.json` declares
> `bundle.externalBin: ["binaries/mdownreview-cli"]`, which Tauri's build
> script validates at compile time. `npm run tauri:build` re-runs it
> automatically, but `cargo check` / `cargo test` need it staged manually.

## Development

```bash
npm run tauri          # dev server with hot reload
```

## Testing

```bash
npm run lint           # ESLint
npm test               # unit tests (Vitest)
npm run test:e2e       # E2E tests (Playwright browser mode)
cargo test             # Rust unit + integration tests (run from src-tauri/)
```

> **Note:** `cargo test` requires the CLI binary to be built first for integration tests:
> ```bash
> cd src-tauri && cargo build --bin mdownreview-cli && cargo test
> ```

## Production Build

### Desktop App (GUI)

```bash
npm run tauri:build    # builds platform installer
```

Output locations:
- **Windows:** `src-tauri/target/release/bundle/nsis/`
- **macOS:** `src-tauri/target/release/bundle/dmg/`

### CLI Tool

```bash
cd src-tauri && cargo build --release --bin mdownreview-cli
```

Output: `src-tauri/target/release/mdownreview-cli[.exe]`

> For installer/distribution behaviour (script vs DMG, ad-hoc signing, quarantine handling, externalBin), see [docs/features/installation.md](docs/features/installation.md).

### Benchmarks

```bash
npm run bench:cli           # run criterion benchmarks (from src-tauri/)
npm run bench:cli:script    # run CLI subprocess timing script
```

---

## Claude Code Automation

The project ships a set of Claude Code skills and subagent definitions in `.claude/` that automate the full development cycle — from starting a branch to running a continuous self-improvement loop.

### Skills

Skills are invoked in a Claude Code session with `/skill-name`. They are defined in `.claude/skills/<name>/SKILL.md`.

---

#### `/iterate`

Autonomously implements a GitHub issue or drives improvement toward a free-text goal, end-to-end, on a single branch and single PR. Supersedes the former `/start-feature`, `/implement-issue`, and `/self-improve-loop` skills.

**Mode is picked from the argument shape:**

| Invocation | Mode |
|---|---|
| `/iterate` (no args) | Auto-pick the oldest open `groomed` issue |
| `/iterate 42` / `/iterate #42` / `/iterate issue-42` / `/iterate <issue URL>` | Issue mode, that issue |
| `/iterate eliminate all ESLint warnings` | Goal mode, using the text verbatim |

**What it does:**
1. Pre-flight (clean tree, on main), creates `feature/issue-<N>-<slug>` or `auto-improve/<slug>-<date>`, opens a draft PR.
2. Up to 30 iterations of: rebase-with-rerere → `goal-assessor` → demand-driven pre-consult experts → plan → parallel `task-implementer` groups → push + race local validation against CI → 6-expert diff review → record.
3. Forward-fixes every failure — validate/CI up to 5 attempts, expert review one round. Never aborts a phase; the assessor re-reads code the next iteration.
4. On `STATUS=achieved`, mirrors the branch tip to `release/iterate-<slug>-<timestamp>`, opens a draft mirror PR to trigger the Release Gate workflow, forward-fixes platform-matrix failures (5 attempts), then closes the mirror PR and marks the iterate PR ready.

**When to use:**
- Any groomed GitHub issue (replaces `/implement-issue`).
- Any free-text improvement goal (replaces `/self-improve-loop`).
- As a safer alternative to hand-coded branch creation — though a bare `git checkout -b feature/<slug>` is faster for small manual spikes (this replaces `/start-feature`).

**When NOT to use:** reviews (use `/review`), releases (use `/publish-release`), triggering CI only (use `/validate-ci`).

---

#### `/groom-issues`

Interactively grooms GitHub issues by brainstorming requirements and attaching a structured spec as a comment.

- **Default**: fetches all open issues labeled `needs-grooming`, processes oldest first
- **With issue numbers** (`/groom-issues #36 #42`): grooms those specific issues regardless of labels
- Asks clarifying questions one at a time, proposes approaches, generates a spec
- Posts spec as a comment (with HTML marker for re-groom updates)
- Swaps labels: `needs-grooming` → `groomed`
- To re-groom: remove `groomed`, add `needs-grooming` — the skill updates the existing spec

---

#### `/run-tests`

Selects and runs the right test suite based on what changed.

| Changed files | Suite run |
|---|---|
| `src/` logic, store, utilities | `npm test` (Vitest, fastest) |
| `e2e/browser/`, UI components | `npm run test:e2e` (Playwright + Vite dev server) |
| `src-tauri/`, watcher, file I/O | `npm run test:e2e:native:build` (builds binary first) |

Reports pass count, fail count, and full output for any failures.

---

#### `/validate-ci`

Triggers both CI and Release Gate workflows for full validation. Use before releases or for significant changes that need cross-platform testing.

- **On a branch**: pushes and creates a draft PR. If the branch isn't `release/*`, offers to create one (Release Gate requires `release/*` prefix).
- **On main**: creates a temporary `release/validate-<sha>` branch with an empty commit and a draft PR, triggering all workflows.

---

#### `/expert-review`

Fires all six expert subagents **in parallel**, cross-references open GitHub issues, then synthesizes a single prioritized improvement plan.

**Output sections:**
- GitHub issue status table
- Priority 1 / 2 / 3 improvements (with file locations and fix hints)
- Quick wins (< 1 hour each)
- Expert consensus items (issues flagged by 2+ experts independently)
- Recommended sprint plan

Use this before planning a sprint or when you want a full health check of the codebase.

---

#### `/self-improve`

One cycle of the autonomous self-improvement loop. Designed to be run repeatedly via `/loop Xh /self-improve`.

**Full cycle walkthrough:**

```
1. Safety pre-flight
   └─ git status clean? branch = main? → stop if not

2. Load log (.claude/self-improve-log.md)
   └─ read DONE / FAILED / SKIPPED task IDs to avoid repeats

3. Get task list
   ├─ Cache < 24h old? → reuse .claude/self-improve-cache.md
   └─ Cache stale/missing → spawn 6 expert agents in parallel,
      write new cache with Quick Wins + Priority 1/2 tables

4. Select next task
   └─ First Quick Win (risk=low) not already in log

5. Create branch
   └─ git checkout -b auto-improve/YYYYMMDD-short-slug

6. Implement  (task-implementer agent)
   └─ scoped, style-matching code change; returns change summary

7. Validate  (implementation-validator agent)
   └─ npx tsc --noEmit → npm test → eslint --max-warnings=0
   └─ PASS or DO NOT COMMIT verdict

8. Commit or abort
   ├─ PASS  → git add <specific files> + commit + update log (DONE)
   └─ FAIL  → delete branch + update log (FAILED) + print reason
```

**State files written/read each cycle:**

| File | Purpose |
|---|---|
| `.claude/self-improve-cache.md` | Expert review output, reused for 24h |
| `.claude/self-improve-log.md` | Persistent record of every attempted task (DONE / FAILED / SKIPPED) |

**Auto-mode safety scope** — the loop will never automatically:
- Modify `src-tauri/tauri.conf.json` or capability/permissions config
- Add dependencies (`npm install`, `cargo add`)
- Touch `.claude/` directory
- Implement anything touching auth, file deletion, or process execution
- Commit to `main` — all changes land on `auto-improve/*` branches for human review

**Starting the loop:**

```bash
/loop 2h /self-improve    # run a cycle every 2 hours
/loop 6h /self-improve    # slower / less aggressive
/self-improve             # single manual cycle
```

**Reviewing loop output:**

Each completed cycle leaves an `auto-improve/*` branch. Review and merge (or discard) at your own pace:

```bash
git log --oneline auto-improve/20260422-fix-unlisten-cleanup
git checkout main && git merge auto-improve/20260422-fix-unlisten-cleanup
# or discard:
git branch -D auto-improve/20260422-fix-unlisten-cleanup
```

---

#### `/publish-release`

Publishes a new release: bumps the version in `package.json` and `tauri.conf.json`, updates `CHANGELOG.md`, commits, and pushes a version tag that triggers the CI build workflow.

Requires an explicit confirmation step before writing any files — will stop and show the proposed version for approval first.

---

### Expert Subagents

Subagents are specialist Claude instances invoked in parallel by the `/iterate` skill (9-expert unconditional panel + 1 conditional per-iteration diff review, plus demand-driven pre-consult). Defined in `.claude/agents/`.

**Review panel (run per iteration diff):**

| Agent | Specialisation |
|---|---|
| `product-improvement-expert` | Feature gaps in the AI-output review workflow; missing capabilities; friction points |
| `performance-expert` | React rendering bottlenecks (shiki, Mermaid), Rust watcher efficiency, IPC payload size |
| `architect-expert` | Component boundaries, Zustand store design, IPC contract integrity, dependency direction |
| `react-tauri-expert` | React 19 API misuse (missing `useTransition`, stale closures), Tauri v2 pattern correctness, plugin usage |
| `ux-expert` | Keyboard navigation, loading/error states, comment workflow friction, empty states |
| `bug-hunter` | Race conditions, async error handling, `listen()` leaks without `unlisten()`, comment anchor edge cases |
| `test-expert` | Test completeness, pyramid-layer correctness, reliability/flakiness, e2e coverage, IPC-mock hygiene, oracle quality |
| `documentation-expert` | Doc taxonomy (principles + deep-dives + one evergreen `docs/features/<area>.md`), code/doc drift, rule-citation staleness |
| `lean-expert` | **Pushes for simpler implementations** — dependency justification, bundle/binary size, dead code, file-size budgets, inlining + collapsing opportunities |
| `security-reviewer` *(conditional)* | Tauri IPC handlers, path traversal, XSS in markdown rendering, IPC type mismatches — runs when diff touches commands, path handling, or markdown rendering |

**Assessor + workers:**

| Agent | Role |
|---|---|
| `goal-assessor` | Reads the code from scratch each iteration, emits fresh requirement specs (Step 2 of `/iterate`) |
| `task-implementer` | Implements a single scoped task; returns a structured change summary |
| `e2e-test-writer` | Writes Playwright browser and native tests following the IPC mock pattern |
| `implementation-validator` | Runs lint → tsc → cargo test → vitest → browser-e2e → native-e2e; returns PASS/FAIL with full output |

### Hooks

Hooks in `.claude/hooks/` run automatically after every file edit (PostToolUse on `Edit` and `Write`):

| Hook | What it does |
|---|---|
| `prettier-on-edit.js` | Formats `.ts`, `.tsx`, `.js`, `.jsx`, `.css` files with Prettier |
| `check-test-exists.js` | Warns (non-blocking) when a `src/lib/` or `src/components/` file is written with no corresponding `__tests__/` file |

TypeScript is also checked after every edit via `npx tsc --noEmit` (configured directly in `.claude/settings.json`).
