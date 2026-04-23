/// MRSF v1.0 comment utility constants and UI-side helpers.
/// Functions that duplicate Rust core logic have been removed.
/// Only UI input-validation helpers remain (truncation before IPC, display limits).

/** Spec §6.2: selected_text MUST NOT exceed 4096 characters. */
export const SELECTED_TEXT_MAX_LENGTH = 4096;

/** Spec §6.1: text SHOULD NOT exceed 16384 characters. */
export const TEXT_MAX_LENGTH = 16384;

/** File size above which viewers show a performance warning (500 KB). */
export const SIZE_WARN_THRESHOLD = 500 * 1024;

/** Truncate selected_text to the spec maximum (4096 Unicode code points). */
export function truncateSelectedText(text: string): string {
  const codePoints = Array.from(text);
  if (codePoints.length <= SELECTED_TEXT_MAX_LENGTH) return text;
  return codePoints.slice(0, SELECTED_TEXT_MAX_LENGTH).join("");
}
