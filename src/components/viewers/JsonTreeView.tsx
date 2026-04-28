import { useEffect, useState } from "react";
import { stripJsonComments } from "@/lib/tauri-commands";
import { useZoom } from "@/hooks/useZoom";
import { FileCommentBadge } from "@/components/comments/FileCommentBadge";
import "../../styles/json-tree.css";

interface JsonTreeViewProps {
  content: string;
  /** Optional file path. When provided, a file-level comment badge is shown. */
  path?: string;
}

/**
 * Compute the JSON-path segment for an array element.
 * Emits numeric-index segments only (`[idx]`).
 */
function arraySegment(_item: unknown, idx: number): string {
  return `[${idx}]`;
}

/**
 * Concatenate `parent` with `key` to form the next dot-notation path.
 * Keys containing `.`, `[`, or `]` use JSON-string-escaped bracket segment.
 */
function objectSegment(parent: string, key: string): string {
  const needsEscape = /[.\[\]]/.test(key);
  if (needsEscape) {
    return `${parent}[${JSON.stringify(key)}]`;
  }
  return parent === "" ? key : `${parent}.${key}`;
}

interface JsonNodeProps {
  value: unknown;
  keyName?: string;
  depth: number;
  /** Full JSON path of this node (root === ""). */
  path: string;
}

function JsonNode({
  value,
  keyName,
  depth,
  path,
}: JsonNodeProps) {
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
              {value.map((item, index) => {
                const childPath = `${path}${arraySegment(item, index)}`;
                return (
                  <JsonNode
                    key={index}
                    value={item}
                    keyName={String(index)}
                    depth={depth + 1}
                    path={childPath}
                  />
                );
              })}
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
                <JsonNode
                  key={key}
                  value={(value as Record<string, unknown>)[key]}
                  keyName={key}
                  depth={depth + 1}
                  path={objectSegment(path, key)}
                />
              ))}
            </div>
          )}
        </>
      );
    }

    return null;
  };

  return (
    <div className="json-node" data-json-path={path}>
      <div className="json-node-row">
        {keyName && <span className="json-key">{keyName}:</span>}
        {renderValue()}
      </div>
    </div>
  );
}

export function JsonTreeView({ content, path }: JsonTreeViewProps) {
  const { zoom } = useZoom(".json");
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ok"; value: unknown }
    | { status: "error" }
  >({ status: "loading" });

  const filePath = path ?? null;

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
    return <div className="json-tree" aria-busy="true" data-zoom={zoom} style={{ fontSize: `${zoom * 100}%` }} />;
  }
  if (state.status === "error") {
    return <div className="json-error">Invalid JSON: Could not parse content</div>;
  }

  return (
    <div className="json-tree" data-zoom={zoom} style={{ fontSize: `${zoom * 100}%` }}>
      {filePath && <FileCommentBadge filePath={filePath} />}
      <JsonNode
        value={state.value}
        depth={0}
        path=""
      />
    </div>
  );
}
