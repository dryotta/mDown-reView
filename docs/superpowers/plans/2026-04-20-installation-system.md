# Installation System Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the release/CI pipeline to produce consistently named artifacts with OS+arch labels, add Windows ARM64 builds, and provide `curl | sh` / `irm | iex` install scripts.

**Architecture:** GitHub Actions workflows are updated to a 3-entry build matrix (win-x64, win-arm64, mac-arm64) with a post-build rename step. Install scripts hosted on GitHub Pages detect platform and download from GitHub Releases. The Tauri updater continues to work via renamed `.nsis.zip` and `.app.tar.gz` artifacts referenced by `latest.json`.

**Tech Stack:** GitHub Actions, Tauri v2 bundler, NSIS, Bash, PowerShell, GitHub Pages

**Spec:** `docs/superpowers/specs/2026-04-20-installation-system-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `.github/workflows/release.yml` | Modify | 3-entry build matrix, rename step, updated latest.json |
| `.github/workflows/ci.yml` | Modify | 3-entry build matrix matching release |
| `site/install.sh` | Create | macOS shell install script |
| `site/install.ps1` | Create | Windows PowerShell install script |
| `site/index.html` | Modify | Add Quick Install section |

---

### Task 1: Update release.yml build matrix and artifact upload

**Files:**
- Modify: `.github/workflows/release.yml:39-106`

The current `build` job has a 2-entry matrix (windows-latest, macos-latest) that uploads Tauri's default-named artifacts. Replace it with a 3-entry matrix that:
1. Adds per-entry fields: `name`, `rust_target`, `target_dir`, `tauri_args`
2. Adds Windows ARM64 entry with `--target aarch64-pc-windows-msvc`
3. Renames Tauri output to `mdownreview-{ver}-{os}-{arch}.{ext}` before upload
4. Removes the old extension-wide delete logic (replaced by exact-name `--clobber`)

Tauri default output filenames (productName `mdownreview`, version `0.2.6`):
- Windows x64: `src-tauri/target/release/bundle/nsis/mdownreview_0.2.6_x64.nsis.zip`
- Windows ARM64: `src-tauri/target/aarch64-pc-windows-msvc/release/bundle/nsis/mdownreview_0.2.6_arm64.nsis.zip`
- macOS ARM64 DMG: `src-tauri/target/release/bundle/dmg/mdownreview_0.2.6_aarch64.dmg`
- macOS ARM64 updater: `src-tauri/target/release/bundle/macos/mdownreview.app.tar.gz`

- [ ] **Step 1: Replace the build job**

Replace lines 39–106 of `.github/workflows/release.yml` (the entire `build:` job) with:

```yaml
  build:
    needs: create-release
    name: Build (${{ matrix.name }})
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: windows-latest
            name: windows-x64
            rust_target: x86_64-pc-windows-msvc
            target_dir: src-tauri/target/release
            tauri_args: ""
          - os: windows-latest
            name: windows-arm64
            rust_target: aarch64-pc-windows-msvc
            target_dir: src-tauri/target/aarch64-pc-windows-msvc/release
            tauri_args: "--target aarch64-pc-windows-msvc"
          - os: macos-latest
            name: macos-arm64
            rust_target: aarch64-apple-darwin
            target_dir: src-tauri/target/release
            tauri_args: ""
    runs-on: ${{ matrix.os }}
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

      - name: Rename and upload artifacts
        shell: bash
        run: |
          TAG="${{ needs.create-release.outputs.tag }}"
          VERSION="${TAG#v}"
          NAME="mdownreview-${VERSION}-${{ matrix.name }}"

          if [[ "${{ matrix.name }}" == windows-* ]]; then
            # Rename the NSIS zip (serves as both download and updater artifact)
            nsis_zip=$(ls -t ${{ matrix.target_dir }}/bundle/nsis/*.nsis.zip 2>/dev/null | head -1)
            [ -z "$nsis_zip" ] && { echo "::error::NSIS zip not found"; exit 1; }
            cp "$nsis_zip" "${NAME}.zip"
            gh release upload "$TAG" "${NAME}.zip" --clobber

            # Upload the signature file with matching name
            sig="${nsis_zip}.sig"
            if [ -f "$sig" ]; then
              cp "$sig" "${NAME}.zip.sig"
              gh release upload "$TAG" "${NAME}.zip.sig" --clobber
            fi
          else
            # Rename the DMG for human download
            dmg=$(ls -t ${{ matrix.target_dir }}/bundle/dmg/*.dmg 2>/dev/null | head -1)
            [ -z "$dmg" ] && { echo "::error::DMG not found"; exit 1; }
            cp "$dmg" "${NAME}.dmg"
            gh release upload "$TAG" "${NAME}.dmg" --clobber

            # Rename the .app.tar.gz updater bundle
            app_tar=$(ls -t ${{ matrix.target_dir }}/bundle/macos/*.app.tar.gz 2>/dev/null | head -1)
            if [ -n "$app_tar" ]; then
              cp "$app_tar" "${NAME}.app.tar.gz"
              gh release upload "$TAG" "${NAME}.app.tar.gz" --clobber
              sig="${app_tar}.sig"
              if [ -f "$sig" ]; then
                cp "$sig" "${NAME}.app.tar.gz.sig"
                gh release upload "$TAG" "${NAME}.app.tar.gz.sig" --clobber
              fi
            fi
          fi
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Verify YAML syntax**

Run: `python -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"`
Expected: No output (success). If Python yaml module isn't available, use: `npx yaml-lint .github/workflows/release.yml` or visually inspect indentation.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: update release build matrix with consistent naming and ARM64

- 3-entry matrix: windows-x64, windows-arm64, macos-arm64
- Rename Tauri artifacts to mdownreview-{ver}-{os}-{arch}.{ext}
- Windows .nsis.zip serves as both download and updater artifact
- Remove extension-wide asset deletion, use --clobber instead"
```

---

### Task 2: Update release.yml latest.json manifest generation

**Files:**
- Modify: `.github/workflows/release.yml:108-170` (the `publish-update-manifest` job)

The `latest.json` generation must reference the new consistently named files and add `windows-aarch64`.

- [ ] **Step 1: Replace the latest.json generation step**

Replace the `Build and upload latest.json` step content (lines ~114-168) with:

```yaml
      - name: Build and upload latest.json
        shell: bash
        run: |
          TAG="${{ needs.create-release.outputs.tag }}"
          VERSION="${TAG#v}"
          BASE_URL="https://github.com/dryotta/mdownreview/releases/download/${TAG}"
          NAME="mdownreview-${VERSION}"

          mkdir -p /tmp/sigs

          # Read signature file content from a release asset
          read_sig() {
            local asset_name="$1"
            gh release download "$TAG" --pattern "${asset_name}" --dir /tmp/sigs 2>/dev/null || true
            cat "/tmp/sigs/${asset_name}" 2>/dev/null || echo ""
          }

          WIN_X64_SIG=$(read_sig "${NAME}-windows-x64.zip.sig")
          WIN_ARM64_SIG=$(read_sig "${NAME}-windows-arm64.zip.sig")
          MAC_ARM64_SIG=$(read_sig "${NAME}-macos-arm64.app.tar.gz.sig")

          PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

          cat > /tmp/latest.json <<EOF
          {
            "version": "${VERSION}",
            "notes": "See release notes on GitHub.",
            "pub_date": "${PUB_DATE}",
            "platforms": {
              "windows-x86_64": {
                "signature": "${WIN_X64_SIG}",
                "url": "${BASE_URL}/${NAME}-windows-x64.zip"
              },
              "windows-aarch64": {
                "signature": "${WIN_ARM64_SIG}",
                "url": "${BASE_URL}/${NAME}-windows-arm64.zip"
              },
              "darwin-aarch64": {
                "signature": "${MAC_ARM64_SIG}",
                "url": "${BASE_URL}/${NAME}-macos-arm64.app.tar.gz"
              }
            }
          }
          EOF

          gh release upload "$TAG" /tmp/latest.json --clobber
```

- [ ] **Step 2: Verify YAML syntax**

Run: `python -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"`
Expected: No output (success).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: update latest.json manifest for new naming and ARM64

- Reference renamed artifacts by exact name (no glob matching)
- Add windows-aarch64 platform entry
- Simpler sig reading via exact filename download"
```

---

### Task 3: Update CI workflow build matrix

**Files:**
- Modify: `.github/workflows/ci.yml:92-146`

Mirror the release workflow's 3-entry build matrix for CI. CI uploads artifacts to `actions/upload-artifact` instead of a GitHub Release.

- [ ] **Step 1: Replace the build job**

Replace lines 92–146 of `.github/workflows/ci.yml` (the entire `build:` job) with:

```yaml
  # ── Installer builds (Windows + macOS) ───────────────────────────────────
  # Runs in parallel with the test job above.
  build:
    name: Build (${{ matrix.name }})
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
            artifact_ext: zip

          - os: windows-latest
            name: windows-arm64
            rust_target: aarch64-pc-windows-msvc
            target_dir: src-tauri/target/aarch64-pc-windows-msvc/release
            tauri_args: "--target aarch64-pc-windows-msvc"
            artifact_ext: zip

          - os: macos-latest
            name: macos-arm64
            rust_target: aarch64-apple-darwin
            target_dir: src-tauri/target/release
            tauri_args: ""
            artifact_ext: dmg

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

      - name: Package artifact
        shell: bash
        run: |
          NAME="mdownreview-${{ matrix.name }}"
          if [[ "${{ matrix.artifact_ext }}" == "zip" ]]; then
            nsis_zip=$(ls -t ${{ matrix.target_dir }}/bundle/nsis/*.nsis.zip 2>/dev/null | head -1)
            [ -z "$nsis_zip" ] && { echo "::error::NSIS zip not found"; exit 1; }
            cp "$nsis_zip" "${NAME}.zip"
            echo "ARTIFACT=${NAME}.zip" >> "$GITHUB_ENV"
          else
            dmg=$(ls -t ${{ matrix.target_dir }}/bundle/dmg/*.dmg 2>/dev/null | head -1)
            [ -z "$dmg" ] && { echo "::error::DMG not found"; exit 1; }
            cp "$dmg" "${NAME}.dmg"
            echo "ARTIFACT=${NAME}.dmg" >> "$GITHUB_ENV"
          fi

      - name: Upload installer artifact
        uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.name }}
          path: ${{ env.ARTIFACT }}
          retention-days: 14
```

- [ ] **Step 2: Verify YAML syntax**

Run: `python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`
Expected: No output (success).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: update CI build matrix to match release naming

- 3-entry matrix: windows-x64, windows-arm64, macos-arm64
- Rename artifacts to mdownreview-{os}-{arch}.{ext} (no version in CI)
- Upload via actions/upload-artifact with 14-day retention"
```

---

### Task 4: Create macOS install script

**Files:**
- Create: `site/install.sh`

Shell script for `curl -LsSf https://dryotta.github.io/mdownreview/install.sh | sh`. Detects macOS ARM64, downloads DMG from latest GitHub Release, mounts it, copies .app to ~/Applications.

- [ ] **Step 1: Create `site/install.sh`**

```bash
#!/bin/sh
set -eu

APP_NAME="mdownreview"
GITHUB_REPO="dryotta/mdownreview"
INSTALL_DIR="$HOME/Applications"

main() {
  need_cmd curl
  need_cmd hdiutil
  need_cmd cp
  need_cmd rm
  need_cmd mktemp

  # Only macOS is supported
  OS="$(uname -s)"
  case "$OS" in
    Darwin) ;;
    *) err "This script only supports macOS. For Windows, use install.ps1." ;;
  esac

  # Detect architecture
  ARCH="$(uname -m)"
  case "$ARCH" in
    arm64)  ARCH_LABEL="arm64" ;;
    x86_64) ARCH_LABEL="arm64" ; say "Note: Intel Mac detected. Installing ARM64 build (runs via Rosetta 2)." ;;
    *) err "Unsupported architecture: $ARCH" ;;
  esac

  say "Fetching latest release..."
  TAG=$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" \
    | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
  [ -z "$TAG" ] && err "Could not determine latest release tag."
  VERSION="${TAG#v}"

  FILENAME="${APP_NAME}-${VERSION}-macos-${ARCH_LABEL}.dmg"
  URL="https://github.com/${GITHUB_REPO}/releases/download/${TAG}/${FILENAME}"

  TMPDIR_INSTALL="$(mktemp -d)"
  trap 'cleanup' EXIT

  say "Downloading ${FILENAME}..."
  curl -fSL --progress-bar -o "${TMPDIR_INSTALL}/${FILENAME}" "$URL"

  say "Mounting disk image..."
  MOUNT_POINT=$(hdiutil attach -nobrowse -readonly "${TMPDIR_INSTALL}/${FILENAME}" \
    | grep '/Volumes/' | sed 's/.*\(\/Volumes\/.*\)/\1/')
  [ -z "$MOUNT_POINT" ] && err "Failed to mount DMG."

  APP_PATH=$(find "$MOUNT_POINT" -maxdepth 1 -name "*.app" | head -1)
  [ -z "$APP_PATH" ] && { hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true; err "No .app found in DMG."; }

  mkdir -p "$INSTALL_DIR"
  APP_BASENAME="$(basename "$APP_PATH")"

  # Remove existing installation if present
  if [ -d "${INSTALL_DIR}/${APP_BASENAME}" ]; then
    say "Removing previous installation..."
    rm -rf "${INSTALL_DIR}/${APP_BASENAME}"
  fi

  say "Installing to ${INSTALL_DIR}/${APP_BASENAME}..."
  cp -R "$APP_PATH" "$INSTALL_DIR/"

  hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true

  say ""
  say "✓ ${APP_NAME} ${VERSION} installed to ${INSTALL_DIR}/${APP_BASENAME}"
  say "  Open it from ~/Applications or run:"
  say "    open \"${INSTALL_DIR}/${APP_BASENAME}\""
}

cleanup() {
  [ -d "${TMPDIR_INSTALL:-}" ] && rm -rf "$TMPDIR_INSTALL"
  # Attempt unmount in case of early exit
  [ -n "${MOUNT_POINT:-}" ] && hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
}

say() {
  printf '%s\n' "$@"
}

err() {
  say "error: $1" >&2
  exit 1
}

need_cmd() {
  if ! command -v "$1" > /dev/null 2>&1; then
    err "need '$1' (command not found)"
  fi
}

main "$@"
```

- [ ] **Step 2: Verify script syntax**

Run: `bash -n site/install.sh`
Expected: No output (syntax OK).

- [ ] **Step 3: Commit**

```bash
git add site/install.sh
git commit -m "feat: add macOS install script

curl -LsSf https://dryotta.github.io/mdownreview/install.sh | sh

- Detects macOS, ARM64 architecture
- Downloads latest DMG from GitHub Releases
- Mounts DMG, copies .app to ~/Applications
- Cleans up temp files on exit"
```

---

### Task 5: Create Windows PowerShell install script

**Files:**
- Create: `site/install.ps1`

PowerShell script for `irm https://dryotta.github.io/mdownreview/install.ps1 | iex`. Detects architecture, downloads zip from latest GitHub Release, extracts, runs NSIS setup silently.

- [ ] **Step 1: Create `site/install.ps1`**

```powershell
#Requires -Version 5.1
<#
.SYNOPSIS
    Installs the latest version of mdownreview on Windows.
.DESCRIPTION
    Downloads the latest mdownreview installer from GitHub Releases,
    extracts it, and runs the NSIS setup in silent mode (current-user install).
.EXAMPLE
    powershell -ExecutionPolicy ByPass -c "irm https://dryotta.github.io/mdownreview/install.ps1 | iex"
#>

$ErrorActionPreference = 'Stop'

$AppName = 'mdownreview'
$GitHubRepo = 'dryotta/mdownreview'

function Get-Architecture {
    try {
        $a = [System.Reflection.Assembly]::LoadWithPartialName("System.Runtime.InteropServices.RuntimeInformation")
        $t = $a.GetType("System.Runtime.InteropServices.RuntimeInformation")
        $p = $t.GetProperty("OSArchitecture")
        switch ($p.GetValue($null).ToString()) {
            "X64"   { return "x64" }
            "Arm64" { return "arm64" }
            default { throw "Unsupported architecture: $_" }
        }
    } catch {
        # Fallback for older PowerShell
        if ([System.Environment]::Is64BitOperatingSystem) {
            return "x64"
        } else {
            throw "Unsupported architecture: 32-bit Windows is not supported."
        }
    }
}

function Install-Mdownreview {
    Write-Host "Detecting architecture..."
    $arch = Get-Architecture
    Write-Host "  Architecture: $arch"

    Write-Host "Fetching latest release..."
    $releaseUrl = "https://api.github.com/repos/$GitHubRepo/releases/latest"
    $release = Invoke-RestMethod -Uri $releaseUrl -UseBasicParsing
    $tag = $release.tag_name
    $version = $tag.TrimStart('v')
    Write-Host "  Latest version: $version"

    $fileName = "$AppName-$version-windows-$arch.zip"
    $downloadUrl = "https://github.com/$GitHubRepo/releases/download/$tag/$fileName"

    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "$AppName-install-$(Get-Random)"
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    try {
        $zipPath = Join-Path $tempDir $fileName
        Write-Host "Downloading $fileName..."
        Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -UseBasicParsing

        Write-Host "Extracting..."
        Expand-Archive -Path $zipPath -DestinationPath $tempDir -Force

        # Find the setup exe inside the extracted files
        $setupExe = Get-ChildItem -Path $tempDir -Filter "*setup*.exe" -Recurse | Select-Object -First 1
        if (-not $setupExe) {
            $setupExe = Get-ChildItem -Path $tempDir -Filter "*.exe" -Recurse | Select-Object -First 1
        }
        if (-not $setupExe) {
            throw "No installer executable found in the downloaded archive."
        }

        Write-Host "Running installer silently..."
        $process = Start-Process -FilePath $setupExe.FullName -ArgumentList '/S' -Wait -PassThru
        if ($process.ExitCode -ne 0) {
            throw "Installer exited with code $($process.ExitCode)."
        }

        Write-Host ""
        Write-Host "Done! $AppName $version has been installed." -ForegroundColor Green
        Write-Host "  You can launch it from the Start Menu or by searching for '$AppName'."
    } finally {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Install-Mdownreview
```

- [ ] **Step 2: Verify script syntax**

Run: `powershell -NoProfile -Command "Get-Command -Syntax { . 'site\install.ps1' }" 2>&1` or simply parse: `powershell -NoProfile -Command "[System.Management.Automation.PSParser]::Tokenize((Get-Content 'site\install.ps1' -Raw), [ref]$null) | Out-Null; Write-Host 'Syntax OK'"`
Expected: "Syntax OK"

- [ ] **Step 3: Commit**

```bash
git add site/install.ps1
git commit -m "feat: add Windows PowerShell install script

powershell -ExecutionPolicy ByPass -c 'irm https://dryotta.github.io/mdownreview/install.ps1 | iex'

- Detects x64 or ARM64 architecture
- Downloads latest zip from GitHub Releases
- Extracts and runs NSIS setup.exe silently (/S flag)
- Cleans up temp files"
```

---

### Task 6: Update site landing page

**Files:**
- Modify: `site/index.html:51-58`

Add a "Quick Install" section before the existing "Build from source" section.

- [ ] **Step 1: Add Quick Install section**

Insert the following HTML before line 52 (`<section class="install">` with "Build from source"):

```html
  <section class="install">
    <h2>Quick Install</h2>
    <p><strong>macOS</strong></p>
    <pre><code>curl -LsSf https://dryotta.github.io/mdownreview/install.sh | sh</code></pre>
    <p><strong>Windows</strong></p>
    <pre><code>powershell -ExecutionPolicy ByPass -c "irm https://dryotta.github.io/mdownreview/install.ps1 | iex"</code></pre>
    <p>Or download directly from <a href="https://github.com/dryotta/mdownreview/releases/latest">GitHub Releases</a>.</p>
  </section>

```

This goes between the `</section>` closing the features section (line 50) and the existing `<section class="install">` for "Build from source" (line 52).

- [ ] **Step 2: Verify HTML renders correctly**

Open `site/index.html` in a browser and visually confirm the Quick Install section appears above Build from source.

- [ ] **Step 3: Commit**

```bash
git add site/index.html
git commit -m "docs: add Quick Install section to landing page

Shows curl|sh and irm|iex one-liner install commands
for macOS and Windows with a link to GitHub Releases."
```

---

### Task 7: Update release notes template and final verification

**Files:**
- Modify: `.github/workflows/release.yml:29-36` (release notes text)

- [ ] **Step 1: Update release notes text**

Update the `--notes` in the `create-release` job to document the new naming and install commands:

```yaml
      - name: Create draft release
        run: |
          # Skip creation if release already exists (re-run scenario)
          gh release view "${{ steps.tag.outputs.tag }}" &>/dev/null || \
          gh release create "${{ steps.tag.outputs.tag }}" \
            --draft \
            --title "mdownreview ${{ steps.tag.outputs.tag }}" \
            --notes "## Install

          **macOS**
          \`\`\`
          curl -LsSf https://dryotta.github.io/mdownreview/install.sh | sh
          \`\`\`

          **Windows**
          \`\`\`
          powershell -ExecutionPolicy ByPass -c \"irm https://dryotta.github.io/mdownreview/install.ps1 | iex\"
          \`\`\`

          Or download the installer for your platform from the Assets section below."
```

- [ ] **Step 2: Full YAML validation of both workflows**

Run:
```bash
python -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml')); yaml.safe_load(open('.github/workflows/ci.yml')); print('Both workflows valid')"
```
Expected: "Both workflows valid"

- [ ] **Step 3: Review all changed files**

Run: `git diff --stat HEAD~6` (or however many commits were made)
Expected: 5 files changed:
- `.github/workflows/release.yml`
- `.github/workflows/ci.yml`
- `site/install.sh` (new)
- `site/install.ps1` (new)
- `site/index.html`

- [ ] **Step 4: Commit release notes change**

```bash
git add .github/workflows/release.yml
git commit -m "ci: update release notes template with install commands"
```

- [ ] **Step 5: Verify existing tests still pass**

Run: `npm test`
Expected: All Vitest tests pass (no source code was changed).

Run: `cd src-tauri && cargo test`
Expected: All Rust tests pass (no Rust source code was changed).
