import { useState } from "react";
import "../../styles/json-tree.css";

interface JsonTreeViewProps {
  content: string;
}

function stripJsonComments(text: string): string {
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

interface JsonNodeProps {
  value: unknown;
  keyName?: string;
  depth: number;
}

function JsonNode({ value, keyName, depth }: JsonNodeProps) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);

  const toggleExpand = () => setIsExpanded(!isExpanded);

  const renderValue = () => {
    if (value === null) {
      return <span className="json-null">null</span>;
    }

    if (typeof value === "string") {
      return <span className="json-string">"{value}"</span>;
    }

    if (typeof value === "number") {
      return <span className="json-number">{value}</span>;
    }

    if (typeof value === "boolean") {
      return <span className="json-boolean">{value.toString()}</span>;
    }

    if (Array.isArray(value)) {
      const itemCount = value.length;
      return (
        <>
          <button
            className="json-toggle"
            onClick={toggleExpand}
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? "▼" : "▶"}
          </button>
          <span>
            [<span className="json-summary">{itemCount} items</span>]
          </span>
          {isExpanded && (
            <div className="json-children">
              {value.map((item, index) => (
                <div key={index} className="json-node">
                  <span className="json-key">{index}:</span>
                  <JsonNode value={item} depth={depth + 1} />
                </div>
              ))}
            </div>
          )}
        </>
      );
    }

    if (typeof value === "object") {
      const keys = Object.keys(value);
      const keyCount = keys.length;
      return (
        <>
          <button
            className="json-toggle"
            onClick={toggleExpand}
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? "▼" : "▶"}
          </button>
          <span>
            {"{"}<span className="json-summary">{keyCount} keys</span>{"}"}
          </span>
          {isExpanded && (
            <div className="json-children">
              {keys.map((key) => (
                <div key={key} className="json-node">
                  <span className="json-key">{key}:</span>
                  <JsonNode
                    value={(value as Record<string, unknown>)[key]}
                    depth={depth + 1}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      );
    }

    return null;
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start" }}>
      {keyName && <span className="json-key">{keyName}:</span>}
      {renderValue()}
    </div>
  );
}

export function JsonTreeView({ content }: JsonTreeViewProps) {
  let parsed: unknown;
  try {
    const stripped = stripJsonComments(content);
    parsed = JSON.parse(stripped);
  } catch {
    return <div className="json-error">Invalid JSON: Could not parse content</div>;
  }

  return (
    <div className="json-tree">
      <JsonNode value={parsed} depth={0} />
    </div>
  );
}
