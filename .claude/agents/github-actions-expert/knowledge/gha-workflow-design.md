---
tags: [gha, cicd]
source: GitHub Actions official documentation (https://docs.github.com/en/actions/), summarised
---

# GitHub Actions Workflow Design

Project-agnostic audit checklist for workflow correctness, performance, and reliability. Cite a rule by its `<rule-id>`.

> **Scope:** workflow shape — triggers (`on:`), filters (`paths`/`branches`), concurrency, caching, matrix strategy, timeouts, artifact retention, gate jobs that satisfy branch protection. Security hardening lives in `gha-security-hardening.md`.
>
> **References:** [Workflow syntax](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions), [Triggering a workflow](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow), [Events that trigger workflows](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows), [Caching dependencies](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/caching-dependencies-to-speed-up-workflows), [Concurrency](https://docs.github.com/en/actions/using-jobs/using-concurrency).

## Triggers — `wf-on-*`

### `wf-on-explicit-branches`

`on.push.branches` and `on.pull_request.branches` SHOULD be explicit. A workflow that triggers on every push to every branch (`on: push` with no filter) burns CI minutes on feature branches that never PR. Pin to `main` for push, and to `[main]` (or specific protected branches) for PRs.

### `wf-on-paths-filter-cost-aware`

`paths:` and `paths-ignore:` filter at the workflow level — a workflow that doesn't match any path on the triggering commit is **skipped entirely** (it doesn't even create a check run). Use this to avoid running the heavy build/test workflow on docs-only PRs:

```yaml
on:
  pull_request:
    paths:
      - 'src/**'
      - 'src-tauri/**'
      - 'package.json'
      - '.github/workflows/ci.yml'
```

Caveat: a workflow that branch protection requires *as a status check* must run on every PR even if it's a no-op — otherwise the PR is stuck in "pending" forever. For these workflows, use `paths-ignore:` and a no-op gate job (see `gate-aggregate-job`), not `paths:`.

### `wf-on-paths-ignore-for-docs`

`paths-ignore: ['docs/**', '*.md']` is the canonical pattern for skipping docs-only changes. **Important**: the filter is `paths-ignore: ALL files match these patterns → skip`, not `ANY file matches → skip`. A PR that touches both `docs/foo.md` and `src/bar.ts` triggers the workflow.

### `wf-on-workflow-dispatch-typed-inputs`

`workflow_dispatch.inputs` should declare `type:` and `required:`. Untyped inputs default to string and lose validation. For `boolean` and `choice`, use the dedicated types so the UI renders the right control.

### `wf-on-pull-request-vs-target`

`pull_request` (read-only token, no secrets for forks) is the right default. `pull_request_target` (write token, secrets) is for labelling/commenting workflows that DO NOT check out untrusted code. See `sec-pwn-no-pull-request-target-with-checkout` in the security knowledge file.

### `wf-on-pull-request-types`

`pull_request` defaults to `[opened, synchronize, reopened]`. If the workflow needs to re-run on `ready_for_review` (PR taken out of draft) or on label changes, list the types explicitly. Conversely, narrow to `[opened, synchronize]` when re-running on reopen is wasteful.

## Concurrency — `wf-conc-*`

### `wf-conc-cancel-in-progress-for-pr`

For PR validation workflows, set `cancel-in-progress: true`:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

When a developer pushes again to the same PR branch, the in-progress run cancels and a new one starts. This is the right trade-off for fast feedback.

### `wf-conc-no-cancel-for-deploy`

For production deploy workflows, set `cancel-in-progress: false` (or omit it — `false` is the default). Cancelling an in-progress deploy mid-way leaves the system in an indeterminate state. Pair with `concurrency.group: production-deploy` so a second deploy queues behind the first.

### `wf-conc-group-includes-ref`

The concurrency group MUST disambiguate by ref (or PR number) for PR-validation workflows. A group of just `${{ github.workflow }}` cancels other PRs' runs — flag this as a regression.

### `wf-conc-named-group-for-resource`

For workflows that contend over a real-world resource (a deploy slot, a Pages publish, a release-tag mutation), use a **named** static group (`group: production-deploy`, `group: pages`, `group: canary`) — not a ref-derived one. Multiple branches deploying to the same slot must serialise on the resource, not the branch.

## Caching — `cache-*`

### `cache-key-includes-os`

A cache key MUST include the runner OS:

```yaml
key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}
```

A cross-OS cache hit (Linux cache restored on macOS) silently ships incompatible binaries (`node-gyp`-built native modules, Rust target-specific artefacts).

### `cache-key-includes-lock-hash`

Cache keys for dependency caches MUST include a hash of the lock file (`package-lock.json`, `yarn.lock`, `Cargo.lock`, `poetry.lock`, etc.). A stale cache for a changed lock file silently ships old dependencies — the new dependency in the lock file is downloaded but ignored.

### `cache-restore-keys-fallback`

Use `restore-keys:` for graceful fallbacks. Most-specific to least-specific:

```yaml
key:          ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}
restore-keys: |
  ${{ runner.os }}-node-
  ${{ runner.os }}-
```

A partial cache hit is faster than a cold start; a full miss falls through to the most general key.

### `cache-save-if-on-main-only-for-pr-cost`

For Rust-build caches via `Swatinem/rust-cache@v2` (or a manual `actions/cache`), restrict cache *saves* to the main branch:

```yaml
- uses: Swatinem/rust-cache@v2
  with:
    workspaces: src-tauri
    save-if: ${{ github.ref == 'refs/heads/main' }}
```

Reasoning: PR jobs **restore** from the main-branch cache, but each PR's tail-of-build artefacts would otherwise pack a separate cache, costing 2-3 minutes per PR for no benefit. Main-only saves keep the cache fresh for everyone.

### `cache-prefix-key-distinct-features`

When the same workspace builds with different feature flags (a `--features codegen` build vs production), use different `prefix-key`s on the cache. A shared cache silently corrupts when one build mode evicts the other's intermediates.

### `cache-not-secrets-anywhere`

Caches are world-readable to anyone who can run a workflow on the repo (including fork PRs against the base cache). **Never** put credentials, tokens, or PII into a cached path. Caches are not a secrets store.

### `cache-version-on-system-deps`

For caches that include system packages (`apt`, `brew`, `apk`), include an explicit `version:` parameter (e.g. `awalsh128/cache-apt-pkgs-action`'s `version: 1.0`). When the dependency list changes, bump the version to force a fresh cache. Without this, stale system caches silently ship old `libwebkit2gtk` / `libgtk` versions and the build mysteriously fails on the next runner upgrade.

## Matrix strategy — `wf-matrix-*`

### `wf-matrix-fail-fast-deliberate`

`strategy.fail-fast` defaults to `true` — a failure in any matrix entry cancels the rest. Set `fail-fast: false` for cross-platform validation, where you want the full signal in one run (Linux failure + macOS failure + Windows failure) rather than discovering each on a separate retry. For matrices where one failure means the rest are pointless (e.g. testing N versions of one tool), keep `fail-fast: true`.

### `wf-matrix-include-not-merge`

Use `strategy.matrix.include` for sparse matrices, not the cartesian-product form with most cells excluded:

```yaml
# CORRECT — sparse matrix
matrix:
  include:
    - { os: windows-latest, target: x86_64-pc-windows-msvc }
    - { os: windows-latest, target: aarch64-pc-windows-msvc }
    - { os: macos-latest,   target: aarch64-apple-darwin }

# AVOID — dense matrix with excludes
matrix:
  os: [windows-latest, macos-latest, ubuntu-latest]
  target: [x86_64-pc-windows-msvc, aarch64-pc-windows-msvc, aarch64-apple-darwin]
  exclude:
    - { os: ubuntu-latest, ... }
    # ... 5 more excludes
```

The `include` form is easier to read, easier to grep, and harder to leave a stale combination in.

### `wf-matrix-name-explicit`

Each matrix entry MUST contribute a stable, human-readable identifier (typically a `name:` field). Use this in `runs-on:` selection, artifact names, and downstream job references — `${{ matrix.os }}` alone produces non-unique names when two entries share an OS.

## Timeouts — `wf-timeout-*`

### `wf-timeout-minutes-required`

Every job MUST set `timeout-minutes:`. The default is 360 minutes (6 hours) — almost always wrong. Pick a value 2-3× the expected duration:

- Lint/test jobs: 10-20 minutes.
- Build jobs (Tauri release): 30-60 minutes.
- Native E2E suites: 30-45 minutes.
- Full release pipeline: 90 minutes.

A hung step otherwise burns 6 hours of billing per failure. Surface this as a recommendation if missing.

### `wf-timeout-step-level-for-flaky`

For known-flaky steps (network-dependent installs, hdiutil/codesign on macOS), add a per-step `timeout-minutes:` shorter than the job timeout. The step fails fast and falls into a retry wrapper or surfaces a clear log line.

## Artifacts — `wf-artifact-*`

### `wf-artifact-retention-explicit`

`actions/upload-artifact` defaults to 90-day retention. For Playwright reports, build logs, and other ephemeral outputs, set `retention-days: 7` (or 14 for release-gate runs). A 90-day default on every PR's debug artefacts piles up fast.

### `wf-artifact-conditional-on-failure`

Upload debug artefacts only on failure: `if: failure()`. Uploading on success doubles storage and clutters the run page. Production artefacts (release installers) are the exception — they upload unconditionally.

### `wf-artifact-name-includes-matrix`

Artifact names MUST be unique per matrix entry — `name: playwright-report-${{ matrix.name }}` is the canonical form. Without disambiguation, the second matrix entry's upload fails with "An artifact with this name has already been uploaded".

### `wf-artifact-no-secrets-in-name`

Never put a secret value into an artifact name (or path). Artifact names appear unredacted in the UI and the API.

## Aggregate gate jobs — `gate-*`

### `gate-aggregate-job`

When branch protection requires a single status check name (e.g. `Test (Linux)`), but the actual testing is sharded across multiple parallel jobs, add a no-op aggregate job:

```yaml
test-gate:
  name: Test (Linux)
  if: always()
  needs: [rust-test, vitest, e2e-browser, bindings-drift]
  runs-on: ubuntu-latest
  steps:
    - name: Check test results
      run: |
        if [[ "${{ needs.rust-test.result }}" != "success" || \
              "${{ needs.vitest.result }}" != "success" || \
              "${{ needs.e2e-browser.result }}" != "success" || \
              "${{ needs.bindings-drift.result }}" != "success" ]]; then
          echo "::error::One or more test jobs failed"
          exit 1
        fi
```

Three properties that MUST hold:

- `if: always()` — the gate runs even if a `needs:` job failed; otherwise a failed shard skips the gate, which leaves the protected branch's status check pending.
- The shell check examines every `needs.<job>.result` — `success` is the only acceptable value (`skipped` is a finding when the upstream wasn't deliberately conditional).
- The `name:` is the **exact** string branch protection requires.

### `gate-paths-ignore-fallthrough`

If the protected workflow uses `paths-ignore`, the gate job MUST still run on every PR. Achieve this with two workflows:

- `ci.yml` with `paths-ignore` and the heavy jobs.
- `ci-gate.yml` with no path filter and a no-op gate job that reports the same name.

Or: keep one workflow, drop `paths-ignore`, and short-circuit each heavy job with a `paths-changed?` first step. The first form is simpler.

### `gate-validate-dispatch-input`

For `workflow_dispatch` workflows that accept a ref input, add a `validate-dispatch` job that runs first and fails fast (~5 s) if the input is empty, points to the default branch, or doesn't match an allowlist of branch prefixes. Every other job depends on `validate-dispatch` via `needs:` so a malformed dispatch fails before any expensive work runs.

## Reusable workflows — `wf-reuse-*`

### `wf-reuse-call-with-secrets-explicit`

`workflow_call`-style reusable workflows do NOT inherit secrets automatically. The caller MUST pass them:

```yaml
jobs:
  build:
    uses: ./.github/workflows/build.yml
    secrets:
      TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
```

A reusable workflow that references `secrets.X` without the caller passing `X` silently sees `X` as empty.

### `wf-reuse-pin-by-sha-when-cross-repo`

A reusable workflow loaded from another repo (`uses: org/repo/.github/workflows/x.yml@<ref>`) MUST be pinned to a SHA, same as a third-party action. A tag/branch ref is a supply-chain risk.

## Runner selection — `wf-runner-*`

### `wf-runner-latest-vs-pinned`

`ubuntu-latest`, `windows-latest`, `macos-latest` are moving targets — they update on a 1-2 month cadence and occasionally break builds (toolchain bumps, removed system packages). For release-critical workflows, pin to a specific image version (`ubuntu-22.04`, `windows-2022`, `macos-13`) and bump deliberately. For PR validation, `*-latest` is acceptable — failures are caught before merge.

### `wf-runner-os-matters-for-bundle`

Some Tauri targets require a specific runner OS:
- macOS DMG / `.app` bundles: `macos-latest` (`macos-12+` or Apple Silicon).
- Windows MSI (WiX): `windows-latest` (WiX is Windows-only).
- Windows NSIS: any OS with `cargo-xwin`, but `windows-latest` is simplest.
- Linux AppImage / Deb / RPM: `ubuntu-latest` (with the right `apt` deps).

A matrix that builds a Windows MSI on `ubuntu-latest` is misconfigured; flag it.

### `wf-runner-self-hosted-only-for-private`

Self-hosted runners on a public repo are a security hazard (see `sec-policy-no-self-hosted-on-public-repo`). For private repos, self-hosted is fine but pin runner labels narrowly so a compromised runner can't pick up jobs from another team's workflow.

## Network resilience — `wf-net-*`

### `wf-net-retry-flaky-installs`

Network-dependent steps (apt installs, brew installs, npm registry pulls, GitHub release downloads) are flaky on a 1-3% rate. For critical installs, wrap in a 2-attempt retry:

```bash
attempt=1; max=2
while [ $attempt -le $max ]; do
  npm ci && break
  attempt=$((attempt+1))
done
[ $attempt -gt $max ] && exit 1
```

Or use a maintained action with retry (`nick-fields/retry@<sha>`). Don't retry test runs — flaky tests should be fixed, not retried.

### `wf-net-platform-known-flake-categories`

Known flaky categories on GitHub-hosted runners:
- macOS `bundle_dmg.sh` / `hdiutil` (tauri-apps/tauri#3055) — wrap with `killall Finder` + detach-stale-mounts pre-flight.
- Windows WebView2 detection — re-run usually works.
- `apt-get update` 5xx from mirrors — retry.

Document the wrapper retry; explain *why* it exists (link to the upstream issue).

## Output discipline — `wf-output-*`

### `wf-output-no-set-output-deprecated`

`echo "::set-output name=X::Y"` was deprecated in 2022 and removed in 2024. Use `$GITHUB_OUTPUT`:

```bash
echo "version=1.2.3" >> "$GITHUB_OUTPUT"
```

`set-output` lines either error out or silently ignore in current runners — workflows that still use them are broken.

### `wf-output-quote-github-output-path`

When writing multiline values to `$GITHUB_OUTPUT`, use the heredoc form:

```bash
{
  echo "notes<<EOF"
  cat release-notes.md
  echo "EOF"
} >> "$GITHUB_OUTPUT"
```

Single-line `echo "key=$value" >> $GITHUB_OUTPUT` breaks on newlines or `=` in the value.

### `wf-output-mask-derived-secrets`

If a step computes a value from a secret and that value should also be redacted, emit `::add-mask::<value>` before exposing it. See `secrets-add-mask-derived-values` in the security knowledge file.
