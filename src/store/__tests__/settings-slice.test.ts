import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store/index";

describe("settings slice", () => {
  beforeEach(() => {
    // reset settingsOpen to false between tests
    useStore.setState({ settingsOpen: false });
  });

  it("openSettings sets settingsOpen=true", () => {
    useStore.getState().openSettings();
    expect(useStore.getState().settingsOpen).toBe(true);
  });

  it("closeSettings sets settingsOpen=false", () => {
    useStore.setState({ settingsOpen: true });
    useStore.getState().closeSettings();
    expect(useStore.getState().settingsOpen).toBe(false);
  });

  it("legacy welcome/setup keys are not exposed", () => {
    const s = useStore.getState() as unknown as Record<string, unknown>;
    expect(s.welcomePanelOpen).toBeUndefined();
    expect(s.setupPanelOpen).toBeUndefined();
    expect(s.openWelcome).toBeUndefined();
    expect(s.openSetup).toBeUndefined();
    expect(s.closeSetup).toBeUndefined();
    expect(s.markOnboardingWelcomed).toBeUndefined();
  });
});
