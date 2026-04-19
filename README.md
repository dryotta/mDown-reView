# mDown reView

> Review AI Agent's work

[![CI](https://github.com/dryotta/mDown-reView/actions/workflows/ci.yml/badge.svg)](https://github.com/dryotta/mDown-reView/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/dryotta/mDown-reView)](https://github.com/dryotta/mDown-reView/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**[Homepage](https://dryotta.github.io/mDown-reView)**

A slim and fast desktop app written in Rust and React for browsing, viewing and reviewing markdown, code and other text files on Windows and macOS.

## Features

- **File tree** — browse your entire docs folder with native folder navigation
- **Tabbed viewer** — open multiple files side by side
- **Syntax highlighting** — code blocks rendered with Shiki
- **File associations** — opens `.md` and `.mdx` files directly from your OS
- **Comments** — annotate sections inline and persist them alongside your files

## Download

Get the latest release from the [Releases page](https://github.com/dryotta/mDown-reView/releases/latest).

| Platform | Installer |
|----------|-----------|
| Windows  | `mDown reView_x.x.x_x64-setup.exe` |
| macOS    | `mDown reView_x.x.x_x64.dmg` / `_aarch64.dmg` |

## Development

**Prerequisites:** [Node.js LTS](https://nodejs.org) · [Rust stable](https://rustup.rs)

```bash
npm install
npm run tauri       # dev server with hot reload
npm test            # unit tests (Vitest)
npm run test:e2e    # E2E tests (Playwright)
```

## Agent Skills

mDown reView persists review comments as `.review.json` sidecar files alongside your source files. Coding agents can read and act on these comments using the bundled CLI and skills.

### Quick Start (agents in this repo)

Skills are automatically available. Run `python scripts/mdownreview.py read` to see outstanding comments.

### Install in Other Projects

**Claude Code / Copilot CLI:**
```
/plugin marketplace add dryotta/mdownreview
/plugin install mdownreview-skills@mdownreview
```

### Available Skills

| Skill | Description |
|-------|-------------|
| `mdownreview-read` | Scan for `.review.json` files and list unresolved comments |
| `mdownreview-respond` | Record an agent response after addressing a comment |
| `mdownreview-resolve` | Mark comments as resolved |
| `mdownreview-cleanup` | Delete `.review.json` files where all comments are resolved |

### CLI Usage

```bash
python scripts/mdownreview.py read [path] [--format json|text] [--all]
python scripts/mdownreview.py respond <file> <comment-id> "<text>"
python scripts/mdownreview.py resolve <file> <comment-id> [--all]
python scripts/mdownreview.py cleanup [path] [--dry-run]
```

## License

MIT — see [LICENSE](LICENSE)
