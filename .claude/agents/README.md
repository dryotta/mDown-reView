# Custom Agents

One folder per agent. Each folder is **self-contained** so the agent can be
lifted into another repository without dragging this project's docs along.

```
.claude/agents/
  <agent-name>/
    agent.md            ← agent definition: frontmatter + protocol body
    knowledge/          ← optional. Generic, project-agnostic best-practice files.
      <topic>.md        ← YAML frontmatter `tags: [...]` + content
      LICENSE-...md     ← attribution where rules originate from external sources
```

## Agent definition (`agent.md`)

Standard frontmatter:

```yaml
---
name: <agent-name>                                      # kebab-case, matches folder name
description: <one-line summary shown in the agent picker>
knowledge_tags: [<tag1>, <tag2>, ...]                   # optional; see "Tag-based discovery" below
---
```

Body sections (recommended order):

1. **Goal** — what the agent catches.
2. **Protocol** — dispatch model (per-knowledge-file subagent fan-out, parent aggregates).
3. **Knowledge sources** — list bundled `./knowledge/*.md` files and document the
   tag-based project-knowledge discovery convention (see below).
4. **Always check / Out of scope (handoff)** — review-time invariants and
   cross-agent boundaries.
5. **Output** — fenced template the agent emits.

## Knowledge: bundled (always loaded)

Files in `<agent>/knowledge/*.md` are the agent's **generic, project-agnostic**
references. The agent's authors curate which files belong here, and they are
**always loaded** — no filtering, no opt-in.

Each bundled knowledge file declares `tags: [...]` in its YAML frontmatter so
humans and tooling can grep across knowledge by topic. The tags are
informational on bundled files; they do **not** drive loading semantics for
that file.

When a knowledge file is distilled from an upstream source (e.g. the Vercel
agent-skills repo), keep `LICENSE-vercel-skills.md` co-located in the same
`knowledge/` folder and preserve the source attribution in the file's
frontmatter:

```yaml
---
tags: [react-rerender, performance, state-management]
source: vercel-labs/agent-skills (vendored — see LICENSE-vercel-skills.md)
---
```

## Project-doc manifest discovery

Each `*-expert` agent is **repo-agnostic** — its `agent.md` body MUST NOT
reference any project-specific path. Instead, the agent declares
`project_docs: [<category>, ...]` in its frontmatter. At review time the
agent:

1. If the host repo's `AGENTS.md` (or equivalent agent-instructions file) is
   absent or contains no **Agent project-doc manifest** section: skip every
   `project_docs` load silently.
2. Otherwise parse the manifest table — the canonical heading is
   `## Agent project-doc manifest`, and rows map `Category → Path → Description`.
3. For each entry in `project_docs`, look up the category in the manifest.
   If unmapped, skip silently. If mapped to a file path, load that file. If
   mapped to a folder path (e.g. `docs/features/`), load every `*.md` inside.
4. Cite rules in loaded files using the host repo's convention (typically
   `<rule-id> in <doc-path>`).

This contract lets the same agent file run unchanged in any host repo. The
host repo controls which deep-dives exist and where they live; the agent
just declares topical interest.

## Tag-based discovery for project-specific knowledge

Project-specific knowledge that is OPTIONAL and that the agent should consume
when present lives in the host repo at:

```
docs/best-practices-project/<file>.md
```

Each file declares `tags: [...]` in its YAML frontmatter.

The agent's `knowledge_tags` (in `agent.md` frontmatter) lists the tags the
agent cares about. At review time the agent:

1. If `docs/best-practices-project/` is absent: skip silently.
2. Otherwise scan every `*.md` in that directory.
3. Load any file whose `tags` overlap the agent's `knowledge_tags`
   (set intersection, non-empty ⇒ load).
4. Cite rules in loaded files as
   `<rule-id> in docs/best-practices-project/<file>.md`.

This contract is parallel to the manifest convention above. An agent that
omits `knowledge_tags` consumes no tagged project-specific knowledge; an
agent that omits `project_docs` consumes no manifest-driven deep-dives.

### Tag inventory

Canonical tags introduced by the current agent set:

