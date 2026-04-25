import { useEffect } from "react";
import { useShallow } from "zustand/shallow";
import { useStore } from "@/store";
import { SectionShell } from "./SectionShell";
import { buildSetupSections, buildOnboardingActions } from "./sections";
import "@/styles/onboarding.css";

const USER_GUIDE_URL =
  "https://github.com/dryotta/mdownreview/blob/main/docs/features/onboarding.md";
const REPORT_ISSUE_URL = "https://github.com/dryotta/mdownreview/issues/new";

export function SetupPanel() {
  const { setupPanelOpen, onboardingStatuses, onboardingErrors } = useStore(
    useShallow((s) => ({
      setupPanelOpen: s.setupPanelOpen,
      onboardingStatuses: s.onboardingStatuses,
      onboardingErrors: s.onboardingErrors,
    })),
  );

  useEffect(() => {
    if (!setupPanelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") useStore.getState().closeSetup();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setupPanelOpen]);

  if (!setupPanelOpen) return null;

  const actions = buildOnboardingActions();

  const sections = buildSetupSections({
    statuses: onboardingStatuses,
    errors: onboardingErrors,
    actions,
  });

  const handleClose = () => useStore.getState().closeSetup();

  return (
    <div
      className="onboarding-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Setup"
      onClick={handleClose}
    >
      <div className="onboarding-panel" onClick={(e) => e.stopPropagation()}>
        <div className="onboarding-header">
          <h2>Setup</h2>
          <button
            type="button"
            className="onboarding-close"
            aria-label="Close"
            onClick={handleClose}
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
          <div className="onboarding-footer-links">
            <span>Update channel: see About → Updates</span>
            <a href={USER_GUIDE_URL} target="_blank" rel="noopener noreferrer">
              User guide
            </a>
            <a href={REPORT_ISSUE_URL} target="_blank" rel="noopener noreferrer">
              Report an issue
            </a>
          </div>
          <div className="onboarding-footer-actions">
            <button
              type="button"
              className="section-shell-btn section-shell-btn-primary"
              onClick={handleClose}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
