/**
 * B6 — slice tests for the onboarding action wrappers and `refreshOnboarding`.
 *
 * These exercise the runtime contract documented in `docs/features/settings.md`:
 *   - `refreshOnboarding` populates `onboardingStatuses` from the three IPC
 *     reads via `Promise.allSettled`, never throwing.
 *   - A rejected status read marks that key as `status="error"` and writes a
 *     formatted string into `onboardingErrors[key]`.
 *   - Each per-section action wrapper (`installCliShim`, `removeCliShim`,
 *     `setDefaultHandler`)
 *     clears any prior error for its section on success and records a
 *     formatted error on rejection.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { MockedFunction } from "vitest";
import { useStore } from "@/store";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core");

const mockedInvoke = invoke as MockedFunction<typeof invoke>;

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({
    onboardingStatuses: {
      cliShim: "pending",
      defaultHandler: "pending",
    },
    onboardingErrors: {},
    onboardingState: null,
  });
});

describe("refreshOnboarding", () => {
  it("happy path: populates onboardingStatuses from the three status reads", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "cli_shim_status") return "done";
      if (cmd === "default_handler_status") return "done";
      if (cmd === "onboarding_state") return { schema_version: 1, last_seen_sections: [] };
      return undefined;
    });

    await useStore.getState().refreshOnboarding();

    const s = useStore.getState();
    expect(s.onboardingStatuses).toEqual({
      cliShim: "done",
      defaultHandler: "done",
    });
    expect(s.onboardingErrors).toEqual({});
    expect(s.onboardingState).toEqual({
      schema_version: 1,
      last_seen_sections: [],
    });
  });

  it("partial failure: rejected read becomes status=error and onboardingErrors[key] is set", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "cli_shim_status") throw "permission denied: /usr/local/bin";
      if (cmd === "default_handler_status") return "done";
      if (cmd === "onboarding_state") return { schema_version: 1, last_seen_sections: [] };
      return undefined;
    });

    await useStore.getState().refreshOnboarding();

    const s = useStore.getState();
    expect(s.onboardingStatuses.cliShim).toBe("error");
    expect(s.onboardingStatuses.defaultHandler).toBe("done");
    expect(s.onboardingErrors.cliShim).toContain("permission denied");
  });
});

// ── action wrappers ────────────────────────────────────────────────────────

interface ActionCase {
  name: keyof ReturnType<typeof useStore.getState>;
  ipcCmd: string;
  sectionKey: "cliShim" | "defaultHandler";
}

const cases: ActionCase[] = [
  { name: "installCliShim", ipcCmd: "install_cli_shim", sectionKey: "cliShim" },
  { name: "removeCliShim", ipcCmd: "remove_cli_shim", sectionKey: "cliShim" },
  {
    name: "setDefaultHandler",
    ipcCmd: "set_default_handler",
    sectionKey: "defaultHandler",
  },
];

describe.each(cases)("action wrapper: $name", ({ name, ipcCmd, sectionKey }) => {
  it("success → clears prior error and refreshes status", async () => {
    useStore.setState({
      onboardingErrors: { [sectionKey]: "stale error" },
    });

    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === ipcCmd) return undefined;
      // status reads (refresh chained from runOnboardingAction)
      if (cmd.endsWith("_status")) return "done";
      if (cmd === "onboarding_state") return { schema_version: 1, last_seen_sections: [] };
      return undefined;
    });

    const action = useStore.getState()[name] as () => Promise<void>;
    await action();

    expect(mockedInvoke).toHaveBeenCalledWith(ipcCmd);
    const s = useStore.getState();
    expect(s.onboardingErrors[sectionKey]).toBeUndefined();
  });

  it("reject → stores formatted error in onboardingErrors[key]", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === ipcCmd) throw "boom: action failed";
      if (cmd.endsWith("_status")) return "missing";
      if (cmd === "onboarding_state") return { schema_version: 1, last_seen_sections: [] };
      return undefined;
    });

    const action = useStore.getState()[name] as () => Promise<void>;
    await action();

    expect(useStore.getState().onboardingErrors[sectionKey]).toBe("boom: action failed");
  });
});
