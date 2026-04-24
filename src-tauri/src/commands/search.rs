//! Document-search and pure-parser commands exposed to the View layer.

pub use crate::core::kql::KqlPipelineStep;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub line_index: usize,
    pub start_col: usize,
    pub end_col: usize,
}

#[tauri::command]
pub fn search_in_document(content: String, query: String) -> Vec<SearchMatch> {
    if query.is_empty() {
        return vec![];
    }
    let lower_query = query.to_lowercase();
    let query_chars = lower_query.chars().count();
    let mut results = Vec::new();
    for (i, line) in content.lines().enumerate() {
        let lower_line = line.to_lowercase();
        let chars: Vec<char> = lower_line.chars().collect();
        let query_chars_vec: Vec<char> = lower_query.chars().collect();
        let mut pos = 0;
        while pos + query_chars <= chars.len() {
            if chars[pos..pos + query_chars] == query_chars_vec[..] {
                results.push(SearchMatch {
                    line_index: i,
                    start_col: pos,
                    end_col: pos + query_chars,
                });
                pos += 1;
            } else {
                pos += 1;
            }
        }
    }
    results
}

#[tauri::command]
pub fn parse_kql(query: String) -> Vec<KqlPipelineStep> {
    crate::core::kql::parse_kql_pipeline(&query)
}

#[tauri::command]
pub fn strip_json_comments(text: String) -> String {
    crate::core::json::strip_json_comments(&text)
}
