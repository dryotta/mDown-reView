#!/usr/bin/env node
// Stage the mdownreview-cli binary into src-tauri/binaries/ so Tauri's
// externalBin resolver finds it during `cargo check`, `cargo test`,
// `tauri:dev`, and `tauri:build`. CI does the equivalent inline in
// .github/workflows/release.yml. See docs/features/installation.md.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
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

function main() {
  const triple = rustHostTriple();
  const profile = process.argv.includes("--release") || process.env.STAGE_CLI_PROFILE === "release" ? "release" : "debug";
  const exeSuffix = triple.includes("windows") ? ".exe" : "";
  const built = join(srcTauri, "target", profile, `mdownreview-cli${exeSuffix}`);
  const staged = join(stagingDir, `mdownreview-cli-${triple}${exeSuffix}`);

  if (!existsSync(stagingDir)) mkdirSync(stagingDir, { recursive: true });

  if (!existsSync(built)) {
    console.log(`[stage-cli] Building mdownreview-cli (${profile})...`);
    const flag = profile === "release" ? "--release" : "";
    execSync(`cargo build ${flag} --bin mdownreview-cli --manifest-path "${join(srcTauri, "Cargo.toml")}"`, {
      stdio: "inherit",
    });
  }

  if (!existsSync(built)) {
    throw new Error(`Built CLI not found at ${built} after cargo build`);
  }

  copyFileSync(built, staged);
  console.log(`[stage-cli] Staged ${staged}`);
}

main();
