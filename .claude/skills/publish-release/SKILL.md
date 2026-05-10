---
name: publish-release
description: Use when the user says "release", "tag", "publish", "ship a new version", "bump version", or runs `/publish-release [major|minor|patch]`. Fully autonomous — never prompts. Default bump: patch.
---

**RIGID. Fully autonomous — never calls `ask_user`.** Owns the full release lifecycle: version bump → CHANGELOG → release PR → tag → signed installers → published GitHub release. Pairs with `ci.yml` (called from `release.yml` via `workflow_call`).

Phase 0 verifies `main` is healthy. Once those gates pass, every later failure is presumed release-pipeline-specific and fixed inline — no delegation. Fixes touching >50 LoC or application source under `src/` or `src-tauri/src/core/` signal an upstream regression Phase 0 should have caught → HALT.

---

## Args

| Arg | Bump |
|---|---|
| empty | `patch` |
| `patch` | `patch` |
| `minor` | `minor` |
| `major` | `major` |

Anything else → `exit 1` with `[publish-release] Unknown arg "<ARG>". Use empty (=patch), patch, minor, or major.`

The arg is authoritative. No auto-detection from `feat!:` or `BREAKING CHANGE:` — misclassified bump is the user's call.

---

## Phase 0 — Pre-flight (read-only, fail-fast)

Read-only — never auto-stashes, auto-commits, or auto-checks-out. On failure: print exact remediation and `exit 1`.

```bash
git --no-pager fetch origin --tags
```

| Gate | Command | Fail message |
|---|---|---|
| Clean tree | `git status --porcelain` empty | `Working tree dirty — commit or stash before release.` |
| On main | `git branch --show-current` == `main` | `Not on main — git checkout main && git pull --ff-only first.` |
| Synced main | `git pull --ff-only origin main` | `Local main diverged from origin — investigate before release.` |
| Latest CI on main green | `gh run list --workflow=ci.yml --branch=main --limit=1 --json conclusion,databaseId,headSha,url` → `conclusion == "success"` AND `headSha == HEAD` | `Latest ci.yml on main is <conclusion> at <url> — fix and let it land before releasing.` |
| Latest canary on main green | `gh run list --workflow=canary.yml --branch=main --limit=1 --json conclusion,headSha,url` → `conclusion == "success"` | `Latest canary.yml on main is <conclusion> at <url> — fix before releasing (signed-build pipeline is broken).` |
| Updater pubkey present | `jq -e '.plugins.updater.pubkey | length > 0' src-tauri/tauri.conf.json` | `tauri.conf.json plugins.updater.pubkey is empty — releases would be unverifiable.` |

On all-green: log `[publish-release] pre-flight green; HEAD=<sha>`.

---

## Phase 1 — Last release + unreleased commits

```bash
LAST_TAG=$(git --no-pager describe --tags --abbrev=0 2>/dev/null || true)
if [ -z "$LAST_TAG" ]; then
  LAST_TAG_RANGE="HEAD"
  BASELINE_VERSION=$(jq -r .version package.json)
else
  LAST_TAG_RANGE="$LAST_TAG..HEAD"
  BASELINE_VERSION="${LAST_TAG#v}"
fi

git --no-pager log "$LAST_TAG_RANGE" --no-merges --pretty=format:"%H%x09%s" \
  | grep -Ev '^[a-f0-9]+\schore: release v' \
  > /tmp/publish-release.commits.tsv
```

Empty file → `exit 0` with `Nothing to release since $LAST_TAG.` (not an error).

---

## Phase 2 — Compute next version

```bash
BUMP="${ARG:-patch}"
IFS=. read -r MAJ MIN PAT <<< "$BASELINE_VERSION"
case "$BUMP" in
  major) NEW_VERSION="$((MAJ+1)).0.0" ;;
  minor) NEW_VERSION="${MAJ}.$((MIN+1)).0" ;;
  patch) NEW_VERSION="${MAJ}.${MIN}.$((PAT+1))" ;;
esac
[[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "computed version $NEW_VERSION not semver"; exit 1; }
git tag -l "v$NEW_VERSION" | grep -q . && { echo "tag v$NEW_VERSION already exists"; exit 1; }
```

