/**
 * Strip Windows verbatim path prefixes (`\\?\` and `\\?\UNC\`) from
 * IPC-facing path strings.
 *
 * Backstop for issue #89: the Rust side now canonicalizes via
 * `dunce::canonicalize` (see `src-tauri/src/core/paths.rs::canonicalize_no_verbatim`)
 * so freshly emitted IPC payloads no longer carry the verbatim prefix. This
 * helper exists to migrate persisted `localStorage` snapshots written by
 * older clients (where every persisted `root`/`tab.path`/`recentItems[].path`/
 * `expandedFolders` key may still be in `\\?\C:\…` form) and as a defensive
 * normaliser for any future surface that touches stored paths.
 *
 * Pure string transform — no path validation, no I/O. Returns the input
 * unchanged when no verbatim prefix is present (including for `null` /
 * `undefined`, which round-trip as-is so callers can chain).
 *
 * Examples:
 *   stripVerbatimPrefix("\\\\?\\C:\\proj\\a.md")     → "C:\\proj\\a.md"
 *   stripVerbatimPrefix("\\\\?\\UNC\\srv\\share\\a") → "\\\\srv\\share\\a"
 *   stripVerbatimPrefix("/home/user/a.md")           → "/home/user/a.md"
 */
export function stripVerbatimPrefix(p: string): string;
export function stripVerbatimPrefix(p: null): null;
export function stripVerbatimPrefix(p: undefined): undefined;
export function stripVerbatimPrefix(p: string | null | undefined): string | null | undefined;
export function stripVerbatimPrefix(p: string | null | undefined): string | null | undefined {
  if (p == null) return p;
  // Order matters: check the longer `\\?\UNC\` form first so the disk-form
  // strip below doesn't half-process a UNC path into `UNC\srv\share`.
  if (p.startsWith("\\\\?\\UNC\\")) {
    return "\\\\" + p.slice("\\\\?\\UNC\\".length);
  }
  if (p.startsWith("\\\\?\\")) {
    return p.slice("\\\\?\\".length);
  }
  return p;
}
