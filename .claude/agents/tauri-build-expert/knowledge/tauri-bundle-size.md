---
tags: [build-system, bundle, tauri-v2, performance]
source: Tauri v2 official documentation (https://v2.tauri.app/), summarised
---

# Tauri v2 Bundle Size & Cross-Compilation

Project-agnostic audit checklist for binary size, Cargo release profile, WebView2 distribution, and cross-compilation. Cite a rule by its `<rule-id>`.

> **Scope:** Cargo profile (release optimisation), WebView2 install mode size trade-offs, cross-compile mechanics for Tauri targets, `removeUnusedCommands` ACL pruning. Frontend JS bundle size lives in `vite-bundle-hygiene.md` (used by `performance-expert` and `lean-expert`); this file owns the Rust/Tauri side.
>
> **References:** [Concept: Size](https://v2.tauri.app/concept/size/), [Windows installer](https://v2.tauri.app/distribute/windows-installer/), [`removeUnusedCommands`](https://github.com/tauri-apps/tauri/pull/12890), [Cargo profiles](https://doc.rust-lang.org/cargo/reference/profiles.html).

## Cargo release profile — `cargo-*`

### `cargo-release-profile-aggressive`

The Tauri-recommended release profile in `src-tauri/Cargo.toml` (or `Cargo.toml` if the workspace lives at root):

```toml
[profile.release]
codegen-units = 1   # better LLVM optimisation
lto = true          # link-time optimisation
opt-level = "s"     # optimise for size; use "3" for speed
panic = "abort"     # remove unwinding tables
strip = true        # remove debug symbols
```

A default profile (no overrides) ships a binary 30-50% larger than necessary. Flag any release build that lacks at least `lto = true` and `strip = true`.

### `cargo-opt-level-tradeoff`

`opt-level` choices and their effect on Tauri release builds:

| Value | Binary size | Runtime perf | Compile time | Notes |
|---|---|---|---|---|
| `0` | huge | slow | fast | Never ship. |
| `1`–`2` | medium | medium | medium | Rarely useful. |
| `3` | larger | fastest | slow | Pick for compute-heavy Rust hot paths. |
| `"s"` | small | good | slow | Default for size-sensitive desktop apps. |
| `"z"` | smallest | slower | slow | Pick only when binary size is the dominant constraint. |

Document the choice with a comment when picking anything other than `"s"`.

### `cargo-codegen-units-one`

`codegen-units = 1` constrains LLVM to compile the crate as a single unit, enabling cross-function optimisations at the cost of compile time. For a Tauri app's release profile this is the right trade — release builds happen on CI with caching, not on developer machines. Setting `codegen-units > 1` in release without justification is a regression.

### `cargo-panic-abort-when-no-catch_unwind`

`panic = "abort"` removes unwinding tables (~10% binary size) but breaks `std::panic::catch_unwind`. Tauri itself does not use `catch_unwind` for IPC — a panicking command becomes a Promise rejection regardless. Flag `panic = "abort"` only if the host repo's Rust code calls `catch_unwind` directly.

### `cargo-strip-true-no-debuginfo`

`strip = true` removes debug symbols and section names. Combined with `[profile.release.package."*"] debug = 0` it eliminates all debug info from dependencies. For a shipped binary this is correct. **Do not** strip the debug profile — stack traces from local crashes need symbols.

### `cargo-trim-paths-removes-leaks`

`trim-paths = "all"` removes absolute build-host paths from the binary (`/Users/alice/.cargo/registry/...`). These paths leak the developer's username and home directory in stack traces. The feature is stable as a `rustc -Cstrip-paths` flag but is **unstable in Cargo's `[profile]` syntax** as of Cargo 1.95 — it requires nightly + `-Z trim-paths`. Re-evaluate when stabilised in stable Cargo. Until then, mitigate by running production builds in CI sandboxes whose paths don't leak meaningful identity.

### `cargo-incremental-dev-only`

`incremental = true` belongs in `[profile.dev]`, not release. Incremental compilation in release breaks `lto = true` and `codegen-units = 1` benefits — they compile the world from scratch anyway. A release profile with `incremental = true` is a misconfiguration; flag it.

## ACL-driven dead-command pruning — `acl-*`

### `acl-remove-unused-commands-flag`

`build.removeUnusedCommands: true` (Tauri 2 stable) reads the activated capability files at build time, computes the union of allowed command names, and tells `generate_handler!` to drop everything else. Two effects:

- **Smaller binary** — typical wins are 5-15% off the Rust binary depending on how broad the IPC surface is.
- **Fail-closed by default** — adding a `#[tauri::command]` without a matching capability permission silently strips it. Test in release.

Flag it as a recommendation when the host repo has a wide IPC surface and explicit capabilities. Flag it as a regression risk if it is **enabled** but the test suite only exercises the dev profile (debug builds skip the pruning).

### `acl-capability-permission-coverage`

Every `#[tauri::command]` in the handler MUST have a matching permission entry in at least one activated capability file. With `removeUnusedCommands` on, missing permissions produce silent stripping. Without the flag, missing permissions produce runtime denials. Either way, audit the full set in CI — a quick `grep '#\[tauri::command\]' src-tauri/src` vs the union of capability `permissions:` is a worthwhile build step.

## WebView2 distribution — `webview-*`

### `webview-install-mode-deliberate`

`bundle.windows.webviewInstallMode.type` is a four-way trade-off (size vs offline vs Windows-7-compat vs supported-runtime). The full table:

| Mode | Extra installer size | Internet at install | Runtime patches | Notes |
|---|---|---|---|---|
| `downloadBootstrapper` | 0 MB | required | system-managed | Default. Right for online installs on Windows 10/11. |
| `embedBootstrapper` | ~1.8 MB | required | system-managed | Better Windows-7 `.msi` compat (TLS 1.2 caveat). |
| `offlineInstaller` | ~127 MB | not needed | system-managed | Required for offline / air-gapped deploys. |
| `fixedRuntime` | ~180 MB | not needed | maintainer-managed | Pin a specific WebView2 version. Acceptable only for managed-update environments. |
| `skip` | 0 MB | n/a | not installed | App fails to launch when WebView2 absent. **Never ship.** |

`fixedRuntime` is a maintenance commitment — the maintainer is responsible for shipping security patches via app updates. Pick it only if the host repo's threat model requires version-pinning.

### `webview-fixed-runtime-path-resolves`

When `webviewInstallMode.type` is `"fixedRuntime"`, the `path` field MUST point to an extracted runtime directory under `src-tauri/`. The directory must contain `EBWebView/` and the runtime files. A relative path that resolves outside `src-tauri` aborts the bundle.

### `webview-download-bootstrapper-tls`

The default `downloadBootstrapper` mode requires TLS 1.2 on the install host. This breaks on stock Windows 7 (TLS 1.0/1.1 only). If shipping to Windows 7, switch to `embedBootstrapper` or `offlineInstaller`.

## Cross-compilation — `xcompile-*`

### `xcompile-targets-rustup-pre-stage`

Cross-compiling a Tauri app requires the Rust target installed on the build host:

```sh
rustup target add x86_64-pc-windows-msvc
rustup target add aarch64-pc-windows-msvc
rustup target add aarch64-apple-darwin
rustup target add x86_64-apple-darwin
```

CI workflows that omit this (relying on a default toolchain) fail with `error: linker not found` or `error: failed to run custom build command for tauri-build`. Pre-stage every target the matrix builds.

### `xcompile-windows-from-non-windows`

Cross-compiling a Windows NSIS installer from Linux/macOS uses `cargo-xwin` as Tauri's runner:

```sh
cargo install --locked cargo-xwin
npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc
```

Caveats:
- **NSIS only** — `.msi` (WiX) cannot cross-compile (WiX is Windows-only).
- **Linux** also needs `lld` + `llvm` (for `llvm-rc`) and on some distros, NSIS Stubs/Plugins from upstream binary releases.
- **`XWIN_CACHE_DIR`** env var caches the Windows SDK between builds; without it `cargo-xwin` re-downloads ~500 MB per build.

### `xcompile-arm64-windows-toolchain`

`aarch64-pc-windows-msvc` requires the "MSVC v143 - VS 2022 C++ ARM64 build tools" component installed via Visual Studio Installer. Stock `windows-latest` GitHub runners include this; self-hosted Windows runners may not — verify with `cl.exe /?` for the ARM64 cross-toolchain.

### `xcompile-macos-universal-not-default`

macOS universal binaries (`x86_64` + `aarch64` in one bundle) are NOT the default. Tauri on `macos-latest` (Apple Silicon) builds an `aarch64`-only bundle. To produce a universal binary either:
- Build twice (separate matrix entries for x86_64 and aarch64), or
- Use `cargo build --target universal-apple-darwin` (requires both Rust targets installed), or
- Run `lipo -create` post-build on the embedded binaries.

If the release ships only an aarch64 bundle, document it — Intel Mac users on macOS 12 cannot run aarch64-only apps under Rosetta in all cases (especially when sidecar binaries are involved).

## Sidecar staging at build time — `sidecar-stage-*`

### `sidecar-stage-target-triple-env`

A staging script that copies a sidecar binary to the suffixed `<name>-<triple>(.exe)?` form MUST honour an env var that names the active build target. Common pattern (cross-platform Node staging script):

```js
const target = process.env.STAGE_CLI_TARGET || execSync('rustc --print host-tuple').toString().trim();
```

A staging script that always uses `rustc --print host-tuple` produces the host's triple suffix even when `tauri build --target <other>` is in flight — the build script then aborts on the existence check.

### `sidecar-stage-build-profile-coherence`

The sidecar binary must be built with the **same** profile as the Tauri app: release sidecar for release Tauri build, debug sidecar for `tauri dev`. Staging a debug sidecar into a release bundle produces a 5-10× larger embedded binary that still functions but ships unstripped symbols and panic strings.

### `sidecar-stage-placeholder-acceptable-when`

When a build script's existence check happens *before* the real sidecar is built (e.g. during a pre-flight `cargo test --features codegen` for typed-binding generation), staging a placeholder file with the correct name is acceptable. The placeholder MUST be replaced by the real binary before the actual `tauri build`. Skipping the replacement ships a broken sidecar that exits with no useful diagnostic.

## Binary size measurement — `size-*`

### `size-measure-stripped`

When tracking binary size, measure the **stripped release binary**, not the debug binary or the unstripped release binary. The latter two can be 3-5× larger; tracking either as the budget produces false regressions on every dependency bump.

### `size-measure-installer-not-binary`

For end-user impact, the **installer download size** matters more than the binary size — a small Rust binary inside a `fixedRuntime` WebView2 install (~180 MB) ships as a ~180 MB installer. Track both. CI checks like `node scripts/check-bundle-size.mjs` SHOULD assert against the installer size for shipped artefacts and the binary size for the in-process budget.

### `size-watch-dependency-bumps`

Cargo dependency bumps are the most common silent size regression. A bump from `serde 1.0.x` to `1.0.y` rarely matters; a bump from `tauri 2.0` to `2.1` can move 1-2 MB. Track binary size in CI per-PR with a regression threshold (e.g. ±5%).
