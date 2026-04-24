import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store/index";
import type { UpdateStatus } from "@/store/index";

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

describe("updateSlice — setUpdateStatus", () => {
  const statuses: UpdateStatus[] = ["idle", "checking", "available", "downloading", "ready", "error"];

  for (const status of statuses) {
    it(`sets status to "${status}"`, () => {
      useStore.getState().setUpdateStatus(status);
      expect(useStore.getState().updateStatus).toBe(status);
    });
  }
});

describe("updateSlice — setUpdateVersion", () => {
  it("sets a version string", () => {
    useStore.getState().setUpdateVersion("2.1.0");
    expect(useStore.getState().updateVersion).toBe("2.1.0");
  });

  it("sets version to null", () => {
    useStore.getState().setUpdateVersion("1.0.0");
    useStore.getState().setUpdateVersion(null);
    expect(useStore.getState().updateVersion).toBeNull();
  });
});

describe("updateSlice — setUpdateProgress", () => {
  it("sets progress to 0", () => {
    useStore.getState().setUpdateProgress(0);
    expect(useStore.getState().updateProgress).toBe(0);
  });

  it("sets progress to 50", () => {
    useStore.getState().setUpdateProgress(50);
    expect(useStore.getState().updateProgress).toBe(50);
  });

  it("sets progress to 100", () => {
    useStore.getState().setUpdateProgress(100);
    expect(useStore.getState().updateProgress).toBe(100);
  });
});

describe("updateSlice — setUpdateChannel", () => {
  it("sets channel to stable", () => {
    useStore.getState().setUpdateChannel("stable");
    expect(useStore.getState().updateChannel).toBe("stable");
  });

  it("sets channel to canary", () => {
    useStore.getState().setUpdateChannel("canary");
    expect(useStore.getState().updateChannel).toBe("canary");
  });

  it("persists channel changes across reads", () => {
    useStore.getState().setUpdateChannel("canary");
    useStore.getState().setUpdateChannel("stable");
    expect(useStore.getState().updateChannel).toBe("stable");
  });
});

describe("updateSlice — dismissUpdate", () => {
  it("resets status to idle", () => {
    useStore.getState().setUpdateStatus("available");
    useStore.getState().dismissUpdate();
    expect(useStore.getState().updateStatus).toBe("idle");
  });

  it("resets version to null", () => {
    useStore.getState().setUpdateVersion("3.0.0");
    useStore.getState().dismissUpdate();
    expect(useStore.getState().updateVersion).toBeNull();
  });

  it("resets progress to 0", () => {
    useStore.getState().setUpdateProgress(75);
    useStore.getState().dismissUpdate();
    expect(useStore.getState().updateProgress).toBe(0);
  });

  it("resets all three fields at once", () => {
    useStore.getState().setUpdateStatus("downloading");
    useStore.getState().setUpdateVersion("2.0.0");
    useStore.getState().setUpdateProgress(42);
    useStore.getState().dismissUpdate();

    const { updateStatus, updateVersion, updateProgress } = useStore.getState();
    expect(updateStatus).toBe("idle");
    expect(updateVersion).toBeNull();
    expect(updateProgress).toBe(0);
  });

  it("does not affect updateChannel", () => {
    useStore.getState().setUpdateChannel("canary");
    useStore.getState().setUpdateStatus("available");
    useStore.getState().dismissUpdate();
    expect(useStore.getState().updateChannel).toBe("canary");
  });
});
