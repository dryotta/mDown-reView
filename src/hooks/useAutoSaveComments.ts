import { useEffect, useRef, useCallback } from "react";
import { saveReviewComments } from "@/lib/tauri-commands";
import type { MrsfComment } from "@/lib/tauri-commands";
import { enrichCommentsWithCommit } from "./useCommitEnricher";
import { useStore } from "@/store";
import { error as logError } from "@/logger";

function computeDocumentPath(filePath: string, root: string | null): string {
  if (root) {
    const normalizedFile = filePath.replace(/\\/g, "/");
    const normalizedRoot = root.replace(/\\/g, "/").replace(/\/$/, "") + "/";
    if (normalizedFile.startsWith(normalizedRoot)) {
      return normalizedFile.slice(normalizedRoot.length);
    }
  }
  return filePath.split(/[/\\]/).pop() ?? filePath;
}

/**
 * Auto-save comments to MRSF sidecar file with 500ms debounce.
 * Flushes pending save on unmount to prevent data loss on tab switch.
 */
export function useAutoSaveComments(
  filePath: string,
  comments: MrsfComment[] | undefined,
  loadKey: number
) {
  const root = useStore((s) => s.root);
  const setLastSaveTimestamp = useStore((s) => s.setLastSaveTimestamp);

  // Track load state as ref (not state) to avoid triggering saves on load completion
  const loadedRef = useRef(false);
  useEffect(() => {
    loadedRef.current = loadKey > 0;
  }, [loadKey]);

  // Track whether comments have changed since initial load (dirty flag).
  // Reset on every load (initial or sidecar reload) so that externally-loaded
  // comments are not treated as dirty and redundantly saved back.
  const dirtyRef = useRef(false);
  const initialCommentsRef = useRef<MrsfComment[] | undefined>(undefined);

  useEffect(() => {
    if (loadKey > 0) {
      initialCommentsRef.current = comments;
      dirtyRef.current = false;
    }
  }, [loadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mark dirty when comments change after initial load
  useEffect(() => {
    if (!loadedRef.current) return;
    if (comments !== initialCommentsRef.current) {
      dirtyRef.current = true;
    }
  }, [comments]);

  // Stable save function
  const doSave = useCallback(() => {
    if (!loadedRef.current || !dirtyRef.current) return;
    const document = computeDocumentPath(filePath, root);
    const commentsToSave = comments ?? [];

    enrichCommentsWithCommit(commentsToSave, filePath)
      .then((enriched) => saveReviewComments(filePath, document, enriched))
      .then(() => setLastSaveTimestamp(Date.now()))
      .catch((err) => logError(`Failed to save review comments for ${filePath}: ${err}`));
  }, [comments, filePath, root, setLastSaveTimestamp]);

  // Store latest doSave in a ref for the unmount effect
  const doSaveRef = useRef(doSave);
  useEffect(() => { doSaveRef.current = doSave; }, [doSave]);

  // Debounced save effect — cleanup only cancels timer (no flush)
  useEffect(() => {
    if (!loadedRef.current || !dirtyRef.current) return;

    const timer = setTimeout(() => {
      doSave();
    }, 500);

    return () => clearTimeout(timer);
  }, [comments, filePath, doSave]);

  // Separate unmount-only flush — [] deps means cleanup runs ONLY on unmount
  useEffect(() => {
    return () => {
      doSaveRef.current();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
