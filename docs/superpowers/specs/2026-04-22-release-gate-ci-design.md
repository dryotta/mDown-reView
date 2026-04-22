# Release Gate CI — Design Spec

## Problem

The publish-release workflow creates a tag immediately after the PR is merged, with no CI verification that the release candidate actually works. Tests run post-tag in the release workflow, but by then the release is already in progress. Native E2E tests only run on Windows in the release workflow and not at PR time at all.

**Goal:** Before a release tag is created, the full test suite must pass on all target platforms (Windows, macOS, Linux), including native E2E on Windows.

## Approach

Two changes:

1. **New `release-gate.yml` workflow** — triggered only on PRs from `release/*` branches to `main`. Runs the complete test matrix across all platforms.
2. **Updated `publish-release` skill** — after creating the PR, polls CI status and blocks until all checks pass before allowing the user to merge and tag.

## Workflow: `.github/workflows/release-gate.yml`

### Trigger

```yaml
on:
  pull_request:
    branches: [main]
    # Only release branches — avoids running on every PR
    # GitHub Actions doesn't support branch filtering on head ref in `on:`,
    # so we use a path-independent trigger and filter in the job condition.
```

Since GitHub Actions doesn't natively filter on head branch name in `pull_request` triggers, each job uses an `if` condition:

```yaml
if: startsWith(github.head_ref, 'release/')
```

This ensures the expensive cross-platform matrix only runs for release PRs, not for regular feature/fix PRs.

### Job Matrix

| Job | Runner | What it runs |
|---|---|---|
| `test-linux` | `ubuntu-latest` | cargo test, vitest, browser E2E |
| `test-windows` | `windows-latest` | cargo test, vitest, browser E2E |
| `test-macos` | `macos-latest` | cargo test, vitest, browser E2E |
| `build-windows` | `windows-latest` | Tauri build (x64) |
| `build-macos` | `macos-latest` | Tauri build (arm64) |
| `native-e2e` | `windows-latest` | Native E2E via CDP (needs build-windows) |

### Job Details

#### `test` (matrix: linux, windows, macos)

A single job definition with a platform matrix:

```yaml
test:
  name: Test (${{ matrix.name }})
  runs-on: ${{ matrix.os }}
  if: startsWith(github.head_ref, 'release/')
  strategy:
    fail-fast: false
    matrix:
      include:
        - os: ubuntu-latest
          name: linux
        - os: windows-latest
          name: windows
        - os: macos-latest
          name: macos
```

Steps:
1. Checkout
2. Set up Rust (stable)
3. Cache Rust artifacts (`Swatinem/rust-cache@v2`)
4. Set up Node.js (LTS)
5. Install npm dependencies (`npm ci`)
6. Install system dependencies (Linux only: `libwebkit2gtk-4.1-dev`, etc.)
7. `cargo test` (in `src-tauri/`)
8. `npm test` (vitest)
9. Install Playwright (chromium only)
10. `npm run test:e2e` (browser E2E)
11. Upload Playwright report on failure

**Linux system deps** are needed for `cargo test` to compile the Tauri crate (links against WebKit GTK). Windows and macOS have their WebView SDKs built in.

**macOS note:** `macos-latest` uses Apple Silicon (M-series). Playwright's Chromium runs natively on arm64.

#### `build` (matrix: windows-x64, macos-arm64)

Reuses the same build steps as `ci.yml`:

```yaml
build:
  name: Build (${{ matrix.name }})
  needs: test
  runs-on: ${{ matrix.os }}
  if: startsWith(github.head_ref, 'release/')
  strategy:
    fail-fast: false
    matrix:
      include:
        - os: windows-latest
          name: windows-x64
          rust_target: x86_64-pc-windows-msvc
          target_dir: src-tauri/target/release
          tauri_args: ""
        - os: macos-latest
          name: macos-arm64
          rust_target: aarch64-apple-darwin
          target_dir: src-tauri/target/release
          tauri_args: ""
```

