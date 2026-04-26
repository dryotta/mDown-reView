// Upload run screenshots to a dedicated orphan branch on the repo so
// gh issues can reference them via raw URLs that GitHub's image
// renderer accepts. Local paths in the issue body would render as
// broken images.

import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, copyFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EVIDENCE_BRANCH = "explore-ux-evidence";

function git(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.once("exit", (code) =>
      code === 0 ? resolve(out) : reject(new Error(err.trim() || `git ${args.join(" ")} exit ${code}`)));
  });
}

function ghJson(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("gh", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.once("exit", (code) =>
      code === 0 ? resolve(out) : reject(new Error(err.trim() || `gh ${args.join(" ")} exit ${code}`)));
  });
}

export interface UploadResult {
  baseUrl: string;     // https://github.com/<owner>/<repo>/raw/<branch>
  remoteDir: string;   // <runId>
  count: number;       // png files uploaded
}

export interface UploadOptions {
  owner?: string;
  repo?: string;
  remoteUrl?: string;
}

/**
 * Upload PNG screenshots from `<runDir>/screenshots/` to an orphan
 * `explore-ux-evidence` branch under `<runId>/<basename>`.
 * Idempotent: re-running the same run is a no-op (git commit fails
 * cleanly when there's nothing to add).
 */
export async function uploadEvidence(
  runDir: string,
  runId: string,
  opts: UploadOptions = {},
): Promise<UploadResult> {
  let owner = opts.owner, repo = opts.repo;
  if (!owner || !repo) {
    const out = await ghJson(["repo", "view", "--json", "owner,name"]);
    const parsed = JSON.parse(out) as { owner: { login: string }; name: string };
    owner = parsed.owner.login; repo = parsed.name;
  }
  const remoteUrl = opts.remoteUrl ?? `https://github.com/${owner}/${repo}.git`;

  const tmp = mkdtempSync(join(tmpdir(), "explore-ux-evidence-"));
  let branchExists = false;
  try {
    await git(["clone", "--branch", EVIDENCE_BRANCH, "--single-branch", "--depth", "1", remoteUrl, tmp]);
    branchExists = true;
  } catch {
    await git(["init", "-q", tmp]);
    await git(["checkout", "--orphan", EVIDENCE_BRANCH], tmp);
    await git(["remote", "add", "origin", remoteUrl], tmp);
  }
  await git(["config", "user.email", "explore-ux@local"], tmp);
  await git(["config", "user.name", "explore-ux"], tmp);

  const targetDir = join(tmp, runId);
  mkdirSync(targetDir, { recursive: true });
  const scrSrc = join(runDir, "screenshots");
  let count = 0;
  if (existsSync(scrSrc)) {
    for (const f of readdirSync(scrSrc)) {
      if (!f.endsWith(".png")) continue;
      copyFileSync(join(scrSrc, f), join(targetDir, f));
      count += 1;
    }
  }

  await git(["add", "."], tmp);
  try {
    await git(["commit", "-m", `evidence: ${runId} (${count} png)`], tmp);
    if (branchExists) {
      await git(["push", "origin", EVIDENCE_BRANCH], tmp);
    } else {
      await git(["push", "-u", "origin", EVIDENCE_BRANCH], tmp);
    }
  } catch {
    // No-op when nothing changed; raw URLs still resolve to existing files.
  }

  return {
    baseUrl: `https://github.com/${owner}/${repo}/raw/${EVIDENCE_BRANCH}`,
    remoteDir: runId,
    count,
  };
}

/**
 * Convert a local screenshot path to its uploaded raw URL.
 * Falls back to the original path if no upload was done (test mode).
 */
export function resolveScreenshotUrl(
  localPath: string,
  upload: { baseUrl: string; remoteDir: string } | null,
): string {
  if (!upload) return localPath;
  const base = localPath.replace(/\\/g, "/").split("/").pop() ?? localPath;
  return `${upload.baseUrl}/${upload.remoteDir}/${base}`;
}
