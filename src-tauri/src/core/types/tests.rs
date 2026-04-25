//! Round-trip and schema-discriminator tests for [`super::MrsfComment`] and
//! [`super::Anchor`]. Extracted from `mod.rs` to keep that file under the
//! 400-LOC budget (rule 23 in `docs/architecture.md`).

use super::*;

/// Regression sentinel — DO NOT MODIFY. v1.0 sidecars must round-trip
/// without any v1.1 wire-field leaking into the output.
#[test]
fn v1_0_sidecar_round_trips_without_new_fields() {
    let json = r#"{
        "mrsf_version": "1.0",
        "document": "test.md",
        "comments": [{
            "id": "c1",
            "author": "alice",
            "timestamp": "2025-01-01T00:00:00Z",
            "text": "hello",
            "resolved": false,
            "line": 5
        }]
    }"#;
    let sidecar: MrsfSidecar = serde_json::from_str(json).unwrap();
    assert_eq!(sidecar.mrsf_version, "1.0");
    assert_eq!(sidecar.comments.len(), 1);

    let re = serde_json::to_string(&sidecar).unwrap();
    for forbidden in [
        "anchor_kind",
        "image_rect",
        "csv_cell",
        "json_path",
        "html_range",
        "html_element",
        "reactions",
        "anchor_history",
    ] {
        assert!(
            !re.contains(forbidden),
            "v1.0 round-trip leaked v1.1 field `{forbidden}`: {re}"
        );
    }
}

fn parse_one(json: &str) -> MrsfComment {
    let sidecar: MrsfSidecar = serde_json::from_str(json).unwrap();
    sidecar.comments.into_iter().next().unwrap()
}

fn wrap_comment(comment_body: &str) -> String {
    format!(
        r#"{{"mrsf_version":"1.1","document":"t.md","comments":[{}]}}"#,
        comment_body
    )
}

