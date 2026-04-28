# MRSF v1.0 Specification — Provenance & Gap Analysis

## Provenance

The file [`docs/specs/MRSF-v1.0.md`](MRSF-v1.0.md) is a **verbatim, unmodified copy** of the
[MRSF v1.0 specification](https://github.com/wictorwilen/MRSF/blob/main/MRSF-v1.0.md) from the
canonical upstream repository [wictorwilen/MRSF](https://github.com/wictorwilen/MRSF),
at commit `aca014902ff2b39d02cb45c8012d54e8bdf8731d`.

The upstream repository is the authoritative source — check it for updates.
Refer to the upstream repository for licensing terms.

---

## Gap Analysis: mdownreview vs MRSF v1.0

Comparison of the upstream MRSF v1.0 specification against the mdownreview implementation.
Each item notes whether it is **conformant**, a **gap** (missing), or a **deviation** (behaves
differently from the spec).

### §3 — File Naming and Discovery

| Spec requirement | Status | Notes |
|---|---|---|
| Co-located `<doc>.review.yaml` naming (§3.1) | ✅ Conformant | `load_sidecar` in `core/sidecar/mod.rs` appends `.review.yaml` then falls back to `.review.json`. |
| `.review.json` as alternate serialization | ✅ Conformant | JSON fallback is read-only; new sidecars always written as YAML. |
| `.mrsf.yaml` alternate sidecar location (§3.2) | ❌ Gap | `sidecar_root` configuration is not implemented. Sidecars are always co-located. |
| Discovery order (§3.3) — `.mrsf.yaml` before co-location | ❌ Gap | No `.mrsf.yaml` lookup is attempted. |

### §4 — Top-Level Structure

| Spec requirement | Status | Notes |
|---|---|---|
| `mrsf_version` field present | ✅ Conformant | Written on every save via `mrsf_version_for()`. |
| `document` field present | ✅ Conformant | Set to the source file path. |
| `comments` array present | ✅ Conformant | Always written, even when empty (triggers sidecar delete). |

### §5 — Versioning

| Spec requirement | Status | Notes |
|---|---|---|
| Reject unknown major versions | ⚠️ Deviation | `load_sidecar` accepts **any** `mrsf_version` — a future `"2.0"` sidecar deserializes with silently dropped fields. Already noted in `docs/security.md` rule list. |

### §6.1 — Required Comment Fields

| Field | Status | Notes |
|---|---|---|
| `id` (string, UUIDv4/ULID) | ✅ Conformant | UUIDv4 generated on creation. |
| `author` (free-form, `Name (id)` convention) | ✅ Conformant | Format used; stored in sidecar. |
| `timestamp` (RFC 3339 with timezone) | ✅ Conformant | Generated with `Utc::now().to_rfc3339()`. |
| `text` (plain text, SHOULD NOT exceed 16384 chars) | ⚠️ No limit enforced | No `text` length validation on write or read. |
| `resolved` (boolean) | ✅ Conformant | |

### §6.2 — Optional Comment Fields

| Field | Status | Notes |
|---|---|---|
| `commit` | ✅ Conformant | Supported in schema; optional. |
| `type` | ✅ Conformant | Stored/rendered; recommended values supported. |
| `severity` | ✅ Conformant | `low`/`medium`/`high` + `Severity::None` for unset. |
| `selected_text` | ✅ Conformant | Clamped to 4096 chars (`SELECTED_TEXT_MAX_LENGTH`). |
| `anchored_text` | ✅ Conformant | Populated by fuzzy re-anchoring in `matching.rs`; omitted on exact match. |
| `reply_to` | ✅ Conformant | Flat threading model. |
| `selected_text_hash` | ✅ Conformant | SHA-256 hex digest, computed on creation. |
| `selected_text_hash` integrity verification | ❌ Gap | Spec says implementations SHOULD verify `selected_text` ↔ `selected_text_hash` consistency on load and flag mismatches. Not implemented. |

### §7 — Targeting and Anchoring

| Spec requirement | Status | Notes |
|---|---|---|
| `line` / `end_line` / `start_column` / `end_column` | ✅ Conformant | All fields supported in `MrsfCommentRepr`. |
| Cross-field validation (`end_line` ≥ `line`, etc.) | ❌ Gap | No validation on load or save. |
| Multiple-match disambiguation using `line`/column | ⚠️ Partial | `matching.rs` picks closest to original line on multiple exact matches, but does not flag ambiguous comments when no line is present (spec §7.2 MUST). |

### §7.4 — Anchoring Resolution Procedure

| Step | Status | Notes |
|---|---|---|
| 1. Exact text match | ✅ Conformant | Searches full document; prefers closest to original line. |
| 2. Line/column fallback | ✅ Conformant | Falls back to original line if in bounds. |
| 2b. Plausibility check on line content | ❌ Gap | Spec says skip to step 3 if content at line is "clearly unrelated". Implementation anchors unconditionally if line is in bounds. |
| 3. Contextual / fuzzy re-anchoring | ✅ Conformant | Levenshtein similarity ≥ 0.6; populates `anchored_text`. |
| 4. Orphan | ✅ Conformant | Comment retained, surfaced with orphan banner. |

### §9 — Lifecycle

| Spec requirement | Status | Notes |
|---|---|---|
| `resolved` lifecycle | ✅ Conformant | |
| Resolving parent MUST NOT auto-resolve replies | ✅ Conformant | Each comment's `resolved` is independent. |

### §9.1 — Deletion (Reply Promotion)

| Spec requirement | Status | Notes |
|---|---|---|
| Promote direct replies on parent delete | ✅ Conformant | `delete_comment()` in `core/comments.rs` reparents replies per §9.1, with tests (`delete_comment_reparents_replies`, `delete_comment_reparents_to_grandparent`). |
| Copy parent targeting fields to replies that omit them | ⚠️ Needs verification | Reparenting is tested, but field-copy when reply omits targeting fields should be confirmed. |

### §10 — Conformance and Error Handling

| Spec requirement | Status | Notes |
|---|---|---|
| Unknown fields treated as ignorable extensions | ✅ Conformant | `serde` `#[serde(default)]` + CLI raw-YAML path preserves unknown fields. |
| `x_`-prefix extension namespace reserved | ✅ Conformant | No `x_`-prefixed fields are used by mdownreview. Unknown fields pass through. |
| Reject `selected_text` > 4096 chars | ✅ Conformant | Clamped on write via `truncate_selected_text`. Note: clamped (truncated) rather than rejected — a soft deviation but within spec's SHOULD language. |
| Flag unresolved `reply_to` | ❌ Gap | No validation or warning when `reply_to` references a non-existent `id`. |
| Format-preserving YAML writes (§10.1) | ❌ Gap | `serde_yaml_ng` re-serializes the full sidecar; does not preserve YAML comments, scalar styles, or key ordering. |

### §13 — Security and Privacy

| Spec requirement | Status | Notes |
|---|---|---|
| Path traversal protection on document paths | ⚠️ Deviation | Already tracked in `docs/security.md` — IPC commands lack workspace-root path validation. |
| Size limits on sidecar reads | ✅ Conformant | `read_capped` in `io_guards.rs` enforces a 5 MB cap. |
| Sanitize `text`/`selected_text` before HTML rendering | ✅ Conformant | React escapes by default; `react-markdown` sanitizes. |

---

## Summary of Gaps

| # | Gap | Spec section | Severity |
|---|---|---|---|
| 1 | No `.mrsf.yaml` / `sidecar_root` alternate location | §3.2–3.3 | Low — MAY-level feature, not a conformance violation |
| 2 | No `mrsf_version` major-version rejection | §5 | Medium — silently loads future-incompatible sidecars |
| 3 | No `text` length limit (16384 char SHOULD) | §6.1 | Low — SHOULD-level |
| 4 | No `selected_text_hash` ↔ `selected_text` integrity check | §6.2 | Low — SHOULD-level |
| 5 | No cross-field validation (`end_line` ≥ `line`) | §7.1, §10 | Medium — could silently accept malformed sidecars |
| 6 | No plausibility check on line-fallback content | §7.4 step 2b | Low — may anchor to wrong line after major edits |
| 7 | No ambiguity flagging when multiple matches + no line hint | §7.2 | Low — current behavior picks first match |
| 8 | No `reply_to` dangling-reference warning | §10 | Low — SHOULD-level |
| 9 | YAML writes are not format-preserving | §10.1 | Medium — causes diff noise; SHOULD-level but high UX impact |
