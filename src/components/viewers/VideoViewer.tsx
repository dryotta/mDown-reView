import { getMimeHint } from "@/lib/file-types";
import { convertAssetUrl } from "@/lib/tauri-commands";

interface Props {
  path: string;
}

/**
 * Native HTML5 video viewer (#65 F2). Same loading model as AudioViewer:
 * `convertAssetUrl` produces an `asset://` URL the webview can stream
 * directly. Native controls only — no custom player chrome. Filename + MIME
 * are surfaced by the `FileActionsBar` rendered above in `ViewerRouter`.
 */
export function VideoViewer({ path }: Props) {
  const src = convertAssetUrl(path);

  return (
    <div className="video-viewer viewer-media-body viewer-media-body--centered">
      <video controls preload="metadata" src={src} />
    </div>
  );
}

/** Resolve the MIME hint for a video path, falling back to `video/*` for
 *  unknown extensions. Exported so `ViewerRouter` can pass the same hint
 *  into `FileActionsBar`. */
export function getVideoMime(path: string): string {
  const hint = getMimeHint(path);
  return hint === "application/octet-stream" ? "video/*" : hint;
}


