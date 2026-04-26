import { useEffect, useState, useMemo } from "react";
import { useStore } from "@/store/index";
import { listenEvent } from "@/lib/tauri-events";
import { getFileComments, type CommentThread } from "@/lib/tauri-commands";
import { error } from "@/logger";

/** Map of file path → that file's comment threads, across the open
 *  workspace. Sources file paths from open tabs and from the
 *  `ghostEntries` slice (which mirrors `scan_review_files` — every
 *  sidecar pair, not just orphans). Reloads on `comments-changed`
 *  and on `file-changed` (kind: "review") events.
 *
 *  This hook is intentionally small: it fans out per-file
 *  `get_file_comments` IPC calls. The Rust side is the chokepoint;
 *  we don't denormalise threads here. */
export function useWorkspaceComments(
  enabled: boolean,
): Record<string, CommentThread[]> {
  const tabs = useStore((s) => s.tabs);
  const ghostEntries = useStore((s) => s.ghostEntries);
  const [reloadKey, setReloadKey] = useState(0);
  const [byPath, setByPath] = useState<Record<string, CommentThread[]>>({});

  const paths = useMemo(() => {
    if (!enabled) return [] as string[];
    const set = new Set<string>();
    tabs.forEach((t) => set.add(t.path));
    ghostEntries.forEach((g) => set.add(g.sourcePath));
    return Array.from(set).sort();
  }, [enabled, tabs, ghostEntries]);

  const pathsKey = paths.join("\0");

  useEffect(() => {
    if (!enabled || paths.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setByPath({});
      return;
    }
    let cancelled = false;
    Promise.all(
      paths.map((p) =>
        getFileComments(p)
          .then((threads) => [p, threads] as const)
          .catch((e) => {
            error(`[useWorkspaceComments] ${p}: ${e}`);
            return [p, [] as CommentThread[]] as const;
          }),
      ),
    ).then((entries) => {
      if (cancelled) return;
      const next: Record<string, CommentThread[]> = {};
      for (const [p, threads] of entries) next[p] = threads;
      setByPath(next);
    });
    return () => {
      cancelled = true;
    };
    // pathsKey dedupes path-array identity churn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pathsKey, reloadKey]);

  useEffect(() => {
    if (!enabled) return;
    const a = listenEvent("comments-changed", () => setReloadKey((k) => k + 1));
    const b = listenEvent("file-changed", (payload) => {
      if (payload.kind === "review") setReloadKey((k) => k + 1);
    });
    return () => {
      a.then((fn) => fn()).catch(() => {});
      b.then((fn) => fn()).catch(() => {});
    };
  }, [enabled]);

  return byPath;
}
