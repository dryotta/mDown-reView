import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store/index";

describe("settings slice", () => {
  beforeEach(() => {
    useStore.setState({ settingsDialogOpen: false });
  });

  it("openSettings sets settingsDialogOpen=true", () => {
    useStore.getState().openSettings();
    expect(useStore.getState().settingsDialogOpen).toBe(true);
  });

  it("closeSettings sets settingsDialogOpen=false", () => {
    useStore.setState({ settingsDialogOpen: true });
    useStore.getState().closeSettings();
    expect(useStore.getState().settingsDialogOpen).toBe(false);
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

  it("removed boolean field `settingsOpen` is not exposed (issue #116 migration)", () => {
    const s = useStore.getState() as unknown as Record<string, unknown>;
    expect(s.settingsOpen).toBeUndefined();
  });

  it("removed authorDialogOpen / settingsSurface / setSettingsSurface are not exposed (issue #160 migration)", () => {
    const s = useStore.getState() as unknown as Record<string, unknown>;
    expect(s.authorDialogOpen).toBeUndefined();
    expect(s.settingsSurface).toBeUndefined();
    expect(s.setSettingsSurface).toBeUndefined();
    expect(s.openAuthorDialog).toBeUndefined();
    expect(s.closeAuthorDialog).toBeUndefined();
    expect(s.setAuthorDialogOpen).toBeUndefined();
  });
});

