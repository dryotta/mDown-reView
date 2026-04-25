import { useEffect, useRef, useState } from "react";
import { basename } from "@/lib/path-utils";
import { convertAssetUrl } from "@/lib/tauri-commands";

interface Props {
  path: string;
}

/**
 * Native PDF viewer (#65 F3). See file header comments above (preserved).
 *
 * R2 — `loadError` no longer needs an effect-driven reset because
 * `ViewerRouter` keys this component on `path`; a path change remounts and
 * the state initializer runs again.
 *
 * The "error" event is attached imperatively because React's synthetic
 * `onError` on `<iframe>` does not bubble through `Event.dispatchEvent`
 * (and is unreliable cross-browser on iframe load failures). A direct
 * `addEventListener` is the supported cross-browser path.
 */
export function PdfViewer({ path }: Props) {
  const [loadError, setLoadError] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const filename = basename(path);
  const src = convertAssetUrl(path);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const onError = () => setLoadError(true);
    iframe.addEventListener("error", onError);
    return () => iframe.removeEventListener("error", onError);
  }, []);

  if (loadError) {
    return (
      <div className="pdf-viewer pdf-viewer-error">
        <p className="pdf-viewer-error__title">PDF failed to load</p>
        <p className="pdf-viewer-error__filename">{filename}</p>
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
    />
  );
}
