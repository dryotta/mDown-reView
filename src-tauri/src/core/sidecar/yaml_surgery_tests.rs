//! Tests for YAML surgery. Extracted to keep `yaml_surgery.rs` under
//! the 400-LOC budget (rule 23 in `docs/architecture.md`).

use super::*;
use crate::core::types::CommentMutation;

const SAMPLE_YAML: &str = "\
mrsf_version: '1.0'
document: test.md
comments:
  - id: c1
    text: hello
    resolved: false
  - id: c2
    text: world
    resolved: true
";

#[test]
fn find_comment_block_finds_by_id() {
    let (start, end) = find_comment_block(SAMPLE_YAML, "c1").unwrap();
    let block = &SAMPLE_YAML[start..end];
    assert!(block.contains("id: c1"), "block: {block}");
    assert!(!block.contains("id: c2"), "block: {block}");
}

#[test]
fn find_comment_block_finds_second() {
    let (start, end) = find_comment_block(SAMPLE_YAML, "c2").unwrap();
    let block = &SAMPLE_YAML[start..end];
    assert!(block.contains("id: c2"));
    assert!(!block.contains("id: c1"));
}

#[test]
fn find_comment_block_quoted_id() {
    let yaml = "\
mrsf_version: '1.0'
document: test.md
comments:
  - id: \"c1\"
    text: hello
    resolved: false
";
    let (start, end) = find_comment_block(yaml, "c1").unwrap();
    assert!(yaml[start..end].contains("id: \"c1\""));
}

#[test]
fn find_comment_block_missing_returns_none() {
    assert!(find_comment_block(SAMPLE_YAML, "nonexistent").is_none());
}

#[test]
fn set_resolved_preserves_comments_and_formatting() {
    let yaml = "\
# file header comment
mrsf_version: '1.0'
document: test.md
comments:
  - id: c1
    # reviewer note
    text: hello
    resolved: false
  - id: c2
    text: world
    resolved: true
";
    let result = try_patch(yaml, "c1", &[CommentMutation::SetResolved(true)]).unwrap();
    // YAML comment preserved
    assert!(result.contains("# file header comment"));
    assert!(result.contains("# reviewer note"));
    // c1 resolved changed
    let c1_block_start = result.find("id: c1").unwrap();
    let c1_block_end = result.find("id: c2").unwrap();
    let c1_block = &result[c1_block_start..c1_block_end];
    assert!(c1_block.contains("resolved: true"), "c1_block: {c1_block}");
    // c2 still true (unchanged)
    let c2_block = &result[result.find("id: c2").unwrap()..];
    assert!(c2_block.contains("resolved: true"));
    // Overall structure preserved
    assert!(result.contains("mrsf_version: '1.0'"));
}

#[test]
fn set_resolved_false() {
    let result =
        try_patch(SAMPLE_YAML, "c2", &[CommentMutation::SetResolved(false)]).unwrap();
    let c2_block = &result[result.find("id: c2").unwrap()..];
    assert!(c2_block.contains("resolved: false"));
}

#[test]
fn surgery_returns_none_for_missing_comment() {
    assert!(
        try_patch(SAMPLE_YAML, "nonexistent", &[CommentMutation::SetResolved(true)]).is_none()
    );
}

#[test]
fn surgery_returns_none_for_empty_mutations() {
    assert!(try_patch(SAMPLE_YAML, "c1", &[]).is_none());
}

#[test]
fn add_response_to_existing_responses() {
    let yaml = "\
mrsf_version: '1.0'
document: test.md
comments:
  - id: c1
    text: hello
    resolved: false
    responses:
      - author: alice
        text: first response
        timestamp: '2024-01-01T00:00:00Z'
";
    let mutation = CommentMutation::AddResponse {
        author: "bob".to_string(),
        text: "second response".to_string(),
        timestamp: "2024-01-02T00:00:00Z".to_string(),
    };
    let result = try_patch(yaml, "c1", &[mutation]).unwrap();
    assert!(result.contains("author: alice"), "result:\n{result}");
    assert!(result.contains("author: bob"), "result:\n{result}");
    assert!(
        result.contains("text: second response"),
        "result:\n{result}"
    );
    // Original formatting preserved
    assert!(result.contains("mrsf_version: '1.0'"));
}

#[test]
fn add_response_to_empty_sequence() {
    let yaml = "\
mrsf_version: '1.0'
document: test.md
comments:
  - id: c1
    text: hello
    resolved: false
    responses: []
";
    let mutation = CommentMutation::AddResponse {
        author: "bob".to_string(),
        text: "new response".to_string(),
        timestamp: "2024-01-02T00:00:00Z".to_string(),
    };
    let result = try_patch(yaml, "c1", &[mutation]).unwrap();
    assert!(result.contains("author: bob"), "result:\n{result}");
    assert!(!result.contains("[]"), "result:\n{result}");
}

#[test]
fn add_response_when_field_absent() {
    let yaml = "\
mrsf_version: '1.0'
document: test.md
comments:
  - id: c1
    text: hello
    resolved: false
  - id: c2
    text: world
    resolved: true
";
    let mutation = CommentMutation::AddResponse {
        author: "bob".to_string(),
        text: "new response".to_string(),
        timestamp: "2024-01-02T00:00:00Z".to_string(),
    };
    let result = try_patch(yaml, "c1", &[mutation]).unwrap();
    assert!(result.contains("responses:"), "result:\n{result}");
    assert!(result.contains("author: bob"), "result:\n{result}");
    // c2 untouched
    assert!(result.contains("id: c2"));
}

#[test]
fn multiple_mutations_in_sequence() {
    let result = try_patch(
        SAMPLE_YAML,
        "c1",
        &[
            CommentMutation::SetResolved(true),
            CommentMutation::AddResponse {
                author: "agent".to_string(),
                text: "done".to_string(),
                timestamp: "2025-01-01T00:00:00Z".to_string(),
            },
        ],
    )
    .unwrap();
    let c1_area = &result[result.find("id: c1").unwrap()..result.find("id: c2").unwrap()];
    assert!(c1_area.contains("resolved: true"), "c1: {c1_area}");
    assert!(c1_area.contains("author: agent"), "c1: {c1_area}");
}

#[test]
fn output_is_valid_yaml() {
    let result =
        try_patch(SAMPLE_YAML, "c1", &[CommentMutation::SetResolved(true)]).unwrap();
    let parsed: Result<serde_json::Value, _> = serde_saphyr::from_str(&result);
    assert!(parsed.is_ok(), "Invalid YAML: {result}");
}

#[test]
fn output_after_add_response_is_valid_yaml() {
    let mutation = CommentMutation::AddResponse {
        author: "bob".to_string(),
        text: "hello world".to_string(),
        timestamp: "2025-01-01T00:00:00Z".to_string(),
    };
    let result = try_patch(SAMPLE_YAML, "c1", &[mutation]).unwrap();
    let parsed: Result<serde_json::Value, _> = serde_saphyr::from_str(&result);
    assert!(parsed.is_ok(), "Invalid YAML:\n{result}");
}

#[test]
fn quote_if_needed_leaves_simple_strings() {
    assert_eq!(quote_if_needed("hello"), "hello");
    assert_eq!(quote_if_needed("bob"), "bob");
}

#[test]
fn quote_if_needed_quotes_special_chars() {
    assert_eq!(quote_if_needed("hello: world"), "\"hello: world\"");
    assert_eq!(quote_if_needed("a # b"), "\"a # b\"");
}
