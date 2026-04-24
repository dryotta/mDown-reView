import { useCallback } from "react";
import { installUpdate } from "@/lib/tauri-commands";
import { useStore } from "@/store";

export function useUpdateActions() {
  const setUpdateStatus = useStore((s) => s.setUpdateStatus);
  const setUpdateProgress = useStore((s) => s.setUpdateProgress);

  const install = useCallback(async () => {
    setUpdateStatus("downloading");
    try {
      await installUpdate();
    } catch {
      setUpdateProgress(0);
      setUpdateStatus("available");
    }
  }, [setUpdateStatus, setUpdateProgress]);

  return { install };
}
