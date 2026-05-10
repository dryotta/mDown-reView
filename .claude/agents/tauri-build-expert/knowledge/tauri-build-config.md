---
tags: [build-system, bundle, tauri-v2]
source: Tauri v2 official documentation (https://v2.tauri.app/), summarised
---

# Tauri v2 Build Configuration

Project-agnostic audit checklist for `tauri.conf.json` (and the equivalent JSON5 / TOML formats) and the build pipeline it drives. Cite a rule by its `<rule-id>`. Rule IDs are stable; the file path is local to whichever agent has bundled this knowledge.

> **Scope:** Tauri v2 only — `bundle`, `build`, `app.security`, capability/permission build-time wiring, sidecar (`externalBin`), resources, file associations. Runtime IPC/event correctness lives in `tauri-v2-patterns.md` (used by `tauri-coding-expert` and `tauri-architect-expert`).
>
> **References:** [`tauri.conf.json` reference](https://v2.tauri.app/reference/config/), [Distribute](https://v2.tauri.app/distribute/), [Sidecar](https://v2.tauri.app/develop/sidecar/), [Resources](https://v2.tauri.app/develop/resources/), [Capabilities](https://v2.tauri.app/security/capabilities/), [Configuration files](https://v2.tauri.app/develop/configuration-files/).

## Bundle config — `bundle-*`

### `bundle-active-on-when-shipping`

`bundle.active` defaults to `false`. A release build with `active: false` produces only the binary — no `.app`, `.dmg`, `.msi`, `.nsis.zip`, `.AppImage`, etc. Releases that ship installers MUST set `bundle.active: true`. CI logs that say "build succeeded" but produce no installer are usually this rule violated.

### `bundle-targets-explicit`

`bundle.targets` defaults to `"all"`, which expands per-platform. Pin to an explicit array (e.g. `["app", "dmg", "nsis"]`) when you know which formats you actually ship. `"all"` causes:

- Linux builds to produce AppImage + Deb + RPM even if only one is distributed (~30 MB wasted, minutes of CI).
- Windows builds to produce both MSI (WiX) and NSIS, which is rarely intended.

Drift between `bundle.targets` and the actual download links published in your release notes is a documentation-vs-code bug; flag it.

### `bundle-identifier-stable`

`identifier` (top-level, reverse-DNS, e.g. `com.example.myapp`) is the bundle ID on macOS, the application ID on Windows installer, and the WebView data-dir name. **It MUST NOT change between releases** — changing it makes existing installs fail to upgrade, leaks WebView data, and on macOS produces a separate Dock icon. The only legitimate change is when shipping a deliberately separate flavour (e.g. `com.example.myapp.beta`) via a `tauri.<env>.conf.json` overlay or the `--config` CLI flag.

### `bundle-version-single-source-of-truth`

The app version is read from `tauri.conf.json > version`, falling back to `Cargo.toml > [package].version` when unset. Pick **one** source — never set both with different values. CI workflows that mutate one without the other silently ship installers labelled with the wrong version. A canary/preview workflow that patches both files is fine *only* if the two writes are atomic (same step, same matrix entry).

### `bundle-icon-paths-resolve`

Every entry in `bundle.icon` is read at build time. A missing path aborts the build with a misleading error. The list MUST contain at least one platform-appropriate entry per shipped target — `.icns` for macOS, `.ico` for Windows, PNGs at multiple resolutions for Linux. Don't ship placeholder 1×1-pixel icons; macOS Finder refuses to display them.

### `bundle-file-associations-ext-no-dot`

`bundle.fileAssociations[].ext` strips a leading `.` automatically, but the schema is permissive and tooling that round-trips the value (e.g. shell scripts that grep the config) breaks on the dotted form. Canonical: `["md", "mdx"]`, never `[".md", ".mdx"]`.

### `bundle-macos-signing-identity-explicit`

`bundle.macOS.signingIdentity` MUST be set when shipping macOS bundles outside the App Store. Acceptable values:

- `"-"` — ad-hoc signature (works on Apple Silicon for users who clear quarantine; the right call for OSS apps that don't pay for a Developer ID).
- `"Developer ID Application: Name (TEAMID)"` — full Developer ID certificate.
- `null`/unset → falls back to the `APPLE_SIGNING_IDENTITY` env var.

Leaving the field `null` and forgetting the env var produces an unsigned `.app` that macOS refuses to launch on first download with no actionable diagnostic. CI MUST verify post-build with `codesign -dv --verbose=4 <path>.app 2>&1 | grep -q 'Signature=adhoc'` (or `Authority=`), and verify the embedded sidecar binaries the same way — Gatekeeper rejects bundles whose embedded binaries are unsigned even if the outer bundle is signed.

### `bundle-macos-entitlements-when-needed`

`bundle.macOS.entitlements` is required when the app uses sandbox-restricted capabilities (camera, microphone, `app-sandbox`). A missing entitlements file with a sandboxed API call is a runtime crash on first invocation. Each entitlement key MUST appear with the correct value type (`<true/>`, `<string>...</string>`); a misspelled key is silently ignored.

### `bundle-macos-hardened-runtime`

`bundle.macOS.hardenedRuntime` defaults to `true` and SHOULD stay `true`. Disabling it skips the runtime protections required for notarization. Only flip to `false` for local development bundles you do not ship.

### `bundle-windows-installer-mode`

`bundle.windows.nsis.installMode` is one of `currentUser` / `perMachine` / `both`:

- `currentUser` is the right default for desktop apps because it avoids the UAC prompt and writes to `%LOCALAPPDATA%`.
- `perMachine` requires admin rights and writes to Program Files; pick it only for IT-managed deployments.
- `both` lets the user choose at install time but doubles the test matrix.

### `bundle-windows-webview-install-mode`

`bundle.windows.webviewInstallMode.type` defaults to `downloadBootstrapper` (~0 MB extra, requires internet at install time). Pick deliberately:

| Mode | Extra size | Internet needed | Notes |
|---|---|---|---|
| `downloadBootstrapper` | 0 MB | yes | Default. Fine for online installs on Windows 10/11. |
| `embedBootstrapper` | ~1.8 MB | yes | Preferred for `.msi` distribution to Windows 7 (TLS-1.2 caveat). |
| `offlineInstaller` | ~127 MB | no | Required for offline / air-gapped environments. |
| `fixedRuntime` | ~180 MB | no | Pin a specific WebView2 build; managed-update environments only. |
| `skip` | 0 MB | no | **Never correct for shipping.** App silently fails to launch when WebView2 is absent. |

### `bundle-windows-msi-vs-nsis`

`.msi` (WiX) and `-setup.exe` (NSIS) are independent installer formats, not alternatives. Setting both `bundle.windows.wix` and `bundle.windows.nsis` produces *both* installers from one `tauri build`. Pick one and pin via `bundle.targets` (`["msi"]` or `["nsis"]`) unless you deliberately distribute both. NSIS supports cross-compile from Linux/macOS via `cargo-xwin`; WiX is Windows-only.

### `bundle-resources-explicit-paths`

`bundle.resources` (array or map form) copies files into the bundle's `$RESOURCE` dir. Audit the patterns:

- `"dir/"` recurses; `"dir/*"` does not. `"dir/**"` and `"dir/**/**"` are **errors** (they only match directories, not files).
- A glob with no matching files at build time silently embeds nothing — use the map form to make intent explicit when shipping a small fixed set.
- Resource files are read-only at runtime; the app SHOULD use `app.path().resolve(..., BaseDirectory::Resource)`, never a hardcoded path under `Contents/Resources` or `resources\`.

### `bundle-create-updater-artifacts-required`

`bundle.createUpdaterArtifacts` MUST be `true` (or `"v1Compatible"` during migration) when `plugins.updater.endpoints` is configured. With the flag off, `tauri build` does not produce `.sig` files, the published `latest.json` references signatures that don't exist, and every client hits "signature verification failed" on update check. The string `"v1Compatible"` is **temporary** — it will be removed in v3, so leave a `// TODO migrate to true` only if you deliberately support v1 clients in the field.

## Hooks — `hooks-*`

### `hooks-before-build-vs-before-bundle`

`build.beforeBuildCommand` runs before `tauri build` (which compiles Rust + bundles). `build.beforeBundleCommand` runs before the bundling phase only — useful for `tauri bundle` invocations that skip compilation. If your hook produces files the Rust build *needs* (e.g. a staged sidecar binary, a generated `dist/`), it MUST be the `beforeBuildCommand` (or wired into both, identically). Hooks declared only in `beforeBundleCommand` are silently skipped during full `tauri build`.

### `hooks-conditional-env-vars`

`TAURI_ENV_PLATFORM`, `TAURI_ENV_ARCH`, `TAURI_ENV_FAMILY`, `TAURI_ENV_PLATFORM_VERSION`, `TAURI_ENV_PLATFORM_TYPE`, `TAURI_ENV_DEBUG` are set inside hooks. Use them to gate platform-specific work. Hooks that shell out unconditionally and assume a host (e.g. `bash` on a Windows runner where it isn't installed) are a portability bug.

### `hooks-no-side-channel-state`

Hooks MUST be idempotent and MUST NOT mutate state that survives the build (no committing generated files, no global tool installs, no writing to `$HOME/.config`). A hook that leaves the workspace dirty silently breaks the next build — both locally and in CI cache restoration.

### `hooks-frontend-dist-must-exist`

`build.frontendDist` is a path (or URL) to the bundled web assets — typically `../dist`. The path MUST exist at the time `tauri build` runs the bundling phase. If `beforeBuildCommand` is responsible for producing it (`npm run build`), removing or skipping that hook silently produces a Tauri build that ships an empty webview.

## Sidecar / externalBin — `sidecar-*`

### `sidecar-target-triple-suffix-required`

A sidecar binary listed in `bundle.externalBin` (e.g. `"binaries/my-cli"`) MUST exist at build time as `binaries/my-cli-<TARGET_TRIPLE>` (with `.exe` on Windows). The build script's existence check aborts with `resource path "binaries/..." doesn't exist` when the suffixed file is absent. The triple is the host's by default; cross-compiles MUST stage a binary for *each* target. A CI matrix that builds for `x86_64-pc-windows-msvc` and `aarch64-pc-windows-msvc` needs both `-x86_64-pc-windows-msvc.exe` and `-aarch64-pc-windows-msvc.exe`.

### `sidecar-shell-permission-required`

Spawning a sidecar requires the `shell:allow-execute` (or `shell:allow-spawn`) permission scoped to the sidecar identifier in a capability file. Adding `externalBin` without the matching capability ships a binary that the runtime refuses to spawn — silent failure, no diagnostic in production builds.

### `sidecar-args-allowlist-or-deny`

The capability's `args` field can be `true` (any args), `false` (no args), or an explicit ordered list (literal strings or `validator` regexes). Defaulting to `true` defeats the purpose of the sidecar permission — every command-injection bug in the renderer becomes a sandbox escape. Enumerate the args.

### `sidecar-ad-hoc-sign-on-macos`

Sidecar binaries embedded under `Contents/MacOS/` MUST be signed with the same identity as the parent `.app` (or ad-hoc with `-`). Gatekeeper rejects an ad-hoc app that contains a non-ad-hoc embedded binary, and vice versa. `codesign -dv` against both the `.app` and the embedded binary is the verification step; do it in CI.

### `sidecar-staging-script-deterministic`

A staging script (typically a `stage-cli.mjs` or shell helper) that copies a pre-built sidecar to the suffixed name MUST be deterministic and idempotent — running it twice on the same workspace must produce the same result without mutating cached artefacts. Non-deterministic staging breaks `Swatinem/rust-cache@v2` and `actions/cache` restoration.

## Assets — `assets-*`

### `assets-icon-platform-coverage`

`bundle.icon` MUST contain at minimum: a `.ico` for Windows, a `.icns` for macOS, and at least one PNG for Linux. Tauri does **not** auto-generate platform icons from a single source at build time — `tauri icon <source>` does, but its output MUST be committed and listed explicitly. A build that ships only a `.icns` produces a generic Windows installer icon.

### `assets-resource-paths-no-leak`

`bundle.resources` paths are baked into the binary as relative paths under `$RESOURCE`. Don't ship absolute developer-machine paths (`/Users/alice/...`) — they leak in error messages and on macOS break bundle relocatability. Use repo-relative paths only.

### `assets-info-plist-merge-order`

A custom `src-tauri/Info.plist` is *merged* with Tauri's generated keys. Overwriting `CFBundleVersion` / `CFBundleShortVersionString` here is forbidden — it conflicts with `bundle.version` resolution and silently ships a wrong version. Only add app-specific keys (`NSCameraUsageDescription`, `NSAppleEventsUsageDescription`, `LSApplicationCategoryType`, etc.).

## Capabilities at build time — `caps-build-*`

### `caps-build-files-discovered-automatically`

Files under `src-tauri/capabilities/*.json` (and `.toml`) are discovered by `tauri-build` and embedded automatically. Only the capability *identifiers* listed in `app.security.capabilities` (when set) are activated; if that array is empty, all capability files in the directory are activated. Either form is valid; pick one and stick to it. Mixing inline capabilities with file-based capabilities is allowed but doubles the audit surface — flag drift.

### `caps-build-platforms-narrow`

A capability with `"platforms": ["macOS"]` is silently dropped on Windows / Linux builds. This is the right primitive for platform-conditional permissions. A capability that grants a *desktop* permission with `platforms: ["iOS", "android"]` is dead code; flag it.

### `caps-build-remove-unused-commands`

`build.removeUnusedCommands: true` (Tauri 2 stable feature) drops commands not referenced by any capability ACL during `tauri build`. Two consequences to flag:

- Adding a new `#[tauri::command]` without a matching capability permission entry causes it to be silently *removed* — calls fail at runtime with no diagnostic in production.
- Removing the last reference to a command from capabilities silently strips it from the binary. Test the IPC surface in release mode, not just dev.

### `caps-build-csp-not-disabled`

`app.security.dangerousDisableAssetCspModification: true` opts out of Tauri's CSP enforcement for the asset protocol — almost never the right call. If you see this set, demand an inline comment explaining the threat model. The default (CSP enforced) is correct for shipping apps.

### `caps-build-asset-protocol-scope-narrow`

`app.security.assetProtocol.scope` defines which paths the renderer can read via `asset://`. A scope like `["/**/*"]` (or absent and falling back to default-allow) lets the renderer read arbitrary files if `enable: true`. Narrow the scope to the workspace allowlist, or disable the asset protocol entirely if not used.

## Plugin updater wiring — `updater-build-*`

(Detailed updater rules live in [`./tauri-signing-and-updater.md`](tauri-signing-and-updater.md). Build-time-only checks live here.)

### `updater-build-pubkey-not-path`

`plugins.updater.pubkey` MUST be the *content* of the public key file, not a path. A path-shaped value (`./pubkey.pem`) compiles but produces a runtime parse error on the first update check. Embed the contents verbatim or via a build-script substitution.

### `updater-build-endpoints-https-in-production`

`plugins.updater.endpoints` MUST be HTTPS in production. The `dangerousInsecureTransportProtocol: true` flag exists for local testing — never set it in a config that ships. If a workflow templates `endpoints` from a variable, the variable MUST be HTTPS-only validated at build time.

### `updater-build-endpoint-fallthrough`

When `endpoints` lists multiple URLs, Tauri tries each in order and stops on the first 2xx response. A 5xx on the primary endpoint silently falls through to the next; design the secondary to be a strict superset of the primary (or omit it). Listing a stale endpoint as "fallback" is a foot-gun — clients on a stale primary never see the new manifest.

## Cross-compilation seam — `xcompile-build-*`

(Cross-compile mechanics live in [`./tauri-bundle-size.md`](tauri-bundle-size.md). Build-config seam-checks live here.)

### `xcompile-build-stage-cli-target-env`

If the host repo uses a sidecar `externalBin` and a CI matrix with multiple `--target <triple>` builds, the staging script MUST receive the active target — usually via an env var threaded through the workflow. Without it, the staged binary has the host's triple suffix, the build script's existence check fails, and the matrix collapses to host-only builds.

### `xcompile-build-conf-overlays`

Platform-specific overlays (`tauri.linux.conf.json`, `tauri.windows.conf.json`, `tauri.macos.conf.json`, `tauri.android.conf.json`, `tauri.ios.conf.json`) merge into the base via JSON Merge Patch (RFC 7396) — a `null` value deletes the key. Use overlays for platform-only settings (NSIS hooks on Windows, DMG layout on macOS) instead of `if`-laddering build scripts.

### `xcompile-build-cli-config-flag`

The `tauri build --config <path-or-json>` flag merges an extra config file at invocation time (also RFC 7396). Use it for ephemeral build flavours (beta, canary) — set `productName`, `identifier`, and `version` overrides — never hand-edit the base `tauri.conf.json` from a CI step. Hand-edits break local rebuilds.
