import { useEffect } from "react";
import { useStore } from "@/store";
import * as logger from "@/logger";

const FOCUS_REFRESH_DEBOUNCE_MS = 300;

/**
 * Onboarding bootstrap: on mount, hydrate onboarding status from the backend;
 * while mounted, re-poll status whenever the window regains focus (debounced)
 * so flows that complete in another window — e.g. Windows
 * "Settings → Default apps" — show a fresh state on return.
 *
 * Failures are swallowed via the `logger` chokepoint; onboarding never crashes
 * the app. No first-run modal is opened from here — the WelcomeView is the
 * no-tab default surface as of #79.
 */
export function useOnboardingBootstrap(): void {
  // Run-once bootstrap.
  useEffect(() => {
    useStore
      .getState()
      .refreshOnboarding()
      .catch((err) => {
        logger.warn(`[onboarding] bootstrap failed: ${String(err)}`);
      });
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
