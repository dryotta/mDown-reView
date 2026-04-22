# Release Gate CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate releases on a full cross-platform test suite (Windows, macOS, Linux) before the release tag is created.

**Architecture:** A new `release-gate.yml` GitHub Actions workflow runs on PRs from `release/*` branches. It tests on all three platforms and builds on Windows/macOS. The `publish-release` skill is updated to poll CI checks and block until green before allowing merge and tag.

**Tech Stack:** GitHub Actions, `gh` CLI (`gh pr checks --watch`), Playwright, Vitest, Cargo

---

### Task 1: Create `release-gate.yml` workflow

**Files:**
- Create: `.github/workflows/release-gate.yml`

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/release-gate.yml` with this exact content:

```yaml
name: Release Gate

on:
  pull_request:
    branches: [main]

jobs:
  # ── Cross-platform tests (Linux, Windows, macOS) ─────────────────────────
  test:
    name: Test (${{ matrix.name }})
    if: startsWith(github.head_ref, 'release/')
    runs-on: ${{ matrix.os }}
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

    steps:
      - uses: actions/checkout@v4

      - name: Set up Rust (stable)
        uses: dtolnay/rust-toolchain@stable

      - name: Cache Rust build artifacts
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - name: Set up Node.js (LTS)
        uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: npm

      - name: Install npm dependencies
        run: npm ci

      - name: Install Linux system dependencies
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update -q
          sudo apt-get install -y -q \
            libwebkit2gtk-4.1-dev \
            libappindicator3-dev \
            librsvg2-dev \
            patchelf

      - name: Rust tests
        working-directory: src-tauri
        run: cargo test

      - name: Vitest unit tests
        run: npm test

      - name: Install Playwright (Chromium only)
        run: npx playwright install --with-deps chromium

      - name: Playwright E2E tests (browser mode)
        run: npm run test:e2e

      - name: Upload Playwright report
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report-${{ matrix.name }}
          path: |
            playwright-report/
            test-results/
          retention-days: 7

  # ── Installer builds (Windows + macOS) ───────────────────────────────────
  build:
    name: Build (${{ matrix.name }})
    needs: test
    if: startsWith(github.head_ref, 'release/')
    runs-on: ${{ matrix.os }}
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

    steps:
      - uses: actions/checkout@v4

      - name: Set up Rust (stable)
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.rust_target }}

      - name: Cache Rust build artifacts
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - name: Set up Node.js (LTS)
        uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: npm

      - name: Install npm dependencies
        run: npm ci

      - name: Clean stale bundles from cache
        shell: bash
        run: rm -rf src-tauri/target/release/bundle src-tauri/target/*/release/bundle 2>/dev/null || true

      - name: Build Tauri app
        shell: bash
        run: |
          if [ -n "${{ matrix.tauri_args }}" ]; then
            npm run tauri:build -- ${{ matrix.tauri_args }}
          else
            npm run tauri:build
          fi
        env:
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}

  # ── Native E2E (Windows only — WebView2 supports CDP) ───────────────────
  native-e2e:
    name: Native E2E (Windows)
    needs: test
    if: startsWith(github.head_ref, 'release/')
    runs-on: windows-latest

    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js (LTS)
        uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: npm

      - name: Install npm dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Set up Rust (stable)
        uses: dtolnay/rust-toolchain@stable

      - name: Cache Rust build artifacts
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - name: Build debug binary for testing
        working-directory: src-tauri
        run: cargo build

      - name: Run native E2E tests
        run: npm run test:e2e:native

      - name: Upload native test report
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: native-playwright-report
          path: playwright-report/
          retention-days: 7
```

- [ ] **Step 2: Verify YAML syntax**

Run:
```bash
python -c "import yaml; yaml.safe_load(open('.github/workflows/release-gate.yml'))"
```

If python/yaml aren't available, manually verify indentation is consistent (2-space indent throughout, no tabs).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release-gate.yml
git commit -m "ci: add release-gate workflow for cross-platform test matrix"
```

---

### Task 2: Update the publish-release skill

**Files:**
- Modify: `.claude/skills/publish-release/SKILL.md`

The changes replace Step 9 and Step 10 in the existing skill to add CI polling and gating.

- [ ] **Step 1: Replace Step 9 in SKILL.md**

Find the current Step 9 section (starting with `## Step 9: Push Branch and Create Pull Request`) and replace it entirely with:

```markdown
## Step 9: Push Branch, Create Pull Request, and Wait for CI

Push the release branch and open a PR against `main`:

1. `git push origin release/v{version}`
2. Create PR via `gh pr create --base main --head release/v{version} --title "chore: release v{version}" --body "Version bump to v{version}. Merge this PR after CI passes, then the release tag will be created."`

Print the PR URL and tell the user:

```
PR created: {pr_url}
Waiting for release-gate CI checks to complete...
```

### Wait for CI checks

Wait 30 seconds for GitHub to register the workflow run, then poll CI:

Run `gh pr checks {pr_url} --watch` using async mode (this blocks until all checks resolve, which may take 20+ minutes for cross-platform builds).

**Read the exit code and output:**

- **Exit code 0 (all checks passed):**

  Print to the user:

  ```
  ✅ All release-gate checks passed!
  Please merge the PR on GitHub, then come back and confirm.
  ```

  Then ask the user to confirm using the ask_user tool with choices:
  - `Merged — create the tag`
  - `Cancel release`

- **Non-zero exit code (some checks failed):**

  Print the `gh pr checks` output so the user can see which checks failed. Then ask using the ask_user tool with choices:
  - `I pushed a fix — re-check`
  - `Cancel release`

  If the user chose to re-check, wait 10 seconds then run `gh pr checks {pr_url} --watch` again (loop back to the polling step).

  If the user cancels, clean up: run each command separately:
  1. `git checkout main`
  2. `git branch -D release/v{version}`
  3. `git push origin --delete release/v{version}`
  Then stop.
```

- [ ] **Step 2: Replace Step 10 in SKILL.md**

Find the current Step 10 section (starting with `## Step 10: Tag the Merged Commit and Push`) and replace it with:

```markdown
## Step 10: Verify CI and Tag the Merged Commit

After the user confirms the PR is merged:

1. `git checkout main`
2. `git pull origin main`

**Verify checks one final time** by running `gh pr checks {pr_url}`. If any check is not passing, warn the user and ask for confirmation before proceeding.

3. `git tag -a v{version} -m "Release v{version}"`
4. `git push origin v{version}`

The tag push triggers the release workflow (`.github/workflows/release.yml`).
```

- [ ] **Step 3: Verify the complete SKILL.md reads correctly**

Read through the full SKILL.md to verify:
- Steps are numbered 1–11 with no gaps or duplicates
- Step 9 references `gh pr checks {pr_url} --watch`
- Step 10 includes the post-merge check verification
- The cancel/cleanup flow is consistent between Step 9 and Step 10

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/publish-release/SKILL.md
git commit -m "chore: update publish-release skill to gate on CI checks"
```

---

### Task 3: Validate the workflow with a dry-run PR

This task verifies the workflow triggers correctly. It must be done manually after Tasks 1–2 are committed and pushed.

- [ ] **Step 1: Create a feature branch and push all changes**

```bash
git checkout -b feature/release-gate-ci
git push -u origin HEAD
```

- [ ] **Step 2: Create a PR for the workflow and skill changes**

```bash
gh pr create --base main --head feature/release-gate-ci --title "ci: add release-gate workflow and update publish-release skill" --body "Adds cross-platform CI gating for releases. See docs/superpowers/specs/2026-04-22-release-gate-ci-design.md for design."
```

- [ ] **Step 3: Merge the PR (manual)**

Review and merge the PR on GitHub. This gets the workflow file onto `main` so it can trigger on future release PRs.

- [ ] **Step 4: Test with a dummy release branch**

After the workflow is on `main`, test it:

```bash
git checkout main && git pull
git checkout -b release/v0.0.0-test
# Make a trivial change (e.g., add a blank line to CHANGELOG.md)
git add CHANGELOG.md
git commit -m "test: verify release-gate workflow"
git push -u origin release/v0.0.0-test
gh pr create --base main --head release/v0.0.0-test --title "test: release gate dry run" --body "Testing release-gate.yml triggers correctly. Will close without merging."
```

- [ ] **Step 5: Verify the workflow runs**

Check the PR's checks tab on GitHub. Verify:
- `Release Gate / Test (linux)` — runs
- `Release Gate / Test (windows)` — runs
- `Release Gate / Test (macos)` — runs
- `Release Gate / Build (windows-x64)` — runs after tests pass
- `Release Gate / Build (macos-arm64)` — runs after tests pass
- `Release Gate / Native E2E (Windows)` — runs after tests pass
- Regular `CI` workflow either doesn't trigger or only runs its Linux test job

- [ ] **Step 6: Clean up the test branch**

```bash
gh pr close --delete-branch
git checkout main && git pull
git branch -D release/v0.0.0-test 2>/dev/null || true
```
