# Installation

## What it is

How users get mdownreview onto their machine, and the trust posture for the first launch. mdownreview is open-source and ships **without** an Apple Developer ID or Windows EV certificate; the install paths below are designed so a normal user reaches a working app without an unsigned-binary scare and without escalating privileges.

## How it works

There are three install paths, in decreasing order of recommendation:

### 1. Script install (recommended)

**macOS**

```bash
curl -LsSf https://dryotta.github.io/mdownreview/install.sh | sh
```

`curl` does **not** apply the macOS quarantine attribute (`com.apple.quarantine`), so the downloaded `.app` launches without a Gatekeeper warning. The script symlinks `mdownreview-cli` into `/usr/local/bin` and falls back to `~/.local/bin` when `/usr/local/bin` is not writable — no `sudo` ever required.

**Windows**

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://dryotta.github.io/mdownreview/install.ps1 | iex"
```

The Windows install runs the NSIS installer in per-user mode and adds the install directory to the per-user `PATH` so `mdownreview-cli` is on `PATH` for new shells. No UAC prompt.

### 2. Manual download (DMG / ZIP)

The GitHub Release page hosts `.dmg` (macOS) and `.zip` (Windows) artifacts.

When a user downloads the `.dmg` through a browser, macOS tags it with the quarantine attribute. After dragging `mdownreview.app` to `/Applications`, the user must clear the attribute once:

```bash
xattr -d com.apple.quarantine /Applications/mdownreview.app
```

Alternative: System Settings → Privacy & Security → "Open Anyway" after the first blocked launch.

### 3. Cargo (CLI-only, automation)

```bash
cargo install --git https://github.com/dryotta/mdownreview.git --bin mdownreview-cli
```

For CI pipelines and automation users who only need the CLI and already have a Rust toolchain.

## Codesigning posture

The app is **ad-hoc signed** — `tauri.conf.json` sets `signingIdentity: "-"`. There is no Apple Developer ID and no notarization. arm64 macOS requires *some* signature for a binary to execute at all; ad-hoc signing satisfies that hard requirement without paying for a Developer ID.

The `mdownreview-cli` binary embedded inside the `.app` bundle (`externalBin`) is also ad-hoc signed, and the release workflow verifies both signatures before publishing the artifact.

## Per-user install

No UAC on Windows, no `sudo` on macOS — both install paths run entirely in user space. This is a charter Non-Goal: see [`docs/principles.md`](../principles.md) Non-Goals (no UAC/sudo).

## Updater is separate

> **IMPORTANT** — The minisign signature on the auto-updater bundle (see [`docs/features/updates.md`](updates.md)) is **not** an Apple codesign identity. Our updater verifies update payloads with our own signing key, which is an entirely separate trust mechanism from Apple Gatekeeper. macOS Gatekeeper still sees the app as ad-hoc signed regardless of how strong the updater signature is.

## Key source

- `site/install.sh` — macOS install script
- `site/install.ps1` — Windows install script
- `src-tauri/tauri.conf.json` — bundle config (`signingIdentity`, `externalBin`)
- `.github/workflows/release.yml` — build pipeline + codesign verification

## Related rules

- Per-user installation, no elevation — [`docs/principles.md`](../principles.md) Non-Goals (no UAC/sudo).
- Updater signing (minisign, separate from Apple codesign) — [`docs/features/updates.md`](updates.md).
- Path canonicalization for installer-supplied paths — [`docs/security.md`](../security.md).
- What the CLI does once installed — [`docs/features/cli-and-associations.md`](cli-and-associations.md).
