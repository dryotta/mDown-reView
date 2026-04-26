// Synchronise the working tree with origin/main between loop iterations.
//
// Usage: tsx sync.ts
//
// Behaviour:
//   - Refuses if there are uncommitted changes (caller should commit/stash).
//   - Fetches origin, fast-forwards `main` to origin/main, prints the new SHA.
//   - Exits 0 on success, 1 on dirty tree or git failure.

import { spawn } from "node:child_process";

function git(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("git", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.once("exit", (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `git exit ${code}`)));
  });
}

async function main(): Promise<void> {
  const status = await git(["status", "--porcelain"]);
  if (status.length > 0) {
    process.stderr.write(`[sync] working tree dirty:\n${status}\n` +
      `       commit, stash, or discard before continuing.\n`);
    process.exit(1);
  }
  await git(["fetch", "--quiet", "origin"]);
  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== "main") {
    process.stderr.write(`[sync] checking out main (was ${branch})\n`);
    await git(["checkout", "main"]);
  }
  await git(["merge", "--ff-only", "origin/main"]);
  const head = await git(["rev-parse", "HEAD"]);
  process.stderr.write(`[sync] main → ${head.slice(0, 8)}\n`);
  process.stdout.write(head + "\n");
}

main().catch((e) => { console.error(`[sync] ${e instanceof Error ? e.message : e}`); process.exit(1); });