---

## Phase 3 — Update version files

Three files, no `v` prefix:

1. `package.json` → `.version`
2. `src-tauri/Cargo.toml` → `version` under `[package]`
3. `src-tauri/tauri.conf.json` → `.version`

```bash
npm install --package-lock-only
cargo generate-lockfile --manifest-path src-tauri/Cargo.toml
```

---

## Phase 4 — CHANGELOG (deterministic filter)

Same input always produces the same output. No subjective "is this user-facing?" judgement.

### Rules

1. Parse each commit subject as `^(?<type>[a-z]+)(\((?<scope>[^)]*)\))?(?<bang>!)?:\s*(?<desc>.+)$`.
2. **Drop entirely** if `scope` ∈ `{ci, test, build, chore, deps, docs, infra, agents, skill, release}`.
3. Drop if subject starts with `chore: release v`.
4. Bucket the rest by `type`:
   - `feat` → **Features**
   - `fix` or `perf` → **Fixes**
   - everything else → **Other**
5. Each entry is `- <desc> (<short-sha>)`.
6. Skip empty buckets.

### Output (prepend to CHANGELOG.md, create if missing)

```
## v<NEW_VERSION> — <YYYY-MM-DD>

### Features
- <feat …> (<sha>)

### Fixes
- <fix/perf …> (<sha>)

### Other
- <other …> (<sha>)

```

Preserve all existing entries below.

---

## Phase 5 — Branch + commit + push + open PR

```bash
git checkout -b "release/v$NEW_VERSION"
git add package.json package-lock.json \
        src-tauri/Cargo.toml src-tauri/Cargo.lock \
        src-tauri/tauri.conf.json \
        CHANGELOG.md
git commit -m "chore: release v$NEW_VERSION

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push origin "release/v$NEW_VERSION"

PR_URL=$(gh pr create --base main --head "release/v$NEW_VERSION" \
  --title "chore: release v$NEW_VERSION" \
  --body "Automated release PR. Will be auto-merged when CI is green.

- Bump: \`$BUMP\` ($BASELINE_VERSION → $NEW_VERSION)
- Commits: $(wc -l < /tmp/publish-release.commits.tsv)
- Last tag: $LAST_TAG")
PR_NUMBER=$(gh pr view "$PR_URL" --json number -q .number)
```

---

## Phase 6 — Babysit pre-tag CI

CI fires automatically on `pull_request`. Caps: 2 reruns/job for flakes, 3 inline-fix attempts.

```bash
PRETAG_FIX_ATTEMPTS=0
PRETAG_FIX_CAP=3
PRETAG_RERUN_BUDGET_PER_JOB=2
declare -A PRETAG_RERUN_COUNT
```

### Loop

1. `gh pr checks "$PR_URL" --watch` → blocks until run completes.
2. Green → `gh pr merge "$PR_URL" --squash --auto` (or `--admin` if branch protection requires it). Phase 7.
3. Failed → fetch failed-job names + logs:
   ```bash
   RUN_ID=$(gh run list --branch "release/v$NEW_VERSION" --workflow=ci.yml --limit=1 --json databaseId -q '.[0].databaseId')
   FAILED_JOBS=$(gh run view "$RUN_ID" --json jobs -q '.jobs[] | select(.conclusion=="failure") | .name')
   ```
4. Classify per **Failure Classification**.
5. Flake → if `${PRETAG_RERUN_COUNT[$job]:-0} < PRETAG_RERUN_BUDGET_PER_JOB`, `gh run rerun "$RUN_ID" --failed`, increment counter, loop to 1.
6. Real failure → if `PRETAG_FIX_ATTEMPTS < PRETAG_FIX_CAP`, inline fix, `git commit --amend --no-edit || git commit -m "fix: ..."`, `git push --force-with-lease origin "release/v$NEW_VERSION"`, increment, loop to 1.
7. Budget exhausted or unclassified → HALT.

### Expected inline fixes

