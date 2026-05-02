import { useMemo } from "react";
import { useComments } from "@/lib/vm/use-comments";
import { deriveAnchor } from "@/lib/anchor-derive";
import { IconComment } from "@/components/Icons";

interface Props {
  filePath: string;
  onCommentOnFile: () => void;
}

/**
 * Renders the "{N} file {M} orphan" pill in the `ViewerToolbar` `centerSlot`
 * (#280 AC2 verbatim — "1 file 1 orphan" when both counts are 1; populated
 * segments only otherwise).
 *
 * Owns its own narrow `useComments(filePath)` subscription so toolbar
 * re-renders are bounded to the pill — keeps render fan-out off the parent
 * (rule 30 in `docs/architecture.md`: narrow selectors / per-surface
 * subscriptions). Counts derive from existing wire fields routed through
 * the typed `deriveAnchor` adapter (rule 31 — never raw `anchor_kind`
 * string equality at consumer sites):
 *   - `deriveAnchor(root).kind === "file"` → file count.
 *   - `root.isOrphaned === true`           → orphan count (Anchor::Unknown
 *     / unresolved `WordRange` paths routed by Rust per iter 1, AC7).
 * Resolved threads are excluded from both counts.
 *
 * The button itself is ALWAYS rendered (it is the only entry point to author
 * a file-level comment from the viewer chrome — required for an empty file
 * to ever get its first file-anchored comment). The count text is appended
 * to the label only when at least one segment is non-zero.
 *
 * Composition over prop-bag growth: the toolbar stays oblivious to comment
 * domain knowledge (see `architecture-avoid-boolean-props` and
 * `patterns-children-over-render-props` in
 * `docs/best-practices-common/react/composition-patterns.md`).
 */
export function ToolbarFileCommentPill({ filePath, onCommentOnFile }: Props): React.JSX.Element {
  const { threads } = useComments(filePath); // rule 30 — narrow per-surface subscription
  const { fileCount, orphanCount } = useMemo(() => {
    let f = 0;
    let o = 0;
    for (const t of threads) {
      if (t.root.resolved) continue;
      if (deriveAnchor(t.root).kind === "file") f++;
      if (t.root.isOrphaned) o++;
    }
    return { fileCount: f, orphanCount: o };
  }, [threads]);

  // AC2 verbatim — "{N} file {M} orphan" with zero-segment omission and a
  // single space between segments. NO commas, NO slashes. Empty when both 0.
  const segments: string[] = [];
  if (fileCount > 0) segments.push(`${fileCount} file`);
  if (orphanCount > 0) segments.push(`${orphanCount} orphan`);
  const label = segments.join(" ");
  const hasCounts = label.length > 0;

  return (
    <button
      className="viewer-toolbar-btn viewer-toolbar-comment-on-file"
      onClick={onCommentOnFile}
      title="Comment on file"
      aria-label={hasCounts ? `Comment on file: ${label}` : "Comment on file"}
    >
      <IconComment />
      {hasCounts && (
        <span className="viewer-toolbar-comment-on-file-label">{label}</span>
      )}
    </button>
  );
}
