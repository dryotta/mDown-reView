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
 * Resolve a relative path against a base directory. POSIX-style ('/') output.
 * Supports `./`, `../`, and bare relative paths. Absolute `rel` (starting with
 * '/' or a Windows drive) is returned as-is (normalized to forward slashes).
 *
 * Kept tiny on purpose — no dependency on Node's `path` module so it works
 * inside the webview.
 */
export function resolveRelative(baseDir: string, rel: string): string {
  const r = rel.replace(/\\/g, "/");
  if (r.startsWith("/") || /^[A-Za-z]:\//.test(r)) return r;
  const baseParts = baseDir.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  for (const segment of r.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (baseParts.length > 1) baseParts.pop();
      continue;
    }
    baseParts.push(segment);
  }
  return baseParts.join("/");
}
