/**
 * Excalidraw scene extraction (issue #352 iter 2 Group B).
 *
 * Thin library wrapper around Excalidraw's own `loadFromBlob` API. For
 * canonical `.excalidraw` / `.excalidrawlib` files, the JSON is the file —
 * no extraction needed; the renderer parses the JSON text directly. This
 * module handles only the PNG / SVG variants where the scene is embedded
 * in a `tEXt` chunk (PNG) or `<metadata>` element (SVG).
 *
 * Architecturally this is **library invocation, not custom parsing** — we
 * never decode tEXt chunks ourselves; Excalidraw's own loader does it.
 * Bytes reach this function only after `read_binary_file` (security rule
 * 1, 10 MB cap), so the parser surface inherits the existing read-bound
 * envelope — no symmetric "extract cap" needed.
 *
 * If iter-3+ requires server-side scene extraction (e.g. for headless
 * scripting), port to a Rust `read_excalidraw_scene` IPC; the renderer
 * wrapper here is the swap point.
 */

import { loadFromBlob } from "@excalidraw/excalidraw";

import { readBinaryFile } from "@/lib/tauri-commands";


export interface ExcalidrawScene {
  elements: ReadonlyArray<unknown>;
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

/**
 * Extract the embedded scene from a `.excalidraw.png` / `.excalidraw.svg`
 * file at `filePath`. Throws if the blob has no embedded scene.
 */
export async function extractScene(filePath: string): Promise<ExcalidrawScene> {
  // Read binary bytes through the existing IPC chokepoint — this enforces
  // the 10 MB cap (security.md rule 1). Result is base64-encoded.
  const base64 = await readBinaryFile(filePath);

  // Decode base64 → Uint8Array → Blob. Browser-native; no new dep.
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const lower = filePath.toLowerCase();
  const mime = lower.endsWith(".png")
    ? "image/png"
    : lower.endsWith(".svg")
      ? "image/svg+xml"
      : "application/octet-stream";
  const blob = new Blob([bytes], { type: mime });

  // Excalidraw's own extractor. Returns `{ elements, appState, files }`.
  // localAppState / localElements are null — we don't merge against any
  // prior scene; this is a fresh open.
  const data = await loadFromBlob(blob, null, null);

  return {
    elements: (data.elements as ReadonlyArray<unknown>) ?? [],
    appState: (data.appState as unknown as Record<string, unknown>) ?? {},
    files: (data.files as unknown as Record<string, unknown>) ?? {},
  };
}
