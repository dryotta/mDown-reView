import { useEffect } from "react";
import { listenEvent } from "@/lib/tauri-events";
import { getLaunchArgs } from "@/lib/tauri-commands";
import { useStore, openFilesFromArgs } from "@/store";

/**
 * Loads CLI launch args on mount and subscribes to second-instance
 * "args-received" signals. The signal carries no payload — the listener
 * MUST call `get_launch_args` to drain whatever the Rust side has queued.
 *
 * Ordering invariant: the listener is registered BEFORE the initial
 * `getLaunchArgs()` await so a second-instance signal racing with the
 * first-instance fetch cannot be lost.
 *
 * No cancellation flag is needed because `get_launch_args` is itself a
 * draining IPC: each call consumes the queued args atomically. If the
 * effect unmounts (e.g. React StrictMode in dev) after a drain has
 * already shifted the queue, the data MUST still be applied to the
 * store, otherwise we silently lose the user's CLI args. The store is
 * a process-global singleton so writing to it post-unmount is safe.
 */
export function useLaunchArgsBootstrap() {
  useEffect(() => {
    const drain = () => {
      getLaunchArgs()
        .then(({ files, folders }) => {
          if (files.length === 0 && folders.length === 0) return;
          openFilesFromArgs(files, folders, useStore.getState());
        })
        .catch(() => {});
    };

    // Attach the listener synchronously FIRST so we don't miss a signal
    // that races with the initial drain below.
    const argsListener = listenEvent("args-received", () => {
      drain();
    });

    // Initial drain for first-instance launch args.
    drain();

    return () => {
      argsListener.then((fn) => fn()).catch(() => {});
    };
  }, []);
}
