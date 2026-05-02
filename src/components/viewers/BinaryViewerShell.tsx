import { type ReactNode } from "react";
import { BinaryPlaceholder } from "./BinaryPlaceholder";
import { ViewerToolbar } from "./ViewerToolbar";
import { FileActionsBar } from "./FileActionsBar";

interface Props {
  path: string;
  size?: number;
  mtime?: number | null;
  /** G4 — forwarded to `ViewerToolbar.centerSlot`. Composition over prop-bag. */
  centerSlot?: ReactNode;
}

/**
 * Shell component that composes the ViewerToolbar above BinaryPlaceholder.
 * Callers plug `<ToolbarFileCommentPill ...>` into `centerSlot` to surface
 * the unresolved file-anchored thread count — important for binary files
 * where line-anchored gutter indicators don't apply.
 */
export function BinaryViewerShell({ path, size, mtime, centerSlot }: Props) {
  return (
    <div className="viewer-media-container">
      <ViewerToolbar
        activeView="visual"
        onViewChange={() => {}}
        hidden
        centerSlot={centerSlot}
        trailing={<FileActionsBar path={path} />}
      />
      <BinaryPlaceholder path={path} size={size} mtime={mtime} />
    </div>
  );
}

