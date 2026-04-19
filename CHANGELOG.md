## v0.2.1 — 2026-04-18

### Features
- feat: improve comment UX — persistence, hover fix, selection/keyboard/context-menu triggers, list items, folder indicator, bubble icon
- feat: wire CommentMargin into MarkdownViewer

### Fixes
- fix: replace on_url_open with RunEvent::Opened for macOS builds; deduplicate release assets
- fix: clean stale bundle cache before release build, remove Cargo.lock from skill git add

### Other
- ci: parallelize tests and builds, add macOS installers, switch to Swatinem/rust-cache
- ci: drop Intel macOS (macos-13) — Apple Silicon only
- chore: update Cargo.lock (new transitive deps from cargo check)

## v0.2.0 — 2026-04-18

### Features
- feat: add in-app update banner
- feat: add tauri-plugin-updater integration
- feat: add publish-release skill

### Fixes
- fix: harden update banner error handling and API usage
- fix: harden publish-release skill

### Other
- ci: align signing env var names with Tauri v2
- ci: harden release workflow against re-runs and missing assets
- ci: fix release workflow for Tauri v2 updater
- docs: update tagline to "Review AI Agent's work"
- docs: update app description across site, README, and AGENTS.md
- docs: update tagline to "Review your AI Agents' work"
- site: update hero headline to match tagline
- add the screenshot
- docs: add GitHub Pages homepage link to README
- docs: update tagline to "Markdown Viewer and Review App for AI-first Developers"
- refactor: rename app to "mDown reView" everywhere
- docs: migrate openspec to docs/specs/, add AGENTS.md, update GitHub URLs
- ci: add GitHub Actions workflow to deploy site/ to GitHub Pages
- chore: remove broken vite.svg favicon reference
- chore: remove Vite scaffold SVGs from public/
- refactor: move GitHub Pages website from docs/ to site/
- docs: add docs folder refactor implementation plan
- docs: add folder refactor design spec
