import { useEffect } from "react";
import { useStore } from "@/store";
import { onboardingShouldWelcome } from "@/lib/tauri-commands";
import * as logger from "@/logger";

const FOCUS_REFRESH_DEBOUNCE_MS = 300;

/**
 * Onboarding bootstrap: on mount, refresh status + maybe auto-open the welcome
 * panel; while mounted, re-poll status whenever the window regains focus
 * (debounced) so flows that complete in another window — e.g. Windows
 * "Settings → Default apps" — show a fresh state on return.
 *
 * Failures are swallowed via the `logger` chokepoint; onboarding never crashes
 * the app.
 */
export function useOnboardingBootstrap(): void {
  // Run-once bootstrap.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await useStore.getState().refreshOnboarding();
        if (cancelled) return;
        if (await onboardingShouldWelcome()) {
          useStore.getState().openWelcome();
        }
      } catch (err) {
        logger.warn(`[onboarding] bootstrap failed: ${String(err)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-poll status on window focus (debounced).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onFocus = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        useStore
          .getState()
          .refreshOnboarding()
          .catch((err) => {
            logger.warn(`[onboarding] focus refresh failed: ${String(err)}`);
          });
      }, FOCUS_REFRESH_DEBOUNCE_MS);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      if (timer) clearTimeout(timer);
    };
  }, []);
}