Steps: checkout, Rust, Node, npm ci, clean stale bundles, `npm run tauri:build`.

Build artifacts are uploaded for the native E2E job to consume (Windows) and as a general verification that the release builds succeed.

**No Linux build** — we don't ship a Linux binary.

**No signing keys needed** — this is a verification build, not the release build. The release workflow handles signing. However, if the build fails without signing keys (Tauri may require them), we'll need to pass `TAURI_SIGNING_PRIVATE_KEY` from secrets.

#### `native-e2e` (Windows only)

```yaml
native-e2e:
  name: Native E2E (Windows)
  needs: test  # doesn't need the release build — uses debug binary
  runs-on: windows-latest
  if: startsWith(github.head_ref, 'release/')
```

Steps:
1. Checkout
2. Node.js + npm ci
3. Install Playwright (chromium)
4. Rust + rust-cache
5. `cargo build` (debug binary for testing)
6. `npm run test:e2e:native`
7. Upload report on failure

This mirrors what `release.yml` currently does, moved to PR time.

### Why not extend `ci.yml`?

- `ci.yml` runs on every PR and every push to main. Adding Windows/macOS runners to every PR would waste CI minutes and slow down feedback for non-release changes.
- A separate workflow makes the release gate explicit and keeps regular CI fast.
- The `if: startsWith(github.head_ref, 'release/')` condition ensures zero cost for non-release PRs even though the workflow file triggers on all PRs.

## Skill Changes: `.claude/skills/publish-release/SKILL.md`

### Current flow (steps 9-10)

```
Step 9: Push branch, create PR
Step 10: Ask user "merged?" → tag
```

### New flow (steps 9-10)

```
Step 9:  Push branch, create PR
Step 9a: Wait 30s for workflow to register
Step 9b: Poll `gh pr checks <pr-url> --watch` (blocks until all checks resolve)
Step 9c: If any check failed → show failures, ask user to fix or cancel
         If all green → tell user "All checks passed", ask to merge
Step 10: User confirms merged
Step 10a: Verify checks still green via `gh pr checks`
Step 10b: Tag and push
```

### Polling mechanism

The `gh pr checks --watch` command blocks until all checks complete, then exits with:
- Exit code 0 if all checks passed
- Non-zero if any check failed

This is simpler and more reliable than manual polling with `gh run list`.

### Failure handling

If checks fail:
- Show the user which checks failed (from `gh pr checks` output)
- Offer choices: "Push a fix and re-run" or "Cancel release"
- If the user pushes a fix, re-poll with `gh pr checks --watch`
- If cancel, clean up branch as before

### Retry loop

The skill should support the user pushing fixes:

```
loop:
  poll checks → if all green → break
  show failures → ask: fix or cancel?
  if cancel → cleanup, stop
  if fix → tell user to push, then re-poll
```

## What doesn't change

- **`ci.yml`** — unchanged. Still runs cargo test + vitest + browser E2E on Linux for every PR.
- **`release.yml`** — unchanged. Still builds, signs, publishes, and runs native E2E after tag push. The release-gate is a pre-tag safety net, not a replacement.
- **Native E2E test code** — no changes to `e2e/native/` tests or Playwright configs.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| macOS runner costs (arm64 is more expensive) | Only triggers on `release/*` PRs — typically 1-2 per week max |
| Build fails without signing keys | Test with a PR first; if needed, pass secrets to the build job |
| `gh pr checks --watch` hangs if a check never completes | The skill can add a timeout (e.g., 30 min) and fall back to manual check |
| Flaky native E2E tests block release | Skill shows failures and lets user choose to retry or skip |

## Test Plan

1. Create a `release/v0.0.0-test` branch with a dummy version bump
2. Open PR → verify `release-gate.yml` triggers with all jobs
3. Verify `ci.yml` does NOT run its expensive jobs (or runs normally on Linux only)
4. Verify non-release PRs don't trigger `release-gate.yml` jobs
5. Merge and delete the test branch (no tag)
