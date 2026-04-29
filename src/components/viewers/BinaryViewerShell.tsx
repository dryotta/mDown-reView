import { BinaryPlaceholder } from "./BinaryPlaceholder";
import { ViewerToolbar } from "./ViewerToolbar";
import { FileActionsBar } from "./FileActionsBar";
import type { Severity } from "@/lib/tauri-commands";

interface Props {
  path: string;
  size?: number;
  mtime?: number | null;
  onCommentOnFile?: () => void;
  fileCommentCount?: number;
  fileCommentSeverity?: Severity | null;
}

/**
 * Shell component that composes the ViewerToolbar above BinaryPlaceholder.
 * `fileCommentCount`/`fileCommentSeverity` surface the unresolved
 * file-anchored thread count next to the toolbar's "Comment on file"
 * button — important for binary files where line-anchored gutter
 * indicators don't apply.
 */
export function BinaryViewerShell({ path, size, mtime, onCommentOnFile, fileCommentCount, fileCommentSeverity }: Props) {
  return (
    <div className="viewer-media-container">
      <ViewerToolbar
        activeView="visual"
        onViewChange={() => {}}
        hidden
        onCommentOnFile={onCommentOnFile}
        fileCommentCount={fileCommentCount}
        fileCommentSeverity={fileCommentSeverity}
        trailing={<FileActionsBar path={path} />}
      />
      <BinaryPlaceholder path={path} size={size} mtime={mtime} />
    </div>
  );
}
