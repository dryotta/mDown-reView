---
tags: [signing, updater, tauri-v2, build-system]
source: Tauri v2 official documentation (https://v2.tauri.app/), summarised
---

# Tauri v2 Code Signing & Updater

Project-agnostic audit checklist for code-signing and the `tauri-plugin-updater` distribution chain. Cite a rule by its `<rule-id>`.

> **Scope:** per-platform code-signing config (`bundle.macOS`, `bundle.windows`), notarization, the `plugins.updater.pubkey` / `endpoints` / `latest.json` triangle, signature artefacts (`.sig`), install modes. Network-level CSP, IPC bounds, and renderer XSS posture are out of scope (see `tauri-security-expert`).
>
> **References:** [Sign macOS](https://v2.tauri.app/distribute/sign/macos/), [Sign Windows](https://v2.tauri.app/distribute/sign/windows/), [Updater](https://v2.tauri.app/plugin/updater/), [DMG distribution](https://v2.tauri.app/distribute/dmg/), [macOS App Bundle](https://v2.tauri.app/distribute/macos-application-bundle/).

## macOS signing — `sign-mac-*`

### `sign-mac-identity-explicit`

`bundle.macOS.signingIdentity` is the canonical knob. Three valid values:

| Value | When to use |
|---|---|
| `"-"` | Ad-hoc signature. App launches on Apple Silicon when users clear `com.apple.quarantine`. Acceptable for OSS apps that don't pay for a Developer ID. |
| `"Developer ID Application: Name (TEAMID)"` | Full Developer ID — required for Gatekeeper-without-quarantine and for notarization. |
| `null` / unset | Falls back to `APPLE_SIGNING_IDENTITY` env var. Acceptable in CI, **never** in committed config without a documented env-var contract. |

A blank/null identity *and* missing env var produces an unsigned `.app`. macOS refuses to launch it on first download with a generic "is damaged and can't be opened" dialog — no actionable diagnostic, no log line. CI MUST verify post-build.

### `sign-mac-verify-in-ci`

Every macOS release pipeline MUST run a verification step after `tauri build`:

```sh
codesign -dv --verbose=4 "<path>.app" 2>&1 | grep -E 'Signature=adhoc|Authority='
codesign -dv --verbose=4 "<path>.app/Contents/MacOS/<embedded-binary>" 2>&1 | grep -E 'Signature=adhoc|Authority='
```

Embedded sidecar binaries must be signed with the **same** posture as the outer bundle — Gatekeeper rejects an ad-hoc bundle whose embedded CLI is not also ad-hoc, and rejects a Developer-ID bundle whose embedded binary is unsigned.

### `sign-mac-keychain-import-in-ci`

Importing the Developer ID `.p12` certificate in CI requires four secrets: `APPLE_CERTIFICATE` (base64 of the .p12), `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`, and the resolved `APPLE_SIGNING_IDENTITY`. The canonical sequence is:

```sh
echo "$APPLE_CERTIFICATE" | base64 --decode > certificate.p12
security create-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
security default-keychain -s build.keychain
security unlock-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
security set-keychain-settings -t 3600 -u build.keychain
security import certificate.p12 -k build.keychain -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" build.keychain
```

The `set-key-partition-list` step is **mandatory** on macOS 10.12+ — without it `codesign` prompts for the keychain password, which hangs CI silently. Pin the keychain timeout (`-t 3600`) to bound the credential lifetime.

### `sign-mac-notarize-when-distributing`

For Developer ID distribution outside the App Store, signing is necessary but not sufficient — the bundle MUST be notarized with `xcrun notarytool` and stapled with `xcrun stapler staple`. Tauri delegates notarization to env vars:

- App Store Connect API: `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH` (preferred — no 2FA flakiness).
- Apple ID: `APPLE_ID`, `APPLE_PASSWORD` (app-specific password), `APPLE_TEAM_ID`.

Skipping notarization ships a Developer-ID-signed app that triggers Gatekeeper "developer cannot be verified" on first launch — confusing for end users and indistinguishable from a malware warning. If the project deliberately ships ad-hoc instead of notarized, the README/install docs MUST document the `xattr -dr com.apple.quarantine` workaround.

### `sign-mac-hardened-runtime-with-developer-id`

Notarization REQUIRES `bundle.macOS.hardenedRuntime: true` (the Tauri default). Disabling it produces a Developer-ID-signed bundle that notarization rejects. Only flip to `false` for unsigned local debug builds.

## Windows signing — `sign-win-*`

### `sign-win-thumbprint-canonical`

Tauri-native Windows signing uses three keys in `bundle.windows`:

```json
{
  "certificateThumbprint": "A1B1A2B2A3B3A4B4A5B5A6B6A7B7A8B8A9B9A0B0",
  "digestAlgorithm": "sha256",
  "timestampUrl": "http://timestamp.digicert.com"
}
```

The thumbprint is a hex string from the cert's "Thumbprint" detail field — **no spaces, no colons, no leading `0x`**. A space-separated form (Windows certmgr displays it that way) compiles but `signtool` rejects it at runtime.

### `sign-win-digest-sha256-only`

`digestAlgorithm` MUST be `"sha256"` for any cert issued in 2017 or later. SHA-1 was deprecated by Microsoft for code-signing in 2016; many timestamp servers refuse it. SHA-256 is the only correct choice.

### `sign-win-timestamp-url-required`

`timestampUrl` is **mandatory** for production releases. Without it, the signature stops being valid the day the certificate expires — even on already-installed copies of the app, SmartScreen will start warning. With a timestamp, signatures remain valid past cert expiry. Pick a timestamp server from the cert issuer's documentation; the `tsp: true` flag enables RFC 3161 timestamping for cross-vendor compatibility.

### `sign-win-azure-key-vault-via-sign-command`

Cloud HSM signing (Azure Key Vault, AWS KMS, EV cert with hardware token) cannot use the thumbprint flow. Instead, set `bundle.windows.signCommand` to a custom command:

```json
{
  "signCommand": "azuresigntool sign -kvu %1 -kvi %2 -kvs %3 -kvc %4 -tr %5 -td sha256 %f"
}
```

`%f` is substituted with the file to sign. `signCommand` overrides the thumbprint flow entirely; setting both is a configuration error — flag it.

### `sign-win-fips-flag`

If the host repo's compliance posture requires FIPS-validated MSI bundles, set `TAURI_BUNDLER_WIX_FIPS_COMPLIANT=true` in the build environment. This is a build-environment flag, not a config key — it has to be present at the `tauri build` step.

## Updater — `updater-*`

### `updater-key-pair-generation`

The Tauri updater requires a minisign keypair generated by `tauri signer generate -w <path>`. The pair has two halves with strict roles:

- **Public key** — embedded in `plugins.updater.pubkey`. Safe to commit; safe to ship.
- **Private key** — used at build time to sign update bundles. Set via `TAURI_SIGNING_PRIVATE_KEY` (path or content) and optionally `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. **NEVER commit. Never log.** A leaked private key forces a coordinated public-key rotation and breaks every existing install's update path.

### `updater-pubkey-content-not-path`

`plugins.updater.pubkey` MUST be the *content* of the public key (a base64 string after the `untrusted comment:` line — Tauri accepts either the raw base64 or the full file contents). Setting it to a file path (`"./pubkey.pem"`) compiles but fails at runtime with a parse error on the first update check. Embed the value verbatim.

### `updater-endpoints-https-only`

`plugins.updater.endpoints` MUST be HTTPS in production. Tauri enforces TLS in release builds; the `dangerousInsecureTransportProtocol: true` escape hatch is for local testing only. If a workflow templates an endpoint from a variable, validate the HTTPS prefix at build time.

### `updater-endpoint-templating`

Endpoint URLs may interpolate `{{current_version}}`, `{{target}}` (`linux`/`windows`/`darwin`), and `{{arch}}` (`x86_64`/`i686`/`aarch64`/`armv7`). Use these to pin a static manifest per-platform — server-side dynamic versioning is rarely worth the complexity for a viewer/CLI app. Multiple endpoints fall through on non-2xx; the order matters.

### `updater-create-artifacts-flag`

`bundle.createUpdaterArtifacts` MUST be `true` (or `"v1Compatible"` during migration). With the flag off, `tauri build` does not emit `.sig` files. Symptoms when missing:

- The published `latest.json` references signatures that don't exist.
- Every client hits "signature verification failed" on update check.
- The release CI's `gh release upload ... .sig` step finds no files and silently skips (or fails, depending on the script).

The `"v1Compatible"` value is **temporary** — it is removed in v3, so leave a `// TODO migrate to true` only when v1 clients are still in the field.

### `updater-artifacts-per-platform`

The artefacts produced by an updater-enabled build are platform-specific:

| Platform | Updater artefact | Signature file | Notes |
|---|---|---|---|
| Linux | `myapp.AppImage` | `myapp.AppImage.sig` | The standard AppImage doubles as the updater bundle. |
| macOS | `myapp.app.tar.gz` | `myapp.app.tar.gz.sig` | The DMG is **not** the updater bundle — clients download the tar.gz and replace the `.app` in place. |
| Windows | `myapp-setup.exe` *or* `myapp.msi` | `*.sig` | The installer doubles as the updater bundle; the `installMode` config controls install behaviour. |

Shipping a release that publishes only the DMG (no `.app.tar.gz`) breaks macOS auto-updates silently — clients see "no update available". Verify all three platform artefacts are present before publishing the manifest.

### `updater-manifest-schema`

The static manifest (`latest.json` or equivalent) follows a strict schema:

```json
{
  "version": "1.2.3",
  "notes": "...",
  "pub_date": "2026-01-01T00:00:00Z",
  "platforms": {
    "windows-x86_64":  { "signature": "...", "url": "..." },
    "windows-aarch64": { "signature": "...", "url": "..." },
    "darwin-aarch64":  { "signature": "...", "url": "..." },
    "darwin-x86_64":   { "signature": "...", "url": "..." },
    "linux-x86_64":    { "signature": "...", "url": "..." }
  }
}
```

Required: `version`, every shipped `platforms[].url`, every shipped `platforms[].signature`. Optional: `notes`, `pub_date` (RFC 3339). The `signature` MUST be the *content* of the `.sig` file (the base64 line after `untrusted comment:`), not a URL. Tauri validates **the whole manifest** before checking version — a malformed entry for one platform breaks updates on *all* platforms.

### `updater-platform-keys-naming`

Platform keys are `<os>-<arch>` where `os ∈ {linux, darwin, windows}` and `arch ∈ {x86_64, i686, aarch64, armv7}`. Common mistakes:

- `"macos-arm64"` — wrong (use `darwin-aarch64`).
- `"windows-arm64"` — wrong (use `windows-aarch64`).
- `"darwin-arm64"` — wrong (use `darwin-aarch64`).
- `"linux-x64"` — wrong (use `linux-x86_64`).

A typo silently makes that platform invisible to the updater (clients see "no update available"). The matching is exact.

### `updater-windows-install-mode`

`plugins.updater.windows.installMode` is one of:

- `"passive"` (default) — small progress window, no user interaction. Generally recommended.
- `"basicUi"` — full installer UI, requires user clicks.
- `"quiet"` — no UI; works only when the app already runs as admin or is a per-user install. Generally avoid.

A mismatch between `bundle.windows.nsis.installMode` and `plugins.updater.windows.installMode` is OK — they serve different phases — but a `quiet` updater paired with a `perMachine` install fails silently when the user lacks admin.

### `updater-private-key-env-not-dotenv`

`TAURI_SIGNING_PRIVATE_KEY` MUST be set as a real environment variable, not via a `.env` file. Tauri's loader explicitly does **not** read dotenv files for signing keys (this is documented). A `.env`-only setup produces unsigned bundles in CI with no clear error.

### `updater-build-time-and-publish-time-coherent`

The `.sig` file generated by `tauri build` is regenerated on every build — it is not deterministic. A pipeline that builds artefacts in one job and publishes the manifest from a different job MUST upload the `.sig` files alongside the artefacts and read them back when generating the manifest (canonical pattern: download the `.sig` from the release before constructing `latest.json`). Computing the manifest from a stale `.sig` produces a verification failure on every client.

### `updater-pre-flight-asset-presence`

Before publishing the updater manifest, verify that *every* updater asset exists in the release. Canonical assertion (one per platform):

```sh
gh release view "$TAG" --json assets --jq ".assets[].name" | grep -q "^${ASSET_NAME}\$"
```

Skipping the assertion ships a manifest that points to non-existent URLs. Clients see "Failed to download update" with no path forward.

## DMG / installer-window — `dmg-*`

### `dmg-applications-symlink-required`

A DMG distribution flow MUST verify the Applications symlink exists in the mounted DMG. The standard Tauri DMG layout puts the `.app` and an `Applications →` symlink side-by-side; an absent symlink ships a DMG where users cannot drag-install. CI verification:

```sh
hdiutil attach -nobrowse -readonly "<path>.dmg"
[ -L "/Volumes/<name>/Applications" ] || exit 1
hdiutil detach "/Volumes/<name>" -force
```

Tauri's `bundle_dmg.sh` is known to flake (tauri-apps/tauri#3055) — wrap the build in a 2-attempt retry that detaches stale mounts and removes half-written DMGs between attempts.

### `dmg-background-windowsize-coherent`

If `bundle.macOS.dmg.background` is set, `bundle.macOS.dmg.windowSize` MUST be sized to match the background image. A 1024×640 background with the default 660×400 window crops the image. The default appPosition `(180, 170)` and applicationFolderPosition `(480, 170)` are calibrated for the 660×400 default — recalibrate when changing windowSize.
