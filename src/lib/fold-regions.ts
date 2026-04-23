export interface FoldRegion {
  startLine: number; // 1-based
  endLine: number; // 1-based, inclusive
}

const OPENERS: Record<string, string> = { "{": "}", "[": "]" };
const CLOSERS = new Set(["}", "]"]);

function stripStringsAndComments(line: string): string {
  const parts: string[] = [];
  let inString: string | null = null;
  let segStart = -1;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (inString) {
      if (ch === "\\" && i + 1 < line.length) {
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      if (segStart !== -1) {
        parts.push(line.slice(segStart, i));
        segStart = -1;
      }
      inString = ch;
      i++;
      continue;
    }
    if (ch === "/" && i + 1 < line.length && line[i + 1] === "/") {
      break;
    }
    if (segStart === -1) segStart = i;
    i++;
  }
  if (segStart !== -1) {
    parts.push(line.slice(segStart, i));
  }
  return parts.join("");
}

function computeBraceRegions(lines: string[]): FoldRegion[] {
  const regions: FoldRegion[] = [];
  const stack: { char: string; line: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const stripped = stripStringsAndComments(lines[i]);
    for (const ch of stripped) {
      if (OPENERS[ch]) {
        stack.push({ char: ch, line: i + 1 });
      } else if (CLOSERS.has(ch)) {
        for (let j = stack.length - 1; j >= 0; j--) {
          if (OPENERS[stack[j].char] === ch) {
            const start = stack[j].line;
            const end = i + 1;
            stack.splice(j, 1);
            if (end - start >= 2) {
              regions.push({ startLine: start, endLine: end });
            }
            break;
          }
        }
      }
    }
  }

  return regions;
}

function getIndent(line: string): number {
  const m = /^(\s*)/.exec(line);
  if (!m) return 0;
  let count = 0;
  for (const ch of m[1]) {
    count += ch === "\t" ? 4 : 1;
  }
  return count;
}

function computeIndentRegions(lines: string[]): FoldRegion[] {
  const regions: FoldRegion[] = [];
  const indents = lines.map((l) => (l.trim() === "" ? -1 : getIndent(l)));

  for (let i = 0; i < lines.length; i++) {
    if (indents[i] < 0) continue;
    const baseIndent = indents[i];

    let nextNonBlank = i + 1;
    while (nextNonBlank < lines.length && indents[nextNonBlank] < 0) nextNonBlank++;
    if (nextNonBlank >= lines.length || indents[nextNonBlank] <= baseIndent)
      continue;

    let end = nextNonBlank;
    for (let j = nextNonBlank + 1; j < lines.length; j++) {
      if (indents[j] < 0) continue;
      if (indents[j] <= baseIndent) break;
      end = j;
    }

    if (end > i) {
      regions.push({ startLine: i + 1, endLine: end + 1 });
    }
  }

  return regions;
}

export function computeFoldRegions(lines: string[]): FoldRegion[] {
  const braceRegions = computeBraceRegions(lines);
  if (braceRegions.length >= 1) {
    return braceRegions;
  }
  return computeIndentRegions(lines);
}
