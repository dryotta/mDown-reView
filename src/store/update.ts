/**
 * Update slice — extracted from index.ts to keep that file under the
 * 500-line shared-chokepoint budget (rule 23 in `docs/architecture.md`).
 *
 * Auto-update status, version string, download progress, and channel
 * preference. Only `updateChannel` is persisted (see `partialize` in
 * index.ts); the rest is session-only.
 */
import type { StoreApi } from "zustand";
import type { Store } from "./index";

// "error" is treated identically to "idle" by the banner (silent fallback);
// reserved for future telemetry.
export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "error";
export type UpdateChannel = "stable" | "canary";

export interface UpdateSlice {
  updateStatus: UpdateStatus;
  updateVersion: string | null;
  updateProgress: number; // 0–100 during download
  updateChannel: UpdateChannel;
  setUpdateStatus: (status: UpdateStatus) => void;
  setUpdateVersion: (version: string | null) => void;
  setUpdateProgress: (progress: number) => void;
  setUpdateChannel: (channel: UpdateChannel) => void;
  dismissUpdate: () => void;
}

type SliceSet = StoreApi<Store>["setState"];

export function createUpdateSlice(set: SliceSet): UpdateSlice {
  return {
    updateStatus: "idle",
    updateVersion: null,
    updateProgress: 0,
    updateChannel: "stable",
    setUpdateStatus: (status) => set({ updateStatus: status }),
    setUpdateVersion: (version) => set({ updateVersion: version }),
    setUpdateProgress: (progress) => set({ updateProgress: progress }),
    setUpdateChannel: (channel) => set({ updateChannel: channel }),
    dismissUpdate: () => set({ updateStatus: "idle", updateVersion: null, updateProgress: 0 }),
  };
}
