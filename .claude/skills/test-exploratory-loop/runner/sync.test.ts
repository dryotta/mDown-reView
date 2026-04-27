// Regression test for sync.ts (issue #143).
//
// Verifies three scenarios using a throwaway git repo under the OS tmp dir:
//   1. Clean tree, origin advanced  → fast-forwards, exit 0.
//   2. Untracked retrospective file → stashed across ff, restored after, exit 0.
//   3. Other dirty file             → exit 1, no fetch performed.
//
// Per-test timeout is 120s: each case shells out to `npx tsx sync.ts` plus
// several git invocations, and on the Windows CI runner the first invocation
// pays an `npx tsx` cold-start (resolve + tsx warmup + ts transpile) that
// can push wall-clock past 60s even though the work being measured is small.
// The tests assert functional correctness, not timing, so the larger budget
// just absorbs cold-start variance.

import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SYNC = resolve(fileURLToPath(import.meta.url), "..", "sync.ts");
const useShell = process.platform === "win32";

interface ProcResult { code: number; stdout: string; stderr: string; }

function sh(cwd: string, cmd: string, args: string[]): ProcResult {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: useShell });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error ? String(r.error) : "") };
}

function git(cwd: string, ...args: string[]): string {
  const r = sh(cwd, "git", args);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${r.stderr}`);
  return r.stdout.trim();
}

function makeRepoPair(): { origin: string; clone: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), "sync-test-"));
  const origin = join(root, "origin.git");
  const clone = join(root, "clone");
  mkdirSync(origin);
  git(origin, "init", "--bare", "--initial-branch=main");

  const seed = join(root, "seed");
  mkdirSync(seed);
  git(seed, "init", "--initial-branch=main");
  git(seed, "config", "user.email", "test@example.com");
  git(seed, "config", "user.name", "Test");
  writeFileSync(join(seed, "README.md"), "seed\n");
  git(seed, "add", ".");
  git(seed, "commit", "-m", "seed");
  git(seed, "remote", "add", "origin", origin);
  git(seed, "push", "origin", "main");

  git(root, "clone", origin, "clone");
  git(clone, "config", "user.email", "test@example.com");
  git(clone, "config", "user.name", "Test");

  return { origin, clone, root };
}

function advanceOrigin(originBare: string, scratchRoot: string, msg: string): string {
  const w = join(scratchRoot, `advance-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  git(scratchRoot, "clone", originBare, w);
  git(w, "config", "user.email", "test@example.com");
  git(w, "config", "user.name", "Test");
  writeFileSync(join(w, msg + ".txt"), msg);
  git(w, "add", ".");
  git(w, "commit", "-m", msg);
  git(w, "push", "origin", "main");
  return git(w, "rev-parse", "HEAD");
}

function runSync(cwd: string): ProcResult {
  return sh(cwd, "npx", ["tsx", SYNC]);
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) {
    try { cleanups.pop()!(); } catch { /* ignore */ }
  }
});

describe("test-exploratory-loop sync.ts", () => {
  it("fast-forwards a clean tree to origin/main", () => {
    const { origin, clone, root } = makeRepoPair();
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));

    const newSha = advanceOrigin(origin, root, "feat-a");
    const result = runSync(clone);
    expect(result.code, result.stderr).toBe(0);
    expect(git(clone, "rev-parse", "HEAD")).toBe(newSha);
  }, 120_000);

  it("stashes and restores allow-listed retrospectives across ff", () => {
    const { origin, clone, root } = makeRepoPair();
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));

    const newSha = advanceOrigin(origin, root, "feat-b");
    mkdirSync(join(clone, ".claude", "retrospectives"), { recursive: true });
    const retroPath = join(clone, ".claude", "retrospectives", "loop-x.md");
    const retroBody = "retro body\n";
    writeFileSync(retroPath, retroBody);

    const result = runSync(clone);
    expect(result.code, result.stderr).toBe(0);
    expect(git(clone, "rev-parse", "HEAD")).toBe(newSha);
    expect(existsSync(retroPath)).toBe(true);
    // Line endings may flip on Windows due to core.autocrlf; compare normalized.
    expect(readFileSync(retroPath, "utf8").replace(/\r\n/g, "\n")).toBe(retroBody);
    expect(git(clone, "stash", "list")).toBe("");
  }, 120_000);

  it("refuses to sync when a non-allow-listed path is dirty", () => {
    const { origin, clone, root } = makeRepoPair();
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));

    const headBefore = git(clone, "rev-parse", "HEAD");
    advanceOrigin(origin, root, "feat-c");
    writeFileSync(join(clone, "README.md"), "dirty\n");

    const result = runSync(clone);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/dirty|outside the allow-list/i);
    expect(git(clone, "rev-parse", "HEAD")).toBe(headBefore);
  }, 120_000);
});
