import type { MrsfComment } from "@/lib/tauri-commands";
import type { CommentWithOrphan } from "@/store";

export type MatchedComment = CommentWithOrphan;

const FUZZY_THRESHOLD = 0.6;

export function matchComments(
  comments: MrsfComment[],
  fileLines: string[]
): MatchedComment[] {
  const lineCount = fileLines.length;

  return comments.map((comment) => {
    if (lineCount === 0) {
      return { ...comment, matchedLineNumber: 1, isOrphaned: true };
    }

    const origLine = comment.line;
    const selectedText = comment.selected_text;

    // Step 1: Exact selected_text match
    if (selectedText) {
      // Try exact match at original line first
      if (origLine && origLine >= 1 && origLine <= lineCount) {
        if (fileLines[origLine - 1].includes(selectedText)) {
          return { ...comment, matchedLineNumber: origLine, isOrphaned: false };
        }
      }
      // Search entire document for exact match
      for (let i = 0; i < lineCount; i++) {
        if (fileLines[i].includes(selectedText)) {
          const newLine = i + 1;
          return { ...comment, matchedLineNumber: newLine, line: newLine, isOrphaned: false };
        }
      }
    }

    // Step 2: Line/column fallback (no selected_text or not found)
    if (origLine && origLine >= 1 && origLine <= lineCount) {
      if (selectedText) {
        // Step 3: Fuzzy match — selected_text was provided but exact match failed
        const fuzzyResult = findFuzzyMatch(fileLines, selectedText, origLine);
        if (fuzzyResult) {
          return {
            ...comment,
            matchedLineNumber: fuzzyResult.line,
            line: fuzzyResult.line,
            anchored_text: fuzzyResult.anchoredText,
            isOrphaned: false,
          };
        }
        // Had selected_text but couldn't find it at all → orphan
        return { ...comment, matchedLineNumber: origLine, isOrphaned: true };
      }
      // Pure line fallback (no selected_text)
      return { ...comment, matchedLineNumber: origLine, isOrphaned: false };
    }

    // Step 3: Fuzzy match (when no valid line)
    if (selectedText) {
      const fuzzyResult = findFuzzyMatch(fileLines, selectedText, origLine ?? 1);
      if (fuzzyResult) {
        return {
          ...comment,
          matchedLineNumber: fuzzyResult.line,
          line: fuzzyResult.line,
          anchored_text: fuzzyResult.anchoredText,
          isOrphaned: false,
        };
      }
    }

    // Step 4: Orphan
    const fallbackLine = origLine ? Math.min(origLine, lineCount) : 1;
    return { ...comment, matchedLineNumber: fallbackLine, isOrphaned: true };
  });
}

function findFuzzyMatch(
  fileLines: string[],
  selectedText: string,
  centerLine: number
): { line: number; anchoredText: string } | null {
  let bestLine: number | null = null;
  let bestScore = 0;
  let bestText = "";

  for (let i = 0; i < fileLines.length; i++) {
    const score = fuzzyScore(selectedText, fileLines[i]);
    if (score >= FUZZY_THRESHOLD && score > bestScore) {
      bestScore = score;
      bestLine = i + 1;
      bestText = fileLines[i];
    } else if (score >= FUZZY_THRESHOLD && score === bestScore && bestLine !== null) {
      // Prefer closer to original line
      const newDist = Math.abs(i - (centerLine - 1));
      const oldDist = Math.abs((bestLine - 1) - (centerLine - 1));
      if (newDist < oldDist) {
        bestLine = i + 1;
        bestText = fileLines[i];
      }
    }
  }

  return bestLine !== null ? { line: bestLine, anchoredText: bestText } : null;
}

function fuzzyScore(a: string, b: string): number {
  const al = a.toLowerCase().trim();
  const bl = b.toLowerCase().trim();
  if (al === bl) return 1.0;
  if (bl.includes(al) || al.includes(bl)) return 0.9;

  // Levenshtein-based similarity
  const maxLen = Math.max(al.length, bl.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshtein(al, bl);
  return 1 - dist / maxLen;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}
