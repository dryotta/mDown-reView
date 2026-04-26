// MRSF comment + Anchor types — single source of truth for the TS side.
//
// Mirrors the Rust `Anchor` enum from `src-tauri/src/core/types/mod.rs`.
// `kind` discriminator values match the Rust serde wire `anchor_kind`
// (snake_case). Payload shapes mirror the per-variant Rust structs.
//
// Wire-format note: the on-disk MRSF v1.0/v1.1 layout is FLAT (legacy
// line fields + optional `anchor_kind` + per-variant payload field). The
// Rust serializer NEVER emits the `anchor` key on the wire, so production
// IPC results land here with `anchor` undefined. The `anchor` field is
// kept for in-memory / test fixtures only — production callers MUST go
// through `deriveAnchor(c)` to get the canonical tagged Anchor.
// `anchor_history` items use a fully tagged envelope on the wire
// (`{anchor_kind, anchor_data}`).

export interface ImageRectAnchor {
  x_pct: number;
  y_pct: number;
  w_pct?: number;
  h_pct?: number;
}

export interface CsvCellAnchor {
  row_idx: number;
  col_idx: number;
  col_header: string;
  primary_key_col?: string;
  primary_key_value?: string;
}

export interface JsonPathAnchor {
  json_path: string;
  scalar_text?: string;
}

export interface HtmlRangeAnchor {
  selector_path: string;
  start_offset: number;
  end_offset: number;
  selected_text: string;
}

export interface HtmlElementAnchor {
  selector_path: string;
  tag: string;
  text_preview: string;
}

export interface WordRangeAnchor {
  start_word: number;
  end_word: number;
  line: number;
  snippet: string;
  line_text_hash: string;
}

/**
 * Tagged anchor union. `kind` matches the Rust serde wire `anchor_kind`
 * exactly (snake_case). Payload fields are inlined per variant.
 */
export type Anchor =
  | {
      kind: "line";
      line: number;
      end_line?: number;
      start_column?: number;
      end_column?: number;
      selected_text?: string;
      selected_text_hash?: string;
    }
  | { kind: "file" }
  | ({ kind: "image_rect" } & ImageRectAnchor)
  | ({ kind: "csv_cell" } & CsvCellAnchor)
  | ({ kind: "json_path" } & JsonPathAnchor)
  | ({ kind: "html_range" } & HtmlRangeAnchor)
  | ({ kind: "html_element" } & HtmlElementAnchor)
  | ({ kind: "word_range" } & WordRangeAnchor);

export interface Reaction {
  user: string;
  kind: string;
  ts: string;
}

export interface MrsfComment {
  id: string;
  author: string;
  timestamp: string;
  text: string;
  resolved: boolean;
  // Legacy v1.0 flat line fields. Rust still emits these in the flat wire
  // layout for `Anchor::Line`; matchers/exporters/threads still read them.
  // For `Anchor::Line` they MUST stay in sync with `anchor`'s payload.
  line?: number;
  end_line?: number;
  start_column?: number;
  end_column?: number;
  selected_text?: string;
  anchored_text?: string;
  selected_text_hash?: string;
  commit?: string;
  type?: "suggestion" | "issue" | "question" | "accuracy" | "style" | "clarity";
  severity?: "low" | "medium" | "high";
  reply_to?: string;
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
  anchor_kind?: "line" | "file" | "image_rect" | "csv_cell" | "json_path" | "html_range" | "html_element" | "word_range";
  image_rect?: ImageRectAnchor;
  csv_cell?: CsvCellAnchor;
  json_path?: JsonPathAnchor;
  html_range?: HtmlRangeAnchor;
  html_element?: HtmlElementAnchor;
  word_range?: WordRangeAnchor;
  anchor_history?: Anchor[];
  reactions?: Reaction[];
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
  switch (c.anchor_kind) {
    case "file":
      return { kind: "file" };
    case "image_rect":
      if (c.image_rect) return { kind: "image_rect", ...c.image_rect };
      break;
    case "csv_cell":
      if (c.csv_cell) return { kind: "csv_cell", ...c.csv_cell };
      break;
    case "json_path":
      if (c.json_path) return { kind: "json_path", ...c.json_path };
      break;
    case "html_range":
      if (c.html_range) return { kind: "html_range", ...c.html_range };
      break;
    case "html_element":
      if (c.html_element) return { kind: "html_element", ...c.html_element };
      break;
    case "word_range":
      if (c.word_range) return { kind: "word_range", ...c.word_range };
      break;
    case "line":
    case undefined:
      break;
  }
  // Default / `anchor_kind: "line"` / missing payload → derive a Line anchor
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

export interface MrsfSidecar {
  mrsf_version: string;
  document: string;
  comments: MrsfComment[];
}
