import { computeLineHash, normalizeLine } from "@/lib/comment-anchors";
import type { ReviewComment } from "@/lib/tauri-commands";
import type { CommentWithOrphan } from "@/store";

export type MatchedComment = CommentWithOrphan;

export function matchComments(
  comments: ReviewComment[],
  fileLines: string[]
): MatchedComment[] {
  const lineCount = fileLines.length;
  const lineHashes = fileLines.map((l) => computeLineHash(l));

  return comments.map((comment) => {
    // Legacy block comments → orphaned at fallbackLine
    if (comment.anchorType === "block") {
      const pos = Math.min(comment.fallbackLine ?? 1, Math.max(lineCount, 1));
      return { ...comment, matchedLineNumber: pos, isOrphaned: true };
    }

    if (lineCount === 0) {
      return { ...comment, matchedLineNumber: 1, isOrphaned: true, lineNumber: 1 };
    }

    const origLine = comment.lineNumber ?? 1;
    const hash = comment.lineHash ?? "";

    // Strategy 1: Exact match at lineNumber
    if (origLine >= 1 && origLine <= lineCount && lineHashes[origLine - 1] === hash) {
      return { ...comment, matchedLineNumber: origLine, isOrphaned: false };
    }

    // Strategy 2: Nearby hash match (±30)
    const nearbyResult = findNearestHash(lineHashes, hash, origLine, 30);
    if (nearbyResult !== null) {
      return {
        ...comment,
        lineNumber: nearbyResult,
        matchedLineNumber: nearbyResult,
        isOrphaned: false,
      };
    }

    // Strategy 3: Context match (±30)
    const contextResult = findByContext(fileLines, comment, origLine, 30);
    if (contextResult !== null) {
      return {
        ...comment,
        lineNumber: contextResult,
        matchedLineNumber: contextResult,
        isOrphaned: false,
      };
    }

    // Strategy 4: Global hash search
    const globalResult = findNearestHash(lineHashes, hash, origLine, lineCount);
    if (globalResult !== null) {
      return {
        ...comment,
        lineNumber: globalResult,
        matchedLineNumber: globalResult,
        isOrphaned: false,
      };
    }

    // Strategy 5: Selected text search (selection comments only)
    if (comment.anchorType === "selection" && comment.selectedText) {
      const textResult = findBySelectedText(fileLines, comment.selectedText, origLine);
      if (textResult !== null) {
        return {
          ...comment,
          lineNumber: textResult,
          matchedLineNumber: textResult,
          isOrphaned: false,
        };
      }
    }

    // Strategy 6: Orphaned — all strategies failed
    const clampedLine = Math.min(origLine, Math.max(lineCount, 1));
    return {
      ...comment,
      lineNumber: clampedLine,
      matchedLineNumber: clampedLine,
      isOrphaned: true,
    };
  });
}

function findNearestHash(
  lineHashes: string[],
  targetHash: string,
  centerLine: number,
  radius: number
): number | null {
  const start = Math.max(0, centerLine - 1 - radius);
  const end = Math.min(lineHashes.length - 1, centerLine - 1 + radius);
  let bestLine: number | null = null;
  let bestDist = Infinity;

  for (let i = start; i <= end; i++) {
    if (lineHashes[i] === targetHash) {
      // Skip the exact original position — Strategy 1 already handles that
      if (i === centerLine - 1) continue;
      const dist = Math.abs(i - (centerLine - 1));
      if (dist < bestDist || (dist === bestDist && i < (bestLine! - 1))) {
        bestDist = dist;
        bestLine = i + 1; // 1-indexed
      }
    }
  }

  return bestLine;
}

function findByContext(
  fileLines: string[],
  comment: ReviewComment,
  centerLine: number,
  radius: number
): number | null {
  const ctxBefore = comment.contextBefore;
  const ctxAfter = comment.contextAfter;
  if (!ctxBefore && !ctxAfter) return null;

  const start = Math.max(0, centerLine - 1 - radius);
  const end = Math.min(fileLines.length - 1, centerLine - 1 + radius);
  let bestLine: number | null = null;
  let bestScore = 0;
  let bestDist = Infinity;

  for (let i = start; i <= end; i++) {
    let matchScore = 0;

    if (ctxBefore) {
      const ctxLines = ctxBefore.split("\n");
      let beforeMatch = true;
      for (let j = 0; j < ctxLines.length; j++) {
        const checkIdx = i - ctxLines.length + j;
        if (checkIdx < 0 || normalizeLine(fileLines[checkIdx]) !== ctxLines[j]) {
          beforeMatch = false;
          break;
        }
      }
      if (beforeMatch) matchScore++;
    }

    if (ctxAfter) {
      const ctxLines = ctxAfter.split("\n");
      let afterMatch = true;
      for (let j = 0; j < ctxLines.length; j++) {
        const checkIdx = i + 1 + j;
        if (checkIdx >= fileLines.length || normalizeLine(fileLines[checkIdx]) !== ctxLines[j]) {
          afterMatch = false;
          break;
        }
      }
      if (afterMatch) matchScore++;
    }

    if (matchScore > 0) {
      // When both contexts are available, require both to match
      const requiredScore = ctxBefore && ctxAfter ? 2 : 1;
      if (matchScore < requiredScore) continue;

      const dist = Math.abs(i - (centerLine - 1));
      if (matchScore > bestScore || (matchScore === bestScore && dist < bestDist)) {
        bestScore = matchScore;
        bestDist = dist;
        bestLine = i + 1;
      }
    }
  }

  return bestLine;
}

function findBySelectedText(
  fileLines: string[],
  selectedText: string,
  centerLine: number
): number | null {
  let bestLine: number | null = null;
  let bestDist = Infinity;

  for (let i = 0; i < fileLines.length; i++) {
    if (fileLines[i].includes(selectedText)) {
      const dist = Math.abs(i - (centerLine - 1));
      if (dist < bestDist) {
        bestDist = dist;
        bestLine = i + 1;
      }
    }
  }

  return bestLine;
}
