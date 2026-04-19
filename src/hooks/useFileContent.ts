import { useEffect, useState } from "react";
import { readTextFile } from "@/lib/tauri-commands";
import { getFileCategory } from "@/lib/file-types";

export type FileStatus = "loading" | "ready" | "binary" | "too_large" | "image" | "error";

export interface FileContent {
  status: FileStatus;
  content?: string;
  error?: string;
}

export function useFileContent(path: string): FileContent {
  const [state, setState] = useState<FileContent>({ status: "loading" });

  useEffect(() => {
    setState({ status: "loading" });
    
    // Short-circuit for image files - don't attempt to read as text
    if (getFileCategory(path) === "image") {
      setState({ status: "image" });
      return;
    }
    
    readTextFile(path)
      .then((content) => setState({ status: "ready", content }))
      .catch((err: unknown) => {
        const msg = String(err);
        if (msg.includes("binary_file")) {
          setState({ status: "binary" });
        } else if (msg.includes("file_too_large")) {
          setState({ status: "too_large" });
        } else {
          setState({ status: "error", error: msg });
        }
      });
  }, [path]);

  return state;
}
