## v0.4.1 — 2026-05-01

### Fixes
- Register `tauri-plugin-process` so the macOS auto-update **Restart Now** button actually works. The Rust crate, ACL, and `init()` registration were missing — the IPC was unrouted and the renderer silently swallowed the rejection, leaving users stuck on "Restart to apply update". UpdateBanner now also surfaces a manual-relaunch fallback if the IPC ever rejects, and a static parity test prevents the underlying class of bug. (#347)
- Scope per-window events with `emit_to` (instead of broadcast `emit`) and share the folder-open ViewModel across windows. (#341)

### Other
- ci: drop aspirational README-at-DMG-root verify checks. (#346)
- ci: fix DMG verify step that fails to mount on macOS. (#345)
- ci: fix silent macOS verify-adhoc abort on v0.4.0 release. (#343)

## v0.4.0 — 2026-05-01

### Breaking
- `mdownreview-cli read --all` removed — use `--include-resolved` instead. (#36)
- `mdownreview-cli resolve <file> <id>` subcommand removed — use `respond <file> <id> --resolve` (combinable with `--response`). (#36)
- `mdownreview-cli read --json` envelope shape changed: each entry is now `{ reviewFile: { relative, absolute }, sourceFile: { relative, absolute }, comments: [...] }`. Folder scans return an array of envelopes; `--file` mode returns a single envelope. (#36)
- `args-received` Tauri event no longer carries a payload (signal-only). Listeners must call `get_launch_args` to drain the pending-args queue. (#36)

### Features
- Multi-window support: open multiple workspaces concurrently with per-window state, watcher routing, and CLI-args forwarding. (#147, #204, #321)
- macOS support overhaul: native menu system (about/services/edit/window submenus), per-window lifecycle, ad-hoc signing, DMG layout. (#303, #305)
- Viewer overhaul: `ViewerToolbar` consolidated across all viewers (markdown / source / HTML / Mermaid / image / binary) with sticky toolbar and contextual banners. (#65, #117, #243, #246, #335)
- Source-view syntax highlighting via Shiki + uniform theming. (#94, #178, #181)
- Mermaid viewer overhaul: themed popout card, fit-to-window 100% baseline, pixel-perfect zoom. (#276, #330, #336)
- HTML preview: iframe sandbox, asset-protocol images, in-iframe zoom, persistent per-file `allow_images` toggle. (#213, #214, #335, #337)
- Sidecar enhancements: `sidecar_root` config + migration UI, format-preserving YAML writes, MRSF v1.0 spec compliance, show-sidecars toggle. (#229, #230, #234, #240, #269, #292)
- Comments overhaul: panel-only commenting, speech-bubble markers, cross-surface flash, file-level anchor unification, simplified mutation surface. (#226, #227, #275, #292)
- Settings region overhaul: full-page Settings, CLI-shim install/status/remove, default-handler controls, author preference, removal of welcome screen. (#79, #113, #160, #215)
- Tab bar visual overhaul (max 5 tabs) and folder-pane improvements (filter shortcut, ESC reset, ghost-entry handling). (#40, #80, #95, #164, #211, #216, #218, #219, #223)
- CLI improvements: `read --json`, `read --file`, `respond --resolve`, `respond --folder`, `cleanup --include-unresolved`, aggregated `--help`. (#36)
- Engineering excellence: typed-lint gate + new ESLint rules + build-perf gates (#262); tauri-specta auto-generated bindings (#263); `mdr_command!` runtime tracing macro + `StartupRecorder` + `--trace` launch flag (#264, #285, #289); IPC-event fixtures tied to real Rust emission shapes (#311, #313); cross-library on-disk-shape rule (#300, #312).
- File / comment status uses filesystem mtime. (#96)
- Canary release pipeline with client-side channel switching. (#50)

### Fixes
- HTML preview: zoom now applies inside iframe, asset CSP scheme corrected, contextual banner, Ctrl+wheel zoom, link-handling parity with markdown. (#274, #335, #337)
- Mermaid: redefine 100% as fit-to-window with pixel-perfect zoom and themed popout. (#336)
- Sidecar/comment IPC contract: snake_case wire shape, `comments-changed` events from Rust mutations, badge TOCTOU fix, sidecar counter accuracy. (#112, #123, #260, #283)
- Multi-window: state contamination, duplicate-folder bypass, per-window CLI-args routing, per-window watcher state, broadcast events to all windows, zoom ping-pong guard. (#232, #233, #236, #237, #249, #251, #253)
- Sidecar config dialog: centering, counting, refresh, `.gitignore` override. (#254, #260)
- Stranded `.reviews/` rescue when toggle is disabled. (#278)
- Folder pane no longer jumps to active file on folder expand. (#224)
- Cold-start: main-window menu attached at build time to eliminate flicker. (#265, #286, #318)
- macOS `RunEvent::Opened` no longer clobbers pending launch args; pending-args queue (`PendingArgsState`) drained by `get_launch_args`. (#36)
- NSIS installer: file-association open verb uses `%*` so Explorer multi-select forwards every selected path to a single window. (#36)
- Source-view tokens render uniform black regression. (#181, #188)
- Sandbox warning readability + persistent settings. (#212, #220)
- Hide "Empty folder" label when Other Files section is visible. (#197, #199)
- File-level comment false-orphan warning. (#131, #187)
- Saphyr emitter unreadable block scalars for whitespace-leading nested strings. (#293, #294)
- Saphyr `quote_if_needed` multi-line LF bug. (#297, #314)
- Replace `std::fs::canonicalize` with `dunce` to strip `\\?\` prefix on Windows. (#89, #126)
- Memoize `CommentsPanel` grouping/sorting/filtering; cancellation guard for source-highlighting async effect; `FolderTree` `mergedList` memo stability; infinite re-render in `useUnresolvedCounts`.
- Tauri listener leak on rapid unmount in `useComments`.
- Many CI / E2E / build / lint / test stabilizations.

### Other
- Removed in-app context menus; Window → DevTools (F12). (#277)
- Removed audio-specific viewer; audio files now treated as binary. (#333)
- Removed welcome screen; CLI-shim/default-handler moved into Settings. (#79, #160)
- Removed folder context menu and multi-select override from NSIS hooks. (#200)
- Removed unused "open in default app" toolbar action. (#93, #159)
- Logging: per-startup new log file + log rotation. (#295)
- CSP: forbid inline `<style>`; assets allowed via `http://asset.localhost` + `asset:` schemes. (#291)
- Manual-test sample files for every viewer. (#329)
- Comprehensive Rust + React + Tauri lint enforcement. (#258)
- Documentation: viewer consistency guidelines, MRSF v1.0 spec, macOS platform best practices, `AGENTIC_DEVELOPMENT.md`, multi-window best practices, agentic-loop skill suite (`groom-issues`, `iterate-loop`, `iterate-one-issue`, `merge-pr-loop`, `optimize-prompt`, `validate-ci`, `test-exploratory-e2e/loop`). (#62, #63, #98, #102, #132, #133, #134, #138, #142, #144, #158, #163, #228, #239, #245, #258, #301)

### Known gaps
- The NSIS multi-select fix is NSIS-only. MSI bundles (if produced) still register `%1` per Tauri defaults; multi-select via MSI installs is not yet covered.

### Manual verification
- After installing from the NSIS bundle: in Explorer, select 2+ `.md` files, press Enter → all selected files must open as tabs in the same mdownreview window.

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
