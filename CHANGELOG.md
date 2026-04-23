## v0.3.4 — 2026-04-23

### Fixes
- break scroll feedback loop in ViewerRouter (#37)

### Other
- update and add skills (validate-ci, groom-issues, implement-issues) (#38)

## v0.3.3 — 2026-04-23

### Features
- Rich CLI support + MVVM core extraction + performance benchmarks

### Other
- 18 self-improvement iterations (bugs, perf, features, security)
- Add user input directives to expert-review and self-improve skills; remove GitHub issue creation
- Make expert-review and self-improve skills compatible
- Add ESLint to CI and fix all lint errors
- Optimize CI/CD workflows for speed and cost

## v0.3.2 — 2026-04-22

### Features
- Add expert review agents and self-improvement loop
- Wire CDP launch via WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS for native E2E on Windows

### Fixes
- Native E2E test infrastructure and file watcher integration — mount useFileWatcher() in App.tsx
- Prevent empty .review.yaml sidecars from being created
- Per-file save guard — stop dropping unrelated file-changed events
- Sync watched dirs immediately on update_watched_files, not after 500ms poll
- ESM hooks, collapse CLAUDE.md to AGENTS.md import
- Windows path matching for file deletion events in watcher

### Other
- Add native E2E tests to release-gate CI
- Cache apt packages, gate builds on tests, add arm64 to release-gate
- Add release-gate workflow for cross-platform CI on release branches
- Fill e2e native and unit test gaps with real assertions
- Move browser e2e tests into e2e/browser/ and rename playwright config
- Overhaul test strategy documentation

## v0.3.1 — 2026-04-21

### Features
- feat: regenerate rasterized icons from updated gradient SVG
- feat: redesign site — scroll snap, sticky nav, indigo palette, remove releases tab
- feat: rebrand with indigo gradient identity and clean up icon folder
- feat: sticky frosted nav, scroll-padding-top, and reveal transition delay
- feat: add CSS scroll snap proximity for slide-style page sections
- feat: add scroll reveal animation to page sections
- feat: remove GitHub Releases tab from download section
- feat: simplify site palette to single indigo brand color
- feat: update favicon with gradient and adaptive dark/light background
- feat: update app icon with indigo gradient
- feat: replace install section with platform-aware tabs
- feat: simplify How It Works to single-column with app mock on step 2 only
- feat: remove screenshot section and replace Copilot references with agent
- feat: replace app icon with brand identity icon
- feat: apply indigo brand identity to site nav and app welcome screen

### Fixes
- fix: transparent background on app icon SVG
- fix: reveal animation fires after snap via scrollend, no opacity hide
- fix: remove unused afterEach import causing TS6133 build error
- fix: make hero full viewport height to push sections below fold
- fix: scroll restore, sidecar reload bugs, and comprehensive test coverage
- fix: skip reveal animation for sections already in viewport on load
- fix: add trailing newline to icon.svg
- fix: use currentColor for SVG brand color, simplify icon font family
- fix: use CSS variable for brand color, clean up welcome-logo font-size

### Other
- chore: remove site review sidecar
- chore: remove unused icon variants
- docs: overhaul site and README, add branding and redesign specs
- style: remove dead terminal CSS and orphaned responsive rules
- copy: reframe how-it-works steps to user perspective

## v0.3.0 — 2026-04-20

### Features
- MRSF v1.0 migration — review comments, file watcher, re-anchoring
- folder/file opening UX refactoring

### Fixes
- MRSF v1.0 spec compliance and auto-save reliability

## v0.2.7 — 2026-04-20

### Features
- overhaul installation system with consistent naming, ARM64, and install scripts

### Other
- add installation system implementation plan
- add installation system overhaul design spec

## v0.2.6 — 2026-04-19

### Other
- rename to mdownreview

## v0.2.5 — 2026-04-19

### Fixes
- fix: resolve 11 TypeScript strict-mode errors breaking CI build

## v0.2.4 — 2026-04-19

### Features
- feat: enhanced file viewer with universal review comments (#3)
- feat(scripts): add mdownreview.py CLI with read/respond/resolve/cleanup
- feat: add marketplace skills for review comment operations
- feat: add marketplace configuration for plugin discovery
- feat: add mdownreview-open and mdownreview-review skills

### Fixes
- fix: add required owner field to marketplace.json

### Other
- docs: add design specs, implementation plans, and agent skills documentation
- refactor: move skills and marketplace to dryotta/mdownreview-skills
- ci: add path filters to CI and Pages workflows
- chore: remove scripts folder, update publish-release skill, add Python gitignore

## v0.2.3 — 2026-04-18

### Features
- feat: add native menu system covering all app functionalities (#1)
- feat: unified top-level toolbar with Open File, Open Folder, and panel toggles (#2)

### Fixes
- fix: harden publish-release skill for Copilot CLI compatibility
- fix: sync Cargo.lock version and update publish-release skill
- fix: read app version dynamically in About dialog
- fix: replace stale release assets before re-upload; deduplicate release assets

### Other
- ci: add workflow_dispatch trigger and skip release creation if already exists

## v0.2.2 — 2026-04-18

### Fixes
- fix: add createUpdaterArtifacts v1Compatible to produce updater bundles

### Other
- chore: update publish-release skill to sync package-lock.json on release
- chore: sync package-lock.json version to 0.2.1

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
- refactor: rename app to "mdownreview" everywhere
- docs: migrate openspec to docs/specs/, add AGENTS.md, update GitHub URLs
- ci: add GitHub Actions workflow to deploy site/ to GitHub Pages
- chore: remove broken vite.svg favicon reference
- chore: remove Vite scaffold SVGs from public/
- refactor: move GitHub Pages website from docs/ to site/
- docs: add docs folder refactor implementation plan
- docs: add folder refactor design spec
