import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useStore, formatOnboardingError, type OnboardingState } from "@/store";

vi.mock("@tauri-apps/api/core");

const mockedInvoke = vi.mocked(invoke);

const RESET_ONBOARDING = {
  onboardingStatuses: { cliShim: "pending" as const, defaultHandler: "pending" as const, folderContext: "pending" as const },
  onboardingState: null,
  onboardingErrors: {},
  welcomePanelOpen: false,
  setupPanelOpen: false,
};

beforeEach(() => {
  mockedInvoke.mockReset();
  useStore.setState(RESET_ONBOARDING);
});

/** Default IPC router. Override by re-setting `mockedInvoke.mockImplementation`. */
function routeIpc(routes: Record<string, () => unknown>) {
  mockedInvoke.mockImplementation(async (cmd: string) => {
    const handler = routes[cmd];
    if (!handler) throw new Error(`Unmocked IPC command: ${cmd}`);
    return handler() as never;
  });
}

const STATE_FIXTURE: OnboardingState = {
  schema_version: 1,
  last_welcomed_version: "0.3.4",
  last_seen_sections: ["cli"],
};

describe("OnboardingSlice — refreshOnboarding", () => {
  it("populates statuses from IPC", async () => {
    routeIpc({
      cli_shim_status: () => "done",
      default_handler_status: () => "other",      // → pending in slice alphabet
      folder_context_status: () => "missing",     // → pending in slice alphabet
      onboarding_state: () => STATE_FIXTURE,
    });

    await useStore.getState().refreshOnboarding();

    const s = useStore.getState();
    expect(s.onboardingStatuses).toEqual({
      cliShim: "done",
      defaultHandler: "pending",
      folderContext: "pending",
    });
    expect(s.onboardingState).toEqual(STATE_FIXTURE);
    expect(s.onboardingErrors).toEqual({});
  });

  it("handles partial failures via allSettled", async () => {
    routeIpc({
      cli_shim_status: () => { throw "io error"; },
      default_handler_status: () => "done",
      folder_context_status: () => "unsupported",
      onboarding_state: () => STATE_FIXTURE,
    });

    await useStore.getState().refreshOnboarding();

    const s = useStore.getState();
    expect(s.onboardingStatuses.cliShim).toBe("error");
    expect(s.onboardingStatuses.defaultHandler).toBe("done");
    expect(s.onboardingStatuses.folderContext).toBe("unsupported");
    expect(s.onboardingState).toEqual(STATE_FIXTURE);
    expect(s.onboardingErrors.cliShim).toContain("io error");
  });
});

describe("OnboardingSlice — markOnboardingWelcomed", () => {
  it("calls IPC with version arg and refreshes state", async () => {
    const calls: Array<{ cmd: string; args?: unknown }> = [];
    mockedInvoke.mockImplementation(async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "onboarding_state") return STATE_FIXTURE as never;
      return undefined as never;
    });

    await useStore.getState().markOnboardingWelcomed("0.4.0");

    const markCall = calls.find((c) => c.cmd === "onboarding_mark_welcomed");
    expect(markCall).toBeDefined();
    expect(markCall!.args).toEqual({ version: "0.4.0" });
    expect(calls.some((c) => c.cmd === "onboarding_state")).toBe(true);
  });
});

