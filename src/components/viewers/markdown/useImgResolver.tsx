import { useCallback } from "react";
import type { ComponentPropsWithoutRef, ComponentType } from "react";
import type { ExtraProps } from "react-markdown";
import { convertAssetUrl } from "@/lib/tauri-commands";
import { dirname } from "@/lib/path-utils";

type ImgComponent = ComponentType<ComponentPropsWithoutRef<"img"> & ExtraProps>;

/**
 * Returns a memoized `img` component for ReactMarkdown that resolves
 * relative image sources against the current file's directory and
 * converts them to Tauri asset URLs. The returned `img` reference is
 * stable across renders for the same `filePath`, allowing the wider
 * components map to skip rebuilding on unrelated re-renders.
 */
export function useImgResolver(filePath: string | null): { img: ImgComponent } {
  const img = useCallback<ImgComponent>(
    ({ src, alt, node: _node, ...props }) => {
      let resolvedSrc = src;
      if (
        filePath &&
        src &&
        !src.startsWith("http://") &&
        !src.startsWith("https://") &&
        !src.startsWith("data:")
      ) {
        const fileDir = dirname(filePath);
        const absolute =
          src.startsWith("/") || src.startsWith("\\") || /^[a-zA-Z]:/.test(src)
            ? src
            : `${fileDir}/${src}`;
        resolvedSrc = convertAssetUrl(absolute);
      }
      return <img src={resolvedSrc} alt={alt ?? ""} {...props} />;
    },
    [filePath],
  );

  return { img };
}
