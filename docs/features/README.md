# Feature Docs

One evergreen file per major user-facing feature area of mdownreview. The taxonomy and content rules are enforced by `.claude/agents/documentation-expert.md` on every iteration.

## Rules of this directory

- **One file per major area.** A "major area" is a user-visible capability a first-time developer needs to understand — there are ~7 of them, not 70.
- **Evergreen, not per-increment.** Each file describes the current state of the feature; historical per-PR context belongs in `CHANGELOG.md` and the git log.
- **Reference, don't duplicate.** Every file cites source by path + key class / function / command / hook name. No copied code. Readers navigate to the referenced file if they need implementation detail.
- **Link to the deep-dives.** Rules come from `docs/principles.md` + `docs/architecture.md` + `docs/performance.md` + `docs/security.md` + `docs/design-patterns.md` + `docs/test-strategy.md`. Feature docs link — they do not restate.

## Current areas

| Area | What it is |
|---|---|
| [viewer.md](viewer.md) | Markdown, source, Mermaid, JSON, CSV, HTML, image, and binary file viewing |
| [comments.md](comments.md) | Inline review comments — selection, threads, MRSF sidecar persistence, re-anchoring |
| [navigation.md](navigation.md) | Folder tree, tabs, workspace search |
| [app-chrome.md](app-chrome.md) | Top toolbar, sticky viewer toolbar, status bar |
| [watcher.md](watcher.md) | File-system watching, hot reload, ghost-entry detection |
| [updates.md](updates.md) | Auto-update with stable and canary release channels |
| [cli-and-associations.md](cli-and-associations.md) | CLI file-open and OS file associations |
| [logging.md](logging.md) | Frontend + Rust logging, single chokepoint, exception capture |

Adding a new area means adding a new file here AND updating this index. See the documentation-expert agent for the full rule set.
