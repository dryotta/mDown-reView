import { useCallback } from "react";
import { useShallow } from "zustand/shallow";
import { setTheme as setThemeIpc } from "@/lib/tauri-commands";
import { useStore } from "@/store";

/**
 * View-model for the user's theme preference (one of "system" | "light" | "dark").
 *
 * The preference lives in two places by design:
 *  - The Zustand `theme` field — read synchronously by `useApplyTheme` (DOM
 *    attribute applier) and by the inline `<script>` in `index.html` via
 *    Zustand `persist` (localStorage). This is the in-WebView2 FOUC
 *    mitigation.
 *  - The Rust `OnboardingState.theme` on disk — the canonical source read
 *    at window-construction time by `commands::config::resolve_window_bg`
 *    to set `WebviewWindowBuilder::background_color` BEFORE WebView2
 *    attaches. This is the OS-paint cold-start FOUC mitigation (PR #363).
 *
 * Unlike `useAuthor`, there is NO hydration on mount — `theme` is in
 * Zustand `partialize` so localStorage hydrates synchronously. Rust reads
 * from `onboarding.json` directly at window-builder time; the renderer
 * never needs to read theme from Rust.
 *
 * On `setTheme`, we persist via the IPC first and only then update the
 * store — so a Rust validation rejection surfaces as a thrown
 * `ConfigError` and the cached value stays correct. Mirrors
 * `useAuthor.setAuthor` exactly.
 */
export type ThemePref = "system" | "light" | "dark";

export interface UseThemePrefResult {
  theme: ThemePref;
  /**
   * Persist `theme` to disk via `set_theme` IPC, then update the Zustand
   * cache. Throws a typed `ConfigError` on validation failure
   * (`InvalidTheme` variant) or persistence failure (`IoError`).
   */
  setTheme: (theme: ThemePref) => Promise<void>;
}

export function useThemePref(): UseThemePrefResult {
  const { theme, setThemeInStore } = useStore(
    useShallow((s) => ({
      theme: s.theme,
      setThemeInStore: s.setTheme,
    })),
  );

  // Stable identity across renders so callers (notably App.tsx ->
  // useMenuListeners) can pass it through dependency arrays without
  // re-subscribing the underlying menu-event listeners on every render.
  const setTheme = useCallback(
    async (next: ThemePref): Promise<void> => {
      await setThemeIpc(next);
      setThemeInStore(next);
    },
    [setThemeInStore],
  );

  return { theme, setTheme };
}
