import { useState, useEffect, useRef, useCallback, useId } from "react";


interface Props {
  content: string;
}

export function MermaidView({ content }: Props) {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const reactId = useId();
  const mermaidId = `mermaid-${reactId.replace(/:/g, "")}`;

  useEffect(() => {
    let cancelled = false;
    async function renderDiagram() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "default" });
        const { svg: renderedSvg } = await mermaid.render(mermaidId, content);
        if (!cancelled) {
          setSvg(renderedSvg);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError(`Error rendering diagram: ${err instanceof Error ? err.message : String(err)}`);
          setSvg("");
        }
      }
    }
    if (content.trim()) {
      renderDiagram();
    }
    return () => { cancelled = true; };
  }, [content, mermaidId]);

  const handleExportSvg = useCallback(() => {
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "diagram.svg";
    a.click();
    URL.revokeObjectURL(url);
  }, [svg]);

  const handleExportPng = useCallback(() => {
    if (!svg) return;
    const canvas = document.createElement("canvas");
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width * 2;
      canvas.height = img.height * 2;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(2, 2);
        ctx.drawImage(img, 0, 0);
        const a = document.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = "diagram.png";
        a.click();
      }
    };
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
  }, [svg]);

  return (
    <div className="mermaid-view" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="mermaid-toolbar" style={{ display: "flex", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--color-border, #d0d7de)", alignItems: "center" }}>
        <button onClick={() => setScale(s => Math.max(0.25, s - 0.25))} aria-label="Zoom out">−</button>
        <span style={{ fontSize: 12, minWidth: 48, textAlign: "center" }}>{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale(s => Math.min(4, s + 0.25))} aria-label="Zoom in">+</button>
        <button onClick={() => setScale(1)} aria-label="Reset zoom">Reset</button>
        <div style={{ flex: 1 }} />
        <button onClick={handleExportPng} aria-label="Export PNG">PNG</button>
        <button onClick={handleExportSvg} aria-label="Export SVG">SVG</button>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        {error && <div className="mermaid-error" style={{ color: "var(--color-danger, #cf222e)", padding: 16 }}>{error}</div>}
        {svg && (
          <div
            ref={containerRef}
            title="Mermaid diagram"
            style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
      </div>
    </div>
  );
}
