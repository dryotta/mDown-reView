import { useState, useEffect } from "react";
import { getAppVersion, getLogPath } from "@/lib/tauri-commands";

export function useAboutInfo() {
  const [version, setVersion] = useState("");
  const [logPath, setLogPath] = useState("");

  useEffect(() => {
    getAppVersion()
      .then((v) => setVersion(v))
      .catch(() => setVersion("unknown"));
    getLogPath()
      .then((path) => setLogPath(path))
      .catch(() => setLogPath("Unavailable"));
  }, []);

  return { version, logPath };
}
