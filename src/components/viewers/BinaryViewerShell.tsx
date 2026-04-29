import { BinaryPlaceholder } from "./BinaryPlaceholder";
import { ViewerToolbar } from "./ViewerToolbar";
import { FileActionsBar } from "./FileActionsBar";

interface Props {
  path: string;
  size?: number;
  mtime?: number | null;
  onCommentOnFile?: () => void;
}

/**
 * Shell component that composes the ViewerToolbar above BinaryPlaceholder.
 */
export function BinaryViewerShell({ path, size, mtime, onCommentOnFile }: Props) {
  return (
    <div className="viewer-media-container">
      <ViewerToolbar
        activeView="visual"
        onViewChange={() => {}}
        hidden
        onCommentOnFile={onCommentOnFile}
        trailing={<FileActionsBar path={path} />}
      />
      <BinaryPlaceholder path={path} size={size} mtime={mtime} />
    </div>
  );
}
