import { useState, useEffect } from "react";
import { checkPathExists } from "@/lib/tauri-commands";
import type { RecentItem } from "@/store";

export function useRecentItemStatus(recentItems: RecentItem[]) {
  const [pathStatus, setPathStatus] = useState<Record<string, "file" | "dir" | "missing">>({});

  useEffect(() => {
    let cancelled = false;
    async function checkAll() {
      const results: Record<string, "file" | "dir" | "missing"> = {};
      await Promise.all(
        recentItems.map(async (item) => {
          try {
            results[item.path] = await checkPathExists(item.path);
          } catch {
            results[item.path] = "missing";
          }
        }),
      );
      if (!cancelled) setPathStatus(results);
    }
    if (recentItems.length > 0) checkAll();
    return () => {
      cancelled = true;
    };
  }, [recentItems]);

  return pathStatus;
}
