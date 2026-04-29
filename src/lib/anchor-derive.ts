// MRSF in-memory anchor types + the runtime helpers that derive a tagged
// `Anchor` from the wire shape. Previously lived in `src/types/comments.ts`;
// moved here in iter 2 of #263 (tauri-specta codegen façade rewrite) so
// the file boundary cleanly separates "types that auto-generate from Rust"
// (`@/lib/bindings.ts`) from "types we still hand-roll on the JS side".
//
// Why the in-memory shape diverges from the wire shape
// ─────────────────────────────────────────────────────
// `@/lib/bindings.ts` exposes the tagged-wire `AnchorWire`
// (`{anchor_kind, anchor_data}`) plus the flat `MatchedComment` shape that
// the IPC actually emits — neither is convenient for the rendering layer.
// Production code wants a discriminated union it can branch on with
// `switch (anchor.kind)`. `deriveAnchor()` is the one-time boundary
// adapter: every IPC result lands as a flat comment, gets fed through
// `deriveAnchor`, and from then on callers reason about the tagged
// `Anchor` defined here.
//
// Wire-format note (preserved from the deleted `src/types/comments.ts`):
// the on-disk MRSF v1.0/v1.1 layout is FLAT (legacy line fields + optional
// `anchor_kind` + per-variant payload field). The Rust serializer NEVER
// emits an `anchor` key on the wire, so production IPC results land here
// with `anchor` undefined. The `anchor` field is kept for in-memory /
// test fixtures only — production callers MUST go through `deriveAnchor(c)`
// to get the canonical tagged Anchor. `anchor_history` items use a fully
// tagged envelope on the wire (`{anchor_kind, anchor_data}`).

// Re-export the structured anchor payloads + reaction shape from bindings.
// These are the per-variant value types used in TaggedAnchor and elsewhere;
// keep them imported from the generated bindings so they stay in sync with
// the Rust source.
export type {
  CsvCellAnchor,
  HtmlElementAnchor,
  HtmlRangeAnchor,
  ImageRectAnchor,
  JsonPathAnchor,
  Reaction,
  Severity,
  WordRangePayload,
  CommentAnchor,
  CommentThread,
  MatchedComment,
} from "@/lib/bindings";

import type { WordRangePayload } from "@/lib/bindings";

// Backward-compat alias: existing call-sites use `WordRangeAnchor` (the
// pre-codegen name). The Rust struct is `WordRangePayload`; alias for
// import-surface stability.
export type WordRangeAnchor = WordRangePayload;

/**
 * In-memory tagged anchor union. `kind` matches the Rust serde wire
 * `anchor_kind` exactly (snake_case). Payload fields are inlined per
 * variant.
 *
 * NOT to be confused with `AnchorWire` from `@/lib/bindings` — that one
 * is the on-wire `{anchor_kind, anchor_data}` envelope. This shape is
 * the in-memory form callers branch on after `deriveAnchor()`.
 *
 * Optional payload fields are `T | null | undefined` to interoperate
 * with `bindings.ts`-generated shapes: specta-typescript emits Rust
 * `Option<T>` as `T | null`, while js-yaml + serde_json (and existing
 * test fixtures) emit absent keys as `undefined`. Allowing both at
 * the type level lets `deriveAnchor()` consume `MatchedComment` (wire
 * shape) without per-call coercion and lets call sites spread
 * `CommentAnchor` into a `{ kind: "line", ... }` literal.
 */
export type Anchor =
  | {
      kind: "line";
      line: number;
      end_line?: number | null;
      start_column?: number | null;
      end_column?: number | null;
      selected_text?: string | null;
      selected_text_hash?: string | null;
    }
  | { kind: "file" }
  | ({ kind: "word_range" } & WordRangePayload)
  | { kind: "unknown" };

/**
 * Explicit alias for the in-memory tagged anchor shape. Kept distinct
 * from `Anchor` (the back-compat name) and from `AnchorWire` (the
 * on-wire `{anchor_kind, anchor_data}` envelope) so future contributors
 * don't have to re-derive which shape they're holding.
 */
export type TaggedAnchor = Anchor;

/**
 * In-memory MRSF comment. The wire shape is the flat layout in
 * `MatchedComment` from `@/lib/bindings` (which extends this set of
 * fields with `matchedLineNumber` etc.). We keep a separate type here
 * because:
 * 1. The MRSF YAML loader (`mrsf-roundtrip.test.ts`) wants this shape
 *    typed for fixtures.
 * 2. `deriveAnchor()` is documented to operate on `MrsfComment`, and the
 *    field set it reads is a strict subset of `MatchedComment`.
 *
 * Field types are `T | null | undefined` rather than `T | undefined`
 * alone because:
 * 1. specta-typescript emits Rust `Option<T>` as `T | null` (not
 *    `T | undefined`). Accepting both at the type level lets
 *    `deriveAnchor(matchedComment)` consume the bindings.ts wire
 *    shape directly with no coercion at the IPC boundary.
 * 2. js-yaml + serde_json both emit absent keys as `undefined`, and
 *    existing fixtures pass `Partial<MrsfComment>` with `undefined`
 *    for missing fields — both forms must stay valid.
 *
 * Optional `anchor` is kept for in-memory / test fixtures only. The
 * Rust serializer NEVER emits an `anchor` key on the wire — production
 * callers MUST go through `deriveAnchor(c)` to get the canonical Anchor.
 */
