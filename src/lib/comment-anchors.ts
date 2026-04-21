/// MRSF anchor creation helpers.

export async function computeSelectedTextHash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function createLineAnchor(lineNumber: number): { line: number } {
  return { line: lineNumber };
}

export function createSelectionAnchor(
  startLine: number,
  endLine: number,
  startColumn: number,
  endColumn: number,
  selectedText: string,
  selectedTextHash: string
): {
  line: number;
  end_line: number;
  start_column: number;
  end_column: number;
  selected_text: string;
  selected_text_hash: string;
} {
  return {
    line: startLine,
    end_line: endLine,
    start_column: startColumn,
    end_column: endColumn,
    selected_text: selectedText,
    selected_text_hash: selectedTextHash,
  };
}
