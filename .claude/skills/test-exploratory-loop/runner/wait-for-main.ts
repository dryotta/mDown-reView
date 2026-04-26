// Block until origin/main advances past a baseline SHA. Used by the
// test-exploratory-loop skill to pause between iterations while another
// agent fixes issues in the backlog.
//
// Usage:
//   tsx wait-for-main.ts [--since <sha>] [--timeout <sec>] [--poll <sec>]
//
// Behaviour:
//   - Polls `git fetch origin main` every <poll> seconds (default 60).
//   - Returns when `origin/main` SHA differs from <since>.
//   - Exits with code 0 on advance, 2 on timeout, 1 on git failure.
//   - --since defaults to the current `origin/main` HEAD at start.
//   - --timeout defaults to 14400 (4 hours). 0 = no timeout.
//   - Prints the new SHA on stdout (single line) so callers can capture it.

import { spawn } from "node:child_process";

interface Args { since?: string; timeoutSec: number; pollSec: number; }

function parseArgs(argv: string[]): Args {
  const a: Args = { timeoutSec: 14_400, pollSec: 60 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--since")        { a.since = v; i++; }
    else if (k === "--timeout") { a.timeoutSec = Number(v); i++; }
    else if (k === "--poll")    { a.pollSec = Number(v); i++; }
    else if (k === "--help" || k === "-h") {
      console.log(
        "tsx wait-for-main.ts [--since <sha>] [--timeout <sec>] [--poll <sec>]");
      process.exit(0);
    }
  }
  if (!Number.isFinite(a.timeoutSec) || a.timeoutSec < 0) a.timeoutSec = 14_400;
  if (!Number.isFinite(a.pollSec)    || a.pollSec    < 5) a.pollSec    = 60;
  return a;
}

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

async function fetchMain(): Promise<string> {
  await git(["fetch", "--quiet", "origin", "main"]);
  return git(["rev-parse", "origin/main"]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const baseline = args.since ?? await fetchMain();
  process.stderr.write(`[wait-for-main] baseline=${baseline.slice(0, 8)} ` +
    `poll=${args.pollSec}s timeout=${args.timeoutSec || "∞"}s\n`);

  const startMs = Date.now();
  while (true) {
    let head: string;
    try { head = await fetchMain(); }
    catch (e) {
      process.stderr.write(`[wait-for-main] git error: ${e instanceof Error ? e.message : e}\n`);
      process.exit(1);
    }
    if (head !== baseline) {
      process.stderr.write(`[wait-for-main] advanced ${baseline.slice(0, 8)} → ${head.slice(0, 8)}\n`);
      process.stdout.write(head + "\n");
      process.exit(0);
    }
    if (args.timeoutSec > 0 && (Date.now() - startMs) / 1000 >= args.timeoutSec) {
      process.stderr.write(`[wait-for-main] timeout after ${args.timeoutSec}s, no advance\n`);
      process.exit(2);
    }
    await sleep(args.pollSec * 1000);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
