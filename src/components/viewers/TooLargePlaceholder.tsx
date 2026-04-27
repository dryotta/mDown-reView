import { basename } from "@/lib/path-utils";
import { formatBytes } from "@/lib/file-types";
import { revealInFolder } from "@/lib/tauri-commands";
import { warn } from "@/logger";

interface Props {
  path: string;
  size?: number;
}

export function TooLargePlaceholder({ path, size }: Props) {
  const name = basename(path);
  const handleReveal = () => {
    void revealInFolder(path).catch((e) =>
      warn(`revealInFolder failed: ${String(e)}`),
    );
  };
  return (
    <div className="too-large-placeholder">
      <p className="binary-filename">{name}</p>
      {size !== undefined && (
        <p className="binary-size">{formatBytes(size)}</p>
      )}
      <p className="too-large-message">
        File exceeds the 10 MB read cap. Reveal it in your file manager to open
        it from there.
      </p>
      <div className="binary-actions">
        <button type="button" onClick={handleReveal}>
          Reveal in folder
        </button>
      </div>
    </div>
  );
}
