/**
 * Parse a leading YAML-ish frontmatter block (delimited by `---` lines) from a
 * markdown string and return a flat key→value map.
 *
 * This is intentionally a tiny, synchronous TS implementation rather than a
 * Tauri command: the markdown viewer renders frontmatter eagerly during initial
 * render, and an async IPC round-trip would cause a flash-of-unstyled-content.
 *
 * Iter 2 of issue #280 made the visual-viewer pipeline file-coordinate
 * end-to-end, so the matching `body` field this helper used to return is no
 * longer consumed by any caller — `<ReactMarkdown>` now gets the full file
 * content (including frontmatter), with `remark-frontmatter` recognising the
 * YAML node so GFM does not mis-parse the leading `---`. Only `data` is read.
 *
 * Behaviour notes:
 * - If the content does not start with `---`, returns `null`.
 * - If the opening `---` is not followed by a closing `\n---`, returns `null`
 *   (malformed frontmatter is treated as plain content).
 * - Inside the YAML block, lines without a `:` are silently skipped.
 * - For lines with a `:`, only the FIRST `:` is the separator; any subsequent
 *   colons are kept verbatim in the value (so URLs/timestamps survive).
 * - Keys and values are trimmed; empty keys are dropped.
 */
export function parseFrontmatter(content: string): Record<string, unknown> | null {
  if (!content.startsWith("---")) return null;
  const nlIdx = content.indexOf("\n");
  if (nlIdx === -1) return null;
  const end = content.indexOf("\n---", nlIdx + 1);
  if (end === -1) return null;
  const yaml = content.slice(nlIdx + 1, end);
  const data: Record<string, unknown> = {};
  for (const line of yaml.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key) data[key] = value;
  }
  return data;
}
