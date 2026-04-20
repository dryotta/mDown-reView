# mdownreview

> Review AI Agent's work

[![CI](https://github.com/dryotta/mdownreview/actions/workflows/ci.yml/badge.svg)](https://github.com/dryotta/mdownreview/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/dryotta/mdownreview)](https://github.com/dryotta/mdownreview/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**[Homepage](https://dryotta.github.io/mdownreview)**

A slim and fast desktop app written in Rust and React for browsing, viewing and reviewing markdown, code and other text files on Windows and macOS.

## Features

- **File tree** — browse your entire docs folder with native folder navigation
- **Tabbed viewer** — open multiple files side by side
- **Syntax highlighting** — code blocks rendered with Shiki
- **File associations** — opens `.md` and `.mdx` files directly from your OS
- **Comments** — annotate sections inline and persist them alongside your files

## Download

Get the latest release from the [Releases page](https://github.com/dryotta/mdownreview/releases/latest).

| Platform | Installer |
|----------|-----------|
| Windows  | `mdownreview_x.x.x_x64-setup.exe` |
| macOS    | `mdownreview_x.x.x_x64.dmg` / `_aarch64.dmg` |

## Development

**Prerequisites:** [Node.js LTS](https://nodejs.org) · [Rust stable](https://rustup.rs)

```bash
npm install
npm run tauri       # dev server with hot reload
npm test            # unit tests (Vitest)
npm run test:e2e    # E2E tests (Playwright)
```

## Agent Skills

mdownreview persists review comments as `.review.json` sidecar files alongside your source files. Coding agents can read and act on these comments using the skills and CLI in [mdownreview-skills](https://github.com/dryotta/mdownreview-skills).

```
/plugin marketplace add dryotta/mdownreview-skills
/plugin install mdownreview@mdownreview-skills
```

## License

MIT — see [LICENSE](LICENSE)
