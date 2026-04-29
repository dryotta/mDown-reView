import { basename } from "@/lib/path-utils";
import { formatBytes } from "@/lib/file-types";

interface Props {
  path: string;
  size?: number;
}

/**
 * Pure metadata display for files that exceed the 10 MB read cap.
 * All actions (reveal in folder) surface through the ViewerToolbar
 * mounted by ViewerRouter — the body is content/metadata only.
 */
export function TooLargePlaceholder({ path, size }: Props) {
  const name = basename(path);
  return (
    <div className="viewer-placeholder">
      <p className="binary-filename">{name}</p>
      {size !== undefined && (
        <p className="binary-size">{formatBytes(size)}</p>
      )}
      <p className="too-large-message">
        File exceeds the 10 MB read cap. Use the toolbar to reveal it in your
        file manager.
      </p>
    </div>
  );
}