- Lockfile drift: re-run `npm install --package-lock-only` / `cargo generate-lockfile`.
- Bindings drift: regenerate per `src/lib/bindings.ts` header instructions.
- CHANGELOG markdown syntax error.
- Version mismatch between the three version files.
- `tauri.conf.json` schema drift (rare — implies a Tauri version bump landed since canary).
- Test snapshot referencing the old version string.

---

## Phase 7 — Tag the merged commit

```bash
git checkout main
git pull --ff-only origin main
MERGED_SHA=$(git rev-parse HEAD)
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"
git push origin "v$NEW_VERSION"
```

Tag push triggers `release.yml`.

---

## Phase 8 — Babysit post-tag release.yml (fix-forward)

Caps: 2 reruns/job for flakes, 2 fix-forward re-rolls (always bumping patch).

```bash
POSTTAG_REROLL_ATTEMPTS=0
POSTTAG_REROLL_CAP=2
POSTTAG_RERUN_BUDGET_PER_JOB=2
declare -A POSTTAG_RERUN_COUNT
```

### Loop

1. Find the release.yml run for `v$NEW_VERSION`:
   ```bash
   sleep 30  # let GitHub register the tag-triggered run
   RELEASE_RUN_ID=$(gh run list --workflow=release.yml --limit=5 \
     --json databaseId,headBranch,status -q '.[] | select(.headBranch=="v'"$NEW_VERSION"'") | .databaseId' | head -1)
   gh run watch "$RELEASE_RUN_ID" --exit-status || true
   ```
2. Re-fetch run conclusion. Success → Phase 9.
3. List failed jobs:
   ```bash
   FAILED_JOBS=$(gh run view "$RELEASE_RUN_ID" --json jobs \
     -q '.jobs[] | select(.conclusion=="failure") | {name: .name, url: .url}')
   ```
4. Classify per **Failure Classification**.
5. Network/transient flake → rerun within budget, loop to 1.
6. Signing/credential class → HALT immediately. Tag stays in place.
7. Fixable build class → **Re-roll** if `POSTTAG_REROLL_ATTEMPTS < POSTTAG_REROLL_CAP`, else HALT.
8. Unclassified → HALT.

### Re-roll algorithm

Always bumps patch from the failed version — never reuse a version.

```bash
gh release delete "v$NEW_VERSION" --cleanup-tag --yes
IFS=. read -r MAJ MIN PAT <<< "$NEW_VERSION"
PREV_FAILED="$NEW_VERSION"
NEW_VERSION="${MAJ}.${MIN}.$((PAT+1))"
git checkout main && git pull --ff-only

# Inline fix scope: src-tauri config (tauri.conf.json, Cargo.toml),
# scripts/, NSIS hooks, build.rs, or a single file under src-tauri/src.
# Examples: NSIS hook syntax, stage-cli profile detection, bundle target
# list, missing platform-conditional. >50 LoC → HALT.

# Phase 3: update version files.
# Phase 4: prepend CHANGELOG entry under "## v$NEW_VERSION — <date>" with
#   ### Other
#   - chore(release): supersedes failed v$PREV_FAILED — <one-line cause>

git checkout -b "release/v$NEW_VERSION"
git add <fixed files> package.json package-lock.json \
        src-tauri/Cargo.toml src-tauri/Cargo.lock \
        src-tauri/tauri.conf.json CHANGELOG.md
git commit -m "chore: release v$NEW_VERSION (supersedes v$PREV_FAILED)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push origin "release/v$NEW_VERSION"
gh pr create ...   # same as Phase 5
((POSTTAG_REROLL_ATTEMPTS++))
# loop back through Phase 6 → 7 → 8 with the new version
```

The supersession line in the CHANGELOG creates an audit trail so consumers seeing a missing `vX.Y.Z` understand why.

---

## Phase 9 — Summary

Always print on success and on HALT.

