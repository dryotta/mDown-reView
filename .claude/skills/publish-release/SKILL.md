---
name: publish-release
description: Use when publishing a new release of mdownreview. Bumps the version, updates the changelog, and creates a release tag that triggers the CI/CD build workflow.
---

# Publish Release Skill

You are implementing a release workflow for the mdownreview Tauri desktop application. This skill publishes a new version by bumping the version number, updating the changelog, and creating a release tag.

**⚠️ CRITICAL: Do not skip the confirmation step.** Always show the user the proposed version and wait for their explicit approval before making any changes to files or git history.

## Step 1: Pre-flight Safety Checks

Before anything else, verify the workspace is in a safe state:

1. **Clean working tree** — run `git status --porcelain`. If there is any output, stop and tell the user to commit or stash their changes first.
2. **Correct branch** — run `git branch --show-current`. If the branch is not `main`, warn the user and ask for explicit confirmation before proceeding.
3. **Sync with remote** — run `git --no-pager fetch origin --tags` to ensure local tags and history are up to date.

## Step 2: Determine Last Release

Run `git --no-pager describe --tags --abbrev=0` to get the most recent tag.

- If tags exist, use that tag as the baseline (e.g., `v0.1.0`)
- If **no tags exist yet**, read `package.json` and use the `version` field as the baseline (treat all commits since the repo's start as unreleased)

## Step 3: Collect Unreleased Commits

Run `git --no-pager log {last-tag}..HEAD --pretty=format:"%s"` to get commit subjects since the last release.

If there are no tags, use `git --no-pager log --pretty=format:"%s"` to get all commits.

**If there are zero commits since the last tag, stop and tell the user there is nothing to release.**

Exclude merge commits and previous release commits (matching `chore: release v`).

## Step 4: Classify Commits and Suggest Version Bump

Examine each commit subject and classify using **conventional commit** patterns, including scoped and bang forms:

- **Major bump** — subject matches `^.+!:` (bang before colon, e.g., `feat!:`, `feat(auth)!:`) or full commit body contains `BREAKING CHANGE:`
  → increment the first version number (e.g., 0.2.0 → 1.0.0)
- **Minor bump** — subject matches `^feat(\(.*\))?:` (e.g., `feat:`, `feat(menu):`)
  → increment the middle version number (e.g., 0.2.0 → 0.3.0)
- **Patch bump** — subject matches `^(fix|perf)(\(.*\))?:` (e.g., `fix:`, `fix(viewer):`, `perf:`)
  → increment the last version number (e.g., 0.2.0 → 0.2.1)

**Priority rule:** If multiple bump types are present, apply the **highest** bump (major > minor > patch).

Calculate the next version based on the classification.

## Step 5: Show User and Request Confirmation

Display to the user:

```
Last tag: {last-tag or package.json version}
Commits since last release:
{commit list}

Suggested next version: v{next-version}
```

**Ask the user to confirm the version** using the ask_user tool with choices:
- `v{next-version} (suggested)`
- `cancel`

Allow freeform input so the user can type a different version (e.g., `v0.3.0`).

**Validation:** If the user provides a version, strip the leading `v` if present, verify it is valid semver (X.Y.Z), and confirm the tag `v{version}` does not already exist (check with `git --no-pager tag -l v{version}`). If validation fails, ask again.

Do not proceed past this step until you have explicit confirmation.

## Step 6: Update Version in Three Files

Once the version is confirmed, strip any leading `v` from the version before writing to files. For example, if the user typed `v0.2.0`, write `0.2.0` in all three files.

Update the version string in exactly these **3 files** (they must stay in sync):

1. **`package.json`** → Update the `"version"` field
2. **`src-tauri/Cargo.toml`** → Update the `version` field under `[package]`
3. **`src-tauri/tauri.conf.json`** → Update the `"version"` field

Note: Use the version without the `v` prefix in the files (e.g., `0.2.0`).

## Step 7: Update CHANGELOG.md

Prepend a new entry to `CHANGELOG.md` (create the file if it doesn't exist).

Format each section with commit messages grouped by type:

```
## v{version} — {YYYY-MM-DD}

### Features
- {feat commits, one per line}

### Fixes
- {fix/perf commits, one per line}

### Other
- {remaining commits, one per line}
```

**Rules:**
- Only include a section (Features/Fixes/Other) if there are commits for that category
- Use today's date in YYYY-MM-DD format
- Preserve any existing changelog entries below this new entry

## Step 8: Create Release Branch, Stage and Commit

Create a release branch, sync lockfiles, then stage and commit all files.

Run each command separately (do not chain with `&&`):

1. `git checkout -b release/v{version}`
2. `npm install --package-lock-only`
3. `cargo generate-lockfile --manifest-path src-tauri/Cargo.toml`
4. `git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json CHANGELOG.md`
5. `git commit -m "chore: release v{version}"`

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

## Step 10: Verify CI and Tag the Merged Commit

After the user confirms the PR is merged:

1. `git checkout main`
2. `git pull origin main`

**Verify checks one final time** by running `gh pr checks {pr_url}`. If any check is not passing, warn the user and ask for confirmation before proceeding.

3. `git tag -a v{version} -m "Release v{version}"`
4. `git push origin v{version}`

The tag push triggers the release workflow (`.github/workflows/release.yml`).

## Step 11: Print Release Information

Print a link to view the GitHub Actions workflow:

```
Release v{version} tagged and pushed!
Monitor the build at: https://github.com/dryotta/mdownreview/actions
```

The CI/CD workflow will automatically build and publish the release.

---

## One-Time Setup

Before the auto-updater can work, a developer needs to set up signing keys once:

```bash
npx tauri signer generate -w ~/.tauri/mdownreview.key
```

Then:
- Add the **private key** to GitHub Secrets as `TAURI_SIGNING_PRIVATE_KEY`
- Set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to an empty string in GitHub Secrets
- Copy the **public key** to `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`

This setup only needs to be done once; the release workflow will use these credentials automatically.
