import type { DirEntry } from "@/lib/tauri-commands";

/**
 * Cross-platform path prefix check. Returns true when `filePath` lies inside
 * (or is equal to) `root`, normalising `\\` and `/` separators so a Windows
 * tab that came from a posix-style root still matches.
 */
export function pathStartsWithRootCrossPlatform(filePath: string, root: string): boolean {
  if (!filePath || !root) return false;
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const np = norm(filePath);
  const nr = norm(root);
  return np === nr || np.startsWith(nr + "/");
}

/**
 * Returns the chain of ancestor folder paths between `root` (exclusive) and
 * the immediate parent of `filePath` (inclusive), in top-down order. Empty
 * array when `filePath` is not inside `root` or sits directly in `root`.
 */
export function getAncestors(root: string, filePath: string): string[] {
  if (!pathStartsWithRootCrossPlatform(filePath, root)) return [];
  const sep = filePath.includes("\\") && !filePath.includes("/") ? "\\" : "/";
  const rel = filePath.length > root.length ? filePath.slice(root.length + 1) : "";
  if (!rel) return [];
  const parts = rel.split(/[\\/]/);
  parts.pop(); // drop the file name itself
  const out: string[] = [];
  let cur = root;
  for (const seg of parts) {
    cur = cur + sep + seg;
    out.push(cur);
  }
  return out;
}

export interface FilterGroup {
  /** Absolute path of the folder that holds the matching files. */
  parentPath: string;
  /** Path of the folder relative to the workspace root, posix-normalised. "" when the folder IS the root. */
  relativePath: string;
  files: { path: string; name: string }[];
}

const DEFAULT_DEPTH_CAP = 20;
const DEFAULT_ENTRY_CAP = 10000;

/**
 * Walks `childrenCache` starting at `root` and groups every file whose name
 * contains `filter` (case-insensitive) by its immediate parent directory.
 *
 * Bounded by `depthCap` (default 20) and `entryCap` (default 10000) to match
 * the scanner budget — folders that have not been loaded into the cache are
 * silently skipped.
 */
export function buildGroupedFilterResult(
  root: string | null,
  childrenCache: Record<string, DirEntry[]>,
  filter: string,
  opts?: { depthCap?: number; entryCap?: number }
): FilterGroup[] {
  if (!root || !filter) return [];
  const depthCap = opts?.depthCap ?? DEFAULT_DEPTH_CAP;
  const entryCap = opts?.entryCap ?? DEFAULT_ENTRY_CAP;
  const needle = filter.toLowerCase();
  const groups = new Map<string, FilterGroup>();
  let visited = 0;

  const walk = (dir: string, depth: number): boolean => {
    if (depth > depthCap) return true;
    const entries = childrenCache[dir];
    if (!entries) return false;
    for (const e of entries) {
      if (visited++ >= entryCap) return true;
      if (e.is_dir) {
        if (walk(e.path, depth + 1)) return true;
      } else if (e.name.toLowerCase().includes(needle)) {
        let g = groups.get(dir);
        if (!g) {
          const rel = dir === root
            ? ""
            : pathStartsWithRootCrossPlatform(dir, root)
              ? dir.slice(root.length + 1).replace(/\\/g, "/")
              : dir.replace(/\\/g, "/");
          g = { parentPath: dir, relativePath: rel, files: [] };
          groups.set(dir, g);
        }
        g.files.push({ path: e.path, name: e.name });
      }
    }
    return false;
  };

  walk(root, 0);

  return Array.from(groups.values()).sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath)
  );
}

/**
 * Returns the set of directories the Rust tree watcher should monitor:
 * the workspace `root` plus every currently-expanded directory, deduped while
 * preserving order (root first).
 */
export function computeWatchedDirs(root: string, expandedDirs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of [root, ...expandedDirs]) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    out.push(dir);
  }
  return out;
}
