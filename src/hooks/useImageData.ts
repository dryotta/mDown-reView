import { useState, useEffect } from "react";
import { readBinaryFile } from "@/lib/tauri-commands";

export function useImageData(path: string, mime: string) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null); // eslint-disable-line react-hooks/set-state-in-effect
    setError(null);
    readBinaryFile(path)
      .then((base64) => {
        if (!cancelled) setDataUrl(`data:${mime};base64,${base64}`);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => { cancelled = true; };
  }, [path, mime]);

  return { dataUrl, error };
}
