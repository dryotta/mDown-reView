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
