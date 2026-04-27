import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store/index";

describe("settings slice", () => {
  beforeEach(() => {
    // reset settingsSurface to 'closed' between tests (issue #116)
    useStore.setState({ settingsSurface: "closed" });
  });

  it("openSettings sets settingsSurface='inline'", () => {
    useStore.getState().openSettings();
    expect(useStore.getState().settingsSurface).toBe("inline");
  });

  it("closeSettings sets settingsSurface='closed'", () => {
    useStore.setState({ settingsSurface: "inline" });
    useStore.getState().closeSettings();
    expect(useStore.getState().settingsSurface).toBe("closed");
  });

  it("openAuthorDialog sets settingsSurface='modal' (single-surface invariance — issue #116)", () => {
    useStore.setState({ settingsSurface: "inline" });
    useStore.getState().openAuthorDialog();
    // Critical: switching to 'modal' must replace 'inline', not co-exist.
    expect(useStore.getState().settingsSurface).toBe("modal");
  });

  it("setSettingsSurface accepts each discriminated-union value", () => {
    const set = useStore.getState().setSettingsSurface;
    set("inline");
    expect(useStore.getState().settingsSurface).toBe("inline");
    set("modal");
    expect(useStore.getState().settingsSurface).toBe("modal");
    set("closed");
    expect(useStore.getState().settingsSurface).toBe("closed");
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

  it("removed boolean fields are not exposed (issue #116 migration)", () => {
    const s = useStore.getState() as unknown as Record<string, unknown>;
    expect(s.settingsOpen).toBeUndefined();
    expect(s.authorDialogOpen).toBeUndefined();
  });
});

