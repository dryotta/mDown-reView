/**
 * Single source of truth for the set of Tauri IPC commands that mutate
 * the sidecar and trigger a `comments-changed` emit downstream of
 * `Emitter::emit_to("main", "comments-changed", …)` in
 * `src-tauri/src/commands/comments/{mod.rs,update.rs}`.
 *
 * Mirrored on the JS side so unit-test mocks (`src/__mocks__/...`) and
 * Playwright fixtures (`e2e/browser/fixtures/error-tracking.ts`) can
 * auto-emit the event after every successful mutation invoke without
 * each test having to dispatch it by hand. Adding a new mutation
 * command is a single-edit operation here; the Rust side is caught at
 * `cargo build` time via the trait callsites.
 */
export const COMMENT_MUTATION_COMMANDS = [
  "add_comment",
  "edit_comment",
  "delete_comment",
  "add_reply",
  "update_comment",
] as const;

export type CommentMutationCommand = (typeof COMMENT_MUTATION_COMMANDS)[number];
