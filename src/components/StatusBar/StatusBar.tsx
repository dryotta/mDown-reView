import { useEffect, useState } from "react";
import { useStore } from "@/store";
import "@/styles/status-bar.css";

const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** Format a byte count: "512 B", "1.2 KB", "3.4 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** Format a relative timestamp as "just now", "5 minutes ago", "2 hours ago", etc. */
export function formatRelative(ts: number, now: number): string {
  const diffSec = Math.floor((now - ts) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return RTF.format(-diffMin, "minute");
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return RTF.format(-diffHr, "hour");
  const diffDay = Math.floor(diffHr / 24);
  return RTF.format(-diffDay, "day");
}

/** Truncate a path from the start, keeping the tail visible. */
export function truncatePath(path: string, max = 60): string {
  if (path.length <= max) return path;
  return `…${path.slice(path.length - (max - 1))}`;
}

/**
 * StatusBar reads everything it needs from the Zustand store via fine-grained
 * scalar selectors (Object.is identity prevents over-render). Crucially it
 * does NOT call `useFileContent` — that hook is the SOLE issuer of
 * `read_text_file`, and ViewerRouter already mounts it. Reading file metadata
 * here would double the IPC + UTF-8 decode + line-count cost on every tab
 * activation. Instead, `useFileContent` and `use-comments` populate
 * `fileMetaByPath` (size, line count, file mtime, comments-sidecar mtime) on
 * each successful load, and we read the cached values.
 */
export function StatusBar() {
  const activeTabPath = useStore((s) => s.activeTabPath);

  // Fine-grained scalar selectors — Object.is on a number/undefined prevents
  // over-render when unrelated paths' entries change.
  const sizeBytes = useStore((s) =>
    activeTabPath ? s.fileMetaByPath[activeTabPath]?.sizeBytes : undefined,
  );
  const lineCount = useStore((s) =>
    activeTabPath ? s.fileMetaByPath[activeTabPath]?.lineCount : undefined,
  );
  // Read mtime scalars (file mtime + comments sidecar mtime) one-per-selector so
  // a change to one does not invalidate the other's reactive consumer.
  const fileMtime = useStore((s) =>
    activeTabPath ? s.fileMetaByPath[activeTabPath]?.fileMtime : undefined,
  );
  const commentsMtime = useStore((s) =>
    activeTabPath ? s.fileMetaByPath[activeTabPath]?.commentsMtime : undefined,
  );

  // Tick once per minute so "N min ago" labels stay fresh. The state value
  // *is* the current wall-clock time, captured at tick boundaries — keeping
  // Date.now() out of the render body (react-hooks/purity).
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!activeTabPath) return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [activeTabPath]);

  if (!activeTabPath) {
    return <div className="status-bar status-bar-empty" role="status" aria-label="Status bar" />;
  }

  return (
    <div className="status-bar" role="status" aria-label="Status bar">
      <span className="status-bar-path" title={activeTabPath}>
        {truncatePath(activeTabPath)}
      </span>
      {sizeBytes !== undefined && (
        <span className="status-bar-item">{formatSize(sizeBytes)}</span>
      )}
      {lineCount !== undefined && (
        <span className="status-bar-item">{lineCount.toLocaleString()} lines</span>
      )}
      {fileMtime != null && (
        <span className="status-bar-item" title={new Date(fileMtime).toLocaleString()}>
          File last changed {formatRelative(fileMtime, now)}
        </span>
      )}
      {commentsMtime != null && (
        <span className="status-bar-item" title={new Date(commentsMtime).toLocaleString()}>
          Comments last changed {formatRelative(commentsMtime, now)}
        </span>
      )}
    </div>
  );
}
