import type { Severity } from "@/lib/tauri-commands";
import { BADGE_CAP, formatBadgeCount } from "@/lib/format-badge-count";

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
  const capped = count > BADGE_CAP;
  const display = formatBadgeCount(count);
  return (
    <span
      className={`${className}${capped ? " badge-capped" : ""}`}
      data-severity={sev}
      aria-label={`${count} unresolved comment${count === 1 ? "" : "s"}${sev !== "none" ? ` (${sev} severity)` : ""}`}
    >
      {display}
    </span>
  );
}
