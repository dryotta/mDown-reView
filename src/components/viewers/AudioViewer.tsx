import { basename } from "@/lib/path-utils";
import { getMimeHint } from "@/lib/file-types";
import { convertAssetUrl } from "@/lib/tauri-commands";

interface Props {
  path: string;
}

/**
 * Native HTML5 audio viewer (#65 F1). Routes the absolute path through
 * `convertAssetUrl` (the chokepoint wrapper around `convertFileSrc`) so the
 * webview loads the file via the `asset://` protocol — no base64 round-trip,
 * no in-memory copy, and the browser owns streaming/seek. Lean pillar: native
 * controls only, no bundled player chrome. The MIME hint (rendered by
 * `FileActionsBar` above this component in `ViewerRouter`) and the active
 * tab provide identification — this component is just the player.
 */
export function AudioViewer({ path }: Props) {
  const src = convertAssetUrl(path);

  return (
    <div className="audio-viewer viewer-media-body viewer-media-body--centered">
      <audio controls preload="metadata" src={src} />
    </div>
  );
}

/** Resolve the MIME hint for an audio path, falling back to `audio/*` for
 *  unknown extensions (the generic MIME hint would say
 *  `application/octet-stream`, which is misleading for media).
 *  Exported so `ViewerRouter` can pass the same hint into `FileActionsBar`. */
export function getAudioMime(path: string): string {
  const hint = getMimeHint(path);
  return hint === "application/octet-stream" ? "audio/*" : hint;
}

/** Exported for tests + parity with old API. */
export function getAudioFilename(path: string): string {
  return basename(path);
}
