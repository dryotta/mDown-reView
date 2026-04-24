import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useOnboarding } from "../use-onboarding";
import { onboardingState, type OnboardingState } from "@/lib/tauri-commands";

vi.mock("@/lib/tauri-commands", () => ({
  onboardingState: vi.fn(),
}));

const mockedOnboardingState = vi.mocked(onboardingState);

beforeEach(() => {
  mockedOnboardingState.mockReset();
});

describe("useOnboarding", () => {
  it("starts with loading=true and state=null", () => {
    mockedOnboardingState.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.loading).toBe(true);
    expect(result.current.state).toBeNull();
  });

  it("loads state on mount", async () => {
    const payload: OnboardingState = {
      schema_version: 1,
      last_welcomed_version: "0.3.4",
      last_seen_sections: ["cli"],
    };
    mockedOnboardingState.mockResolvedValueOnce(payload);
    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.state).toEqual(payload);
  });

  it("sets loading=false and leaves state=null on error", async () => {
    mockedOnboardingState.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.state).toBeNull();
  });

  it("does not setState after unmount (cancellation)", async () => {
    let resolve!: (v: OnboardingState) => void;
    mockedOnboardingState.mockImplementation(
      () => new Promise<OnboardingState>((r) => { resolve = r; }),
    );
    const { result, unmount } = renderHook(() => useOnboarding());
    unmount();
    resolve({
      schema_version: 1,
      last_welcomed_version: "0.9.9",
      last_seen_sections: [],
    });
    // Give the microtask queue a tick to flush the resolved promise
    await new Promise((r) => setTimeout(r, 0));
    // Final snapshot is the pre-unmount state — loading still true, state null
    expect(result.current.loading).toBe(true);
    expect(result.current.state).toBeNull();
  });
});
