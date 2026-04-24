# Product Principles & Documentation — Design

**Date:** 2026-04-23
**Status:** Approved, in execution

## Goal

Define mdownreview's product identity through a small set of durable **principles** and a larger set of concrete, citable **rules**. Propagate those principles into `AGENTS.md`, every expert subagent, every worker/validator subagent, and the skills that drive planning and implementation — so every future change is evaluated against the same standard.

## Non-goals

- No feature work in this change.
- No refactor of existing code (the principles describe current-or-intended state; enforcement of gaps lands in follow-up issues).
- No changes to mechanical skills (`start-feature`, `run-tests`, `validate-ci`, `publish-release`) — they are pure process, no judgment.

## 1. Document structure

One charter + five domain deep-dives, all in `docs/` (peer to `docs/specs/`).

| Doc | Purpose | Primary author |
|---|---|---|
| `docs/principles.md` | Charter. 5 product pillars (Professional, Reliable, Performant, Lean, Architecturally Sound) + 3 engineering meta-principles (Evidence-Based, Rust-First, Zero Bug). Routes to deep-dives. | Synthesized |
| `docs/architecture.md` | Structural rules: layer separation, IPC contract, Zustand slice boundaries, component boundaries, file-size budgets. | `architect-expert` |
| `docs/performance.md` | Hard numbers: startup budget, file-open budget, render-cost budget, watcher debounce, memory ceiling. | `performance-expert` |
| `docs/security.md` | IPC surface rules, markdown XSS vectors, path handling, logging redaction, save-loop prevention. | `security-reviewer` (+ `react-tauri-expert` for framework reliability) |
| `docs/design-patterns.md` | React 18/19 idioms, Tauri v2 idioms, hook composition, event-vs-command choice, persistence pattern. | `react-tauri-expert` (+ `product-improvement-expert` for UX-preserving patterns) |
| `docs/test-strategy.md` | 3-layer pyramid rules, coverage floors, IPC mock hygiene, console-error-spy contract. | `test-gap-reviewer` |

**Every rule** in every doc is a single declarative sentence, numbered, backed by file:line evidence or benchmark, citable as "violates rule N in `docs/X.md`".

## 2. AGENTS.md changes

AGENTS.md becomes a router, not a source of truth.

- Replace the "Core Engineering Principles" section with a short **"Product Identity"** section: 5 pillars in a table (1-line each), followed by 3 engineering meta-principles (1-line each), followed by a link to `docs/principles.md`.
- Add a **"Operational Rules"** section: one bullet per deep-dive doc with a 1-line summary and a link.
- Keep the rest of AGENTS.md (git workflow, tech stack table, specs list, test strategy overview) but remove duplicated content now owned by the deep-dives. Keep a short test-strategy summary pointing to `docs/test-strategy.md`.
- Goal: AGENTS.md stays under ~200 lines and every long-form rule moves to a deep-dive.

## 3. Subagent updates (12)

Every subagent gets a **"Principles you apply"** block near the top of its file, citing specific docs. Review-type subagents must cite "violates rule N in docs/X.md" form in their reports.

| Subagent | Must cite |
|---|---|
| `architect-expert` | `architecture.md`, `design-patterns.md` |
| `performance-expert` | `performance.md` |
| `react-tauri-expert` | `design-patterns.md`, `architecture.md` |
| `security-reviewer` | `security.md` |
| `product-improvement-expert` | `principles.md` (pillar focus: Professional) |
| `test-gap-reviewer` | `test-strategy.md` |
| `ux-expert` | `principles.md` (Professional pillar), `design-patterns.md` |
| `bug-hunter` | `principles.md` (Zero Bug), `test-strategy.md` |
| `e2e-test-writer` | `test-strategy.md` |
| `task-implementer` | full set, Evidence-Based + Rust-First emphasized |
| `goal-assessor` | full set |
| `implementation-validator` | full set |

## 4. Skill updates (3)

| Skill | Change |
|---|---|
| `implement-issue` | Planning step must check proposed change against principles; code review step must call out rule violations by number. |
| `self-improve-loop` | Add principles doc set as evaluation criteria when choosing improvement targets. |
| `groom-issues` | Score issues against pillars when prioritizing the backlog. |

Mechanical skills (`start-feature`, `run-tests`, `validate-ci`, `publish-release`) are unchanged.

## 5. Expert dispatch prompt (unified template)

Each of the 6 experts receives the same prompt shape, with a domain-specific scope appendix. Key elements:

- **Context**: read `AGENTS.md` and `CLAUDE.md` first. Project is a Tauri v2 + React + Rust desktop viewer.
- **Pillars**: Professional, Reliable, Performant, Lean, Architecturally Sound.
- **Deliverable**: single markdown doc, 800-2000 words, with Principles (3-6), Rules (15-30), Gaps.
- **Rigor**: Every rule = single declarative sentence + file:line or benchmark. No guessing. Numbered. Citable. Tied to pillars.
- **Scope**: domain-specific paragraph.

Experts produce *raw reports*. Synthesis into deep-dive docs (the actual `docs/*.md` files) is done by the orchestrator, not the experts — this ensures cross-doc consistency, shared terminology, and de-duplication.

## 6. Sequencing & review gates

1. **Branch created** (`chore/product-principles`) ✅
2. **Spec written and committed** (this file)
3. **Dispatch 6 experts in parallel** — auditor reports collected
4. **Synthesize** into charter + 5 deep-dives
5. **Update AGENTS.md** to route to deep-dives
6. **Update 12 subagents** with principle citations
7. **Update 3 skills**
8. **Self-review** for internal consistency (every rule cited by at least one subagent; every doc linked from AGENTS.md; no contradictions between docs)
9. **Present diff summary to user** for review
10. **Push + open PR** per `AGENTS.md` workflow — user merges

## Acceptance criteria

- `docs/principles.md` + 5 deep-dive docs exist, each ≤ ~1200 words, internally consistent.
- Every rule in every deep-dive is numbered, cites evidence, and has a clear pillar tag.
- `AGENTS.md` is shorter than before and links to all 6 new docs.
- Every subagent file references at least one doc under a "Principles you apply" heading.
- The 3 skill files (`implement-issue`, `self-improve-loop`, `groom-issues`) reference the principles.
- `npm run lint` passes (docs don't affect lint but no accidental code changes should exist).
- PR description lists the 6 new docs and the 15 file updates.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Expert reports overlap or contradict | Synthesis phase is owned by orchestrator; conflicts resolved before writing docs. |
| Rules become too abstract to enforce | Every rule must include evidence (file:line or benchmark); abstract rules are rewritten. |
| AGENTS.md bloat | Hard target: ≤200 lines post-change. Anything longer moves to deep-dive. |
| Subagent files become noisy with boilerplate | Each subagent gets a compact "Principles you apply" table, not a full re-statement. |
