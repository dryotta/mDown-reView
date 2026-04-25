import { useEffect, useRef, useState } from "react";
import { convertAssetUrl } from "@/lib/tauri-commands";

interface Props {
  path: string;
}

/**
 * Native PDF viewer (#65 F3). The webview (WebView2 on Windows, WKWebKit on
 * macOS, WebKitGTK on Linux) renders PDFs natively when given an iframe src,
 * so we don't bundle pdf.js. The path is routed through `convertAssetUrl`
 * (the chokepoint wrapper around `convertFileSrc`) so the file streams via
 * the `asset://` protocol — no IPC round-trip, no in-memory copy.
 *
 * Sandbox is `""` (empty string), which strips ALL capabilities from the
 * iframe content — no scripts, no forms, no top navigation. This is the
 * tightest sandbox the spec allows; the PDF plugin built into the webview
 * runs outside the sandboxed document context, so rendering still works.
 *
 * The `error` event is attached imperatively via `addEventListener` instead
 * of the React `onError` prop because React 18+ does not reliably delegate
 * the error event to iframes — and this lets us verify the fallback path
 * in jsdom-based unit tests by dispatching a native event.
 *
 * If the iframe fails to load (asset path invalid, file deleted between
 * mount and load, etc.), we surface a small fallback message rather than
 * leave the user staring at a blank pane.
 */
export function PdfViewer({ path }: Props) {
  const [loadError, setLoadError] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const filename = path.split(/[\\/]/).pop() || path;
  const src = convertAssetUrl(path);

  useEffect(() => {
    const node = iframeRef.current;
    if (!node) return;
    const onError = () => setLoadError(true);
    node.addEventListener("error", onError);
    return () => node.removeEventListener("error", onError);
  }, []);

  if (loadError) {
    return (
      <div
        className="pdf-viewer pdf-viewer-error"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          padding: 24,
          color: "var(--color-muted, #656d76)",
          gap: 8,
        }}
      >
        <p style={{ fontWeight: 600 }}>PDF failed to load</p>
        <p style={{ fontSize: 13 }}>{filename}</p>
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      className="pdf-viewer"
      title={filename}
      src={src}
      sandbox=""
      style={{ width: "100%", height: "100%", border: "none" }}
    />
  );
}
