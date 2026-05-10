#!/usr/bin/env node
// Stage the mdownreview-cli binary into src-tauri/binaries/ so Tauri's
// externalBin resolver finds it during `cargo check`, `cargo test`,
// `tauri:dev`, and `tauri:build`. See docs/features/installation.md.
//
// Chicken-and-egg note: tauri.conf.json declares externalBin, which the
// Tauri build script (build.rs) validates at compile time. But to BUILD
// the CLI we need to invoke cargo, which runs that same build script.
// We break the cycle by writing an empty placeholder at the staged path
// BEFORE invoking cargo build, then overwriting it with the real binary.
//
// Cargo profile alignment: this script accepts `--profile <name>` so the
// staged CLI uses the SAME Cargo profile as the GUI build that's about
// to run next. PR builds use `release-ci`; canary/release builds use
// `release`. Aligning profiles avoids compiling the dependency graph
// twice (once per profile, in different `target/<profile>/` directories)
// because Cargo cannot share artefacts across profiles. See PR for more.
//
// `--with-gui` turns the staging cargo invocation into
// `cargo build --bins --features tauri/custom-protocol`, which compiles
// BOTH the GUI bin (mdownreview) and the CLI bin (mdownreview-cli) in
// one cargo invocation that shares the dep + lib graph. The subsequent
// `tauri build` step's cargo invocation then finds every fingerprint
// fresh and skips straight to the bundler. The feature flag is mandatory
// to match the feature set tauri-cli unconditionally adds — without it,
// cargo's feature resolver re-unifies and recompiles the tauri/wry
// crate graph, defeating the optimisation.
//
// Usage:
//   node scripts/stage-cli.mjs [--profile <name>] [--target <triple>] [--with-gui]
//
// `--release` is accepted as a backcompat alias for `--profile release`.
// The `STAGE_CLI_PROFILE` env var (legacy) accepts a profile name; the
// historical literal value `"release"` continues to mean profile=release.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcTauri = join(repoRoot, "src-tauri");
const stagingDir = join(srcTauri, "binaries");

function rustHostTriple() {
  const out = execSync("rustc -vV", { encoding: "utf8" });
  const m = out.match(/^host:\s*(.+)$/m);
  if (!m) throw new Error("Could not parse rustc host triple");
  return m[1].trim();
}

function parseArgs() {
  const args = process.argv.slice(2);

  let profile = null;
  const pi = args.indexOf("--profile");
  if (pi !== -1 && args[pi + 1]) profile = args[pi + 1];
  if (profile === null && args.includes("--release")) profile = "release";
  if (profile === null && process.env.STAGE_CLI_PROFILE) {
    profile = process.env.STAGE_CLI_PROFILE;
  }
  if (profile === null) profile = "debug";

  let target = process.env.STAGE_CLI_TARGET || null;
  const ti = args.indexOf("--target");
  if (ti !== -1 && args[ti + 1]) target = args[ti + 1];

  const withGui = args.includes("--with-gui");

  return { profile, target, withGui };
}

function main() {
  const { profile, target, withGui } = parseArgs();
  const triple = target || rustHostTriple();
  const exeSuffix = triple.includes("windows") ? ".exe" : "";
  const targetSubdir = target ? join(target, profile) : profile;
  const built = join(srcTauri, "target", targetSubdir, `mdownreview-cli${exeSuffix}`);
  const staged = join(stagingDir, `mdownreview-cli-${triple}${exeSuffix}`);

  if (!existsSync(stagingDir)) mkdirSync(stagingDir, { recursive: true });

  // Placeholder so the Tauri build script's externalBin existence check
  // (Path::exists() + Path::is_file() in tauri-build's copy_file()) passes
  // during the `cargo build` we're about to run. A 0-byte real file
  // satisfies both checks; the bundler is profile-agnostic and will copy
  // whatever bytes end up at this path after cargo finishes.
  if (!existsSync(staged)) {
    writeFileSync(staged, "");
    console.log(`[stage-cli] Wrote placeholder at ${staged}`);
  }

  // Always invoke cargo. We previously short-circuited on `existsSync(built)`
  // to skip cargo when the binary looked already-built, but that masks stale
  // cache entries (Swatinem cache restore can hand back a fingerprint-stale
  // binary). Cargo's own fingerprint logic is the right gate; when artefacts
  // are truly fresh, cargo exits in milliseconds.
  const profileLabel = `${profile}${target ? `, target=${target}` : ""}${withGui ? ", with-gui" : ""}`;
  console.log(`[stage-cli] Building mdownreview-cli (${profileLabel})...`);
  const parts = ["cargo", "build"];
  if (profile === "release") {
    parts.push("--release");
  } else if (profile !== "debug") {
    parts.push("--profile", profile);
  }
  if (withGui) {
    // `cargo build --bins` compiles every [[bin]] in the package — both
    // the GUI bin (mdownreview) and the CLI bin (mdownreview-cli) — in
    // one cargo invocation that shares the dep + lib graph.
    //
    // `--features tauri/custom-protocol` matches what tauri-cli adds
    // unconditionally to its own cargo invocation
    // (crates/tauri-cli/src/interface/rust.rs::build_options). Omitting it
    // here would cause cargo's feature resolver to recompile the tauri /
    // wry / webview2-com crate graph during the subsequent `tauri build`,
    // negating the optimisation.
    parts.push("--bins", "--features", "tauri/custom-protocol");
  } else {
    parts.push("--bin", "mdownreview-cli");
  }
  parts.push("--manifest-path", `"${join(srcTauri, "Cargo.toml")}"`);
  if (target) parts.push("--target", target);
  execSync(parts.join(" "), { stdio: "inherit" });

  if (!existsSync(built)) {
    throw new Error(`Built CLI not found at ${built} after cargo build`);
  }

  copyFileSync(built, staged);
  console.log(`[stage-cli] Staged ${staged}`);
}

main();
