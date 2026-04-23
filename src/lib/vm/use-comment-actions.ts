import { useCallback } from "react";
import { useStore } from "@/store";
import {
  addComment as addCommentCmd,
  addReply as addReplyCmd,
  editComment as editCommentCmd,
  deleteComment as deleteCommentCmd,
  setCommentResolved,
  type CommentAnchor,
} from "@/lib/tauri-commands";
import { error } from "@/logger";

export interface UseCommentActionsResult {
  addComment: (
    filePath: string,
    text: string,
    anchor?: CommentAnchor,
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
      anchor?: CommentAnchor,
      commentType?: string,
      severity?: string,
      document?: string
    ) => {
      try {
        await addCommentCmd(
          filePath,
          authorName || "Anonymous",
          text,
          anchor,
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
        await setCommentResolved(filePath, commentId, true);
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
        await setCommentResolved(filePath, commentId, false);
      } catch (e) {
        error(`[vm] Failed to unresolve comment: ${e}`);
        throw e;
      }
    },
    []
  );

  return {
    addComment,
    addReply,
    editComment,
    deleteComment,
    resolveComment,
    unresolveComment,
  };
}
