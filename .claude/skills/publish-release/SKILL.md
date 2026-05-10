---
name: publish-release
description: Use when shipping a new release of mdownreview — when the user says "release", "tag", "publish", "ship a new version", "bump version", or runs `/publish-release [major|minor|patch]`. Fully autonomous — picks the bump from the arg (default `patch`), validates pre-flight gates, opens a release PR, babysits CI, tags the merged commit, then babysits release.yml — forward-fixing recoverable failures inline. Halts only on uncorrectable conditions (signing failures, dirty tree, divergent main).
---

**RIGID. Fully autonomous — never calls `ask_user`.** Owns the entire release lifecycle: version bump → CHANGELOG → release PR → tag → signed installers → published GitHub release. Pairs with `ci.yml` (CI build + sign + verify, called via `workflow_call` from `release.yml`).

The skill assumes a healthy `main`: pre-flight verifies the latest `ci.yml` and `canary.yml` runs on `main` are green and the working tree is clean. **Once those gates pass, every later failure is presumed release-pipeline-specific** (version-bump conflict, lockfile drift, NSIS hook, tauri.conf schema, platform build script) and is handled by inline fix-forward, not by delegating to `/iterate-one-issue`. If a fix would need >50 LoC or unfamiliar code paths, that's a signal of an upstream regression pre-flight should have caught — abort with HALT instead of chasing it.

Forward-fix budgets are bounded:
- **Pre-tag CI:** flake reruns cap 2/job, inline fixes cap 3.
- **Post-tag release CI:** flake reruns cap 2, fix-forward re-rolls cap 2 (always bumping patch — never reuse a version).

---

## Args

| Arg | Bump |
|---|---|
| empty | `patch` |
| `patch` | `patch` |
| `minor` | `minor` |
| `major` | `major` |

Anything else → `exit 1` with message `[publish-release] Unknown arg "<ARG>". Use empty (=patch), patch, minor, or major.`

The skill **always follows the literal arg** — it never auto-detects bump class from `feat!:`/`BREAKING CHANGE:` and never overrides the user. Misclassified bump is the user's call.

---

## Phase 0 — Pre-flight (read-only, fail-fast)

Each gate is read-only — the skill never auto-stashes, auto-commits, or auto-checks-out. On failure: print exact remediation command and `exit 1`.

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

If every gate passes, log `[publish-release] pre-flight green; HEAD=<sha>`.

---

## Phase 1 — Last release + unreleased commits

```bash
LAST_TAG=$(git --no-pager describe --tags --abbrev=0 2>/dev/null || true)
if [ -z "$LAST_TAG" ]; then
  LAST_TAG_RANGE="HEAD"  # first release
  BASELINE_VERSION=$(jq -r .version package.json)
else
  LAST_TAG_RANGE="$LAST_TAG..HEAD"
  BASELINE_VERSION="${LAST_TAG#v}"
fi

git --no-pager log "$LAST_TAG_RANGE" --no-merges --pretty=format:"%H%x09%s" \
  | grep -Ev '^[a-f0-9]+\schore: release v' \
  > /tmp/publish-release.commits.tsv
```

If `/tmp/publish-release.commits.tsv` is empty → `exit 0` with `Nothing to release since $LAST_TAG.` (not an error).

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

No `ask_user`. The arg is authoritative.

---

## Phase 3 — Update version files

Three files, no `v` prefix in any of them:

1. `package.json` → `.version`
2. `src-tauri/Cargo.toml` → `version` under `[package]`
3. `src-tauri/tauri.conf.json` → `.version`

Then refresh lockfiles:
```bash
npm install --package-lock-only
cargo generate-lockfile --manifest-path src-tauri/Cargo.toml
```

---

## Phase 4 — CHANGELOG (deterministic filter)

CHANGELOG generation is **mechanical** — the same input always produces the same output. No subjective "is this user-facing?" judgement.

### Rules

1. Parse each commit subject as `^(?<type>[a-z]+)(\((?<scope>[^)]*)\))?(?<bang>!)?:\s*(?<desc>.+)$`.
2. **Drop entirely** if `scope` ∈ `{ci, test, build, chore, deps, docs, infra, agents, skill, release}`. (Tell contributors: scope your commit properly to control CHANGELOG visibility.)
3. Drop if subject starts with `chore: release v` (already filtered in Phase 1, but keep as safety net).
4. Bucket the rest by `type`:
   - `feat` → **Features**
   - `fix` or `perf` → **Fixes**
   - everything else → **Other**
