# Building mdownreview

## Prerequisites

- [Node.js LTS](https://nodejs.org) (v20+)
- [Rust stable](https://rustup.rs) (1.75+)

## Setup

```bash
git clone https://github.com/dryotta/mdownreview.git
cd mdownreview
npm install
npm run stage:cli      # builds + stages mdownreview-cli for Tauri externalBin (one-time per checkout)
```

> The `stage:cli` step is required because `tauri.conf.json` declares
> `bundle.externalBin: ["binaries/mdownreview-cli"]`, which Tauri's build
> script validates at compile time. `npm run tauri:build` re-runs it
> automatically, but `cargo check` / `cargo test` need it staged manually.

## Development

```bash
npm run tauri          # dev server with hot reload
```

## Testing

```bash
npm run lint           # ESLint
npm test               # unit tests (Vitest)
npm run test:e2e       # E2E tests (Playwright browser mode)
cargo test             # Rust unit + integration tests (run from src-tauri/)
```

> **Note:** `cargo test` requires the CLI binary to be built first for integration tests:
> ```bash
> cd src-tauri && cargo build --bin mdownreview-cli && cargo test
> ```

## Production Build

### Desktop App (GUI)

```bash
npm run tauri:build    # builds platform installer
```

Output locations:
- **Windows:** `src-tauri/target/release/bundle/nsis/`
- **macOS:** `src-tauri/target/release/bundle/dmg/`

### CLI Tool

```bash
cd src-tauri && cargo build --release --bin mdownreview-cli
```

Output: `src-tauri/target/release/mdownreview-cli[.exe]`

> For installer/distribution behaviour (script vs DMG, ad-hoc signing, quarantine handling, externalBin), see [docs/features/installation.md](docs/features/installation.md).

### Benchmarks

```bash
npm run bench:cli           # run criterion benchmarks (from src-tauri/)
npm run bench:cli:script    # run CLI subprocess timing script
```

---

## Claude Code Automation

See [`AGENTIC_DEVELOPMENT.md`](AGENTIC_DEVELOPMENT.md) for the full skills + agents catalogue and the three day-to-day workflows. Only the editor-side hooks below are not covered there.

### Hooks

Hooks in `.claude/hooks/` run automatically after every file edit (PostToolUse on `Edit` and `Write`):

| Hook | What it does |
|---|---|
| `prettier-on-edit.js` | Formats `.ts`, `.tsx`, `.js`, `.jsx`, `.css` files with Prettier |
| `check-test-exists.js` | Warns (non-blocking) when a `src/lib/` or `src/components/` file is written with no corresponding `__tests__/` file |

TypeScript is also checked after every edit via `npx tsc --noEmit` (configured directly in `.claude/settings.json`).

