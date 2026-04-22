# mdownreview

Tauri v2 desktop app for reviewing AI agent output. React 19 frontend + Rust backend.

## Git workflow — ALWAYS follow this

**Never commit directly to `main`.** Every change goes through a feature branch and PR.

```bash
# Start any new task:
git checkout main && git pull
git checkout -b feature/short-description   # or fix/ or chore/
# ... make changes ...
git add <specific files>
git commit -m "type: description"
git push -u origin HEAD
gh pr create --title "..." --body "..."
```

Branch naming:
- `feature/` — new functionality
- `fix/` — bug fixes
- `chore/` — tooling, config, docs
- `auto-improve/` — autonomous self-improvement loop (already uses branches)

If you accidentally commit to `main`, do NOT force-push. Ask the user how to proceed.

## Tech stack

- **Frontend**: React 19, TypeScript, Zustand, Vite, `react-markdown`, shiki, Mermaid
- **Backend**: Rust, Tauri v2 (`@tauri-apps/api` v2)
- **Tests**: Vitest (unit), Playwright (e2e browser + native)

## Test commands

```bash
npm test                          # vitest unit tests (fastest, run first)
npm run test:e2e                  # Playwright browser tests (Vite dev server + IPC mock)
npm run test:e2e:native:build     # Playwright native tests (builds Tauri binary first)
npx tsc --noEmit                  # TypeScript check
```

## Key file locations

| Area | Path |
|------|------|
| IPC commands (Rust) | `src-tauri/src/commands.rs` |
| IPC wrappers (TS) | `src/lib/tauri-commands.ts` |
| App state | `src/store/index.ts` |
| File viewers | `src/components/viewers/` |
| Comment system | `src/components/comments/` |
| File hooks | `src/hooks/` |

## IPC rule

If you add a Tauri command in `src-tauri/src/commands.rs`, you **must** also add the typed wrapper in `src/lib/tauri-commands.ts`. Never call `invoke()` directly from components.