describe("OnboardingSlice — dismissOnboardingWelcome", () => {
  it("closes panel without calling IPC", () => {
    useStore.setState({ welcomePanelOpen: true });

    useStore.getState().dismissOnboardingWelcome();

    expect(useStore.getState().welcomePanelOpen).toBe(false);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});

describe("OnboardingSlice — installCliShim", () => {
  it("sets a permission-denied message when IPC rejects with structured error", async () => {
    const calls: string[] = [];
    mockedInvoke.mockImplementation(async (cmd) => {
      calls.push(cmd);
      if (cmd === "install_cli_shim") {
        // Tauri rejects pass through the value as-is; structured errors arrive as objects.
        throw {
          kind: "permission_denied",
          path: "/usr/local/bin/mdownreview-cli",
          target: "/Applications/mdownreview.app/Contents/MacOS/mdownreview-cli",
        };
      }
      // status refresh after settle:
      if (cmd === "onboarding_state") return STATE_FIXTURE as never;
      return "missing" as never;
    });

    await useStore.getState().installCliShim();

    const err = useStore.getState().onboardingErrors.cliShim ?? "";
    expect(err.toLowerCase()).toContain("permission denied");
    expect(err).toContain("sudo");
    // Status refresh ran in finally:
    expect(calls).toContain("cli_shim_status");
  });

  it("refreshes status on success and clears prior error", async () => {
    useStore.setState({ onboardingErrors: { cliShim: "stale" } });
    const calls: string[] = [];
    mockedInvoke.mockImplementation(async (cmd) => {
      calls.push(cmd);
      if (cmd === "onboarding_state") return STATE_FIXTURE as never;
      if (cmd === "install_cli_shim") return undefined as never;
      return "done" as never;
    });

    await useStore.getState().installCliShim();

    expect(calls).toContain("install_cli_shim");
    expect(calls).toContain("cli_shim_status");
    const s = useStore.getState();
    expect(s.onboardingErrors.cliShim).toBeUndefined();
    expect(s.onboardingStatuses.cliShim).toBe("done");
  });
});

describe("OnboardingSlice — panel toggles", () => {
  it("openWelcome / closeWelcome toggle the flag", () => {
    useStore.getState().openWelcome();
    expect(useStore.getState().welcomePanelOpen).toBe(true);
    useStore.getState().closeWelcome();
    expect(useStore.getState().welcomePanelOpen).toBe(false);
  });

  it("openSetup / closeSetup toggle the flag", () => {
    useStore.getState().openSetup();
    expect(useStore.getState().setupPanelOpen).toBe(true);
    useStore.getState().closeSetup();
    expect(useStore.getState().setupPanelOpen).toBe(false);
  });

  it("openSetup closes Welcome and vice versa (mutually exclusive)", () => {
    useStore.getState().openWelcome();
    expect(useStore.getState().welcomePanelOpen).toBe(true);
    useStore.getState().openSetup();
    const s1 = useStore.getState();
    expect(s1.welcomePanelOpen).toBe(false);
    expect(s1.setupPanelOpen).toBe(true);
    useStore.getState().openWelcome();
    const s2 = useStore.getState();
    expect(s2.welcomePanelOpen).toBe(true);
    expect(s2.setupPanelOpen).toBe(false);
  });
});

describe("formatOnboardingError", () => {
  it("formats permission_denied with sudo hint", () => {
    const out = formatOnboardingError({
      kind: "permission_denied",
      path: "/usr/local/bin/x",
      target: "/Applications/mdownreview.app/Contents/MacOS/mdownreview-cli",
    });
    expect(out.toLowerCase()).toContain("permission denied");
    expect(out).toContain("/usr/local/bin/x");
    expect(out).toContain("/Applications/mdownreview.app/Contents/MacOS/mdownreview-cli");
    expect(out).toContain("sudo ln -sf");
    // target must precede path in the rendered command
    expect(out).toMatch(
      /sudo ln -sf .*mdownreview-cli .*\/usr\/local\/bin\/x/,
    );
  });

  it("renders io variant message, not raw JSON", () => {
    const out = formatOnboardingError({ kind: "io", message: "disk full" });
    expect(out).toBe("disk full");
    expect(out).not.toContain("{");
  });

  it("returns Error.message for Error instances", () => {
    expect(formatOnboardingError(new Error("boom"))).toBe("boom");
  });

  it("returns the string as-is for string rejections", () => {
    expect(formatOnboardingError("plain")).toBe("plain");
  });
});
