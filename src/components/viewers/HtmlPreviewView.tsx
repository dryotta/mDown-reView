import { useState } from "react";

interface Props {
  content: string;
}

export function HtmlPreviewView({ content }: Props) {
  const [unsafeMode, setUnsafeMode] = useState(false);
  const sandbox = unsafeMode ? "allow-same-origin allow-scripts" : "allow-same-origin";

  return (
    <div className="html-preview" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="html-preview-banner" style={{ padding: "6px 12px", background: "var(--color-warning-bg, #fff3cd)", borderBottom: "1px solid var(--color-warning-border, #ffc107)", fontSize: 12 }}>
        ⚠ Sandboxed preview — scripts and external resources disabled
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
        srcDoc={content}
        sandbox={sandbox}
        title="HTML preview"
        style={{ width: "100%", border: "none", minHeight: 400, flex: 1, background: "white" }}
      />
    </div>
  );
}
