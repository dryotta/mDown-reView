import { fnv1a8, normalizeLine } from "@/lib/fnv1a";

export { normalizeLine };

export function computeLineHash(lineText: string): string {
  return fnv1a8(normalizeLine(lineText));
}

export function captureContext(
  lines: string[],
  lineIndex: number
): { contextBefore: string; contextAfter: string } {
  const beforeLines: string[] = [];
  for (let i = Math.max(0, lineIndex - 2); i < lineIndex; i++) {
    beforeLines.push(normalizeLine(lines[i]));
  }

  const afterLines: string[] = [];
  for (let i = lineIndex + 1; i <= Math.min(lines.length - 1, lineIndex + 2); i++) {
    afterLines.push(normalizeLine(lines[i]));
  }

  return {
    contextBefore: beforeLines.join("\n"),
    contextAfter: afterLines.join("\n"),
  };
}
