# Installation System Overhaul

## Problem

Current release artifacts have inconsistent naming (no OS label, mixed arch formats like `x64` vs `aarch64`), no Windows ARM64 build, and no way to install from the command line. Users must manually navigate GitHub Releases to find the right download.

## Goals

1. Mark Windows and macOS clearly in release filenames
2. Use consistent naming across all release artifacts
3. Mark CPU architecture clearly for each file
4. Add Windows ARM64 build
5. Eliminate duplicate artifacts — single zip serves as both download and Tauri updater bundle
6. Provide `curl | sh` and `irm | iex` install scripts (like uv)

## Non-Goals

- macOS x86_64 build (ARM64-only; Intel Macs use Rosetta 2)
- Linux builds
- Version pinning in install scripts (latest only)
- Homebrew / winget / scoop packages

## Naming Convention

All release assets follow: `mdownreview-{version}-{os}-{arch}.{ext}`

- Lowercase, dash-separated
- OS: `windows`, `macos`
- Arch: `x64`, `arm64`

## Release Artifacts

Per release tag, the following assets are uploaded:

| Asset | Description |
|---|---|
| `mdownreview-{ver}-windows-x64.zip` | NSIS setup.exe in a zip (download + updater) |
| `mdownreview-{ver}-windows-x64.zip.sig` | Updater signature |
| `mdownreview-{ver}-windows-arm64.zip` | NSIS setup.exe in a zip (download + updater) |
| `mdownreview-{ver}-windows-arm64.zip.sig` | Updater signature |
| `mdownreview-{ver}-macos-arm64.dmg` | macOS disk image (human download) |
| `mdownreview-{ver}-macos-arm64.app.tar.gz` | macOS updater bundle |
| `mdownreview-{ver}-macos-arm64.app.tar.gz.sig` | macOS updater signature |
| `latest.json` | Tauri updater manifest |

The Windows `.zip` serves double duty: users download and extract it to run the installer; the Tauri updater downloads and extracts it to apply updates. This avoids duplicating the NSIS bundle.

For macOS, the DMG and `.app.tar.gz` remain separate because the Tauri updater cannot process a DMG.

## Build Matrix

### Release Workflow (`.github/workflows/release.yml`)

Three matrix entries:

| Runner | Rust Target | Tauri Build Args | Output |
|---|---|---|---|
| `windows-latest` | `x86_64-pc-windows-msvc` | (none) | NSIS zip + sig |
| `windows-latest` | `aarch64-pc-windows-msvc` | `--target aarch64-pc-windows-msvc` | NSIS zip + sig |
| `macos-latest` | `aarch64-apple-darwin` | (none) | DMG + app.tar.gz + sig |

Windows ARM64 is cross-compiled on the `windows-latest` runner using `rustup target add aarch64-pc-windows-msvc`.

**Post-build rename step:** Each matrix entry renames Tauri's default output files to the consistent naming convention before uploading to the GitHub Release.

**Path handling:** Native builds output to `src-tauri/target/release/bundle/`. Cross-compiled ARM64 builds output to `src-tauri/target/aarch64-pc-windows-msvc/release/bundle/`. The matrix includes per-entry `target_dir` fields.

### CI Workflow (`.github/workflows/ci.yml`)

Same 3-entry matrix, producing identically named artifacts for CI verification. Artifacts are uploaded with `actions/upload-artifact` (14-day retention), not to a GitHub Release.

### Updater Manifest (`latest.json`)

References the consistently named updater artifacts:

```json
{
  "version": "0.2.6",
  "platforms": {
    "windows-x86_64": {
      "signature": "...",
      "url": "https://github.com/dryotta/mdownreview/releases/download/v0.2.6/mdownreview-0.2.6-windows-x64.zip"
    },
    "windows-aarch64": {
      "signature": "...",
      "url": "https://github.com/dryotta/mdownreview/releases/download/v0.2.6/mdownreview-0.2.6-windows-arm64.zip"
    },
    "darwin-aarch64": {
      "signature": "...",
      "url": "https://github.com/dryotta/mdownreview/releases/download/v0.2.6/mdownreview-0.2.6-macos-arm64.app.tar.gz"
    }
  }
}
```

## Install Scripts

### Shell Script (`site/install.sh`)

For macOS. Hosted on GitHub Pages at `https://dryotta.github.io/mdownreview/install.sh`.

**Usage:**
```bash
curl -LsSf https://dryotta.github.io/mdownreview/install.sh | sh
```

**Behavior:**
1. Detect architecture via `uname -m` (only `arm64` supported; exits with message for others)
2. Fetch latest release tag from `https://api.github.com/repos/dryotta/mdownreview/releases/latest`
3. Download `mdownreview-{ver}-macos-arm64.dmg` to a temp directory
4. Mount DMG via `hdiutil attach`
5. Copy `.app` bundle to `~/Applications/` (creates directory if needed)
6. Unmount DMG via `hdiutil detach`
7. Clean up temp files
8. Print success message

**Error handling:** Validates HTTP status codes, checks for expected files, prints clear messages on failure, cleans up temp on exit (trap).

### PowerShell Script (`site/install.ps1`)

For Windows. Hosted on GitHub Pages at `https://dryotta.github.io/mdownreview/install.ps1`.

**Usage:**
```powershell
powershell -ExecutionPolicy ByPass -c "irm https://dryotta.github.io/mdownreview/install.ps1 | iex"
```

**Behavior:**
1. Detect architecture via `[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture` → maps `X64` to `x64`, `Arm64` to `arm64`
2. Fetch latest release tag from GitHub API
3. Download `mdownreview-{ver}-windows-{arch}.zip` to temp directory
4. Extract zip using `Expand-Archive`
5. Run the NSIS setup.exe with `/S` flag (silent install, current-user mode)
6. Clean up temp files
7. Print success message

**Error handling:** Uses `try/catch`, validates downloads, checks installer exit code.

## Site Updates

### `site/index.html`

Add a "Quick Install" section above the existing "Build from source" section:

```html
<section class="install">
  <h2>Quick Install</h2>
  <p><strong>macOS</strong></p>
  <pre><code>curl -LsSf https://dryotta.github.io/mdownreview/install.sh | sh</code></pre>
  <p><strong>Windows</strong></p>
  <pre><code>powershell -ExecutionPolicy ByPass -c "irm https://dryotta.github.io/mdownreview/install.ps1 | iex"</code></pre>
</section>
```

## Files Changed

| File | Change |
|---|---|
| `.github/workflows/release.yml` | New 3-entry build matrix, rename step, unified zip artifacts, updated latest.json generation |
| `.github/workflows/ci.yml` | Matching 3-entry build matrix with consistent artifact naming |
| `site/install.sh` | New macOS shell install script |
| `site/install.ps1` | New Windows PowerShell install script |
| `site/index.html` | Add Quick Install section |

## Testing

- **Workflow validation:** Push to a test branch with a tag to verify the release workflow produces correctly named artifacts
- **Install scripts:** Manual testing on macOS (ARM64) and Windows (x64 + ARM64 if available)
- **Updater:** Verify `latest.json` is correctly generated and the Tauri updater can fetch updates from the new URLs
- Existing `cargo test`, `npm test`, and `npm run test:e2e` remain unaffected (no source code changes)
