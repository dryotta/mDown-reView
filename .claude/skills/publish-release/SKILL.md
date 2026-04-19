# Publish Release Skill

You are implementing a release workflow for the mDown reView Tauri desktop application. This skill publishes a new version by bumping the version number, updating the changelog, and creating a release tag.

**⚠️ CRITICAL: Do not skip the confirmation step.** Always show the user the proposed version and wait for their explicit approval before making any changes to files or git history.

## Step 1: Determine Last Release

Run `git describe --tags --abbrev=0` to get the most recent tag.

- If tags exist, use that tag as the baseline (e.g., `v0.1.0`)
- If **no tags exist yet**, read `package.json` and use the `version` field as the baseline (treat all commits since the repo's start as unreleased)

## Step 2: Collect Unreleased Commits

Run `git log {last-tag}..HEAD --pretty=format:"%s"` to get all commits since the last release.

If there are no tags, use `git log --pretty=format:"%s"` to get all commits in the repository.

Store the list of commit messages for classification.

## Step 3: Classify Commits and Suggest Version Bump

Examine each commit message and classify:

- **Minor bump** (`feat:` prefix) → increment the middle version number (e.g., 0.1.0 → 0.2.0)
- **Patch bump** (`fix:` or `perf:` prefix) → increment the last version number (e.g., 0.1.0 → 0.1.1)
- **Major bump** (contains `BREAKING CHANGE` anywhere in the message) → increment the first version number (e.g., 0.1.0 → 1.0.0)

**Priority rule:** If multiple bump types are present, apply the **highest** bump (major > minor > patch).

Calculate the next version based on the classification.

## Step 4: Show User and Request Confirmation

Display to the user:

```
Last tag: {last-tag or package.json version}
Commits since last release:
{commit list}

Suggested next version: v{next-version}
```

**Ask the user to confirm the version:** "Does v{next-version} look correct? Type the version or press Enter to confirm."

**Wait for user input.** The user may:
- Press Enter to confirm the suggested version
- Type a different version (e.g., `v0.2.0`) to override
- Type `abort` or `cancel` to stop the release process

Do not proceed past this step until you have explicit confirmation.

## Step 5: Update Version in Three Files

Once the version is confirmed, strip any leading `v` from the version before writing to files. For example, if the user typed `v0.2.0`, write `0.2.0` in all three files.

Update the version string in exactly these **3 files** (they must stay in sync):

1. **`package.json`** → Update the `"version"` field
   ```json
   "version": "{version}"
   ```

2. **`src-tauri/Cargo.toml`** → Update the `version` field under `[package]`
   ```toml
   [package]
   version = "{version}"
   ```

3. **`src-tauri/tauri.conf.json`** → Update the `"version"` field
   ```json
   "version": "{version}"
   ```

Note: Use the version without the `v` prefix in the files (e.g., `0.2.0`).

## Step 6: Update CHANGELOG.md

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

## Step 7: Stage and Commit Version Files

First sync lockfiles to the new version, then commit all files:

```bash
npm install --package-lock-only
cd src-tauri && cargo check && cd ..
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json CHANGELOG.md
git commit -m "chore: release v{version}"
```

## Step 8: Create Tag and Push

Create the annotated tag and push to the remote:

```bash
git tag -a v{version} -m "Release v{version}"
git push origin HEAD --follow-tags
```

## Step 9: Print Release Information

Print a link to view the GitHub Actions workflow:

```
Release v{version} published!
Monitor the build at: https://github.com/dryotta/mDown-reView/actions
```

The CI/CD workflow will automatically build and publish the release.

---

## One-Time Setup

Before the auto-updater can work, a developer needs to set up signing keys once:

```bash
npx tauri signer generate -w ~/.tauri/mdown-review.key
```

Then:
- Add the **private key** to GitHub Secrets as `TAURI_SIGNING_PRIVATE_KEY`
- Set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to an empty string in GitHub Secrets
- Copy the **public key** to `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`

This setup only needs to be done once; the release workflow will use these credentials automatically.
