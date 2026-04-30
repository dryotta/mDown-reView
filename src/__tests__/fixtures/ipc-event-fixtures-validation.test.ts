/**
 * Issue #311 forward-fix — pins the semantic-validation contract on
 * each IPC-event fixture factory. The validation closes the bug-class
 * recurrence path called out in iter-1 rubber-duck Finding 1: a future
 * test author calling `fileChangedReview("/source.md")` (source path
 * with kind="review") or `fileChangedContent("/x.md.review.yaml")`
 * (sidecar path with kind="content") would have re-opened the iter-1/
 * iter-3 #298 bug class. The factories now refuse those shapes at
 * construction time, citing `src-tauri/src/watcher.rs:489-496` and
 * `src-tauri/src/commands/comments/mod.rs:90-95`.
 */
import { describe, it, expect } from "vitest";

import {
  fileChangedReview,
  fileChangedReviewJson,
  fileChangedContent,
  fileChangedDeleted,
  commentsChanged,
  folderChanged,
} from "./ipc-event-fixtures";

describe("ipc-event-fixtures — semantic validation (issue #311 forward-fix)", () => {
  describe("fileChangedReview", () => {
    it("accepts a .review.yaml sidecar path", () => {
      expect(() => fileChangedReview("/x/notes.md.review.yaml")).not.toThrow();
    });
    it("accepts a .review.json sidecar path", () => {
      expect(() => fileChangedReview("/x/notes.md.review.json")).not.toThrow();
    });
    it("throws on a non-sidecar (source) path", () => {
      expect(() => fileChangedReview("/x/notes.md")).toThrow(/sidecar/i);
    });
  });

  describe("fileChangedReviewJson", () => {
    it("accepts a .review.json sidecar path", () => {
      expect(() => fileChangedReviewJson("/x/notes.md.review.json")).not.toThrow();
    });
    it("throws on a .review.yaml path", () => {
      expect(() => fileChangedReviewJson("/x/notes.md.review.yaml")).toThrow(/\.review\.json/i);
    });
    it("throws on a non-sidecar path", () => {
      expect(() => fileChangedReviewJson("/x/notes.md")).toThrow(/\.review\.json/i);
    });
  });

  describe("fileChangedContent", () => {
    it("accepts a non-sidecar (source) path", () => {
      expect(() => fileChangedContent("/x/notes.md")).not.toThrow();
    });
    it("throws on a .review.yaml sidecar path", () => {
      expect(() => fileChangedContent("/x/notes.md.review.yaml")).toThrow(/sidecar/i);
    });
    it("throws on a .review.json sidecar path", () => {
      expect(() => fileChangedContent("/x/notes.md.review.json")).toThrow(/sidecar/i);
    });
  });

  describe("fileChangedDeleted", () => {
    it("accepts a non-sidecar path (source deletion)", () => {
      expect(() => fileChangedDeleted("/x/notes.md")).not.toThrow();
    });
    it("accepts a sidecar path (sidecar deletion — production watcher does emit this)", () => {
      expect(() => fileChangedDeleted("/x/notes.md.review.yaml")).not.toThrow();
      expect(() => fileChangedDeleted("/x/notes.md.review.json")).not.toThrow();
    });
  });

  describe("commentsChanged", () => {
    it("accepts a source file path", () => {
      expect(() => commentsChanged("/x/notes.md")).not.toThrow();
    });
    it("throws on a sidecar path (commands/comments/mod.rs always emits source)", () => {
      expect(() => commentsChanged("/x/notes.md.review.yaml")).toThrow(/source/i);
      expect(() => commentsChanged("/x/notes.md.review.json")).toThrow(/source/i);
    });
  });

  describe("folderChanged", () => {
    it("accepts any directory path (no validation)", () => {
      expect(() => folderChanged("/anywhere")).not.toThrow();
      expect(() => folderChanged("/x/y.review.yaml")).not.toThrow();
    });
  });
});
