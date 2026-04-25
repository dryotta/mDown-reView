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
// Usage:
//   node scripts/stage-cli.mjs [--release] [--target <triple>]

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
  const release =
    args.includes("--release") || process.env.STAGE_CLI_PROFILE === "release";
  let target = process.env.STAGE_CLI_TARGET || null;
  const ti = args.indexOf("--target");
  if (ti !== -1 && args[ti + 1]) target = args[ti + 1];
  return { profile: release ? "release" : "debug", target };
}

function main() {
  const { profile, target } = parseArgs();
  const triple = target || rustHostTriple();
  const exeSuffix = triple.includes("windows") ? ".exe" : "";
  const targetSubdir = target ? join(target, profile) : profile;
  const built = join(srcTauri, "target", targetSubdir, `mdownreview-cli${exeSuffix}`);
  const staged = join(stagingDir, `mdownreview-cli-${triple}${exeSuffix}`);

  if (!existsSync(stagingDir)) mkdirSync(stagingDir, { recursive: true });

  // Placeholder so the Tauri build script's externalBin existence check
  // passes during the `cargo build` we're about to run.
  if (!existsSync(staged)) {
    writeFileSync(staged, "");
    console.log(`[stage-cli] Wrote placeholder at ${staged}`);
  }

  if (!existsSync(built)) {
    console.log(`[stage-cli] Building mdownreview-cli (${profile}${target ? `, target=${target}` : ""})...`);
    const parts = ["cargo", "build"];
    if (profile === "release") parts.push("--release");
    parts.push("--bin", "mdownreview-cli");
    parts.push("--manifest-path", `"${join(srcTauri, "Cargo.toml")}"`);
    if (target) parts.push("--target", target);
    execSync(parts.join(" "), { stdio: "inherit" });
  }

  if (!existsSync(built)) {
    throw new Error(`Built CLI not found at ${built} after cargo build`);
  }

  copyFileSync(built, staged);
  console.log(`[stage-cli] Staged ${staged}`);
}

main();