5. Each entry is `- <desc> (<short-sha>)` — short-sha helps reviewers locate the commit.
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

CI fires automatically on `pull_request` open. Wait for the run to finish, classify, fix-forward inline, repeat.

```bash
PRETAG_FIX_ATTEMPTS=0
PRETAG_FIX_CAP=3
PRETAG_RERUN_BUDGET_PER_JOB=2
declare -A PRETAG_RERUN_COUNT
```

### Loop

1. `gh pr checks "$PR_URL" --watch` → blocks until run completes.
2. If green → `gh pr merge "$PR_URL" --squash --auto` (or `--admin` if branch protection requires it). Proceed to Phase 7.
3. If failed → fetch failed-job names + logs:
   ```bash
   RUN_ID=$(gh run list --branch "release/v$NEW_VERSION" --workflow=ci.yml --limit=1 --json databaseId -q '.[0].databaseId')
   FAILED_JOBS=$(gh run view "$RUN_ID" --json jobs -q '.jobs[] | select(.conclusion=="failure") | .name')
   ```
4. Classify (see **Failure Classification** below).
5. **Flake** → if `${PRETAG_RERUN_COUNT[$job]:-0} < PRETAG_RERUN_BUDGET_PER_JOB`, `gh run rerun "$RUN_ID" --failed`, increment counter, loop to step 1.
6. **Real failure** → if `PRETAG_FIX_ATTEMPTS < PRETAG_FIX_CAP`, perform inline fix (see below), `git commit --amend --no-edit || git commit -m "fix: ...`", `git push --force-with-lease origin "release/v$NEW_VERSION"`, increment `PRETAG_FIX_ATTEMPTS`, loop to step 1.
7. **Budget exhausted or unclassified** → HALT (see **HALT** below).

### Inline fix scope (pre-tag)

Pre-tag failures are by definition release-pipeline-specific (pre-flight already proved `main` + canary green). Expected fixes:

- Lockfile drift: re-run `npm install --package-lock-only` / `cargo generate-lockfile`.
- Bindings drift: regenerate per `src/lib/bindings.ts` header instructions.
- CHANGELOG syntax error: fix markdown.
- Version mismatch between the three version files.
- `tauri.conf.json` schema (rare — would mean a Tauri version bump landed since canary).
- Test snapshot referencing the old version string.

If the failed-job log indicates >50 LoC of changes or touches application source under `src/`/`src-tauri/src/core/`, that's a regression pre-flight should have caught — HALT, do not chase.

---

## Phase 7 — Tag the merged commit

After Phase 6 squash-merges:

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

Watch `release.yml` for the new tag. Classify each failure (table below). On **fixable** classes, perform the **fix-forward re-roll** (delete tag/release, bump patch, re-issue the PR). On **HALT** classes, exit non-zero with diagnosis. Always print which class and which class-specific log line caused the decision.

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
2. Re-fetch the run conclusion. If `success` → Phase 9.
3. List failed jobs:
   ```bash
   FAILED_JOBS=$(gh run view "$RELEASE_RUN_ID" --json jobs \
     -q '.jobs[] | select(.conclusion=="failure") | {name: .name, url: .url}')
   ```
4. Classify per **Failure Classification**.
5. **Network/transient flake** → rerun within budget, loop to step 1.
6. **Signing/credential class** → HALT immediately. Tag stays in place; print remediation.
7. **Fixable build class** → perform **Re-roll** (below) if `POSTTAG_REROLL_ATTEMPTS < POSTTAG_REROLL_CAP`, else HALT.
8. **Unclassified** → HALT.

### Re-roll algorithm

Always bumps **patch** from the failed version (never reuses a version):

```bash
gh release delete "v$NEW_VERSION" --cleanup-tag --yes
# Bump patch from the failed version:
IFS=. read -r MAJ MIN PAT <<< "$NEW_VERSION"
PREV_FAILED="$NEW_VERSION"
NEW_VERSION="${MAJ}.${MIN}.$((PAT+1))"
git checkout main && git pull --ff-only

# Inline code fix for the build/script issue (touching only src-tauri config,
# scripts/, NSIS hooks, or a single file under src-tauri/src). >50 LoC → HALT.
# Examples: NSIS hook syntax error, stage-cli profile detection, tauri.conf
# bundle target list, missing platform-conditional in build.rs.

# Update version files (Phase 3)
# Prepend CHANGELOG entry under "## v$NEW_VERSION — <date>" with
#   "### Other" → "- chore(release): supersedes failed v$PREV_FAILED — <one-line cause>"
#   plus any commits introduced by the inline fix.

git checkout -b "release/v$NEW_VERSION"
git add <fixed files> package.json package-lock.json \
        src-tauri/Cargo.toml src-tauri/Cargo.lock \
        src-tauri/tauri.conf.json CHANGELOG.md
git commit -m "chore: release v$NEW_VERSION (supersedes v$PREV_FAILED)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push origin "release/v$NEW_VERSION"
gh pr create ...        # same as Phase 5
((POSTTAG_REROLL_ATTEMPTS++))
# loop back through Phase 6 → 7 → 8 with the new version
```

