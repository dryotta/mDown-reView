import { useEffect } from "react";
import { useShallow } from "zustand/shallow";
import { getAuthor, setAuthor as setAuthorIpc } from "@/lib/tauri-commands";
import { useStore } from "@/store";

/**
 * View-model for the "author identity" setting (AC #71/F7).
 *
 * The display name lives in two places by design:
 *  - The Zustand `authorName` field — read synchronously by every
 *    `add_comment` caller (see `useCommentActions`) so new-comment
 *    creation never has to await an IPC round-trip.
 *  - The Rust `OnboardingState.author` on disk — the source of truth
 *    across app restarts and across processes (a sidecar tool could
 *    invoke `set_author` and the next launch will read the new value).
 *
 * On mount, if the in-memory store value is empty we hydrate it via
 * `get_author` (which itself falls back to `USERNAME`/`USER` and finally
 * to `"anonymous"`). On `setAuthor`, we persist via the IPC first and
 * only then update the store so a validation rejection from Rust is
 * surfaced as a thrown `ConfigError` and the cached value stays correct.
 */
export interface UseAuthorResult {
  /** Current display name. Empty string until the first hydration completes. */
  author: string;
  /**
   * Persist `name` to disk via `set_author` IPC, then update the Zustand
   * cache. Throws a typed `ConfigError` on validation / persistence
   * failure (callers branch on `kind`).
   */
  setAuthor: (name: string) => Promise<void>;
}

export function useAuthor(): UseAuthorResult {
  const { author, setAuthorInStore } = useStore(
    useShallow((s) => ({
      author: s.authorName,
      setAuthorInStore: s.setAuthorName,
    })),
  );

  useEffect(() => {
    if (author) return;
    let cancelled = false;
    getAuthor()
      .then((v) => {
        if (!cancelled && v) setAuthorInStore(v);
      })
      .catch(() => {
        // Hydration failures are non-fatal — `useCommentActions` falls
        // back to "Anonymous" when the store value is empty.
      });
    return () => {
      cancelled = true;
    };
  }, [author, setAuthorInStore]);

  const setAuthor = async (name: string): Promise<void> => {
    const stored = await setAuthorIpc(name);
    setAuthorInStore(stored);
  };

  return { author, setAuthor };
}
