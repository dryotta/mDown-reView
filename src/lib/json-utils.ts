export function stripJsonComments(text: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];

    if (escaped) {
      result += char;
      escaped = false;
      i++;
      continue;
    }

    if (char === "\\" && inString) {
      result += char;
      escaped = true;
      i++;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      i++;
      continue;
    }

    if (inString) {
      result += char;
      i++;
      continue;
    }

    // Handle line comments
    if (char === "/" && next === "/") {
      // Skip until end of line
      i += 2;
      while (i < text.length && text[i] !== "\n") {
        i++;
      }
      continue;
    }

    // Handle block comments
    if (char === "/" && next === "*") {
      i += 2;
      while (i < text.length - 1) {
        if (text[i] === "*" && text[i + 1] === "/") {
          i += 2;
          break;
        }
        i++;
      }
      continue;
    }

    // Handle trailing commas
    if (char === ",") {
      // Look ahead to see if there's only whitespace before } or ]
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) {
        j++;
      }
      if (text[j] === "}" || text[j] === "]") {
        // Skip the comma
        i++;
        continue;
      }
    }

    result += char;
    i++;
  }

  return result;
}