#[test]
fn v1_1_image_rect_round_trip_uses_tagged_layout() {
    let body = r#"{"id":"c1","author":"a","timestamp":"2025-01-01T00:00:00Z","text":"x","resolved":false,"anchor_kind":"image_rect","image_rect":{"x_pct":10.5,"y_pct":20.5,"w_pct":30.0,"h_pct":40.0}}"#;
    let c = parse_one(&wrap_comment(body));
    assert!(matches!(c.anchor, Anchor::ImageRect(_)));
    let re = serde_json::to_string(&c).unwrap();
    assert!(re.contains(r#""anchor_kind":"image_rect""#));
    assert!(re.contains(r#""image_rect""#));
    assert!(!re.contains(r#""line""#));
}

#[test]
fn v1_1_csv_cell_round_trip() {
    let body = r#"{"id":"c1","author":"a","timestamp":"t","text":"x","resolved":false,"anchor_kind":"csv_cell","csv_cell":{"row_idx":3,"col_idx":2,"col_header":"name"}}"#;
    let c = parse_one(&wrap_comment(body));
    assert!(matches!(c.anchor, Anchor::CsvCell(_)));
    let re = serde_json::to_string(&c).unwrap();
    assert!(re.contains(r#""anchor_kind":"csv_cell""#));
    assert!(re.contains(r#""csv_cell""#));
}

#[test]
fn v1_1_json_path_round_trip() {
    let body = r#"{"id":"c1","author":"a","timestamp":"t","text":"x","resolved":false,"anchor_kind":"json_path","json_path":{"json_path":"$.a","scalar_text":"v"}}"#;
    let c = parse_one(&wrap_comment(body));
    assert!(matches!(c.anchor, Anchor::JsonPath(_)));
    let re = serde_json::to_string(&c).unwrap();
    assert!(re.contains(r#""anchor_kind":"json_path""#));
}

#[test]
fn v1_1_html_range_round_trip() {
    let body = r#"{"id":"c1","author":"a","timestamp":"t","text":"x","resolved":false,"anchor_kind":"html_range","html_range":{"selector_path":"p","start_offset":0,"end_offset":5,"selected_text":"hello"}}"#;
    let c = parse_one(&wrap_comment(body));
    assert!(matches!(c.anchor, Anchor::HtmlRange(_)));
    let re = serde_json::to_string(&c).unwrap();
    assert!(re.contains(r#""anchor_kind":"html_range""#));
}

#[test]
fn v1_1_html_element_round_trip() {
    let body = r#"{"id":"c1","author":"a","timestamp":"t","text":"x","resolved":false,"anchor_kind":"html_element","html_element":{"selector_path":"div","tag":"div","text_preview":"hi"}}"#;
    let c = parse_one(&wrap_comment(body));
    assert!(matches!(c.anchor, Anchor::HtmlElement(_)));
    let re = serde_json::to_string(&c).unwrap();
    assert!(re.contains(r#""anchor_kind":"html_element""#));
}

#[test]
fn discriminator_payload_mismatch_is_rejected() {
    let body = r#"{"id":"c1","author":"a","timestamp":"t","text":"x","resolved":false,"anchor_kind":"image_rect"}"#;
    let res: Result<MrsfSidecar, _> = serde_json::from_str(&wrap_comment(body));
    assert!(res.is_err(), "expected mismatch error, got {:?}", res);
    let err = res.unwrap_err().to_string();
    assert!(
        err.contains("anchor_kind/payload mismatch"),
        "unexpected error: {err}"
    );
}

/// B7: per-variant declared-kind-but-wrong-payload (missing matching payload)
/// — every typed variant must reject its discriminator without payload.
#[test]
fn discriminator_missing_payload_rejected_for_all_typed_variants() {
    for kind in ["image_rect", "csv_cell", "json_path", "html_range", "html_element", "word_range"] {
        let body = format!(
            r#"{{"id":"c1","author":"a","timestamp":"t","text":"x","resolved":false,"anchor_kind":"{kind}"}}"#
        );
        let res: Result<MrsfSidecar, _> = serde_json::from_str(&wrap_comment(&body));
        assert!(res.is_err(), "kind={kind} should reject without payload");
    }
}

/// B7 inverse: payload sibling present without `anchor_kind` declaration is
/// rejected (closes the silently-ignored-payload class).
#[test]
fn payload_present_without_anchor_kind_rejected() {
    let body = r#"{"id":"c1","author":"a","timestamp":"t","text":"x","resolved":false,"image_rect":{"x_pct":1.0,"y_pct":2.0}}"#;
    let res: Result<MrsfSidecar, _> = serde_json::from_str(&wrap_comment(body));
    assert!(res.is_err(), "payload without anchor_kind must be rejected");
}

/// B9: declared `anchor_kind` with a stray sibling payload (mixed payloads)
/// is rejected, even when the matching payload is also present.
#[test]
fn mixed_payloads_with_typed_anchor_kind_rejected() {
    let body = r#"{"id":"c1","author":"a","timestamp":"t","text":"x","resolved":false,"anchor_kind":"image_rect","image_rect":{"x_pct":1.0,"y_pct":2.0},"csv_cell":{"row_idx":0,"col_idx":0,"col_header":"h"}}"#;
    let res: Result<MrsfSidecar, _> = serde_json::from_str(&wrap_comment(body));
    assert!(
        res.is_err(),
        "stray sibling payload alongside declared kind must be rejected"
    );
}

#[test]
fn anchor_history_caps_at_three_fifo() {
    let mut c = MrsfComment::default();
    for i in 1..=4u32 {
        c.push_anchor_history(Anchor::Line {
            line: i,
            end_line: None,
            start_column: None,
            end_column: None,
            selected_text: None,
            selected_text_hash: None,
        });
    }
    let h = c.anchor_history.as_ref().unwrap();
    assert_eq!(h.len(), 3);
    // Oldest (line 1) dropped; remaining are 2, 3, 4 in FIFO order.
    let lines: Vec<u32> = h
        .iter()
        .map(|a| match a {
            Anchor::Line { line, .. } => *line,
            _ => panic!("expected Line"),
        })
        .collect();
    assert_eq!(lines, vec![2, 3, 4]);
}

/// Stronger sibling of `anchor_history_caps_at_three_fifo`: push 5 to make
/// sure the FIFO eviction loop evicts *both* over-cap entries (not just the
/// most-recent overflow). Guards against an off-by-one regression where a
/// `if h.len() == CAP` check would let the second overflow through.
#[test]
fn push_anchor_history_clamps_at_three_with_five_pushes() {
    let mut c = MrsfComment::default();
    for i in 1..=5u32 {
        c.push_anchor_history(Anchor::Line {
            line: i,
            end_line: None,
            start_column: None,
            end_column: None,
            selected_text: None,
            selected_text_hash: None,
        });
    }
    let h = c.anchor_history.as_ref().unwrap();
    assert_eq!(h.len(), 3);
    let lines: Vec<u32> = h
        .iter()
        .map(|a| match a {
            Anchor::Line { line, .. } => *line,
            _ => panic!("expected Line"),
        })
        .collect();
    // history[0] is the 3rd push, history[2] is the 5th — oldest two evicted.
    assert_eq!(lines, vec![3, 4, 5]);
}

#[test]
fn v1_0_byte_identity_fixture() {
    let raw = include_str!("../../../tests/fixtures/mrsf/v1.0/byte_identity.yaml");
    // Normalise CRLF in the on-disk fixture (Windows checkout) before
    // comparison — serde_yaml_ng emits LF unconditionally.
    let input = raw.replace("\r\n", "\n");
    let sidecar: MrsfSidecar = serde_yaml_ng::from_str(&input).unwrap();
    let re = serde_yaml_ng::to_string(&sidecar).unwrap();
    assert_eq!(input, re, "v1.0 fixture must round-trip byte-identically");
}

#[test]
fn legacy_line_constructor_keeps_flat_and_anchor_in_sync() {
    let c = MrsfComment::new_legacy_line(
        "c1".into(),
        "a".into(),
        "t".into(),
        "x".into(),
        false,
        Some(7),
        Some(9),
        None,
        None,
        None,
        None,
    );
    assert_eq!(c.line, Some(7));
    match &c.anchor {
        Anchor::Line { line, end_line, .. } => {
            assert_eq!(*line, 7);
            assert_eq!(*end_line, Some(9));
        }
        _ => panic!("expected Line"),
    }
}

// ── Group D-wire (iter 3): WordRange anchor ─────────────────────────────────
//
// `WordRange` is a v1.1-only typed variant with security-validated payload
// (snippet ≤ 4 KB, no NUL, bidi/ZW chars stripped on ingest, hash regex).

const VALID_HASH: &str = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

fn word_range_body(snippet: &str, hash: &str) -> String {
    format!(
        r#"{{"id":"c1","author":"a","timestamp":"t","text":"x","resolved":false,"anchor_kind":"word_range","word_range":{{"start_word":2,"end_word":4,"line":3,"snippet":{},"line_text_hash":"{}"}}}}"#,
        serde_json::to_string(snippet).unwrap(),
        hash,
    )
}

#[test]
fn word_range_round_trip() {
    let body = word_range_body("hello world", VALID_HASH);
    let c = parse_one(&wrap_comment(&body));
    match &c.anchor {
        Anchor::WordRange(p) => {
            assert_eq!(p.start_word, 2);
            assert_eq!(p.end_word, 4);
            assert_eq!(p.line, 3);
            assert_eq!(p.snippet, "hello world");
            assert_eq!(p.line_text_hash, VALID_HASH);
        }
        _ => panic!("expected WordRange"),
    }
    let re = serde_json::to_string(&c).unwrap();
    assert!(re.contains(r#""anchor_kind":"word_range""#));
    assert!(re.contains(r#""word_range""#));
    assert!(re.contains(r#""start_word":2"#));
    // No flat line legacy field for typed variants.
    assert!(!re.contains(r#""line":0"#));
}

#[test]
fn word_range_oversize_snippet_rejected() {
    let huge = "a".repeat(4097); // 4 KB + 1 byte
    let body = word_range_body(&huge, VALID_HASH);
    let res: Result<MrsfSidecar, _> = serde_json::from_str(&wrap_comment(&body));
    assert!(res.is_err(), "4097-byte snippet must be rejected");
    let err = res.unwrap_err().to_string();
    assert!(err.contains("snippet exceeds"), "unexpected error: {err}");
}

#[test]
fn word_range_nul_in_snippet_rejected() {
    let body = word_range_body("hello\0world", VALID_HASH);
    let res: Result<MrsfSidecar, _> = serde_json::from_str(&wrap_comment(&body));
    assert!(res.is_err(), "NUL in snippet must be rejected");
    let err = res.unwrap_err().to_string();
    assert!(err.contains("NUL"), "unexpected error: {err}");
}

#[test]
fn word_range_strips_bidi_chars() {
    // U+202E (RLO) + U+200B (ZWSP) interleaved with normal text.
    let body = word_range_body("he\u{202E}llo\u{200B} world", VALID_HASH);
    let c = parse_one(&wrap_comment(&body));
    match &c.anchor {
        Anchor::WordRange(p) => assert_eq!(p.snippet, "hello world"),
        _ => panic!("expected WordRange"),
    }
}

#[test]
fn word_range_invalid_hash_rejected() {
    // Wrong length.
    let body = word_range_body("ok", "deadbeef");
    let res: Result<MrsfSidecar, _> = serde_json::from_str(&wrap_comment(&body));
    assert!(res.is_err(), "short hash must be rejected");
    // Non-hex char.
    let bad = "z".to_string() + &VALID_HASH[1..];
    let body = word_range_body("ok", &bad);
    let res: Result<MrsfSidecar, _> = serde_json::from_str(&wrap_comment(&body));
    assert!(res.is_err(), "non-hex hash must be rejected");
    // Uppercase rejected (regex requires lowercase).
    let upper = VALID_HASH.to_uppercase();
    let body = word_range_body("ok", &upper);
    let res: Result<MrsfSidecar, _> = serde_json::from_str(&wrap_comment(&body));
    assert!(res.is_err(), "uppercase hash must be rejected");
}

#[test]
fn word_range_promotes_to_v1_1() {
    use crate::core::mrsf_version::mrsf_version_for;
    use crate::core::types::WordRangePayload;
    let c = MrsfComment {
        anchor: Anchor::WordRange(WordRangePayload {
            start_word: 0,
            end_word: 1,
            line: 1,
            snippet: "x".into(),
            line_text_hash: VALID_HASH.into(),
        }),
        ..Default::default()
    };
    assert_eq!(mrsf_version_for(&[c]), "1.1");
}
