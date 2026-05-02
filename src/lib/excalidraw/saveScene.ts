/**
 * Excalidraw scene serialization (issue #352 iter 3 / AC5).
 *
 * Thin library wrapper around Excalidraw's serializer + image-export APIs.
 * Routes to the workspace-write IPC chokepoint (`write_workspace_text` /
 * `write_workspace_binary`) per `docs/architecture.md` rule 32 and
 * `docs/security.md` rule 29 (extension allowlist enforced by Rust).
 *
 * Format-preserving by file type:
 *   - `.excalidraw`            → `serializeAsJSON({ elements, appState, files })` (verbatim — no pretty-print) → text IPC
 *   - `.excalidrawlib`         → `serializeLibraryAsJSON({ libraryItems })` (verbatim) → text IPC
 *   - `.excalidraw.png`        → `exportToBlob({ ..., mimeType: "image/png", embedScene: true })` → base64 → binary IPC
 *   - `.excalidraw.svg`        → `exportToSvg({ ..., embedScene: true })` → base64 → binary IPC
 *
 * Why no pretty-printing: Excalidraw's `serializeAsJSON` already emits a
 * stable canonical form. Re-formatting it would defeat MRSF's source-line
 * re-anchoring on every save (the line numbers would shift). Per spec we
 * accept that fragility; we MUST NOT amplify it by inserting our own
 * whitespace pass.
 *
 * Imported only by the lazy-loaded `ExcalidrawView` so the
 * `@excalidraw/excalidraw` save APIs never enter the main bundle (AC8 —
 * lazy-chunk-only).
 */

import {
  exportToBlob,
  exportToSvg,
  serializeAsJSON,
  serializeLibraryAsJSON,
} from "@excalidraw/excalidraw";

import { writeWorkspaceBinary, writeWorkspaceText } from "@/lib/tauri-commands";

/**
 * Inputs the saver needs from the Excalidraw scene at save time. Mirrors
 * Excalidraw's `serializeAsJSON` / `exportToBlob` arg shapes.
 *
 * Typed as the readonly snapshot the Excalidraw API returns on `onChange`
 * — we never mutate; we serialize and post. We keep these as opaque
 * `unknown` payloads (mirroring `ExcalidrawScene` in `extractScene.ts`)
 * because Excalidraw's package doesn't re-export the underlying
 * `ExcalidrawElement` / `AppState` / `BinaryFiles` types from its public
 * entry; the serializers accept them positionally.
 */
export interface ExcalidrawSaveData {
  elements: ReadonlyArray<unknown>;
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
  /**
   * `.excalidrawlib` library items. `null`/`undefined` for non-library
   * files. Excalidraw passes library items through `appState.libraryItems`
   * during normal editing; we read either source.
   */
  libraryItems?: ReadonlyArray<unknown> | null;
}

/**
 * Encode a `Blob` to base64 (sans data: URL prefix) for transport over
 * the workspace-write binary IPC. Deliberately small + dependency-free —
 * `FileReader#readAsDataURL` is universally available in browsers and
 * Tauri webviews.
 */
async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // Chunked conversion to avoid stack overflow on large blobs (a 5 MB PNG
  // is ~5e6 args — fromCharCode chokes around 65 K). 32 K is well-tested.
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

/**
 * Serialize an `<svg>` DOM element to a UTF-8 byte array, then to base64
 * for binary-IPC transport. Excalidraw's `exportToSvg` returns a live
 * `<svg>` DOM node; we serialize via `XMLSerializer` (browser-native).
 */
function svgToBase64(svg: SVGSVGElement): string {
  const xml = new XMLSerializer().serializeToString(svg);
  // `unescape(encodeURIComponent(...))` is the canonical UTF-8 → binary
  // string trick for `btoa` since `btoa` only accepts Latin-1.
  return btoa(unescape(encodeURIComponent(xml)));
}

/**
 * Save an Excalidraw scene back to disk in the original file format.
 *
 * Throws on:
 *   - unsupported extension (caller should disable the Save button before
 *     reaching this code path; throw is a defensive guard, not a UI flow).
 *   - any underlying IPC error (rejected `Result` is unwrapped to a
 *     thrown `Error` by the façade).
 *
 * allow-chained-invokes: each branch's `await`s are sequential by data
 * dependency — the IPC call (`writeWorkspaceText` / `writeWorkspaceBinary`)
 * needs the serialized bytes from the prior `exportToBlob` / `exportToSvg`
 * call, which is JS work, not IPC. The lint rule's "4 awaited IPC calls"
 * count includes the JS API calls; only ONE IPC fires per save.
 */
export async function saveExcalidrawFile(
  filePath: string,
  data: ExcalidrawSaveData,
): Promise<void> {
  // allow-chained-invokes: sequential by data dependency — `writeWorkspaceText`
  // / `writeWorkspaceBinary` (the only real IPC) needs bytes from the prior
  // `exportToBlob` / `exportToSvg` call (JS work, not IPC). Per branch only
  // ONE IPC fires; the rule's "4 chained IPC calls" count includes the JS
  // API calls. See `docs/architecture.md` rule 1.
  const lower = filePath.toLowerCase();

  if (lower.endsWith(".excalidraw.png")) {
    const blob = await exportToBlob({
      elements: data.elements as never,
      appState: data.appState as never,
      files: data.files as never,
      mimeType: "image/png",
      // Round-trips: PNG bytes carry the scene in a `tEXt` chunk so the
      // file re-opens losslessly (matches the read path in extractScene).
      exportEmbedScene: true,
    });
    const base64 = await blobToBase64(blob);
    await writeWorkspaceBinary(filePath, base64);
    return;
  }

  if (lower.endsWith(".excalidraw.svg")) {
    const svg = await exportToSvg({
      elements: data.elements as never,
      appState: data.appState as never,
      files: data.files as never,
      // Same round-trip semantics as PNG — embed scene in `<metadata>`.
      exportEmbedScene: true,
    });
    const base64 = svgToBase64(svg);
    await writeWorkspaceBinary(filePath, base64);
    return;
  }

  if (lower.endsWith(".excalidrawlib")) {
    // Library files use a separate serializer that emits the
    // `excalidrawlib` JSON shape (`type: "excalidrawlib"`).
    const items = (data.libraryItems ??
      (data.appState as Record<string, unknown>).libraryItems ??
      []) as ReadonlyArray<unknown>;
    const text = serializeLibraryAsJSON(items as never);
    await writeWorkspaceText(filePath, text);
    return;
  }

  if (lower.endsWith(".excalidraw")) {
    // Verbatim — no pretty-print, no JSON.stringify rewrap.
    const text = serializeAsJSON(
      data.elements as never,
      data.appState as never,
      data.files as never,
      "local",
    );
    await writeWorkspaceText(filePath, text);
    return;
  }

  throw new Error(`saveExcalidrawFile: unsupported extension for ${filePath}`);
}
