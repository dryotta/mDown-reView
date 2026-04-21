/// MRSF v1.0 comment utility functions and constants.

import { warn } from "@/logger";

/** Spec §6.2: selected_text MUST NOT exceed 4096 characters. */
export const SELECTED_TEXT_MAX_LENGTH = 4096;

/** Spec §6.1: text SHOULD NOT exceed 16384 characters. */
export const TEXT_MAX_LENGTH = 16384;

/** Generate a UUIDv4 comment ID (spec §6.1: SHOULD be collision-resistant). */
export function generateCommentId(): string {
  return crypto.randomUUID();
}

/** Truncate selected_text to the spec maximum (4096 chars). */
export function truncateSelectedText(text: string): string {
  if (text.length <= SELECTED_TEXT_MAX_LENGTH) return text;
  return text.slice(0, SELECTED_TEXT_MAX_LENGTH);
}

/** Validate and clamp MRSF targeting fields per spec §7.1. Logs warning on clamping. */
export function validateTargetingFields(
  fields: {
    line?: number;
    end_line?: number;
    start_column?: number;
    end_column?: number;
  },
  logger?: { warn: (msg: string) => void }
): typeof fields {
  const _logger = logger ?? { warn };
  const result = { ...fields };

  if (result.line !== undefined && result.end_line !== undefined && result.end_line < result.line) {
    _logger.warn(`MRSF: clamped end_line (${result.end_line}) to line (${result.line})`);
    result.end_line = result.line;
  }

  if (
    result.line !== undefined &&
    result.end_line !== undefined &&
    result.line === result.end_line &&
    result.start_column !== undefined &&
    result.end_column !== undefined &&
    result.end_column < result.start_column
  ) {
    _logger.warn(`MRSF: clamped end_column (${result.end_column}) to start_column (${result.start_column})`);
    result.end_column = result.start_column;
  }

  return result;
}
