export function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

export function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash > 0 ? normalized.slice(0, lastSlash) : normalized;
}

export function extname(path: string): string {
  const base = basename(path);
  const dotIdx = base.lastIndexOf(".");
  return dotIdx > 0 ? base.slice(dotIdx).toLowerCase() : "";
}

/**
 * Resolve a markdown/HTML link href into an absolute filesystem path that is
 * guaranteed to live inside `workspaceRoot` (or `baseDir`, if no workspace is
 * open). Returns `null` if the href cannot be safely contained.
 *
 * Defends against three escape vectors that a naive baseDir-relative resolver
 * would forward to `openFile`:
 *   1. `[x](/etc/passwd)` — absolute paths treated as OS-rooted.
 *   2. `[x](../../../../etc/passwd)` — `..` traversal exiting the root.
 *   3. `[x](C:/Windows/foo)` — Windows-drive prefixes bypass containment.
 *
 * Also strips the URL fragment (`#…`) and query (`?…`) before resolution and
 * URL-decodes the pathname so `[x](./My%20Doc.md)` opens `./My Doc.md`.
 *
 * Returns `{ path, fragment }`. The fragment (if any) lets callers do
 * scroll-to-anchor on the freshly opened tab.
 */
export interface ResolvedWorkspacePath {
  path: string;
  fragment: string | null;
}

export function resolveWorkspacePath(
  workspaceRoot: string,
  baseDir: string,
  href: string,
): ResolvedWorkspacePath | null {
  // Strip query first, then fragment. Both are removed before any path
  // resolution — they describe how to use the URL, not which file it points
  // at.
  let rest = href;
  const qIdx = rest.indexOf("?");
  if (qIdx >= 0) rest = rest.slice(0, qIdx);
  let fragment: string | null = null;
  const hIdx = rest.indexOf("#");
  if (hIdx >= 0) {
    fragment = rest.slice(hIdx + 1);
    rest = rest.slice(0, hIdx);
  }

  // Decode percent-escapes; bail on malformed input rather than guessing.
  let decoded: string;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return null;
  }

  // Reject Windows-drive absolute prefixes — those are OS roots, not
  // workspace-relative.
  const normalized = decoded.replace(/\\/g, "/");
  if (/^[A-Za-z]:[/\\]/.test(decoded)) return null;

  // Containment root: prefer the workspace folder; if the app was opened on
  // a single file with no folder, fall back to that file's directory.
  const root = (workspaceRoot || baseDir).replace(/\\/g, "/").replace(/\/+$/, "");

  // Workspace-root-relative href ('/foo.md' → '<root>/foo.md').
  let absolute: string;
  if (normalized.startsWith("/")) {
    absolute = `${root}${normalized}`;
  } else {
    absolute = `${baseDir.replace(/\\/g, "/").replace(/\/+$/, "")}/${normalized}`;
  }

  // Normalise '.' and '..' segments in the resulting path.
  const parts: string[] = [];
  let leading = "";
  if (absolute.startsWith("/")) leading = "/";
  for (const seg of absolute.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  const resolved = leading + parts.join("/");

  // Containment check: resolved path must be `root` itself or a descendant.
  // Compare with a trailing '/' so '/work/repo-evil' does not slip past
  // '/work/repo'.
  if (resolved !== root && !resolved.startsWith(`${root}/`)) return null;

  return { path: resolved, fragment };
}