The supersession line in the CHANGELOG creates an audit trail so consumers seeing a missing `vX.Y.Z` understand why.

---

## Phase 9 — Summary

Always print on success **or** on HALT (so the user has an audit trail either way):

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

Used by Phase 6 (pre-tag) and Phase 8 (post-tag) to route each failed job. Match in order — first row that matches wins.

| # | Signal in failed-job log | Class | Pre-tag action | Post-tag action |
|---|---|---|---|---|
| 1 | Job timeout / `connect ETIMEDOUT` / `503 Service Unavailable` / GitHub Actions runner provisioning error | **flake** | rerun (cap 2/job) | rerun (cap 2/job) |
| 2 | Native E2E `WebView2Loader` / browser launch error / single-instance lock | **flake** | rerun (cap 2/job) | n/a (job not in release.yml workflow_call's matrix) |
| 3 | `error: failed to read … TAURI_SIGNING_PRIVATE_KEY` / `signature verification failed` / `pubkey mismatch` / `endorsement` / cert-related stderr | **signing** | HALT (block PR merge — tag would be unsigned) | HALT (do NOT re-roll — credentials problem, not code) |
| 4 | rustc/cargo error referencing `src-tauri/Cargo.lock` mismatch | **lockfile-drift** | inline fix: `cargo generate-lockfile --manifest-path src-tauri/Cargo.toml` (cap 3) | re-roll with same fix (cap 2) |
| 5 | `bindings.ts` mismatch (bindings-drift job) | **bindings-drift** | inline fix per `src/lib/bindings.ts` regeneration command (cap 3) | re-roll with same fix |
| 6 | CHANGELOG markdown lint / version-string assertion failure in tests | **changelog/version-mismatch** | inline fix (cap 3) | re-roll |
| 7 | NSIS / `installer-hooks.nsh` syntax error · `signtool` invocation · DMG layout failure · `Verify ad-hoc signing` step · platform-specific `cargo build` errors localized to `src-tauri/src` config or `scripts/` | **fixable-build** | HALT (would mean canary should have caught it; investigate) | re-roll (cap 2) |
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
2. **Pre-tag HALT** (PR not yet merged):
   - Leave the branch and PR in place — user inspects, fixes, force-pushes, or runs `/publish-release` again after the upstream issue is resolved.
   - **Do not** auto-close the PR or auto-delete the branch (preserves debugging context).
3. **Post-tag HALT**:
   - Tag and GitHub release stay in place if class ∈ `{signing}` (the tag itself is fine; the build infra is broken — fixing the secret will unblock a re-trigger via `gh workflow run release.yml --ref v$NEW_VERSION`).
   - Tag is left in place if class ∈ `{regression, unclassified}` (so the user can decide whether to fix-forward to a higher patch or rollback manually).
4. Print Phase 9 summary with `HALTED: <class>` in the Release URL row.
5. `exit 1`.

---

## Recovery primitives (used by re-roll and HALT)

- **Delete tag + release:** `gh release delete "v$VERSION" --cleanup-tag --yes`
- **Delete release branch (if abandoning):** `git push origin --delete "release/v$VERSION"; git checkout main; git branch -D "release/v$VERSION"`
- **Re-trigger release.yml after secret fix:** `gh workflow run release.yml --ref "v$NEW_VERSION"`

The skill does not invoke recovery primitives during a HALT — they're documented here so a human (or a follow-up `/publish-release` invocation) can use them.

---

## One-time signing setup

```bash
npx tauri signer generate -w ~/.tauri/mdownreview.key
```

- GitHub Secrets: `TAURI_SIGNING_PRIVATE_KEY` (private key), `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty string).
- `src-tauri/tauri.conf.json` → `plugins.updater.pubkey` (public key — Phase 0 verifies it's non-empty).

Done once; release workflow uses these. Rotation is human-only — the skill HALTs on signing failures and does not attempt to regenerate keys.
