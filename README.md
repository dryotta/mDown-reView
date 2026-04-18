# mDown reView

> Markdown Viewer and Review App for AI-first Developers

[![CI](https://github.com/dryotta/mDown-reView/actions/workflows/ci.yml/badge.svg)](https://github.com/dryotta/mDown-reView/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/dryotta/mDown-reView)](https://github.com/dryotta/mDown-reView/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**[Homepage](https://dryotta.github.io/mDown-reView)**

Browse, read, and annotate `.md` and `.mdx` files natively on Windows and macOS.

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

## License

MIT — see [LICENSE](LICENSE)
