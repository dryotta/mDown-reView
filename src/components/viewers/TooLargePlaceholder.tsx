import { basename } from "@/lib/path-utils";
import { formatBytes } from "@/lib/file-types";
import { openInDefaultApp } from "@/lib/tauri-commands";
import { warn } from "@/logger";

interface Props {
  path: string;
  size?: number;
}

export function TooLargePlaceholder({ path, size }: Props) {
  const name = basename(path);
  const handleOpen = () => {
    void openInDefaultApp(path).catch((e) =>
      warn(`openInDefaultApp failed: ${String(e)}`),
    );
  };
  return (
    <div className="too-large-placeholder">
      <p className="binary-filename">{name}</p>
      {size !== undefined && (
        <p className="binary-size">{formatBytes(size)}</p>
      )}
      <p className="too-large-message">
        File exceeds the 10 MB read cap. Open it in the OS default app to view
        the full contents.
      </p>
      <div className="binary-actions">
        <button type="button" onClick={handleOpen}>
          Open in default app
        </button>
      </div>
    </div>
  );
}
