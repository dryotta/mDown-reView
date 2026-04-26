/**
 * Canonicalize a filesystem path via the Rust IPC, returning the original
 * path on error. Used at workspace-open and tab-open boundaries so the
 * stored form matches what `find_review_files` (which canonicalises via
 * `dunce`) emits.
 *
 * Why fallback rather than reject: Workspace-open flows must not break if
 * the directory was deleted between the dialog and the store, or if the
 * IPC otherwise fails. The original (un-canonicalised) string is stored
 * and a warning logged.
 *
 * Extracted from `index.ts` to keep that file under the 500-line
 * shared-chokepoint budget (rule 23 in `docs/architecture.md`).
 */
import { warn } from "@/logger";
import { canonicalizePath } from "@/lib/tauri-commands";

export async function canonicalizeOrFallback(path: string): Promise<string> {
  try {
    const result = await canonicalizePath(path);
    // Guard against IPC mocks / misbehaving backends that resolve null or
    // empty strings — fall back to the original path so downstream consumers
    // (basename/dirname/setRoot) never see null.
    if (typeof result !== "string" || result.length === 0) {
      warn(`[store] canonicalizePath returned non-string (${String(result)}); using original path: ${path}`);
      return path;
    }
    return result;
  } catch (err) {
    warn(`[store] canonicalizePath failed; using original path: ${path} (${String(err)})`);
    return path;
  }
}
