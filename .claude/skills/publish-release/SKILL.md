---
name: publish-release
description: Use when shipping a new release of mdownreview — when the user says "release", "tag", "publish", "ship a new version", "bump version", or asks for a CHANGELOG-driven version bump. Triggers the release CI/CD workflow via tag push.
---

**Never skip the confirmation in Step 5.**

## 1. Pre-flight

- `git status --porcelain` — non-empty → stop (commit/stash first).
- `git branch --show-current` — not `main` → warn, ask explicit confirmation.
- `git --no-pager fetch origin --tags`.

## 2. Last release

`git --no-pager describe --tags --abbrev=0`. If no tags, baseline = `package.json` `version`.

## 3. Unreleased commits

`git --no-pager log {last-tag}..HEAD --pretty=format:"%s"` (or `git log --pretty=format:"%s"` if no tags). Exclude merges and `chore: release v` commits. **Zero commits → stop ("nothing to release").**

## 4. Classify + suggest bump

| Subject pattern | Bump |
|---|---|
| `^.+!:` or body has `BREAKING CHANGE:` | **major** (1.x.0 → 2.0.0) |
| `^feat(\(.*\))?:` | **minor** (0.2.0 → 0.3.0) |
| `^(fix\|perf)(\(.*\))?:` | **patch** (0.2.0 → 0.2.1) |

Highest bump wins.

## 5. Confirm

Show:
```
Last tag: <tag>
Commits since last release:
<list>
Suggested next version: v<next>
```

Use `ask_user` with `v<next> (suggested)` | `cancel` (allow freeform). Strip leading `v`. Validate semver. Reject if tag already exists (`git tag -l v<version>`). **Do not proceed without confirmation.**

## 6. Update version (3 files, no `v` prefix)

1. `package.json` → `"version"`
2. `src-tauri/Cargo.toml` → `version` under `[package]`
3. `src-tauri/tauri.conf.json` → `"version"`

## 7. CHANGELOG.md (prepend; create if missing)

```
## v<version> — YYYY-MM-DD

### Features
- <feat …>

### Fixes
- <fix/perf …>

### Other
- <rest>
```

Skip empty sections. Preserve existing entries below.

## 8. Branch + commit (separate commands)

```bash
git checkout -b release/v<version>
npm install --package-lock-only
cargo generate-lockfile --manifest-path src-tauri/Cargo.toml
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json CHANGELOG.md
git commit -m "chore: release v<version>"
```

## 8.5. Local native E2E gate (Windows only)

Native E2E cannot run in GitHub Actions (WebView2/CDP unavailable headless). Skip on non-Windows but tell user to run on Windows before continuing.

```bash
npm test
npm run test:e2e
npm run test:e2e:native:build
```

Stop on first failure. On all-pass print `✅ All local tests passed`.

## 9. Push, PR, wait for CI

```bash
git push origin release/v<version>
gh pr create --base main --head release/v<version> --title "chore: release v<version>" --body "Version bump to v<version>. Merge after CI passes; tag will trigger build."
```

Print PR URL. Wait 30 s, then `gh pr checks <pr_url> --watch` (async — may take 20+ min).

- **Exit 0:** print "All release-gate checks passed — merge the PR, then confirm." Use `ask_user` with `Merged — create the tag` | `Cancel release`.
- **Non-zero:** print failed-check output. Choices: `I pushed a fix — re-check` | `Cancel release`. Re-check loops back to `--watch` after 10 s. Cancel:
  ```bash
  git checkout main
  git branch -D release/v<version>
  git push origin --delete release/v<version>
  ```

## 10. Tag the merged commit

```bash
git checkout main
git pull origin main
gh pr checks <pr_url>           # final verify; warn + confirm if not green
git tag -a v<version> -m "Release v<version>"
git push origin v<version>
```

Tag push triggers `.github/workflows/release.yml`.

## 11. Print

```
Release v<version> tagged and pushed!
Monitor: https://github.com/dryotta/mdownreview/actions
```

---

## One-time signing setup

```bash
npx tauri signer generate -w ~/.tauri/mdownreview.key
```

- GitHub Secrets: `TAURI_SIGNING_PRIVATE_KEY` (private key), `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty string).
- `src-tauri/tauri.conf.json` → `plugins.updater.pubkey` (public key).

Done once; release workflow uses these.