| Tag | Used by knowledge files about… |
|---|---|
| `architecture` | layer separation, IPC chokepoints, state stratification |
| `ipc` | Tauri IPC contract, command shapes |
| `events` | Tauri event lifecycle, listener cleanup |
| `state-management` | Zustand, derived state, single-writer |
| `react-19` | React 19 specific APIs |
| `react-rerender` | re-render hygiene |
| `react-rendering` | paint/layout cost, hydration |
| `react-composition` | boolean props, compound components |
| `react-hooks` | hook lifecycle, effects |
| `performance` | numeric budgets, hot-path rules |
| `hot-paths` | performance-sensitive areas of *this* codebase |
| `js-performance` | language-level JS perf |
| `bundle` | bundler hygiene, smaller binaries |
| `tauri-v2` | cross-platform Tauri v2 patterns |
| `macos` | macOS-specific (menu, lifecycle, WKWebView) |
| `security` | attack vectors, file-read bounds, CSP |
| `markdown` | markdown rendering surfaces |
| `bug` | bug categories |
| `test` | test patterns, layer choice, mocks |
| `documentation` | docs taxonomy, drift |
| `product` | UX, scope |
| `accessibility` | keyboard, focus, contrast |
| `lean` | deletion, simpler primitives |
| `ux-banners` | must-acknowledge banner pattern |
| `lifecycle` | app lifecycle pitfalls (window, single-instance) |
| `mocks` | test mock contracts and hygiene |
| `anchoring` | comment / annotation anchoring |
| `async-errors` | async error handling, silent failures |

When adding a new tag, update this table and any agent's `knowledge_tags`
that should now match.

## Lifting an agent into another project

1. Copy the entire `<agent-name>/` folder into the target repo's
   `.claude/agents/`.
2. Verify the bundled knowledge in `<agent-name>/knowledge/` still applies to
   the target repo's stack. If not, edit / replace those files.
3. (Optional) Author project-specific deep-dive docs in the target repo and
   list them under an **Agent project-doc manifest** section in the target
   repo's `AGENTS.md`, mapping the categories the agent declares in its
   `project_docs:` frontmatter.
4. (Optional) Author project-specific tagged knowledge in the target repo at
   `docs/best-practices-project/<file>.md` with appropriate `tags:` frontmatter.

The agent works without steps 3 and 4 — it just runs with bundled knowledge
only. The agent file itself NEVER needs editing for portability.

## Agents

| Agent | Bundles knowledge? | knowledge_tags | project_docs | One-line goal |
|---|---|---|---|---|
| `tauri-architect-expert` | ✅ | architecture, ipc, events, state-management, tauri-v2, macos | architecture, test-strategy | catch architectural drift in Tauri v2 apps |
| `bug-expert` | — | bug, react-hooks, ipc, lifecycle, anchoring, async-errors | design-patterns, test-strategy | confirmed defects with reproductions |
| `documentation-expert` | — | documentation | charter, architecture, design-patterns, performance, security, test-strategy, observability, features, behavioral-specs | docs taxonomy + drift between code and docs |
| `lean-expert` | ✅ | lean, react-composition, bundle | charter | challenge bloat — cuts and inlines |
| `performance-expert` | ✅ | performance, hot-paths, react-rerender, react-rendering, js-performance, tauri-v2, bundle | performance | regressions vs numeric budgets |
| `product-expert` | ✅ | product, accessibility, macos, ux-banners | charter, features | UX, scope, pillar progress |
| `react-coding-expert` | ✅ | react-19, react-composition, react-hooks, state-management, react-rerender, react-rendering | design-patterns | idiomatic React 19 |
| `tauri-coding-expert` | ✅ | tauri-v2, ipc, events, macos, windows | design-patterns | idiomatic Tauri v2 |
| `tauri-security-expert` | ✅ | security, ipc, tauri-v2 | security | concrete attack vectors in Tauri IPC + FS surface |
| `test-expert` | — | test, ipc, mocks | test-strategy | test completeness, oracle quality, mock hygiene |
| `exe-goal-assessor` | — | (none) | (project-specific) | autonomous-loop satisfaction check |
| `exe-implementation-validator` | — | (none) | (project-specific) | run-and-report validation gate |
| `exe-task-implementer` | — | (none) | (project-specific) | implement one scoped task |
