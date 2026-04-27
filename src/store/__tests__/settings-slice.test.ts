import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store/index";

describe("settings slice", () => {
  beforeEach(() => {
    // reset both Settings surfaces between tests (issue #116)
    useStore.setState({ settingsSurface: "closed", authorDialogOpen: false });
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

  it("openAuthorDialog sets authorDialogOpen=true and does NOT change settingsSurface (independence — issue #116)", () => {
    useStore.setState({ settingsSurface: "inline" });
    useStore.getState().openAuthorDialog();
    expect(useStore.getState().authorDialogOpen).toBe(true);
    // Critical: opening the child modal must leave the underlying page mounted.
    expect(useStore.getState().settingsSurface).toBe("inline");
  });

  it("closeAuthorDialog sets authorDialogOpen=false and does NOT change settingsSurface", () => {
    useStore.setState({ settingsSurface: "inline", authorDialogOpen: true });
    useStore.getState().closeAuthorDialog();
    expect(useStore.getState().authorDialogOpen).toBe(false);
    expect(useStore.getState().settingsSurface).toBe("inline");
  });

  it("opening then dismissing the author dialog leaves SettingsView intact (architect regression — issue #116)", () => {
    useStore.setState({ settingsSurface: "inline" });
    useStore.getState().openAuthorDialog();
    useStore.getState().closeAuthorDialog();
    expect(useStore.getState().settingsSurface).toBe("inline");
    expect(useStore.getState().authorDialogOpen).toBe(false);
  });

  it("setSettingsSurface accepts each discriminated-union value", () => {
    const set = useStore.getState().setSettingsSurface;
    set("inline");
    expect(useStore.getState().settingsSurface).toBe("inline");
    set("closed");
    expect(useStore.getState().settingsSurface).toBe("closed");
  });

  it("setAuthorDialogOpen toggles the boolean independently", () => {
    useStore.getState().setAuthorDialogOpen(true);
    expect(useStore.getState().authorDialogOpen).toBe(true);
    useStore.getState().setAuthorDialogOpen(false);
    expect(useStore.getState().authorDialogOpen).toBe(false);
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
});

