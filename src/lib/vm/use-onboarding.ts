import { useEffect, useState } from "react";
import { onboardingState, type OnboardingState } from "@/lib/tauri-commands";

interface UseOnboardingResult {
  state: OnboardingState | null;
  loading: boolean;
}

/**
 * Read-side ViewModel for onboarding state. Loads once on mount; the FE then
 * decides whether to show the welcome flow based on `last_welcomed_version`
 * vs. the running app version.
 */
export function useOnboarding(): UseOnboardingResult {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    onboardingState()
      .then((s) => {
        if (!cancelled) {
          setState(s);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { state, loading };
}
