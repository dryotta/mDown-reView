# mdownreview — Product Principles (Charter)

**Status:** Canonical. All other principles/rules docs derive from this one.
**Last updated:** 2026-04-23

## One-sentence definition

**mdownreview is a read-only, offline desktop reviewer that lets developers annotate AI-generated files in place — comments live beside the file, survive refactors, and never depend on a server.**

## The five product pillars

Every feature, review decision, and engineering trade-off is judged against these five pillars.

### 1. Professional
The app looks and feels like a tool a developer would pay for. Instant keyboard shortcuts, native menubar, polish details (ghost entries, comment badges, "Copy path" in About), and no amateur rough edges. Shipping a feature that is visibly half-finished damages this pillar more than not shipping it at all.

### 2. Reliable
Comments are the product, and comments are indestructible. MRSF sidecars, 4-step re-anchoring, ghost entries for deleted sources, atomic writes, save-loop prevention, and a watcher that survives editor rename patterns all exist to honor this pillar. A feature that risks losing a user comment is not shipped.

### 3. Performant
Fast startup, fast file open, fast search, fast render — even on folders of thousands of files. Performance is measured, not intuited. Budgets are numeric and tracked.

### 4. Lean
Minimal memory, minimal disk, minimal dependencies, minimal binary size. Every new dependency must earn its place. The app is a viewer, not a platform.

### 5. Architecturally Sound
Clean layer boundaries, narrow IPC surface, single chokepoints for IPC and logging, testable in isolation. A codebase that stays comprehensible at 10× its current size.

## Three engineering meta-principles

These govern *how* we work. They are non-negotiable and override convenience.

### Evidence-Based Only
No guessing. Every proposal, bug report, or performance claim cites file:line evidence, a benchmark, or a failing test. "This might be slow" without a measurement is not a proposal.

### Rust-First
File I/O, path manipulation, text processing, data validation, and performance-sensitive computation live in Rust and cross IPC once. React/TypeScript owns UI rendering, state management, and user interaction — nothing more. When adding a feature, ask: "Can the heavy lifting live in Rust?" If yes, build it there.

### Zero Bug Policy
Every confirmed bug gets fixed. Every fix ships with a regression test that reproduces the original failure mode. A fix without a failing-then-passing test is not done.

## Deep-dive documents

The rules that operationalize these pillars live in domain-specific docs. Every rule is numbered and citable as "violates rule N in `docs/X.md`".

| Document | Primary pillars | What it governs |
|---|---|---|
| [`docs/architecture.md`](architecture.md) | Architecturally Sound, Reliable, Lean | Layer separation, IPC contract, Zustand boundaries, component boundaries, file-size budgets |
| [`docs/performance.md`](performance.md) | Performant, Lean | Startup/open/render budgets, watcher debounce, memory ceilings, benchmark requirements |
| [`docs/security.md`](security.md) | Reliable, Professional | IPC surface rules, path canonicalization, markdown XSS posture, CSP, sidecar atomicity, crash capture |
| [`docs/design-patterns.md`](design-patterns.md) | Architecturally Sound, Reliable | React 19 and Tauri v2 idioms, hook composition, command-vs-event choice, persistence pattern |
| [`docs/test-strategy.md`](test-strategy.md) | Reliable | Three-layer test pyramid, coverage floors, IPC mock hygiene, console-error-spy contract |

## Non-Goals (identity-preserving)

These are explicitly out of scope. Each one would damage one of the five pillars.

- **Editing file content** — breaks *Professional* (blurs identity) and *Lean*.
- **Git integration, diff views, or version history** — competitor space; also pressures *Lean* and the 10 MB viewer limit.
- **Cloud sync or real-time collaboration** — breaks *Lean* and *Reliable* (forces auth/backend).
- **Plugin/extension system** — breaks *Architecturally Sound* (stable-API lock-in) and *Lean*.
- **Remote log shipping or telemetry** — breaks *Reliable* (offline trust) and the local-only stance.
- **Log viewer UI inside the app** — log file + "Copy path" is sufficient; an in-app viewer breaks *Lean*.
- **Linux `.desktop` file association** — platform scope creep.
- **File type associations other than `.md`/`.mdx`** — identity scope creep.
- **Built-in AI chat / "ask the agent"** — mdownreview is the *human* side of the loop; embedding AI dilutes identity.
- **Comment notifications / realtime multi-reviewer cursors** — demands server/identity/presence; solved asynchronously via sidecars + git.

## How to use this charter

- **Adding a feature?** It must strengthen at least one pillar without damaging another. If you cannot identify which pillar it serves, it is not a feature worth adding.
- **Reviewing a PR?** Check the diff against the deep-dive docs. Cite "violates rule N in docs/X.md" when calling out issues.
- **Filing an issue?** Identify which pillar is degraded and quote the rule that covers it.
- **Disagreeing with a rule?** Propose a change to the rule with evidence. Do not work around it silently.
