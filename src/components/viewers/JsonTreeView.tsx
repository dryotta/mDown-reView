import { useEffect, useState } from "react";
import { stripJsonComments } from "@/lib/tauri-commands";
import "../../styles/json-tree.css";

interface JsonTreeViewProps {
  content: string;
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
      return <span className="json-string">&quot;{value}&quot;</span>;
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
  // null = still parsing, { ok: true, value } = parsed, { ok: false } = error.
  // The useEffect below only transitions to "ok"/"error", never back to "loading",
  // so subsequent content reloads keep the previous parse visible until ready.
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ok"; value: unknown }
    | { status: "error" }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    stripJsonComments(content)
      .then((stripped) => {
        if (cancelled) return;
        try {
          const parsed = JSON.parse(stripped);
          setState({ status: "ok", value: parsed });
        } catch {
          setState({ status: "error" });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [content]);

  if (state.status === "loading") {
    return <div className="json-tree" aria-busy="true" />;
  }
  if (state.status === "error") {
    return <div className="json-error">Invalid JSON: Could not parse content</div>;
  }

  return (
    <div className="json-tree">
      <JsonNode value={state.value} depth={0} />
    </div>
  );
}
