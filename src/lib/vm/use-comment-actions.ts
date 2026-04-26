import { useCallback } from "react";
import { useStore } from "@/store";
import {
  addComment as addCommentCmd,
  addReply as addReplyCmd,
  editComment as editCommentCmd,
  deleteComment as deleteCommentCmd,
  updateComment,
  computeAnchorHash,
  type CommentAnchor,
} from "@/lib/tauri-commands";
import type { Anchor } from "@/types/comments";
import { error } from "@/logger";

/**
 * Anchor argument accepted by `addComment`. We accept either:
 * - the legacy IPC-shape `CommentAnchor` (line + selected_text), used by the
 *   line-margin and selection-anchor entry points; or
 * - the discriminated `Anchor` union, used by the iter-5 file-level entry
 *   points (`{ kind: "file" }`) and any future typed-anchor authoring path.
 */
export type AddCommentAnchor = CommentAnchor | Anchor;

/**
 * Narrow `AddCommentAnchor` to the line-shaped subset that carries a
 * `selected_text_hash` field — i.e. legacy `CommentAnchor` (no `kind`) or the
 * tagged `{ kind: "line", ... }` variant. Used to short-circuit the
 * hash-computation branch for non-line tagged anchors.
 */
function isLineShapedAnchor(
  a: AddCommentAnchor,
): a is CommentAnchor | Extract<Anchor, { kind: "line" }> {
  return !("kind" in a) || a.kind === "line";
}

interface UseCommentActionsResult {
  addComment: (
    filePath: string,
    text: string,
    anchor?: AddCommentAnchor,
    commentType?: string,
    severity?: string,
    document?: string
  ) => Promise<void>;
  addReply: (
    filePath: string,
    parentId: string,
    text: string
  ) => Promise<void>;
  editComment: (
    filePath: string,
    commentId: string,
    text: string
  ) => Promise<void>;
  deleteComment: (filePath: string, commentId: string) => Promise<void>;
  resolveComment: (filePath: string, commentId: string) => Promise<void>;
  unresolveComment: (filePath: string, commentId: string) => Promise<void>;
  /**
   * F1 — resolve the currently-focused thread (driven by the `R`
   * keyboard shortcut). Reads `focusedThreadId` + `activeTabPath`
   * from the store at call time and routes through the existing
   * `update_comment` chokepoint. No-op when nothing is focused.
   */
  resolveFocusedThread: () => Promise<void>;
  /**
   * Re-anchor a comment thread to a new Anchor. Dispatches the
   * `move_anchor` CommentPatch via `update_comment`; the Rust command
   * emits `comments-changed`, which `useComments` already subscribes to,
   * so callers do not need to trigger a reload manually.
   */
  commitMoveAnchor: (filePath: string, commentId: string, newAnchor: Anchor) => Promise<void>;
  /**
   * Iter 6 F4 — append a quick-reaction (`thumbsup` / `ack` / `dismiss`)
   * to a comment. Routes through the `add_reaction` CommentPatch chokepoint;
   * the Rust command is idempotent on (`user`, `kind`) so duplicate clicks
   * from the same author are silent no-ops.
   */
  addReaction: (filePath: string, commentId: string, kind: string) => Promise<void>;
}

/**
 * Hook that exposes comment mutation actions.
 * Each action calls the corresponding Rust command.
 * Author comes from the Zustand UI store (authorName).
 */
export function useCommentActions(): UseCommentActionsResult {
  const authorName = useStore((s) => s.authorName);

  const addComment = useCallback(
    async (
      filePath: string,
      text: string,
      anchor?: AddCommentAnchor,
      commentType?: string,
      severity?: string,
      document?: string
    ) => {
      try {
        let resolvedAnchor: AddCommentAnchor | undefined = anchor;
        // Compute the selected_text hash for line-shaped anchors (legacy
        // `CommentAnchor` and the tagged `{ kind: "line", ... }` variant) when
        // text is present but the hash is missing. Non-line tagged anchors
        // (`file`, `image_rect`, ...) carry no `selected_text_hash`, so we
        // pass them through untouched.
        if (anchor && isLineShapedAnchor(anchor) && anchor.selected_text && !anchor.selected_text_hash) {
          const hash = await computeAnchorHash(anchor.selected_text);
          resolvedAnchor = { ...anchor, selected_text_hash: hash };
        }
        await addCommentCmd(
          filePath,
          authorName || "Anonymous",
          text,
          resolvedAnchor,
          commentType,
          severity,
          document
        );
      } catch (e) {
        error(`[vm] Failed to add comment: ${e}`);
        throw e;
      }
    },
    [authorName]
  );

  const addReply = useCallback(
    async (filePath: string, parentId: string, text: string) => {
      try {
        await addReplyCmd(filePath, parentId, authorName || "Anonymous", text);
      } catch (e) {
        error(`[vm] Failed to add reply: ${e}`);
        throw e;
      }
    },
    [authorName]
  );

  const editComment = useCallback(
    async (filePath: string, commentId: string, text: string) => {
      try {
        await editCommentCmd(filePath, commentId, text);
      } catch (e) {
        error(`[vm] Failed to edit comment: ${e}`);
        throw e;
      }
    },
    []
  );

  const deleteComment = useCallback(
    async (filePath: string, commentId: string) => {
      try {
        await deleteCommentCmd(filePath, commentId);
      } catch (e) {
        error(`[vm] Failed to delete comment: ${e}`);
        throw e;
      }
    },
    []
  );

  const resolveComment = useCallback(
    async (filePath: string, commentId: string) => {
      try {
        await updateComment(filePath, commentId, {
          kind: "set_resolved",
          data: { resolved: true },
        });
      } catch (e) {
        error(`[vm] Failed to resolve comment: ${e}`);
        throw e;
      }
    },
    []
  );

  const unresolveComment = useCallback(
    async (filePath: string, commentId: string) => {
      try {
        await updateComment(filePath, commentId, {
          kind: "set_resolved",
          data: { resolved: false },
        });
      } catch (e) {
        error(`[vm] Failed to unresolve comment: ${e}`);
        throw e;
      }
    },
    []
  );

  const commitMoveAnchor = useCallback(
    async (filePath: string, commentId: string, newAnchor: Anchor) => {
      try {
        await updateComment(filePath, commentId, {
          kind: "move_anchor",
          data: { new_anchor: newAnchor },
        });
      } catch (e) {
        error(`[vm] Failed to move anchor: ${e}`);
        throw e;
      }
    },
    []
  );

  const addReaction = useCallback(
    async (filePath: string, commentId: string, kind: string) => {
      try {
        await updateComment(filePath, commentId, {
          kind: "add_reaction",
          data: {
            user: authorName || "Anonymous",
            kind,
            ts: new Date().toISOString(),
          },
        });
      } catch (e) {
        error(`[vm] Failed to add reaction: ${e}`);
        throw e;
      }
    },
    [authorName]
  );

  const resolveFocusedThread = useCallback(async () => {
    const { focusedThreadId, activeTabPath } = useStore.getState();
    if (!focusedThreadId || !activeTabPath) return;
    try {
      await updateComment(activeTabPath, focusedThreadId, {
        kind: "set_resolved",
        data: { resolved: true },
      });
    } catch (e) {
      error(`[vm] Failed to resolve focused thread: ${e}`);
      throw e;
    }
  }, []);

  return {
    addComment,
    addReply,
    editComment,
    deleteComment,
    resolveComment,
    unresolveComment,
    commitMoveAnchor,
    addReaction,
    resolveFocusedThread,
  };
}
