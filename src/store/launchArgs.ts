/**
 * `openFilesFromArgs` — opens the workspace root and a list of files
 * supplied via CLI launch args (or the test-only `set_root_via_test`
 * IPC). Each path is canonicalised at the renderer boundary so the
 * stored form matches what `scan_review_files` emits (long form, no
 * `\\?\` verbatim prefix). Without this, the GH Actions Windows
 * runner's 8.3 short-name `tmpdir()` (e.g. `RUNNER~1`) is stored
 * verbatim in tabs but the scanner emits the long form
 * (`runneradmin`), so `ghostEntries.some(g => g.sourcePath === path)`
 * never matches and `DeletedFileViewer` never renders (#89 iter 3).
 *
 * Extracted from `index.ts` to keep that file under the 500-line
 * shared-chokepoint budget (rule 23 in `docs/architecture.md`).
 */
import { useStore } from "./index";
import { canonicalizeOrFallback } from "./canonicalize";
import { registerWindowFolder } from "@/lib/tauri-commands";
import { warn } from "@/logger";

export async function openFilesFromArgs(
  files: string[],
  folders: string[],
  store: ReturnType<typeof useStore.getState>,
): Promise<void> {
  // Last folder wins (spec requirement).
  // Confirm registration with the Rust registry (the Rust setup/router
  // already claimed the folder — this re-confirms and updates the title).
  // If it fails (e.g., folder already open), log but still set root since
  // the Rust side already routed this folder to this window.
  if (folders.length > 0) {
    const lastFolder = folders[folders.length - 1];
    const canonicalFolder = await canonicalizeOrFallback(lastFolder);
    await store.setRoot(canonicalFolder);
    store.addRecentItem(canonicalFolder, "folder");
    try {
      await registerWindowFolder(canonicalFolder);
    } catch (err) {
      warn(`[launchArgs] register_window_folder failed: ${err}`);
    }
  }
  const alreadyOpen = new Set(store.tabs.map((t) => t.path));
  // Deduplicate incoming files
  const unique = [...new Set(files)];
  for (const file of unique) {
    const canonicalFile = await canonicalizeOrFallback(file);
    if (!alreadyOpen.has(canonicalFile)) {
      store.openFile(canonicalFile);
      alreadyOpen.add(canonicalFile);
    }
    store.addRecentItem(canonicalFile, "file");
  }
}