```
=== publish-release summary ===
Bump:                  <patch|minor|major> (default | user-arg "<arg>")
Last tag:              <LAST_TAG>
Released as:           v<NEW_VERSION>$([ -n "$PREV_FAILED" ] && echo " (supersedes $PREV_FAILED)")
Commits classified:
  Features:            <N>
  Fixes:               <N>
  Other:               <N>
  Excluded by scope:   <N>
Pre-tag CI:            green after <X> attempts (<R> reruns, <F> inline fixes)
Post-tag release.yml:  green after <Y> attempts (<R2> reruns, <RR> re-rolls)
Final tag SHA:         <merged-sha>
Release URL:           <gh release url>   (or "DRAFT" / "FAILED" / "HALTED: <class>")
Signed assets:         <count>            (or "n/a" on HALT)
Total wall-clock:      <hh:mm:ss>
```

---

## Failure Classification

Used by Phase 6 (pre-tag) and Phase 8 (post-tag). Match in order — first row wins.

| # | Signal in failed-job log | Class | Pre-tag action | Post-tag action |
|---|---|---|---|---|
| 1 | Job timeout / `connect ETIMEDOUT` / `503 Service Unavailable` / runner provisioning error | **flake** | rerun (cap 2/job) | rerun (cap 2/job) |
| 2 | Native E2E `WebView2Loader` / browser launch error / single-instance lock | **flake** | rerun (cap 2/job) | n/a (job not in release.yml workflow_call matrix) |
| 3 | `error: failed to read … TAURI_SIGNING_PRIVATE_KEY` / `signature verification failed` / `pubkey mismatch` / cert-related stderr | **signing** | HALT | HALT (credentials problem, not code) |
| 4 | rustc/cargo error referencing `src-tauri/Cargo.lock` mismatch | **lockfile-drift** | inline fix: `cargo generate-lockfile --manifest-path src-tauri/Cargo.toml` | re-roll with same fix |
| 5 | `bindings.ts` mismatch (bindings-drift job) | **bindings-drift** | inline fix per `src/lib/bindings.ts` regeneration command | re-roll with same fix |
| 6 | CHANGELOG markdown lint / version-string assertion failure in tests | **changelog/version-mismatch** | inline fix | re-roll |
| 7 | NSIS / `installer-hooks.nsh` syntax · `signtool` invocation · DMG layout · `Verify ad-hoc signing` step · platform-specific `cargo build` errors localized to `src-tauri/src` config or `scripts/` | **fixable-build** | HALT (canary should have caught it) | re-roll |
| 8 | Test failure under `src/__tests__/`, `src-tauri/tests/`, `e2e/` referencing application logic | **regression** | HALT (canary lied — fix on main first) | HALT (do not ship a release chasing a regression) |
| 9 | Anything else | **unclassified** | HALT | HALT |

When in doubt: HALT. Two HALTs in a release are better than one bad release.

---

## HALT procedure

When budget is exhausted or a non-fixable class is hit:

1. Print:
   ```
   [publish-release] HALT — class=<class>, attempts=<N>/<cap>
   Failed job:    <job name>
   Failed run:    <gh run url>
   First-line:    <first error line from log>
   Remediation:   <class-specific message>
   ```
2. Pre-tag HALT (PR not yet merged): leave branch and PR in place — preserves debugging context.
3. Post-tag HALT: tag stays in place. For `signing` class, the tag is fine — fix the secret and re-trigger via `gh workflow run release.yml --ref v$NEW_VERSION`.
4. Print Phase 9 summary with `HALTED: <class>` in the Release URL row.
5. `exit 1`.

---

## Recovery primitives

Documented for human follow-up; the skill does not invoke them during HALT.

- Delete tag + release: `gh release delete "v$VERSION" --cleanup-tag --yes`
- Delete release branch: `git push origin --delete "release/v$VERSION"; git checkout main; git branch -D "release/v$VERSION"`
- Re-trigger release.yml after secret fix: `gh workflow run release.yml --ref "v$NEW_VERSION"`

---

## One-time signing setup

```bash
npx tauri signer generate -w ~/.tauri/mdownreview.key
```

- GitHub Secrets: `TAURI_SIGNING_PRIVATE_KEY` (private key), `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty string).
- `src-tauri/tauri.conf.json` → `plugins.updater.pubkey` (public key — Phase 0 verifies non-empty).

Rotation is human-only — the skill HALTs on signing failures and does not regenerate keys.
