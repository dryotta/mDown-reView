import type { MrsfComment } from "@/lib/tauri-commands";
import { getGitHead } from "@/lib/tauri-commands";

// Cache git HEAD per directory with 60s TTL to handle new commits
interface CacheEntry {
  sha: string | null;
  timestamp: number;
}
const CACHE_TTL_MS = 60_000;
const commitCache = new Map<string, CacheEntry>();

/** Reset the cache (for testing). */
export function resetCommitCache(): void {
  commitCache.clear();
}

function dirOf(filePath: string): string {
  const sep = filePath.lastIndexOf("/") !== -1 ? "/" : "\\";
  const idx = filePath.lastIndexOf(sep);
  return idx > 0 ? filePath.slice(0, idx) : filePath;
}

/**
 * Enrich comments that lack a `commit` field with the current git HEAD SHA.
 * Best-effort: returns comments unchanged if git is unavailable.
 */
export async function enrichCommentsWithCommit(
  comments: MrsfComment[],
  filePath: string
): Promise<MrsfComment[]> {
  // Skip if all comments already have commits
  if (comments.every((c) => c.commit)) return comments;

  const dir = dirOf(filePath);
  const cached = commitCache.get(dir);
  let sha: string | null;

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    sha = cached.sha;
  } else {
    try {
      sha = await getGitHead(dir);
    } catch {
      sha = null;
    }
    commitCache.set(dir, { sha, timestamp: Date.now() });
  }

  if (!sha) return comments;

  return comments.map((c) => (c.commit ? c : { ...c, commit: sha }));
}
