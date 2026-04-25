import { useEffect, useMemo, useState } from "react";
import { stripJsonComments } from "@/lib/tauri-commands";
import { useZoom } from "@/hooks/useZoom";
import { useComments } from "@/lib/vm/use-comments";
import { useCommentActions } from "@/lib/vm/use-comment-actions";
import { useStore } from "@/store";
import { deriveAnchor, type Anchor } from "@/types/comments";
import { CommentBadge } from "@/components/comments/CommentBadge";
import { CommentInput } from "@/components/comments/CommentInput";
import "../../styles/json-tree.css";

interface JsonTreeViewProps {
  content: string;
  /** Optional file path. When omitted, the comment-affordance UI is hidden. */
  path?: string;
}

const SCALAR_TEXT_CAP = 200;

interface PathThreadIndex {
  /** Unresolved thread roots keyed by exact `json_path`. */
  byPath: Map<string, { id: string; severity: string | null }[]>;
}

/**
 * Compute the JSON-path segment for an array element. If the element is an
 * object that carries an obvious id field (`id`, `key`, `name`), encode it
 * as `[<field>=<value>]` so reorderings can still be located by that key.
 * Otherwise fall back to the index form `[idx]`.
 */
function arraySegment(item: unknown, idx: number): string {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const obj = item as Record<string, unknown>;
    for (const field of ["id", "key", "name"] as const) {
      const v = obj[field];
      if (v !== undefined && (typeof v === "string" || typeof v === "number")) {
        return `[${field}=${String(v)}]`;
      }
    }
  }
  return `[${idx}]`;
}

function objectSegment(parent: string, key: string): string {
  return parent === "" ? key : `${parent}.${key}`;
}

/** Derive the scalar-leaf text representation for a JsonPath anchor. */
function leafScalarText(value: unknown): string | undefined {
  if (value === null) return "null";
  if (typeof value === "string") return value.slice(0, SCALAR_TEXT_CAP);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).slice(0, SCALAR_TEXT_CAP);
  }
  return undefined;
}

interface JsonNodeProps {
  value: unknown;
  keyName?: string;
  depth: number;
  /** Full JSON path of this node (root === ""). */
  path: string;
  /** When non-null, comment-affordance UI is rendered. */
  filePath: string | null;
  threadIndex: PathThreadIndex;
  composerPath: string | null;
  onOpenComposer: (path: string, scalarText?: string) => void;
  onCloseComposer: () => void;
  onSaveComposer: (text: string) => void;
  onFocusThread: (id: string) => void;
}

function JsonNode({
  value,
  keyName,
  depth,
  path,
  filePath,
  threadIndex,
  composerPath,
  onOpenComposer,
  onCloseComposer,
  onSaveComposer,
  onFocusThread,
}: JsonNodeProps) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);

  const toggleExpand = () => setIsExpanded(!isExpanded);

  const scalarText = leafScalarText(value);
  const threadsHere = threadIndex.byPath.get(path) ?? [];
  const isComposing = composerPath === path;

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
                    filePath={filePath}
                    threadIndex={threadIndex}
                    composerPath={composerPath}
                    onOpenComposer={onOpenComposer}
                    onCloseComposer={onCloseComposer}
                    onSaveComposer={onSaveComposer}
                    onFocusThread={onFocusThread}
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
                  filePath={filePath}
                  threadIndex={threadIndex}
                  composerPath={composerPath}
                  onOpenComposer={onOpenComposer}
                  onCloseComposer={onCloseComposer}
                  onSaveComposer={onSaveComposer}
                  onFocusThread={onFocusThread}
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
        {threadsHere.length > 0 && (
          <button
            type="button"
            className="json-path-badge-btn"
            aria-label={`Open ${threadsHere.length} comment${threadsHere.length === 1 ? "" : "s"} on this path`}
            onClick={(e) => {
              e.stopPropagation();
              onFocusThread(threadsHere[0].id);
            }}
          >
            <CommentBadge count={threadsHere.length} className="tree-comment-badge" />
          </button>
        )}
        {filePath && path !== "" && !isComposing && (
          <button
            type="button"
            className="json-path-add"
            aria-label="Comment on this JSON path"
            title="Comment on this JSON path"
            onClick={(e) => {
              e.stopPropagation();
              onOpenComposer(path, scalarText);
            }}
          >
            +
          </button>
        )}
      </div>
      {isComposing && (
        <div className="json-path-composer" onClick={(e) => e.stopPropagation()}>
          <CommentInput
            onSave={onSaveComposer}
            onClose={onCloseComposer}
            placeholder="Comment on this JSON path…"
          />
        </div>
      )}
    </div>
  );
}

export function JsonTreeView({ content, path }: JsonTreeViewProps) {
  const { zoom } = useZoom(".json");
  // null = still parsing, { ok: true, value } = parsed, { ok: false } = error.
  // The useEffect below only transitions to "ok"/"error", never back to "loading",
  // so subsequent content reloads keep the previous parse visible until ready.
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ok"; value: unknown }
    | { status: "error" }
  >({ status: "loading" });

  const [composerPath, setComposerPath] = useState<string | null>(null);
  const [composerScalar, setComposerScalar] = useState<string | undefined>(undefined);
  const filePath = path ?? null;
  const { threads } = useComments(filePath);
  const { addComment } = useCommentActions();
  const setFocusedThread = useStore((s) => s.setFocusedThread);

  const threadIndex = useMemo<PathThreadIndex>(() => {
    const byPath = new Map<string, { id: string; severity: string | null }[]>();
    for (const t of threads) {
      if (t.root.resolved) continue;
      const a = deriveAnchor(t.root);
      if (a.kind !== "json_path") continue;
      const arr = byPath.get(a.json_path) ?? [];
      arr.push({ id: t.root.id, severity: t.root.severity ?? null });
      byPath.set(a.json_path, arr);
    }
    return { byPath };
  }, [threads]);

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

  const handleOpenComposer = (p: string, scalarText?: string) => {
    setComposerPath(p);
    setComposerScalar(scalarText);
  };

  const handleSave = (text: string) => {
    if (!filePath || composerPath === null) return;
    const anchor: Anchor = {
      kind: "json_path",
      json_path: composerPath,
      ...(composerScalar !== undefined ? { scalar_text: composerScalar } : {}),
    };
    addComment(filePath, text, anchor).catch(() => {});
    setComposerPath(null);
    setComposerScalar(undefined);
  };

  return (
    <div className="json-tree" data-zoom={zoom} style={{ fontSize: `${zoom * 100}%` }}>
      <JsonNode
        value={state.value}
        depth={0}
        path=""
        filePath={filePath}
        threadIndex={threadIndex}
        composerPath={composerPath}
        onOpenComposer={handleOpenComposer}
        onCloseComposer={() => {
          setComposerPath(null);
          setComposerScalar(undefined);
        }}
        onSaveComposer={handleSave}
        onFocusThread={setFocusedThread}
      />
    </div>
  );
}
