/** Cap for badge counts — values above this display as "99+". */
export const BADGE_CAP = 99;

/** Format a numeric count for badge display, capping at 99+. */
export function formatBadgeCount(count: number): string {
  return count > BADGE_CAP ? "99+" : String(count);
}
