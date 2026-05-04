/**
 * Source-mode wrapper for Excalidraw PNG/SVG variants (issue #352 / AC2).
 *
 * For canonical `.excalidraw` / `.excalidrawlib` files the SourceView
 * receives the raw JSON text directly. For `.excalidraw.png` /
 * `.excalidraw.svg` the on-disk bytes are binary (PNG with `tEXt` chunk
 * or SVG with `<metadata>` element); the embedded scene must be
 * extracted before SourceView can render it.
 *
 * This component lives separate from the lazy `<ExcalidrawView>` because
 * Source mode is rendered ABOVE the lazy boundary (no
 * `@excalidraw/excalidraw` package needed for plain JSON syntax
 * highlighting). We DO need the package's `loadFromBlob` to extract the
 * embedded scene, though, which means this component itself must be
 * lazy-loaded — same chunk as the read path in `extractScene.ts`.
 *
 * Pretty-printing: PNG/SVG variants are derived (the JSON is generated
 * by Excalidraw's `serializeAsJSON`, a single line). Source mode for a
 * binary variant is a *display* surface, not a *write* surface — the
 * file's authoritative bytes are the rendered raster + embedded chunk,
 * not the JSON. So we pretty-print here for readability without
 * defeating MRSF re-anchoring (which only applies to authoritative
 * source files like `.excalidraw` / `.excalidrawlib`).
 */

import { startTransition, useEffect, useState } from "react";

import { extractScene } from "@/lib/excalidraw/extractScene";
import { warn as logWarn } from "@/logger";

import { SourceView } from "./SourceView";
import { SkeletonLoader } from "./SkeletonLoader";

interface Props {
  filePath: string;
  fileSize?: number;
  wordWrap: boolean;
  zoom: number;
  /** Pseudo-path used by `SourceView` for syntax-highlighting language detection.
   *  We pass `<filePath>.json` so the highlighter picks JSON, not PNG/SVG. */
  syntaxPath: string;
}

export function ExcalidrawSourceMode({ filePath, fileSize, wordWrap, zoom, syntaxPath }: Props) {
  const [json, setJson] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    extractScene(filePath)
      .then((scene) => {
        if (cancelled) return;
        // Pretty-print for readability — see file header rationale.
        const text = JSON.stringify(
          {
            type: "excalidraw",
            version: 2,
            source: filePath,
            elements: scene.elements,
            appState: scene.appState,
            files: scene.files,
          },
          null,
          2,
        );
        startTransition(() => {
          setJson(text);
          setError(null);
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        void logWarn(`excalidraw source-mode extract failed: ${msg}`);
        startTransition(() => {
          setJson(null);
          setError(msg);
        });
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  if (error) {
    return (
      <div
        className="excalidraw-source-mode excalidraw-source-mode--error"
        data-testid="excalidraw-source-error"
      >
        <p style={{ padding: "1rem", color: "var(--color-error, #c00)" }}>
          Failed to extract Excalidraw scene: {error}
        </p>
      </div>
    );
  }

  if (json === null) {
    return <SkeletonLoader />;
  }

  return (
    <SourceView
      content={json}
      path={syntaxPath}
      filePath={filePath}
      fileSize={fileSize}
      wordWrap={wordWrap}
      zoom={zoom}
    />
  );
}
