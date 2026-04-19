import { useState, useEffect } from "react";
import { resolveLocalAssets } from "@/lib/resolve-html-assets";

interface Props {
  content: string;
  filePath?: string;
}

export function HtmlPreviewView({ content, filePath }: Props) {
  const [unsafeMode, setUnsafeMode] = useState(false);
  const [resolvedContent, setResolvedContent] = useState(content);
  const [resolving, setResolving] = useState(false);
  const sandbox = unsafeMode ? "allow-same-origin allow-scripts" : "allow-same-origin";

  useEffect(() => {
    if (!filePath) {
      setResolvedContent(content);
      return;
    }
    let cancelled = false;
    setResolving(true);
    resolveLocalAssets(content, filePath)
      .then((resolved) => {
        if (!cancelled) setResolvedContent(resolved);
      })
      .catch(() => {
        if (!cancelled) setResolvedContent(content);
      })
      .finally(() => {
        if (!cancelled) setResolving(false);
      });
    return () => { cancelled = true; };
  }, [content, filePath]);

  return (
    <div className="html-preview" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="html-preview-banner" style={{ padding: "6px 12px", background: "var(--color-warning-bg, #fff3cd)", borderBottom: "1px solid var(--color-warning-border, #ffc107)", fontSize: 12 }}>
        ⚠ Sandboxed preview — scripts and external resources disabled
        {resolving && <span style={{ marginLeft: 8 }}>⏳ Resolving local images…</span>}
        <button
          className="comment-btn"
          aria-label={unsafeMode ? "Disable scripts" : "Enable scripts"}
          onClick={() => setUnsafeMode(!unsafeMode)}
          style={{ marginLeft: 8 }}
        >
          {unsafeMode ? "Disable scripts" : "Enable scripts"}
        </button>
      </div>
      <iframe
        srcDoc={resolvedContent}
        sandbox={sandbox}
        title="HTML preview"
        style={{ width: "100%", border: "none", minHeight: 400, flex: 1, background: "white" }}
      />
    </div>
  );
}
