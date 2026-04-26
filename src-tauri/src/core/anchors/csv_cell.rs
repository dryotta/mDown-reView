use super::MatchOutcome;
use crate::core::types::CsvCellAnchor;

/// Lightweight in-memory representation of a CSV document. Built once per
/// file by [`parse_csv`]; reused across all anchors targeting the file by
/// the dispatcher (Wave 1c).
pub(crate) struct CsvDoc {
    pub rows: Vec<Vec<String>>,
}

/// Hand-rolled RFC 4180 tokenizer. Lean pillar: a 40-line tokenizer is
/// preferable to pulling the full `csv` crate. Handles quoted fields,
/// escaped quotes (`""`), and CRLF/LF row separators. Non-UTF8 input is an
/// `Err(())`.
pub(crate) fn parse_csv(bytes: &[u8]) -> Result<CsvDoc, ()> {
    let s = std::str::from_utf8(bytes).map_err(|_| ())?;
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                field.push(c);
            }
        } else {
            match c {
                '"' if field.is_empty() => in_quotes = true,
                ',' => row.push(std::mem::take(&mut field)),
                '\r' => {
                    if chars.peek() == Some(&'\n') {
                        chars.next();
                    }
                    row.push(std::mem::take(&mut field));
                    rows.push(std::mem::take(&mut row));
                }
                '\n' => {
                    row.push(std::mem::take(&mut field));
                    rows.push(std::mem::take(&mut row));
                }
                _ => field.push(c),
            }
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    Ok(CsvDoc { rows })
}

/// Resolve a [`CsvCellAnchor`]. With a primary-key column, prefer pk-based
/// lookup so row reordering still resolves (`Fuzzy` if the key moved).
/// Without a pk, fall back to direct (row, col) indexing.
pub(crate) fn resolve(p: &CsvCellAnchor, doc: Option<&CsvDoc>) -> MatchOutcome {
    let doc = match doc {
        Some(d) => d,
        None => return MatchOutcome::Orphan,
    };

    if let (Some(pk_col), Some(pk_val)) = (&p.primary_key_col, &p.primary_key_value) {
        let header = doc.rows.first().map(|r| r.as_slice()).unwrap_or(&[]);
        let pk_ci = match header.iter().position(|h| h == pk_col.as_str()) {
            Some(i) => i,
            None => return MatchOutcome::Orphan,
        };
        // D4 — re-resolve the target column by header name so column
        // reordering survives. If `col_header` is missing entirely the
        // anchor degrades to file-level (the row resolved, the column
        // didn't); if it moved to a different index, the cell still
        // resolves but the anchor is `Fuzzy`.
        let header_ci = header.iter().position(|h| h == p.col_header.as_str());
        for (ri, row) in doc.rows.iter().enumerate().skip(1) {
            if row
                .get(pk_ci)
                .map(|v| v == pk_val.as_str())
                .unwrap_or(false)
            {
                let resolved_ci = match header_ci {
                    Some(ci) => ci,
                    None => return MatchOutcome::FileLevel,
                };
                if row.get(resolved_ci).is_none() {
                    return MatchOutcome::FileLevel;
                }
                let exact = ri == p.row_idx as usize && resolved_ci == p.col_idx as usize;
                return if exact {
                    MatchOutcome::Exact
                } else {
                    MatchOutcome::Fuzzy
                };
            }
        }
        return MatchOutcome::Orphan;
    }

    if doc
        .rows
        .get(p.row_idx as usize)
        .and_then(|r| r.get(p.col_idx as usize))
        .is_some()
    {
        MatchOutcome::Exact
    } else {
        MatchOutcome::Orphan
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc() -> CsvDoc {
        parse_csv(b"id,name,age\n1,Alice,30\n2,Bob,25\n3,Carol,40\n").unwrap()
    }

    #[test]
    fn exact_cell_by_index() {
        let p = CsvCellAnchor {
            row_idx: 1,
            col_idx: 1,
            col_header: "name".into(),
            primary_key_col: None,
            primary_key_value: None,
        };
        assert_eq!(resolve(&p, Some(&doc())), MatchOutcome::Exact);
    }

    #[test]
    fn pk_row_shifted_fuzzy() {
        // Anchor was captured at row 1 but Bob now lives at row 2.
        let p = CsvCellAnchor {
            row_idx: 1,
            col_idx: 1,
            col_header: "name".into(),
            primary_key_col: Some("id".into()),
            primary_key_value: Some("2".into()),
        };
        assert_eq!(resolve(&p, Some(&doc())), MatchOutcome::Fuzzy);
    }

    #[test]
    fn pk_key_missing_orphan() {
        let p = CsvCellAnchor {
            row_idx: 1,
            col_idx: 1,
            col_header: "name".into(),
            primary_key_col: Some("id".into()),
            primary_key_value: Some("999".into()),
        };
        assert_eq!(resolve(&p, Some(&doc())), MatchOutcome::Orphan);
    }

    #[test]
    fn out_of_bounds_orphan() {
        let p = CsvCellAnchor {
            row_idx: 99,
            col_idx: 0,
            col_header: "id".into(),
            primary_key_col: None,
            primary_key_value: None,
        };
        assert_eq!(resolve(&p, Some(&doc())), MatchOutcome::Orphan);
    }

    // D4 — when the row resolves via primary key but the headers have been
    // reordered, look up the column by `col_header` and resolve to the new
    // index. The match degrades to `Fuzzy` because the literal `col_idx`
    // in the anchor is now stale.
    #[test]
    fn pk_self_anchor_after_col_reorder() {
        // Original anchor was captured against `id,name,age` with
        // col_idx=1 (`name`). Current document has the columns swapped to
        // `id,age,name` so `name` lives at col_idx=2.
        let reordered = parse_csv(b"id,age,name\n1,30,Alice\n2,25,Bob\n").unwrap();
        let p = CsvCellAnchor {
            row_idx: 1,
            col_idx: 1,
            col_header: "name".into(),
            primary_key_col: Some("id".into()),
            primary_key_value: Some("2".into()),
        };
        assert_eq!(resolve(&p, Some(&reordered)), MatchOutcome::Fuzzy);
    }

    // D4 — when the column header is gone entirely, the row still
    // resolves but the cell can't, so we degrade to `FileLevel` rather
    // than orphan the comment outright.
    #[test]
    fn pk_self_anchor_col_header_removed_file_level() {
        let stripped = parse_csv(b"id,age\n1,30\n2,25\n").unwrap();
        let p = CsvCellAnchor {
            row_idx: 1,
            col_idx: 1,
            col_header: "name".into(),
            primary_key_col: Some("id".into()),
            primary_key_value: Some("2".into()),
        };
        assert_eq!(resolve(&p, Some(&stripped)), MatchOutcome::FileLevel);
    }
}
