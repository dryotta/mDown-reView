import type { Severity } from "@/lib/tauri-commands";

interface CommentBadgeProps {
  /** Unresolved-thread count. The component renders nothing when count <= 0. */
  count: number;
  /** Worst severity across unresolved threads — drives the badge colour. */
  severity?: Severity | null;
  /** Placement-specific base class (e.g. `tree-comment-badge`, `tab-badge`). */
  className: string;
}

/**
 * Presentational badge for unresolved comment counts. Severity is exposed via
 * `data-severity` so callers can colour-tune via CSS without per-variant JSX.
 */
export function CommentBadge({ count, severity, className }: CommentBadgeProps) {
  if (count <= 0) return null;
  const sev = severity ?? "none";
  return (
    <span
      className={className}
      data-severity={sev}
      aria-label={`${count} unresolved comment${count === 1 ? "" : "s"}${sev !== "none" ? ` (${sev} severity)` : ""}`}
    >
      {count}
    </span>
  );
}
