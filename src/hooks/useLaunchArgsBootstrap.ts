import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getLaunchArgs } from "@/lib/tauri-commands";
import { useStore, openFilesFromArgs } from "@/store";

/**
 * Loads CLI launch args on mount and subscribes to second-instance "args-received"
 * events. Calls `openFilesFromArgs` for each result.
 */
export function useLaunchArgsBootstrap() {
  useEffect(() => {
    let cancelled = false;

    getLaunchArgs()
      .then(({ files, folders }) => {
        if (cancelled) return;
        openFilesFromArgs(files, folders, useStore.getState());
      })
      .catch(() => {});

    const argsListener = listen<{ files: string[]; folders: string[] }>(
      "args-received",
      (event) => {
        openFilesFromArgs(
          event.payload.files,
          event.payload.folders,
          useStore.getState(),
        );
      },
    );

    return () => {
      cancelled = true;
      argsListener.then((fn) => fn()).catch(() => {});
    };
  }, []);
}
