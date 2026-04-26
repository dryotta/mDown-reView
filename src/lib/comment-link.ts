/** F6 — Build a workspace-relative deep-link to a line.
 *
 *  Returns `mdrv://<rel>?line=<n>`. The `mdrv://` scheme is unhandled today
 *  (the link is for sharing in PR comments / chat — not for opening files);
 *  the format is fixed so consumers can parse it.
 *
 *  - Backslashes are normalized to forward slashes.
 *  - When `workspaceRoot` is provided the prefix is stripped so the link
 *    is portable; otherwise the path is emitted as-is.
 *  - `?line=` is omitted when `line` is `undefined` or `NaN`. `line=0` is
 *    treated as a real line.
 */
export function buildCommentLink(opts: {
  filePath: string;
  line?: number;
  workspaceRoot?: string | null;
}): string {
  const { filePath, line, workspaceRoot } = opts;
  const norm = (s: string) => s.replace(/\\/g, "/");
  let rel = norm(filePath);
  if (workspaceRoot) {
    const root = norm(workspaceRoot).replace(/\/+$/, "");
    if (root && rel.startsWith(root + "/")) rel = rel.slice(root.length + 1);
    else if (rel === root) rel = "";
  }
  const hasLine = typeof line === "number" && Number.isFinite(line);
  return hasLine ? `mdrv://${rel}?line=${line}` : `mdrv://${rel}`;
}
