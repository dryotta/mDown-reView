export const KQL_OPERATORS = new Set([
  "where",
  "summarize",
  "project",
  "extend",
  "join",
  "count",
  "take",
  "top",
  "sort",
  "order",
  "distinct",
  "render",
  "limit",
  "let",
  "union",
  "mv-expand",
  "parse",
  "evaluate",
  "make-series",
  "print",
]);

export interface KqlPipelineStep {
  step: number;
  operator: string;
  details: string;
  isSource: boolean;
}

/**
 * Tokenize KQL input, respecting string literals and comments
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inString: '"' | "'" | null = null;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const nextChar = input[i + 1];

    // Handle escape sequences in strings
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (inString) {
      current += char;
      if (char === "\\") {
        escaped = true;
      } else if (char === inString) {
        inString = null;
      }
      continue;
    }

    // Check for comments
    if (char === "/" && nextChar === "/") {
      // Skip to end of line
      while (i < input.length && input[i] !== "\n") {
        i++;
      }
      continue;
    }

    // Handle string start
    if (char === '"' || char === "'") {
      inString = char;
      current += char;
      continue;
    }

    // Handle pipe separator
    if (char === "|") {
      if (current.trim()) {
        tokens.push(current.trim());
      }
      current = "";
      continue;
    }

    current += char;
  }

  // Add remaining content
  if (current.trim()) {
    tokens.push(current.trim());
  }

  return tokens;
}

/**
 * Parse KQL pipeline into structured steps
 */
export function parseKqlPipeline(input: string): KqlPipelineStep[] {
  if (!input.trim()) {
    return [];
  }

  const segments = tokenize(input);
  const steps: KqlPipelineStep[] = [];

  segments.forEach((segment, index) => {
    if (index === 0) {
      // First segment is the source table
      steps.push({
        step: 1,
        operator: segment.trim(),
        details: "",
        isSource: true,
      });
    } else {
      // Extract operator and details
      const trimmed = segment.trim();
      const parts = trimmed.split(/\s+/);
      const operator = parts[0] || "";
      const details = parts.slice(1).join(" ");

      steps.push({
        step: index + 1,
        operator,
        details,
        isSource: false,
      });
    }
  });

  return steps;
}

/**
 * Format KQL query with each pipe operator on a new line
 */
export function formatKql(input: string): string {
  if (!input.trim()) {
    return "";
  }

  const segments = tokenize(input);
  if (segments.length === 0) {
    return "";
  }

  // First segment (table name) on its own line
  let result = segments[0];

  // Add each subsequent segment with pipe on new line
  for (let i = 1; i < segments.length; i++) {
    result += "\n| " + segments[i];
  }

  return result;
}