export interface MrsfComment {
  id: string;
  author: string;
  timestamp: string;
  text: string;
  resolved: boolean;
  // Legacy v1.0 flat line fields. Rust still emits these in the flat wire
  // layout for `Anchor::Line`; matchers/exporters/threads still read them.
  // For `Anchor::Line` they MUST stay in sync with `anchor`'s payload.
  line?: number | null;
  end_line?: number | null;
  start_column?: number | null;
  end_column?: number | null;
  selected_text?: string | null;
  anchored_text?: string | null;
  selected_text_hash?: string | null;
  commit?: string | null;
  type?: "suggestion" | "issue" | "question" | "accuracy" | "style" | "clarity" | string | null;
  severity?: "low" | "medium" | "high" | string | null;
  reply_to?: string | null;
  // Canonical anchor — discriminated union. Replaces the seven flat
  // sibling fields (`anchor_kind`, `image_rect`, `csv_cell`, `json_path`,
  // `html_range`, `html_element`) that lived on this interface in iter 1.
  //
  // OPTIONAL on the wire: the Rust serializer keeps v1.0 line-anchored
  // comments byte-identical (no `anchor` key, no `anchor_kind` key — only
  // the legacy flat line fields). For v1.1 anchors (image_rect, csv_cell,
  // json_path, html_range, html_element, file) the flat layout is the
  // tagged `anchor_kind` + payload sibling shape — `anchor` is still
  // absent on the wire. Production callers MUST go through
  // `deriveAnchor(c)` to obtain the in-memory canonical Anchor regardless
  // of which on-wire shape arrived. Tests/fixtures may set `anchor`
  // directly to skip the derivation.
  anchor?: Anchor;
  // Tagged anchor-kind discriminator that mirrors Rust's wire `anchor_kind`.
  // Only present on v1.1 non-line anchors and on v1.1 line anchors with
  // additional v1.1 markers (history/reactions). `deriveAnchor` reads this
  // alongside the per-variant payload siblings below.
  //
  // Typed as `string | null` (rather than the literal union below) to
  // accept the bindings.ts `MatchedComment` shape verbatim — the Rust
  // serializer's `anchor_kind` is `Option<String>` so specta emits
  // `string | null`. The literal union is preserved in comments for
  // documentation purposes; `deriveAnchor`'s switch enumerates the
  // valid values explicitly.
  anchor_kind?:
    | "line"
    | "file"
    | "image_rect"
    | "csv_cell"
    | "json_path"
    | "html_range"
    | "html_element"
    | "word_range"
    | string
    | null;
  image_rect?: import("@/lib/bindings").ImageRectAnchor | null;
  csv_cell?: import("@/lib/bindings").CsvCellAnchor | null;
  json_path?: import("@/lib/bindings").JsonPathAnchor | null;
  html_range?: import("@/lib/bindings").HtmlRangeAnchor | null;
  html_element?: import("@/lib/bindings").HtmlElementAnchor | null;
  word_range?: WordRangePayload | null;
  // `bindings.ts` types `anchor_history` as `AnchorWire[] | null` (the
  // tagged on-wire envelope). Hand-rolled fixtures + the YAML round-trip
  // loader instead populate it with the in-memory `Anchor[]` shape. The
  // type is broadened to accept either form so production code can pass
  // `MatchedComment` directly without a wire→domain conversion at the
  // type level (the runtime-side resolution lives in `deriveAnchor`'s
  // siblings of caller code).
  anchor_history?: Anchor[] | import("@/lib/bindings").AnchorWire[] | null;
  reactions?: import("@/lib/bindings").Reaction[] | null;
}

/**
 * Top-level MRSF sidecar shape. Used by the YAML round-trip test
 * (`mrsf-roundtrip.test.ts`) which loads `.review.yaml` files via
 * `js-yaml`. Mirrors the Rust `MrsfSidecar` struct.
 */
export interface MrsfSidecar {
  mrsf_version: string;
  document: string;
  comments: MrsfComment[];
}

/**
 * Derive the canonical [`Anchor`] for a comment regardless of which on-wire
 * shape arrived. Production callers MUST use this rather than reading
 * `c.anchor` directly because the Rust serializer never emits the `anchor`
 * key — it stays on the wire as flat line fields (v1.0) or as the tagged
 * `anchor_kind` + payload sibling layout (v1.1). Returns the explicit
 * `c.anchor` if a fixture/in-memory caller set it.
 */
export function deriveAnchor(c: MrsfComment): Anchor {
  if (c.anchor) return c.anchor;
  // `anchor_kind` is typed as `string | null | undefined` to match the
  // bindings.ts wire shape; switch on the known discriminator values
  // and treat anything else (including `null` / unknown strings) as
  // the implicit "line" default + flat-field derivation below.
  switch (c.anchor_kind) {
    case "file":
      return { kind: "file" };
    case "word_range":
      if (c.word_range) return { kind: "word_range", ...c.word_range };
      // word_range without payload → treat as unknown
      return { kind: "unknown" };
    case "image_rect":
    case "csv_cell":
    case "json_path":
    case "html_range":
    case "html_element":
      // Known-but-deleted anchor types → unknown
      return { kind: "unknown" };
    case "line":
    case null:
    case undefined:
      break;
    default:
      // Unknown future discriminator → fall through to line derivation
      // (matches the v1.0 default behaviour for missing `anchor_kind`).
      break;
  }
  // Default / `anchor_kind: "line"` / missing → derive a Line anchor
  // from the flat sibling fields. `line` defaults to 0 (matches Rust).
  return {
    kind: "line",
    line: c.line ?? 0,
    end_line: c.end_line,
    start_column: c.start_column,
    end_column: c.end_column,
    selected_text: c.selected_text,
    selected_text_hash: c.selected_text_hash,
  };
}

/**
 * Exhaustive-switch guard for the `Anchor.kind` discriminator.
 * Usage: `default: assertNeverAnchorKind(anchor)` in switch blocks.
 */
export function assertNeverAnchorKind(a: never): never {
  throw new Error(`Unhandled anchor kind: ${(a as Anchor).kind}`);
}
