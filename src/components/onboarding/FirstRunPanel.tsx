import { useEffect } from "react";
import { useShallow } from "zustand/shallow";
import { useStore } from "@/store";
import { useAboutInfo } from "@/hooks/useAboutInfo";
import { SectionShell } from "./SectionShell";
import { buildFirstRunSections, buildOnboardingActions } from "./sections";
import "@/styles/onboarding.css";

const FALLBACK_VERSION = "0.3.4";

export function FirstRunPanel() {
  const {
    welcomePanelOpen,
    onboardingStatuses,
    onboardingState,
    onboardingErrors,
  } = useStore(
    useShallow((s) => ({
      welcomePanelOpen: s.welcomePanelOpen,
      onboardingStatuses: s.onboardingStatuses,
      onboardingState: s.onboardingState,
      onboardingErrors: s.onboardingErrors,
    })),
  );

  const { version: appVersion } = useAboutInfo();
  const currentVersion = appVersion || FALLBACK_VERSION;

  // Dismiss = "Skip for now" (does NOT mark welcomed). Same as backdrop / ESC.
  useEffect(() => {
    if (!welcomePanelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") useStore.getState().dismissOnboardingWelcome();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [welcomePanelOpen]);

  if (!welcomePanelOpen) return null;

  const isWhatsNew = onboardingState?.last_welcomed_version != null;
  const title = isWhatsNew
    ? `What's new in v${currentVersion}`
    : "Welcome to mDown reView";

  const actions = buildOnboardingActions();

  const sections = buildFirstRunSections({
    statuses: onboardingStatuses,
    errors: onboardingErrors,
    actions,
  });

  const handleDone = async () => {
    await useStore.getState().markOnboardingWelcomed(currentVersion);
    useStore.getState().closeWelcome();
  };

  const handleSkip = () => {
    useStore.getState().dismissOnboardingWelcome();
  };

  return (
    <div
      className="onboarding-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={handleSkip}
    >
      <div className="onboarding-panel" onClick={(e) => e.stopPropagation()}>
        <div className="onboarding-header">
          <h2>{title}</h2>
          <button
            type="button"
            className="onboarding-close"
            aria-label="Close"
            onClick={handleSkip}
          >
            ×
          </button>
        </div>
        <div className="onboarding-body">
          {sections.map((s) => (
            <SectionShell key={s.key} {...s.shellProps} />
          ))}
        </div>
        <div className="onboarding-footer">
          <div className="onboarding-footer-actions">
            <button
              type="button"
              className="section-shell-btn"
              onClick={handleSkip}
            >
              Skip for now
            </button>
            <button
              type="button"
              className="section-shell-btn section-shell-btn-primary"
              onClick={handleDone}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
